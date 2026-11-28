//! Machine learning inference, template matching, and card OCR abstractions.
//!
//! ONNX model contract (`resources/model/ability_classifier_fp16.onnx` + `class_names.json`):
//! - Dynamic class count validated at init against `class_names.json`.
//! - Input tensor shape: `[batch, 96, 96, 3]` (`INPUT_SIZE = 96`).
//! - Pixel range: raw `0.0..=255.0` `f32` (the ONNX graph includes its own `Rescaling` layer).

use thiserror::Error;

pub mod card_ocr;
#[cfg(not(target_os = "windows"))]
pub mod fallback_ocr;
pub mod hero_matcher;
pub mod onnx;
pub mod template_matcher;
#[cfg(target_os = "windows")]
pub mod windows_ocr;

pub const INPUT_SIZE: u32 = 96;
pub const DEFAULT_POOL_CONFIDENCE_THRESHOLD: f32 = 0.90;
pub const PICK_TEMPLATE_COMPARE_SIZE: u32 = 48;
pub const PICK_TEMPLATE_CROP_INSET_RATIO: f32 = 0.08;
pub const PICK_TEMPLATE_MIN_NCC: f32 = 0.45;
pub const PICK_TEMPLATE_MIN_MARGIN: f32 = 0.02;
pub const PICK_TEMPLATE_FALLBACK_MIN_NCC: f32 = 0.85;
pub const PICK_TEMPLATE_EMPTY_STD: f32 = 25.0;
pub const OCR_MIN_SIMILARITY: f32 = 0.60;
pub const OCR_UNSCOPED_MIN_SIMILARITY: f32 = 0.85;

pub fn class_threshold_override(class_name: &str) -> Option<f32> {
    match class_name {
        "crystal_maiden_crystal_nova"
        | "medusa_gorgon_grasp"
        | "nevermore_shadowraze2" => Some(0.50),
        _ => None,
    }
}

#[derive(Debug, Clone)]
pub struct SlotCrop<'a> {
    pub slot_index: usize,
    pub width: u32,
    pub height: u32,
    pub rgb_bytes: &'a [u8],
}

#[derive(Debug, Clone, PartialEq)]
pub struct Prediction {
    pub slot_index: usize,
    pub class_name: Option<String>,
    pub confidence: f32,
    pub class_index: usize,
}

#[derive(Debug, Error)]
pub enum MlError {
    #[error("model class count ({model_classes}) does not match class_names.json ({manifest_classes})")]
    ClassCountMismatch {
        model_classes: usize,
        manifest_classes: usize,
    },
    #[error("inference failed: {0}")]
    Inference(String),
    #[error("ocr failed: {0}")]
    Ocr(String),
}

pub trait MlClassifier: Send + Sync {
    fn class_count(&self) -> usize;
    fn classify_pool_slots(&mut self, crops: &[SlotCrop<'_>]) -> Result<Vec<Prediction>, MlError>;
}

pub trait OcrEngine: Send + Sync {
    fn recognize_hero_card_text(
        &mut self,
        rgba_bytes: &[u8],
        width: u32,
        height: u32,
    ) -> Result<String, MlError>;
}

pub fn default_ocr_engine() -> Result<Box<dyn OcrEngine>, MlError> {
    #[cfg(target_os = "windows")]
    {
        Ok(Box::new(windows_ocr::WindowsOcrEngine::new()?))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Box::new(fallback_ocr::FallbackOcrEngine))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_ocr_engine_constructs() {
        let engine = default_ocr_engine();
        assert!(engine.is_ok(), "unexpected OCR init error: {:?}", engine.err());
    }
}
