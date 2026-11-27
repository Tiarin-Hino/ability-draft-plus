//! Cross-platform OCR fallback stub for non-Windows hosts prior to macOS Vision / Linux ocrs integration.

use crate::{MlError, OcrEngine};

#[derive(Debug, Default)]
pub struct FallbackOcrEngine;

impl OcrEngine for FallbackOcrEngine {
    fn recognize_hero_card_text(
        &mut self,
        rgba_bytes: &[u8],
        width: u32,
        height: u32,
    ) -> Result<String, MlError> {
        let expected = (width as usize) * (height as usize) * 4;
        if width == 0 || height == 0 || rgba_bytes.len() < expected {
            return Err(MlError::Ocr(format!(
                "invalid RGBA image buffer ({width}x{height}, {} bytes)",
                rgba_bytes.len()
            )));
        }
        Err(MlError::Ocr(
            "native OCR backend not yet implemented on this platform".to_string(),
        ))
    }
}
