//! ONNX Runtime pool-slot classifier (`ability_classifier_fp16.onnx`).
//!
//! Mirrors `src/core/ml/onnx-classifier.ts`:
//! - Validates `session` output width against `class_names.json` during warmup.
//! - Accepts raw `0.0..=255.0` `f32` `[batch, 96, 96, 3]` NHWC tensors.
//! - Supports active-pool class masking and per-class threshold overrides.

use std::{
    collections::HashSet,
    fs,
    path::Path,
    sync::OnceLock,
};

use ort::{
    environment::Environment,
    session::{builder::GraphOptimizationLevel, Session},
    value::Tensor,
};

use crate::{class_threshold_override, MlClassifier, MlError, Prediction, SlotCrop, INPUT_SIZE};

static ORT_ENV: OnceLock<Result<Environment, String>> = OnceLock::new();

fn shared_ort_env() -> Result<&'static Environment, MlError> {
    let res = ORT_ENV.get_or_init(|| ort::init().build().map_err(|e| e.to_string()));
    match res {
        Ok(env) => Ok(env),
        Err(msg) => Err(MlError::Inference(format!(
            "failed to initialize ONNX environment: {msg}"
        ))),
    }
}

pub struct OnnxPoolClassifier {
    session: Session,
    class_names: Vec<String>,
    input_name: String,
    output_name: String,
}

impl OnnxPoolClassifier {
    pub fn load(model_path: &Path, class_names_path: &Path) -> Result<Self, MlError> {
        let raw_names = fs::read_to_string(class_names_path)
            .map_err(|e| MlError::Inference(format!("failed to read class_names.json: {e}")))?;
        let class_names: Vec<String> = serde_json::from_str(&raw_names)
            .map_err(|e| MlError::Inference(format!("invalid class_names.json: {e}")))?;
        if class_names.is_empty() {
            return Err(MlError::Inference("class_names.json is empty".to_string()));
        }

        let env = shared_ort_env()?;

        let mut session = Session::builder(env)
            .map_err(|e| MlError::Inference(format!("failed to create ONNX session builder: {e}")))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| MlError::Inference(format!("failed to set ONNX optimization level: {e}")))?
            .commit_from_file(model_path)
            .map_err(|e| MlError::Inference(format!("failed to load ONNX model: {e}")))?;

        let input_name = session
            .inputs()
            .first()
            .map(|o| o.name().to_string())
            .ok_or_else(|| MlError::Inference("ONNX model has no inputs".to_string()))?;
        let output_name = session
            .outputs()
            .first()
            .map(|o| o.name().to_string())
            .ok_or_else(|| MlError::Inference("ONNX model has no outputs".to_string()))?;

        // Warmup inference + output width validation against class_names.json
        let side = INPUT_SIZE as usize;
        let dummy = vec![0.0f32; side * side * 3];
        let dummy_tensor = Tensor::from_array(([1usize, side, side, 3], dummy))
            .map_err(|e| MlError::Inference(format!("failed to build warmup tensor: {e}")))?;
        let output_classes = {
            let outputs = session
                .run(ort::inputs![input_name.as_str() => dummy_tensor])
                .map_err(|e| MlError::Inference(format!("warmup inference failed: {e}")))?;
            let (_shape, slice) = outputs[output_name.as_str()]
                .try_extract_tensor::<f32>()
                .map_err(|e| MlError::Inference(format!("failed to read warmup output: {e}")))?;
            slice.len()
        };
        if output_classes != class_names.len() {
            return Err(MlError::ClassCountMismatch {
                model_classes: output_classes,
                manifest_classes: class_names.len(),
            });
        }

