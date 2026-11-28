//! Pure screen-space Panorama projection and 3D plinth perspective geometry.
//!
//! Mirrors `src/core/resolution/visual-geometry.ts` so native `ad-overlay` borders
//! align edge-for-edge with Dota 2's angled Ability Draft board across 16:9, 16:10,
//! 21:9, and 4:3 resolutions while keeping raw `layout_coordinates.json` boxes intact
//! for ML crops.

use ad_protocol::ResolutionSource;

pub const REFERENCE_WIDTH: f64 = 1920.0;
pub const REFERENCE_HEIGHT: f64 = 1080.0;
pub const BOARD_CENTER_X_1080: f64 = 960.375;
pub const MIN_WIDTH_HEIGHT_RATIO: f64 = 1.6;
pub const PLINTH_VANISH_X: f64 = 960.0;
pub const PLINTH_VANISH_Y: f64 = -1960.0;
pub const MAX_PLINTH_SKEW_X_DEG: f64 = 7.8;
pub const ULT_COL_PITCH_RATIO: f64 = 95.25;
pub const ULT_SKEW_STEP_DEG: f64 = 1.18;
pub const MAX_ULT_SKEW_X_DEG: f64 = 3.5;

const HERO_CARD_Y0_1080: f64 = 146.25;
const HERO_CARD_ROW_STRIDE_1080: f64 = 168.0;
const HERO_CARD_RADIANT_X_1080: f64 = 139.5;
const HERO_CARD_DIRE_X_1080: f64 = 1460.25;
const HERO_CARD_WIDTH_1080: f64 = 320.25;
const HERO_CARD_HEIGHT_1080: f64 = 151.5;

