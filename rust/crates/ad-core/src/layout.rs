//! Aspect-aware resolution scaling and `layout_coordinates.json` loader.
//!
//! Mirrors `src/core/resolution/scaling-engine.ts`:
//! `scaleFactor = targetHeight / baseHeight`,
//! `horizontalOffset = (targetWidth - baseWidth * scaleFactor) / 2`.

use std::{collections::HashMap, fs, path::Path};

use ad_protocol::ResolutionSource;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AspectFamily {
    Ratio4x3,
    Ratio16x10,
    Ratio16x9,
    Ratio21x9,
}

impl AspectFamily {
    pub fn base_dimensions(self) -> (u32, u32) {
        match self {
            Self::Ratio4x3 => (1920, 1440),
            Self::Ratio16x10 => (1920, 1200),
            Self::Ratio16x9 => (1920, 1080),
            Self::Ratio21x9 => (3440, 1440),
        }
    }

    pub fn base_key(self) -> &'static str {
        match self {
            Self::Ratio4x3 => "1920x1440",
            Self::Ratio16x10 => "1920x1200",
            Self::Ratio16x9 => "1920x1080",
            Self::Ratio21x9 => "3440x1440",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoxParams {
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotCoordinate {
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub width: Option<i32>,
    #[serde(default)]
    pub height: Option<i32>,
    pub hero_order: u8,
    #[serde(default)]
    pub ability_order: Option<u8>,
    #[serde(default)]
    pub is_ultimate: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResolutionLayout {
    pub heroes_params: BoxParams,
    pub selected_abilities_params: BoxParams,
    pub ultimate_slots_coords: Vec<SlotCoordinate>,
    pub standard_slots_coords: Vec<SlotCoordinate>,
    #[serde(default)]
    pub models_coords: Vec<SlotCoordinate>,
    #[serde(default)]
    pub heroes_coords: Vec<SlotCoordinate>,
    #[serde(default)]
    pub selected_abilities_coords: Vec<SlotCoordinate>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LayoutDatabase {
    pub resolutions: HashMap<String, ResolutionLayout>,
}

#[derive(Debug, Error)]
pub enum LayoutError {
    #[error("failed to read layout_coordinates.json: {0}")]
    Io(#[from] std::io::Error),
    #[error("failed to parse layout_coordinates.json: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn get_aspect_family(width: u32, height: u32) -> Option<AspectFamily> {
    if width == 0 || height == 0 {
        return None;
    }
    let ratio = f64::from(width) / f64::from(height);
    if ratio >= 2.1 {
        Some(AspectFamily::Ratio21x9)
    } else if ratio >= 1.7 {
        Some(AspectFamily::Ratio16x9)
    } else if ratio >= 1.55 {
        Some(AspectFamily::Ratio16x10)
    } else if ratio >= 1.2 {
        Some(AspectFamily::Ratio4x3)
    } else {
        None
    }
}

pub fn parse_resolution(resolution: &str) -> Option<(u32, u32)> {
    let (w_str, h_str) = resolution.split_once('x')?;
    let width = w_str.parse::<u32>().ok()?;
    let height = h_str.parse::<u32>().ok()?;
    Some((width, height))
}

fn scale_slot(
    coord: &SlotCoordinate,
    scale: f64,
    x_offset: f64,
    has_dimensions: bool,
) -> SlotCoordinate {
    SlotCoordinate {
        x: (f64::from(coord.x) * scale + x_offset).round() as i32,
        y: (f64::from(coord.y) * scale).round() as i32,
        width: if has_dimensions {
            coord.width.map(|w| (f64::from(w) * scale).round() as i32)
        } else {
            coord.width
        },
        height: if has_dimensions {
            coord.height.map(|h| (f64::from(h) * scale).round() as i32)
        } else {
            coord.height
        },
        hero_order: coord.hero_order,
        ability_order: coord.ability_order,
        is_ultimate: coord.is_ultimate,
    }
}

fn scale_params(params: BoxParams, scale: f64) -> BoxParams {
    BoxParams {
        width: (f64::from(params.width) * scale).round() as i32,
        height: (f64::from(params.height) * scale).round() as i32,
    }
}

pub fn scale_coordinates(
    base_layout: &ResolutionLayout,
    target_width: u32,
    target_height: u32,
    base_width: u32,
    base_height: u32,
) -> ResolutionLayout {
    let scale_factor = f64::from(target_height) / f64::from(base_height);
    let horizontal_offset = (f64::from(target_width) - f64::from(base_width) * scale_factor) / 2.0;

    ResolutionLayout {
        heroes_params: scale_params(base_layout.heroes_params, scale_factor),
        selected_abilities_params: scale_params(
            base_layout.selected_abilities_params,
            scale_factor,
        ),
        ultimate_slots_coords: base_layout
            .ultimate_slots_coords
            .iter()
            .map(|c| scale_slot(c, scale_factor, horizontal_offset, true))
            .collect(),
        standard_slots_coords: base_layout
            .standard_slots_coords
            .iter()
            .map(|c| scale_slot(c, scale_factor, horizontal_offset, true))
            .collect(),
        models_coords: base_layout
            .models_coords
            .iter()
            .map(|c| scale_slot(c, scale_factor, horizontal_offset, true))
            .collect(),
        heroes_coords: base_layout
            .heroes_coords
            .iter()
            .map(|c| scale_slot(c, scale_factor, horizontal_offset, false))
            .collect(),
        selected_abilities_coords: base_layout
            .selected_abilities_coords
            .iter()
            .map(|c| scale_slot(c, scale_factor, horizontal_offset, false))
            .collect(),
    }
}

impl LayoutDatabase {
    pub fn from_file(path: &Path) -> Result<Self, LayoutError> {
        let raw = fs::read_to_string(path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn resolve_layout(
        &self,
        width: u32,
        height: u32,
    ) -> Option<(ResolutionLayout, ResolutionSource)> {
        let key = format!("{width}x{height}");
        if let Some(preset) = self.resolutions.get(&key) {
            return Some((preset.clone(), ResolutionSource::Preset));
        }
        let family = get_aspect_family(width, height)?;
        let base_layout = self.resolutions.get(family.base_key())?;
        let (base_w, base_h) = family.base_dimensions();
        Some((
            scale_coordinates(base_layout, width, height, base_w, base_h),
            ResolutionSource::AutoScaled,
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn coords_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../resources/config/layout_coordinates.json")
    }

    #[test]
    fn loads_real_layout_coordinates_and_resolves_preset_and_autoscaled() {
        let db = LayoutDatabase::from_file(&coords_path()).expect("load layout_coordinates.json");

        let (preset, src) = db.resolve_layout(1920, 1080).expect("1920x1080 preset");
        assert_eq!(src, ResolutionSource::Preset);
        assert_eq!(preset.ultimate_slots_coords.len(), 12);
        assert_eq!(preset.standard_slots_coords.len(), 36);

        let (scaled, src_auto) = db.resolve_layout(3000, 1688).expect("3000x1688 auto-scaled");
        assert_eq!(src_auto, ResolutionSource::AutoScaled);
        assert_eq!(scaled.ultimate_slots_coords.len(), 12);
        assert_eq!(scaled.standard_slots_coords.len(), 36);
        assert!(
            scaled.ultimate_slots_coords[0].x > preset.ultimate_slots_coords[0].x,
            "expected scaled x coordinate to grow on 3000x1688"
        );
    }

    #[test]
    fn parses_resolution_strings() {
        assert_eq!(parse_resolution("2560x1440"), Some((2560, 1440)));
        assert_eq!(parse_resolution("invalid"), None);
    }
}
