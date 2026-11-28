//! 3-pass hero-card OCR preprocessing, pixel-change gating, and pool/full-roster matching.
//!
//! Mirrors `src/core/ml/preprocessing.ts` (`cropRegionPng`) and
//! `src/main/services/ocr-service.ts`.

use crate::{
    hero_matcher::{match_hero_name, match_thin_two_letter_hero, normalize_hero_text, HeroNameCandidate, HeroNameMatch},
    OcrEngine, OCR_MIN_SIMILARITY, OCR_UNSCOPED_MIN_SIMILARITY,
};

pub const OCR_NAME_STRIP_HEIGHT_RATIO: f32 = 0.5;
pub const OCR_DARK_TEXT_THRESHOLD: u8 = 120;
pub const OCR_STRIP_TARGET_WIDTH: u32 = 600;
pub const OCR_STRIP_DIFF_SIZE: u32 = 32;
pub const OCR_STRIP_DIFF_THRESHOLD: f32 = 4.0;

#[derive(Debug, Clone, PartialEq)]
pub struct CardOcrOutcome {
    pub hero: Option<HeroNameMatch>,
    pub is_no_hero: bool,
    pub winning_pass: Option<u8>,
    pub raw_texts: Vec<String>,
}

/// Crops the upper half of a player card, bilinearly scales to `target_w` preserving
/// aspect ratio, converts to luminance, and normalizes contrast across `[0, 255]` RGBA.
pub fn extract_hero_name_strip_rgba(
    frame_bytes: &[u8],
    frame_w: u32,
    frame_h: u32,
    is_bgra: bool,
    card_bounds: [u32; 4],
    target_w: u32,
) -> Option<(Vec<u8>, u32, u32)> {
    let [card_x, card_y, card_w, card_h] = card_bounds;
    let strip_h = ((card_h as f32) * OCR_NAME_STRIP_HEIGHT_RATIO).round().max(1.0) as u32;
    if card_w == 0
        || target_w == 0
        || card_x.saturating_add(card_w) > frame_w
        || card_y.saturating_add(strip_h) > frame_h
    {
        return None;
    }
    let expected = (frame_w as usize).saturating_mul(frame_h as usize).saturating_mul(4);
    if frame_bytes.len() < expected {
        return None;
    }

    let target_h = ((strip_h as f64) * (target_w as f64) / (card_w as f64))
        .round()
        .max(1.0) as u32;

    let read_luma = |px: u32, py: u32| -> f32 {
        let idx = ((py as usize) * (frame_w as usize) + (px as usize)) * 4;
        let (r, g, b) = if is_bgra {
            (
                frame_bytes[idx + 2] as f32,
                frame_bytes[idx + 1] as f32,
                frame_bytes[idx] as f32,
            )
        } else {
            (
                frame_bytes[idx] as f32,
                frame_bytes[idx + 1] as f32,
                frame_bytes[idx + 2] as f32,
            )
        };
        0.299 * r + 0.587 * g + 0.114 * b
    };

    let scale_x = card_w as f32 / target_w as f32;
    let scale_y = strip_h as f32 / target_h as f32;
    let mut luma = Vec::with_capacity((target_w as usize) * (target_h as usize));
    let mut min_v = f32::INFINITY;
    let mut max_v = f32::NEG_INFINITY;

    for dy in 0..target_h {
        let src_y = (dy as f32 + 0.5) * scale_y - 0.5;
        let sy0 = src_y.floor().clamp(0.0, (strip_h - 1) as f32) as u32;
        let sy1 = (sy0 + 1).min(strip_h - 1);
        let fy = (src_y - sy0 as f32).clamp(0.0, 1.0);

        for dx in 0..target_w {
            let src_x = (dx as f32 + 0.5) * scale_x - 0.5;
            let sx0 = src_x.floor().clamp(0.0, (card_w - 1) as f32) as u32;
            let sx1 = (sx0 + 1).min(card_w - 1);
            let fx = (src_x - sx0 as f32).clamp(0.0, 1.0);

            let top = read_luma(card_x + sx0, card_y + sy0) * (1.0 - fx)
                + read_luma(card_x + sx1, card_y + sy0) * fx;
            let bot = read_luma(card_x + sx0, card_y + sy1) * (1.0 - fx)
                + read_luma(card_x + sx1, card_y + sy1) * fx;
            let v = top * (1.0 - fy) + bot * fy;
            if v < min_v {
                min_v = v;
            }
            if v > max_v {
                max_v = v;
            }
            luma.push(v);
        }
    }

    let span = max_v - min_v;
    let mut rgba = Vec::with_capacity(luma.len() * 4);
    for v in luma {
        let norm = if span > 1e-3 {
            (((v - min_v) / span) * 255.0).round().clamp(0.0, 255.0) as u8
        } else {
            v.round().clamp(0.0, 255.0) as u8
        };
        rgba.extend_from_slice(&[norm, norm, norm, 255]);
    }

    Some((rgba, target_w, target_h))
}

