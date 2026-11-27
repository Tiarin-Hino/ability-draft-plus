//! Windows native WinRT OCR (`Windows.Media.Ocr`) for player-card hero names.

use windows::{
    core::h,
    Globalization::Language,
    Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap},
    Media::Ocr::OcrEngine as WinRtOcrEngine,
    Security::Cryptography::CryptographicBuffer,
    Win32::{
        Foundation::RPC_E_CHANGED_MODE,
        System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
    },
};

use crate::{MlError, OcrEngine};

pub struct WindowsOcrEngine {
    engine: WinRtOcrEngine,
}

// WinRT agile OcrEngine supports multi-threaded usage across STA/MTA callers.
unsafe impl Send for WindowsOcrEngine {}
unsafe impl Sync for WindowsOcrEngine {}

impl WindowsOcrEngine {
    pub fn new() -> Result<Self, MlError> {
        unsafe {
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            if hr.is_err() && hr != RPC_E_CHANGED_MODE {
                return Err(MlError::Ocr(format!("CoInitializeEx failed: {hr:?}")));
            }
        }

        let engine = Language::CreateLanguage(h!("en-US"))
            .and_then(|lang| WinRtOcrEngine::TryCreateFromLanguage(&lang))
            .or_else(|_| WinRtOcrEngine::TryCreateFromUserProfileLanguages())
            .map_err(|e| MlError::Ocr(format!("failed to create WinRT OcrEngine: {e}")))?;

        Ok(Self { engine })
    }
}

impl OcrEngine for WindowsOcrEngine {
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

        let buf = CryptographicBuffer::CreateFromByteArray(&rgba_bytes[..expected])
            .map_err(|e| MlError::Ocr(format!("CreateFromByteArray failed: {e}")))?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &buf,
            BitmapPixelFormat::Rgba8,
            width as i32,
            height as i32,
        )
        .map_err(|e| MlError::Ocr(format!("SoftwareBitmap::CreateCopyFromBuffer failed: {e}")))?;

        let op = self
            .engine
            .RecognizeAsync(&bitmap)
            .map_err(|e| MlError::Ocr(format!("RecognizeAsync failed: {e}")))?;
        let result = op
            .join()
            .map_err(|e| MlError::Ocr(format!("OCR async wait failed: {e}")))?;
        let text = result
            .Text()
            .map_err(|e| MlError::Ocr(format!("OCR result Text() failed: {e}")))?;
        Ok(text.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializes_winrt_ocr_and_handles_blank_image() {
        let mut ocr = WindowsOcrEngine::new().expect("init Windows.Media.Ocr");
        let blank = vec![0u8; 64 * 32 * 4];
        let text = ocr
            .recognize_hero_card_text(&blank, 64, 32)
            .expect("recognize blank image");
        assert!(text.trim().is_empty());
    }
}
