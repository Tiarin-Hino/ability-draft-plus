//! Machine learning inference, template matching, and card OCR abstractions.
//!
//! ONNX model contract (`resources/model/ability_classifier_fp16.onnx` + `class_names.json`):
//! - Dynamic class count validated at init against `class_names.json`.
//! - Input tensor shape: `[batch, 96, 96, 3]` (`INPUT_SIZE = 96`).
//! - Pixel range: raw `0.0..=255.0` `f32` (the ONNX graph includes its own `Rescaling` layer).

use thiserror::Error;

pub const INPUT_SIZE: u32 = 96;
pub const DEFAULT_POOL_CONFIDENCE_THRESHOLD: f32 = 0.90;
pub const PICK_TEMPLATE_FALLBACK_MIN_NCC: f32 = 0.70;
pub const OCR_UNSCOPED_MIN_SIMILARITY: f32 = 0.85;

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
}

#[derive(Debug, Clone, PartialEq)]
pub struct TemplateMatch {
    pub ability_name: String,
    pub ncc_score: f32,
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
    fn recognize_hero_card_text(&mut self, image_bytes: &[u8], width: u32, height: u32) -> Result<String, MlError>;
}
