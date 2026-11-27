//! Versioned IPC protocol between `ad-daemon` and `ad-overlay`.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResolutionSource {
    Custom,
    Preset,
    AutoScaled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RoleMode {
    Off,
    Fixed,
    Dynamic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlotHighlight {
    pub slot_index: usize,
    pub bounds: Rect,
    pub display_name: String,
    pub is_unknown: bool,
    pub is_top_tier: bool,
    pub is_synergy_pick: bool,
    pub consolidated_score: Option<f64>,
    pub winrate: Option<f64>,
    pub pick_rate: Option<f64>,
    pub top_rank: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OverlaySnapshot {
    pub protocol_version: u32,
    pub sequence: u64,
    pub target_resolution: String,
    pub resolution_source: ResolutionSource,
    pub scanning: bool,
    pub slots: Vec<SlotHighlight>,
    pub selected_spot_hero_order: Option<u8>,
    pub selected_model_hero_order: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OverlayCommand {
    TriggerScan { is_initial: bool },
    SelectMySpot { hero_order: u8, db_hero_id: i64 },
    SelectMyModel { hero_order: u8, db_hero_id: i64 },
    SetRoleMode { mode: RoleMode, fixed_positions: Vec<u8> },
    ResetDraft,
    CloseOverlay,
    ReportFailedScan,
}