/// Binarizes a grayscale RGBA image (`luma < threshold -> 0 else 255`) for dark-on-light text.
pub fn threshold_dark_text_rgba(rgba: &[u8], threshold: u8) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgba.len());
    for px in rgba.as_chunks::<4>().0 {
        let v = if px[0] < threshold { 0 } else { 255 };
        out.extend_from_slice(&[v, v, v, 255]);
    }
    out
}

/// Inverts RGB channels while preserving opaque alpha (`255`).
pub fn invert_rgba(rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgba.len());
    for px in rgba.as_chunks::<4>().0 {
        out.extend_from_slice(&[255 - px[0], 255 - px[1], 255 - px[2], 255]);
    }
    out
}

/// Downscales luminance to `32x32` (`1024` bytes) for per-row change gating.
pub fn compute_strip_signature(rgba: &[u8], w: u32, h: u32) -> Vec<u8> {
    if w == 0 || h == 0 || rgba.len() < (w as usize) * (h as usize) * 4 {
        return Vec::new();
    }
    let size = OCR_STRIP_DIFF_SIZE;
    let mut sig = Vec::with_capacity((size as usize) * (size as usize));
    for dy in 0..size {
        let sy = ((dy * h) / size).min(h - 1);
        for dx in 0..size {
            let sx = ((dx * w) / size).min(w - 1);
            let idx = ((sy * w + sx) * 4) as usize;
            sig.push(rgba[idx]);
        }
    }
    sig
}

pub fn strip_pixels_changed(prev: Option<&[u8]>, next: &[u8], threshold: f32) -> bool {
    let Some(prev_bytes) = prev else {
        return true;
    };
    if prev_bytes.len() != next.len() || next.is_empty() {
        return true;
    }
    let total_diff: u64 = prev_bytes
        .iter()
        .zip(next.iter())
        .map(|(&a, &b)| u64::from(a.abs_diff(b)))
        .sum();
    (total_diff as f32 / next.len() as f32) >= threshold
}

fn match_pool_candidate(raw: &str, pool_candidates: &[HeroNameCandidate]) -> Option<HeroNameMatch> {
    if pool_candidates.is_empty() {
        return None;
    }
    if let Some(m) = match_hero_name(raw, pool_candidates) {
        if m.similarity >= f64::from(OCR_MIN_SIMILARITY) {
            return Some(m);
        }
    }
    if let Some(m) = match_thin_two_letter_hero(raw, pool_candidates) {
        return Some(m);
    }
    None
}

