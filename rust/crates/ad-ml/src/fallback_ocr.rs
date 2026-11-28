//! Cross-platform OCR backend for non-Windows hosts using the `tesseract` CLI (`eng`, PSM 11).

use std::{
    io::{ErrorKind, Write},
    process::{Command, Stdio},
};

use crate::{MlError, OcrEngine};

#[derive(Debug, Default)]
pub struct FallbackOcrEngine;

pub fn encode_rgba_as_ppm(rgba_bytes: &[u8], width: u32, height: u32) -> Result<Vec<u8>, MlError> {
    let expected = (width as usize).saturating_mul(height as usize).saturating_mul(4);
    if width == 0 || height == 0 || rgba_bytes.len() < expected {
        return Err(MlError::Ocr(format!(
            "invalid RGBA image buffer ({width}x{height}, {} bytes)",
            rgba_bytes.len()
        )));
    }
    let header = format!("P6\n{width} {height}\n255\n");
    let pixels = (width as usize) * (height as usize);
    let mut ppm = Vec::with_capacity(header.len() + pixels * 3);
    ppm.extend_from_slice(header.as_bytes());
    for px in rgba_bytes[..expected].as_chunks::<4>().0 {
        ppm.extend_from_slice(&[px[0], px[1], px[2]]);
    }
    Ok(ppm)
}

impl OcrEngine for FallbackOcrEngine {
    fn recognize_hero_card_text(
        &mut self,
        rgba_bytes: &[u8],
        width: u32,
        height: u32,
    ) -> Result<String, MlError> {
        let ppm = encode_rgba_as_ppm(rgba_bytes, width, height)?;

        let mut child = match Command::new("tesseract")
            .args(["stdin", "stdout", "--psm", "11", "-l", "eng"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(err) if err.kind() == ErrorKind::NotFound => {
                return Err(MlError::Ocr("tesseract CLI not installed".to_string()));
            }
            Err(err) => {
                return Err(MlError::Ocr(format!("failed to invoke tesseract: {err}")));
            }
        };

        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(&ppm);
        }
        let output = child
            .wait_with_output()
            .map_err(|e| MlError::Ocr(format!("tesseract wait failed: {e}")))?;
        if !output.status.success() {
            return Err(MlError::Ocr(format!(
                "tesseract exited with status {}",
                output.status
            )));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_ppm_header_and_rgb_pixels_and_rejects_bad_buffer() {
        let rgba = vec![
            10, 20, 30, 255, // pixel 0
            40, 50, 60, 255, // pixel 1
        ];
        let ppm = encode_rgba_as_ppm(&rgba, 2, 1).expect("encode 2x1 PPM");
        let expected_prefix = b"P6\n2 1\n255\n";
        assert!(ppm.starts_with(expected_prefix));
        assert_eq!(ppm.len(), expected_prefix.len() + 6);
        assert_eq!(&ppm[expected_prefix.len()..], &[10, 20, 30, 40, 50, 60]);

        assert!(encode_rgba_as_ppm(&[0u8; 4], 2, 2).is_err());
    }
}
