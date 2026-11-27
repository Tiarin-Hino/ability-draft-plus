//! Bilinear region cropper and raw `0.0..=255.0` float32 batch builder.
//!
//! Matches `src/core/ml/preprocessing.ts`: bilinear interpolation (`kernel: 'linear'`),
//! RGB8 channel order, and raw `0–255` float values (the ONNX graph contains an internal
//! `Rescaling` layer).

use crate::{CaptureError, PixelFormat, RawFrame};

/// Crops `(x, y, width, height)` from `frame` and resizes bilinearly to `(target_w, target_h)` RGB8.
pub fn crop_and_resize_bilinear_rgb(
    frame: &RawFrame,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    target_w: u32,
    target_h: u32,
) -> Result<Vec<u8>, CaptureError> {
    if width == 0 || height == 0 || target_w == 0 || target_h == 0 {
        return Err(CaptureError::Failed(
            "crop and target dimensions must be non-zero".to_string(),
        ));
    }
    let right = x.checked_add(width).ok_or_else(|| {
        CaptureError::Failed("crop x + width overflow".to_string())
    })?;
    let bottom = y.checked_add(height).ok_or_else(|| {
        CaptureError::Failed("crop y + height overflow".to_string())
    })?;
    if right > frame.width || bottom > frame.height {
        return Err(CaptureError::Failed(format!(
            "crop ({x},{y} {width}x{height}) exceeds frame ({}x{})",
            frame.width, frame.height
        )));
    }
    let expected_len = (frame.width as usize)
        .saturating_mul(frame.height as usize)
        .saturating_mul(4);
    if frame.bytes.len() < expected_len {
        return Err(CaptureError::Failed(format!(
            "frame buffer too small: {} < {expected_len}",
            frame.bytes.len()
        )));
    }

    let mut out = vec![0u8; (target_w as usize) * (target_h as usize) * 3];
    let scale_x = width as f32 / target_w as f32;
    let scale_y = height as f32 / target_h as f32;

    for dy in 0..target_h {
        let src_y = (dy as f32 + 0.5) * scale_y - 0.5;
        let sy0 = src_y.floor().clamp(0.0, (height - 1) as f32) as u32;
        let sy1 = (sy0 + 1).min(height - 1);
        let fy = (src_y - sy0 as f32).clamp(0.0, 1.0);

        for dx in 0..target_w {
            let src_x = (dx as f32 + 0.5) * scale_x - 0.5;
            let sx0 = src_x.floor().clamp(0.0, (width - 1) as f32) as u32;
            let sx1 = (sx0 + 1).min(width - 1);
            let fx = (src_x - sx0 as f32).clamp(0.0, 1.0);

            let p00 = read_rgb(frame, x + sx0, y + sy0);
            let p10 = read_rgb(frame, x + sx1, y + sy0);
            let p01 = read_rgb(frame, x + sx0, y + sy1);
            let p11 = read_rgb(frame, x + sx1, y + sy1);

            let out_idx = ((dy as usize) * (target_w as usize) + (dx as usize)) * 3;
            for c in 0..3 {
                let top = p00[c] as f32 * (1.0 - fx) + p10[c] as f32 * fx;
                let bot = p01[c] as f32 * (1.0 - fx) + p11[c] as f32 * fx;
                let val = top * (1.0 - fy) + bot * fy;
                out[out_idx + c] = val.round().clamp(0.0, 255.0) as u8;
            }
        }
    }

    Ok(out)
}

/// Applies an inset ratio (e.g. `0.08` for pick boxes) before bilinear resize to `target_size x target_size`.
pub fn crop_inset_and_resize_bilinear_rgb(
    frame: &RawFrame,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    inset_ratio: f32,
    target_size: u32,
) -> Result<Vec<u8>, CaptureError> {
    let inset = ((width.min(height) as f32) * inset_ratio).round().max(0.0) as u32;
    let inset_x = x.saturating_add(inset);
    let inset_y = y.saturating_add(inset);
    let inset_w = width.saturating_sub(inset.saturating_mul(2)).max(1);
    let inset_h = height.saturating_sub(inset.saturating_mul(2)).max(1);
    crop_and_resize_bilinear_rgb(frame, inset_x, inset_y, inset_w, inset_h, target_size, target_size)
}