/// Runs the 3-pass OCR cascade (normal -> dark-text threshold -> inverted) with `"NO HERO"`
/// short-circuiting, pool scoping (`0.60`), and full-roster fallback (`0.85`).
pub fn recognize_card_hero_name(
    engine: &mut dyn OcrEngine,
    strip_rgba: &[u8],
    w: u32,
    h: u32,
    pool_candidates: &[HeroNameCandidate],
    full_roster: &[HeroNameCandidate],
) -> CardOcrOutcome {
    let pass2 = threshold_dark_text_rgba(strip_rgba, OCR_DARK_TEXT_THRESHOLD);
    let pass3 = invert_rgba(strip_rgba);
    let passes: [(&[u8], u8); 3] = [(strip_rgba, 1), (&pass2, 2), (&pass3, 3)];

    let mut raw_texts = Vec::with_capacity(3);
    for &(buf, pass_num) in &passes {
        let Ok(raw) = engine.recognize_hero_card_text(buf, w, h) else {
            continue;
        };
        let norm = normalize_hero_text(&raw);
        raw_texts.push(raw.clone());

        if norm == "NOHERO" {
            return CardOcrOutcome {
                hero: None,
                is_no_hero: true,
                winning_pass: None,
                raw_texts,
            };
        }

        if let Some(hero) = match_pool_candidate(&raw, pool_candidates) {
            return CardOcrOutcome {
                hero: Some(hero),
                is_no_hero: false,
                winning_pass: Some(pass_num),
                raw_texts,
            };
        }
    }

    for (idx, raw) in raw_texts.iter().enumerate() {
        if let Some(m) = match_hero_name(raw, full_roster) {
            if m.similarity >= f64::from(OCR_UNSCOPED_MIN_SIMILARITY) {
                return CardOcrOutcome {
                    hero: Some(m),
                    is_no_hero: false,
                    winning_pass: Some((idx + 1) as u8),
                    raw_texts,
                };
            }
        }
    }

    CardOcrOutcome {
        hero: None,
        is_no_hero: false,
        winning_pass: None,
        raw_texts,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MlError;

    struct ScriptedOcr {
        responses: Vec<String>,
        calls: usize,
    }

    impl ScriptedOcr {
        fn new(responses: Vec<&str>) -> Self {
            Self {
                responses: responses.into_iter().map(ToOwned::to_owned).collect(),
                calls: 0,
            }
        }
    }

    impl OcrEngine for ScriptedOcr {
        fn recognize_hero_card_text(
            &mut self,
            _rgba_bytes: &[u8],
            _width: u32,
            _height: u32,
        ) -> Result<String, MlError> {
            let out = self
                .responses
                .get(self.calls)
                .cloned()
                .unwrap_or_default();
            self.calls += 1;
            Ok(out)
        }
    }

    fn hero(name: &str, display_name: &str) -> HeroNameCandidate {
        HeroNameCandidate {
            name: name.into(),
            display_name: display_name.into(),
        }
    }

    #[test]
    fn strip_extraction_threshold_and_pixel_gating_work() {
        // Vertical light gradient over dark text strip
        let mut frame = vec![0u8; 40 * 20 * 4];
        for y in 0..20u32 {
            for x in 0..40u32 {
                let idx = ((y * 40 + x) * 4) as usize;
                let v = if x < 10 { 40 } else { 200 };
                frame[idx..idx + 4].copy_from_slice(&[v, v, v, 255]);
            }
        }
        let (strip, sw, sh) =
            extract_hero_name_strip_rgba(&frame, 40, 20, true, [0, 0, 40, 20], 60).unwrap();
        assert_eq!(sw, 60);
        assert_eq!(sh, 15);
        assert_eq!(strip.len(), 60 * 15 * 4);
        let th = threshold_dark_text_rgba(&strip, OCR_DARK_TEXT_THRESHOLD);
        assert_eq!(th[0], 0);
        assert_eq!(*th.last().unwrap(), 255);

        let sig1 = compute_strip_signature(&strip, sw, sh);
        assert_eq!(sig1.len(), 1024);
        assert!(!strip_pixels_changed(Some(&sig1), &sig1, OCR_STRIP_DIFF_THRESHOLD));
        assert!(strip_pixels_changed(Some(&sig1), &th[..1024], OCR_STRIP_DIFF_THRESHOLD));
    }

    #[test]
    fn three_pass_cascade_handles_pass2_no_hero_io_and_unscoped_fallback() {
        let strip = vec![128u8; 32 * 16 * 4];
        let pool = vec![hero("axe", "Axe"), hero("wisp", "Io")];
        let roster = vec![
            hero("axe", "Axe"),
            hero("wisp", "Io"),
            hero("antimage", "Anti-Mage"),
        ];

        // 1. NO HERO short-circuits on pass 1 without calling pass 2/3
        let mut no_hero_ocr = ScriptedOcr::new(vec!["NO HERO", "AXE", "AXE"]);
        let out_no = recognize_card_hero_name(&mut no_hero_ocr, &strip, 32, 16, &pool, &roster);
        assert!(out_no.is_no_hero);
        assert_eq!(out_no.hero, None);
        assert_eq!(no_hero_ocr.calls, 1);

        // 2. Pass 2 recovers highlighted dark-on-light text
        let mut p2_ocr = ScriptedOcr::new(vec!["", "A X E", ""]);
        let out_p2 = recognize_card_hero_name(&mut p2_ocr, &strip, 32, 16, &pool, &roster);
        assert_eq!(out_p2.winning_pass, Some(2));
        assert_eq!(out_p2.hero.unwrap().name, "axe");

        // 3. Thin-glyph Io recovery ("O" -> "Io")
        let mut io_ocr = ScriptedOcr::new(vec!["O"]);
        let out_io = recognize_card_hero_name(&mut io_ocr, &strip, 32, 16, &pool, &roster);
        assert_eq!(out_io.hero.unwrap().name, "wisp");

        // 4. Unscoped full-roster fallback (>= 0.85) recovers missing pool model
        let mut fallback_ocr = ScriptedOcr::new(vec!["ANTI-MAGE"]);
        let out_fb = recognize_card_hero_name(&mut fallback_ocr, &strip, 32, 16, &pool, &roster);
        assert_eq!(out_fb.hero.unwrap().name, "antimage");
    }
}