const SELECTED_BOX_Y0_1080: f64 = 236.25;
const SELECTED_BOX_BASE_DP: f64 = 56.0;
const SELECTED_BOX_HALF_MARGIN_DP: f64 = 2.0;
const SELECTED_BOX_SIZE_1080: f64 = 56.25;
const SELECTED_BOX_RADIANT_INNER_1080: f64 = 506.25;
const SELECTED_BOX_DIRE_INNER_1080: f64 = 505.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VisualSlotCategory {
    Ultimate,
    Standard,
    Model,
    Selected,
    HeroCard,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SlotBoundsF64 {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct BoardPerspective {
    pub skew_x_deg: f64,
    pub skew_y_deg: f64,
    pub rotate_x_deg: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedVisualSlot {
    pub bounds: SlotBoundsF64,
    pub perspective: BoardPerspective,
    pub horizontal_overhang_px: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VisualSlotInput {
    pub fallback: SlotBoundsF64,
    pub category: VisualSlotCategory,
    pub hero_order: Option<u8>,
    pub ability_order: Option<u8>,
    pub is_ultimate: Option<bool>,
    pub box_index: Option<u8>,
    pub viewport_width: f64,
    pub viewport_height: f64,
    pub layout_source: Option<ResolutionSource>,
}

struct UltimateCanonicalRow {
    hero_orders: [u8; 6],
    y1080: f64,
    height1080: f64,
    width1080: f64,
    pitch1080: f64,
}

const ULTIMATE_ROWS: [UltimateCanonicalRow; 2] = [
    UltimateCanonicalRow {
        hero_orders: [0, 1, 2, 7, 6, 5],
        y1080: 164.25,
        height1080: 61.5,
        width1080: 60.0,
        pitch1080: 96.3,
    },
    UltimateCanonicalRow {
        hero_orders: [3, 4, 10, 11, 9, 8],
        y1080: 262.5,
        height1080: 59.25,
        width1080: 58.5,
        pitch1080: 94.2,
    },
];

struct PlinthCanonicalRow {
    left_hero_order: u8,
    right_hero_order: u8,
    std_y1080: f64,
    std_height1080: f64,
    std_width1080: f64,
    std_inner_center_offset1080: f64,
    std_pitch1080: f64,
    model_y1080: f64,
    model_height1080: f64,
    model_width1080: f64,
    model_center_offset1080: f64,
}

const PLINTH_ROWS: [PlinthCanonicalRow; 6] = [
    PlinthCanonicalRow {
        left_hero_order: 0,
        right_hero_order: 5,
        std_y1080: 342.375,
        std_height1080: 45.75,
        std_width1080: 53.25,
        std_inner_center_offset1080: 51.6,
        std_pitch1080: 77.475,
        model_y1080: 342.75,
        model_height1080: 46.5,
        model_width1080: 55.5,
        model_center_offset1080: 309.375,
    },
    PlinthCanonicalRow {
        left_hero_order: 1,
        right_hero_order: 6,
        std_y1080: 408.0,
        std_height1080: 47.625,
        std_width1080: 54.75,
        std_inner_center_offset1080: 53.0625,
        std_pitch1080: 79.5,
        model_y1080: 408.0,
        model_height1080: 48.75,
        model_width1080: 57.0,
        model_center_offset1080: 317.8125,
    },
    PlinthCanonicalRow {
        left_hero_order: 2,
        right_hero_order: 7,
        std_y1080: 477.0,
        std_height1080: 50.25,
        std_width1080: 56.25,
        std_inner_center_offset1080: 54.375,
        std_pitch1080: 81.9375,
        model_y1080: 476.25,
        model_height1080: 51.75,
        model_width1080: 58.5,
        model_center_offset1080: 326.4375,
    },
    PlinthCanonicalRow {
        left_hero_order: 3,
        right_hero_order: 8,
        std_y1080: 591.75,
        std_height1080: 54.75,
        std_width1080: 58.5,
        std_inner_center_offset1080: 57.1875,
        std_pitch1080: 85.5,
        model_y1080: 591.0,
        model_height1080: 56.25,
        model_width1080: 60.75,
        model_center_offset1080: 341.8125,
    },
    PlinthCanonicalRow {
        left_hero_order: 4,
        right_hero_order: 9,
        std_y1080: 671.25,
        std_height1080: 58.125,
        std_width1080: 60.75,
        std_inner_center_offset1080: 58.875,
        std_pitch1080: 88.125,
        model_y1080: 670.5,
        model_height1080: 60.0,
        model_width1080: 63.0,
        model_center_offset1080: 352.125,
    },
    PlinthCanonicalRow {
        left_hero_order: 10,
        right_hero_order: 11,
        std_y1080: 756.0,
        std_height1080: 61.5,
        std_width1080: 62.25,
        std_inner_center_offset1080: 60.5625,
        std_pitch1080: 90.9375,
        model_y1080: 755.25,
        model_height1080: 63.0,
        model_width1080: 65.25,
        model_center_offset1080: 363.1875,
    },
];

fn round_2dp(value: f64) -> f64 {
    let rounded = (value * 100.0).round() / 100.0;
    if rounded == 0.0 {
        0.0
    } else {
        rounded
    }
}

pub fn compute_panorama_projection(viewport_width: f64, viewport_height: f64) -> (f64, f64) {
    let effective_h = viewport_height.min(viewport_width / MIN_WIDTH_HEIGHT_RATIO);
    let letterbox_y = (viewport_height - effective_h) / 2.0;
    (effective_h / REFERENCE_HEIGHT, letterbox_y)
}

fn project_rect_from_1080p(
    rect1080: SlotBoundsF64,
    viewport_width: f64,
    viewport_height: f64,
) -> SlotBoundsF64 {
    let (scale, letterbox_y) = compute_panorama_projection(viewport_width, viewport_height);
    let center_x = viewport_width / 2.0;
    SlotBoundsF64 {
        x: center_x + (rect1080.x - REFERENCE_WIDTH / 2.0) * scale,
        y: letterbox_y + rect1080.y * scale,
        width: rect1080.width * scale,
        height: rect1080.height * scale,
    }
}

fn ultimate_canonical_rect(hero_order: u8) -> Option<SlotBoundsF64> {
    for row in &ULTIMATE_ROWS {
        for (col, &order) in row.hero_orders.iter().enumerate() {
            if order == hero_order {
                let offset_units = (col as f64) - 2.5;
                let cx = BOARD_CENTER_X_1080 + offset_units * row.pitch1080;
                return Some(SlotBoundsF64 {
                    x: cx - row.width1080 / 2.0,
                    y: row.y1080,
                    width: row.width1080,
                    height: row.height1080,
                });
            }
        }
    }
    None
}

fn standard_canonical_rect(hero_order: u8, ability_order: u8) -> Option<SlotBoundsF64> {
    if !(1..=3).contains(&ability_order) {
        return None;
    }
    for row in &PLINTH_ROWS {
        if row.left_hero_order == hero_order {
            let left_col_from_center = f64::from(3 - ability_order);
            let left_cx = BOARD_CENTER_X_1080
                - (row.std_inner_center_offset1080 + left_col_from_center * row.std_pitch1080);
            return Some(SlotBoundsF64 {
                x: left_cx - row.std_width1080 / 2.0,
                y: row.std_y1080,
                width: row.std_width1080,
                height: row.std_height1080,
            });
        }
        if row.right_hero_order == hero_order {
            let right_col_from_center = f64::from(ability_order - 1);
            let right_cx = BOARD_CENTER_X_1080
                + (row.std_inner_center_offset1080 + right_col_from_center * row.std_pitch1080);
            return Some(SlotBoundsF64 {
                x: right_cx - row.std_width1080 / 2.0,
                y: row.std_y1080,
                width: row.std_width1080,
                height: row.std_height1080,
            });
        }
    }
    None
}

fn model_canonical_rect(hero_order: u8) -> Option<SlotBoundsF64> {
    for row in &PLINTH_ROWS {
        if row.left_hero_order == hero_order {
            return Some(SlotBoundsF64 {
                x: BOARD_CENTER_X_1080 - row.model_center_offset1080 - row.model_width1080 / 2.0,
                y: row.model_y1080,
                width: row.model_width1080,
                height: row.model_height1080,
            });
        }
        if row.right_hero_order == hero_order {
            return Some(SlotBoundsF64 {
                x: BOARD_CENTER_X_1080 + row.model_center_offset1080 - row.model_width1080 / 2.0,
                y: row.model_y1080,
                width: row.model_width1080,
                height: row.model_height1080,
            });
        }
    }
    None
}

fn resolve_canonical_1080p_rect(input: &VisualSlotInput) -> Option<SlotBoundsF64> {
    let hero_order = input.hero_order?;
    match input.category {
        VisualSlotCategory::Ultimate => ultimate_canonical_rect(hero_order),
        VisualSlotCategory::Standard => {
            standard_canonical_rect(hero_order, input.ability_order?)
        }
        VisualSlotCategory::Model => model_canonical_rect(hero_order),
        VisualSlotCategory::HeroCard => {
            if hero_order > 9 {
                return None;
            }
            let is_dire = hero_order >= 5;
            let row = f64::from(if is_dire { hero_order - 5 } else { hero_order });
            Some(SlotBoundsF64 {
                x: if is_dire {
                    HERO_CARD_DIRE_X_1080
                } else {
                    HERO_CARD_RADIANT_X_1080
                },
                y: HERO_CARD_Y0_1080 + row * HERO_CARD_ROW_STRIDE_1080,
                width: HERO_CARD_WIDTH_1080,
                height: HERO_CARD_HEIGHT_1080,
            })
        }
        VisualSlotCategory::Selected => None,
    }
}

fn resolve_selected_screen_rect(input: &VisualSlotInput) -> Option<SlotBoundsF64> {
    let hero_order = input.hero_order?;
    if hero_order > 9 || input.viewport_width <= 0.0 || input.viewport_height <= 0.0 {
        return None;
    }

    let is_dire = hero_order >= 5;
    let row = f64::from(if is_dire { hero_order - 5 } else { hero_order });
    let (scale, letterbox_y) =
        compute_panorama_projection(input.viewport_width, input.viewport_height);
    let center_x = input.viewport_width / 2.0;

    let box_size = (SELECTED_BOX_BASE_DP * scale).round();
    let box_gap = 2.0 * (SELECTED_BOX_HALF_MARGIN_DP * scale).round();
    let pitch = box_size + box_gap;
    let radiant_inner_right = (center_x - SELECTED_BOX_RADIANT_INNER_1080 * scale).round();
    let dire_inner_left = (center_x + SELECTED_BOX_DIRE_INNER_1080 * scale).round();
    let x0 = if is_dire {
        dire_inner_left
    } else {
        radiant_inner_right - box_size - 3.0 * pitch
    };
    let y = letterbox_y + (SELECTED_BOX_Y0_1080 + row * HERO_CARD_ROW_STRIDE_1080) * scale;

    let col = if let Some(idx) = input.box_index.filter(|&b| b <= 3) {
        idx
    } else if input.is_ultimate == Some(true) {
        3
    } else {
        let fallback_w = if input.fallback.width > 0.0 {
            input.fallback.width
        } else {
            SELECTED_BOX_SIZE_1080 * scale
        };
        let fallback_center_x = input.fallback.x + fallback_w / 2.0;
        let max_col: u8 = if input.is_ultimate == Some(false) { 3 } else { 4 };
        let mut best_col = 0;
        let mut best_dist = f64::INFINITY;
        for b in 0..max_col {
            let dist = (fallback_center_x - (x0 + f64::from(b) * pitch + box_size / 2.0)).abs();
            if dist < best_dist {
                best_dist = dist;
                best_col = b;
            }
        }
        best_col
    };

    Some(SlotBoundsF64 {
        x: x0 + f64::from(col) * pitch,
        y,
        width: box_size,
        height: box_size,
    })
}

pub fn compute_board_perspective(
    slot: SlotBoundsF64,
    category: VisualSlotCategory,
    viewport_width: f64,
    viewport_height: f64,
) -> BoardPerspective {
    if viewport_width <= 0.0
        || viewport_height <= 0.0
        || !slot.x.is_finite()
        || !slot.y.is_finite()
        || slot.width <= 0.0
        || slot.height <= 0.0
    {
        return BoardPerspective::default();
    }

    if matches!(
        category,
        VisualSlotCategory::Selected | VisualSlotCategory::HeroCard
    ) {
        return BoardPerspective::default();
    }

    let (scale, letterbox_y) = compute_panorama_projection(viewport_width, viewport_height);
    if scale <= 0.0 {
        return BoardPerspective::default();
    }

    let cx = slot.x + slot.width / 2.0;
    let cy = slot.y + slot.height / 2.0;
    let dx1080 = (cx - viewport_width / 2.0) / scale;
    let x1080 = REFERENCE_WIDTH / 2.0 + dx1080;
    let y1080 = (cy - letterbox_y) / scale;

    if category == VisualSlotCategory::Ultimate {
        let col_offset_units = dx1080 / ULT_COL_PITCH_RATIO;
        let raw_ult_skew_x = -col_offset_units * ULT_SKEW_STEP_DEG;
        let skew_x_deg = round_2dp(raw_ult_skew_x.clamp(-MAX_ULT_SKEW_X_DEG, MAX_ULT_SKEW_X_DEG));
        return BoardPerspective {
            skew_x_deg,
            skew_y_deg: 0.0,
            rotate_x_deg: 0.0,
        };
    }

    let dy = (y1080 - PLINTH_VANISH_Y).max(400.0);
    let tan_theta = (x1080 - PLINTH_VANISH_X) / dy;
    let raw_skew_x = tan_theta.atan().to_degrees();
    let skew_x_deg = round_2dp(raw_skew_x.clamp(-MAX_PLINTH_SKEW_X_DEG, MAX_PLINTH_SKEW_X_DEG));

    BoardPerspective {
        skew_x_deg,
        skew_y_deg: 0.0,
        rotate_x_deg: 0.0,
    }
}

pub fn resolve_visual_slot_layout(input: &VisualSlotInput) -> ResolvedVisualSlot {
    let use_canonical = input.layout_source != Some(ResolutionSource::Custom);
    let bounds = if use_canonical && input.category == VisualSlotCategory::Selected {
        resolve_selected_screen_rect(input).unwrap_or(input.fallback)
    } else {
        let canonical_1080 = if use_canonical {
            resolve_canonical_1080p_rect(input)
        } else {
            None
        };
        match canonical_1080 {
            Some(c) if input.viewport_width > 0.0 && input.viewport_height > 0.0 => {
                project_rect_from_1080p(c, input.viewport_width, input.viewport_height)
            }
            _ => input.fallback,
        }
    };

    let perspective = compute_board_perspective(
        bounds,
        input.category,
        input.viewport_width,
        input.viewport_height,
    );
    let horizontal_overhang_px = if perspective.skew_x_deg == 0.0 {
        0.0
    } else {
        (perspective.skew_x_deg.to_radians().tan().abs() * bounds.height) / 2.0
    };

    ResolvedVisualSlot {
        bounds,
        perspective,
        horizontal_overhang_px,
    }
}

/// Returns `[top_left, top_right, bottom_right, bottom_left]` vertices matching CSS `skewX(deg)`
/// around the rectangle's geometric center.
pub fn skewed_quad_points(bounds: SlotBoundsF64, skew_x_deg: f64) -> [(f64, f64); 4] {
    let dx_half = (bounds.height * 0.5) * skew_x_deg.to_radians().tan();
    [
        (bounds.x - dx_half, bounds.y),
        (bounds.x + bounds.width - dx_half, bounds.y),
        (bounds.x + bounds.width + dx_half, bounds.y + bounds.height),
        (bounds.x + dx_half, bounds.y + bounds.height),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panorama_projection_handles_widescreen_and_narrow_letterbox() {
        let (scale_1440, lb_1440) = compute_panorama_projection(2560.0, 1440.0);
        assert!((scale_1440 - (1440.0 / 1080.0)).abs() < 1e-6);
        assert!(lb_1440.abs() < 1e-6);

        let (scale_ultrawide, lb_uw) = compute_panorama_projection(3440.0, 1440.0);
        assert!((scale_ultrawide - (1440.0 / 1080.0)).abs() < 1e-6);
        assert!(lb_uw.abs() < 1e-6);

        let (scale_43, lb_43) = compute_panorama_projection(1440.0, 1080.0);
        // 1440 / 1.6 = 900 < 1080 -> vertically letterboxed by (1080 - 900) / 2 = 90
        assert!((scale_43 - (900.0 / 1080.0)).abs() < 1e-6);
        assert!((lb_43 - 90.0).abs() < 1e-6);
    }

    #[test]
    fn canonical_plinth_skews_oppose_symmetrically_on_left_and_right() {
        let left_std = resolve_visual_slot_layout(&VisualSlotInput {
            fallback: SlotBoundsF64 {
                x: 0.0,
                y: 0.0,
                width: 40.0,
                height: 40.0,
            },
            category: VisualSlotCategory::Standard,
            hero_order: Some(0),
            ability_order: Some(1),
            is_ultimate: Some(false),
            box_index: None,
            viewport_width: 2560.0,
            viewport_height: 1440.0,
            layout_source: Some(ResolutionSource::Preset),
        });
        let right_std = resolve_visual_slot_layout(&VisualSlotInput {
            fallback: SlotBoundsF64 {
                x: 0.0,
                y: 0.0,
                width: 40.0,
                height: 40.0,
            },
            category: VisualSlotCategory::Standard,
            hero_order: Some(5),
            ability_order: Some(1),
            is_ultimate: Some(false),
            box_index: None,
            viewport_width: 2560.0,
            viewport_height: 1440.0,
            layout_source: Some(ResolutionSource::Preset),
        });

        assert!(left_std.perspective.skew_x_deg < -4.0);
        assert!(right_std.perspective.skew_x_deg > 0.0);
        assert!(left_std.horizontal_overhang_px > 0.0);
        assert!(left_std.bounds.width > 65.0);
    }

    #[test]
    fn custom_layout_source_preserves_fallback_bounds_verbatim() {
        let fallback = SlotBoundsF64 {
            x: 123.0,
            y: 456.0,
            width: 78.0,
            height: 90.0,
        };
        let resolved = resolve_visual_slot_layout(&VisualSlotInput {
            fallback,
            category: VisualSlotCategory::Standard,
            hero_order: Some(0),
            ability_order: Some(1),
            is_ultimate: Some(false),
            box_index: None,
            viewport_width: 2560.0,
            viewport_height: 1440.0,
            layout_source: Some(ResolutionSource::Custom),
        });
        assert_eq!(resolved.bounds, fallback);
    }

    #[test]
    fn skewed_quad_points_match_css_skewx_around_center() {
        let q = skewed_quad_points(
            SlotBoundsF64 {
                x: 100.0,
                y: 200.0,
                width: 60.0,
                height: 50.0,
            },
            4.5,
        );
        // Top edge shifts left (-dx), bottom edge shifts right (+dx) for positive skewX
        assert!(q[0].0 < 100.0);
        assert!(q[2].0 > 160.0);
        assert!(((q[0].0 + q[3].0) * 0.5 - 100.0).abs() < 1e-6);
    }
}