/// Converts raw `RGB8` crops into a flat NHWC `f32` batch keeping values in `0.0..=255.0`.
pub fn rgb_u8_to_f32_batch(crops: &[Vec<u8>]) -> Vec<f32> {
    let total_len: usize = crops.iter().map(Vec::len).sum();
    let mut batch = Vec::with_capacity(total_len);
    for crop in crops {
        batch.extend(crop.iter().map(|&b| b as f32));
    }
    batch
}

#[inline]
fn read_rgb(frame: &RawFrame, px: u32, py: u32) -> [u8; 3] {
    let idx = ((py as usize) * (frame.width as usize) + (px as usize)) * 4;
    match frame.format {
        PixelFormat::Bgra8 => [frame.bytes[idx + 2], frame.bytes[idx + 1], frame.bytes[idx]],
        PixelFormat::Rgba8 => [frame.bytes[idx], frame.bytes[idx + 1], frame.bytes[idx + 2]],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_solid_bgra_frame(width: u32, height: u32, b: u8, g: u8, r: u8) -> RawFrame {
        let mut bytes = Vec::with_capacity((width * height * 4) as usize);
        for _ in 0..(width * height) {
            bytes.extend_from_slice(&[b, g, r, 255]);
        }
        RawFrame {
            width,
            height,
            format: PixelFormat::Bgra8,
            bytes,
        }
    }

    #[test]
    fn swizzles_bgra_to_rgb_and_preserves_raw_range() {
        let frame = make_solid_bgra_frame(8, 8, 10, 120, 240);
        let rgb = crop_and_resize_bilinear_rgb(&frame, 1, 1, 4, 4, 2, 2).unwrap();
        assert_eq!(rgb.len(), 2 * 2 * 3);
        assert_eq!(&rgb[0..3], &[240, 120, 10]);

        let batch = rgb_u8_to_f32_batch(&[rgb]);
        assert_eq!(&batch[0..3], &[240.0, 120.0, 10.0]);
    }

    #[test]
    fn bilinear_interpolates_horizontal_gradient() {
        // 2x1 RGBA frame: left=(0,0,0), right=(100,200,50)
        let frame = RawFrame {
            width: 2,
            height: 1,
            format: PixelFormat::Rgba8,
            bytes: vec![0, 0, 0, 255, 100, 200, 50, 255],
        };
        // Resizing 2x1 -> 3x1 puts middle pixel at exact center x=0.5 -> average (50,100,25)
        let rgb = crop_and_resize_bilinear_rgb(&frame, 0, 0, 2, 1, 3, 1).unwrap();
        assert_eq!(&rgb[0..3], &[0, 0, 0]);
        assert_eq!(&rgb[3..6], &[50, 100, 25]);
        assert_eq!(&rgb[6..9], &[100, 200, 50]);
    }

    #[test]
    fn inset_crop_strips_border_pixels() {
        // 10x10 frame with white (255) border and black (0) interior
        let mut frame = make_solid_bgra_frame(10, 10, 0, 0, 0);
        for y in 0..10u32 {
            for x in 0..10u32 {
                if x == 0 || y == 0 || x == 9 || y == 9 {
                    let idx = ((y * 10 + x) * 4) as usize;
                    frame.bytes[idx..idx + 3].copy_from_slice(&[255, 255, 255]);
                }
            }
        }
        // 10% inset strips 1px border on all sides -> pure black interior
        let rgb = crop_inset_and_resize_bilinear_rgb(&frame, 0, 0, 10, 10, 0.10, 4).unwrap();
        assert!(rgb.iter().all(|&v| v == 0));
    }

    #[test]
    fn rejects_out_of_bounds_crop() {
        let frame = make_solid_bgra_frame(4, 4, 0, 0, 0);
        assert!(crop_and_resize_bilinear_rgb(&frame, 2, 2, 3, 2, 2, 2).is_err());
        assert!(crop_and_resize_bilinear_rgb(&frame, 0, 0, 0, 2, 2, 2).is_err());
    }
}