        Ok(Self {
            session,
            class_names,
            input_name,
            output_name,
        })
    }

    pub fn classify_batch(
        &mut self,
        batch_f32: &[f32],
        batch_size: usize,
        confidence_threshold: f32,
        active_class_names: Option<&HashSet<String>>,
    ) -> Result<Vec<Prediction>, MlError> {
        let side = INPUT_SIZE as usize;
        let expected = batch_size * side * side * 3;
        if batch_f32.len() != expected {
            return Err(MlError::Inference(format!(
                "batch float length {} does not match expected {expected}",
                batch_f32.len()
            )));
        }
        if batch_size == 0 {
            return Ok(Vec::new());
        }

        let excluded: Option<Vec<bool>> = match active_class_names {
            Some(active) if !active.is_empty() => {
                let mask: Vec<bool> = self
                    .class_names
                    .iter()
                    .map(|name| !active.contains(name))
                    .collect();
                if mask.iter().all(|&ex| ex) {
                    None
                } else {
                    Some(mask)
                }
            }
            _ => None,
        };

        let tensor = Tensor::from_array(([batch_size, side, side, 3], batch_f32.to_vec()))
            .map_err(|e| MlError::Inference(format!("failed to build input tensor: {e}")))?;
        let outputs = self
            .session
            .run(ort::inputs![self.input_name.as_str() => tensor])
            .map_err(|e| MlError::Inference(format!("ONNX run failed: {e}")))?;
        let (_shape, probs) = outputs[self.output_name.as_str()]
            .try_extract_tensor::<f32>()
            .map_err(|e| MlError::Inference(format!("failed to read ONNX output: {e}")))?;

        let num_classes = self.class_names.len();
        let mut results = Vec::with_capacity(batch_size);

        for i in 0..batch_size {
            let offset = i * num_classes;
            let mut max_prob = 0.0f32;
            let mut max_idx = 0usize;
            for j in 0..num_classes {
                if excluded.as_ref().is_some_and(|m| m[j]) {
                    continue;
                }
                let val = probs[offset + j];
                if val > max_prob {
                    max_prob = val;
                    max_idx = j;
                }
            }
            let predicted = self.class_names.get(max_idx).map(String::as_str);
            let effective_threshold = predicted
                .and_then(class_threshold_override)
                .unwrap_or(confidence_threshold);
            let accepted = predicted
                .filter(|_| max_prob >= effective_threshold)
                .map(ToOwned::to_owned);

            results.push(Prediction {
                slot_index: i,
                class_name: accepted,
                confidence: max_prob,
                class_index: max_idx,
            });
        }

        Ok(results)
    }
}

impl MlClassifier for OnnxPoolClassifier {
    fn class_count(&self) -> usize {
        self.class_names.len()
    }

    fn classify_pool_slots(&mut self, crops: &[SlotCrop<'_>]) -> Result<Vec<Prediction>, MlError> {
        let side = INPUT_SIZE as usize;
        let expected_crop_bytes = side * side * 3;
        let mut batch = Vec::with_capacity(crops.len() * expected_crop_bytes);
        for crop in crops {
            if crop.width != INPUT_SIZE
                || crop.height != INPUT_SIZE
                || crop.rgb_bytes.len() != expected_crop_bytes
            {
                return Err(MlError::Inference(format!(
                    "slot {} crop must be {}x{} RGB8 ({expected_crop_bytes} bytes)",
                    crop.slot_index, INPUT_SIZE, INPUT_SIZE
                )));
            }
            batch.extend(crop.rgb_bytes.iter().map(|&b| b as f32));
        }

        let mut preds = self.classify_batch(
            &batch,
            crops.len(),
            crate::DEFAULT_POOL_CONFIDENCE_THRESHOLD,
            None,
        )?;
        for (pred, crop) in preds.iter_mut().zip(crops.iter()) {
            pred.slot_index = crop.slot_index;
        }
        Ok(preds)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn loads_real_fp16_model_validates_528_classes_and_runs_batch() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../resources/model");
        let model_path = root.join("ability_classifier_fp16.onnx");
        let names_path = root.join("class_names.json");
        assert!(model_path.exists(), "missing {}", model_path.display());
        assert!(names_path.exists(), "missing {}", names_path.display());

        let mut clf = OnnxPoolClassifier::load(&model_path, &names_path)
            .expect("load real ONNX FP16 model");
        assert_eq!(clf.class_count(), 528);

        let crop_bytes = vec![128u8; (INPUT_SIZE as usize) * (INPUT_SIZE as usize) * 3];
        let crops = vec![
            SlotCrop {
                slot_index: 0,
                width: INPUT_SIZE,
                height: INPUT_SIZE,
                rgb_bytes: &crop_bytes,
            },
            SlotCrop {
                slot_index: 7,
                width: INPUT_SIZE,
                height: INPUT_SIZE,
                rgb_bytes: &crop_bytes,
            },
        ];
        let preds = clf.classify_pool_slots(&crops).expect("run 2-slot batch");
        assert_eq!(preds.len(), 2);
        assert_eq!(preds[0].slot_index, 0);
        assert_eq!(preds[1].slot_index, 7);
        for p in preds {
            assert!(p.confidence.is_finite() && (0.0..=1.0).contains(&p.confidence));
        }
    }
}
