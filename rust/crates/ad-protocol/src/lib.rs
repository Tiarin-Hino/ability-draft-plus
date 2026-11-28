//! Versioned IPC protocol between `ad-daemon`, `ad-overlay`, and OBS stream consumers.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const STREAM_PROTOCOL_VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResolutionSource {
    Custom,
    Preset,
    AutoScaled,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RoleMode {
    #[default]
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
pub struct SynergyCombo {
    pub ability1_name: String,
    pub ability2_name: String,
    pub synergy_winrate: f64,
    pub synergy_increase: Option<f64>,
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
    #[serde(default)]
    pub skew_x_deg: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HeroModelHighlight {
    pub hero_order: u8,
    pub bounds: Rect,
    pub db_hero_id: Option<i64>,
    pub hero_name: String,
    pub display_name: String,
    pub is_unknown: bool,
    pub is_top_tier: bool,
    pub is_my_model: bool,
    pub top_rank: Option<u8>,
    pub winrate: Option<f64>,
    pub pick_rate: Option<f64>,
    pub consolidated_score: Option<f64>,
    #[serde(default)]
    pub skew_x_deg: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerSpotHighlight {
    pub hero_order: u8,
    pub bounds: Rect,
    pub is_my_spot: bool,
    #[serde(default)]
    pub ocr_hero_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PickedAbilitySlot {
    pub hero_order: u8,
    pub box_index: u8,
    pub is_ultimate: bool,
    pub ability_name: Option<String>,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OverlaySnapshot {
    pub protocol_version: u32,
    pub sequence: u64,
    pub target_resolution: String,
    pub resolution_source: ResolutionSource,
    pub scanning: bool,
    pub slots: Vec<SlotHighlight>,
    #[serde(default)]
    pub hero_models: Vec<HeroModelHighlight>,
    #[serde(default)]
    pub hero_spots: Vec<PlayerSpotHighlight>,
    #[serde(default)]
    pub picked_abilities: Vec<PickedAbilitySlot>,
    pub selected_spot_hero_order: Option<u8>,
    pub selected_model_hero_order: Option<u8>,
    #[serde(default)]
    pub op_combinations: Vec<SynergyCombo>,
    #[serde(default)]
    pub trap_combinations: Vec<SynergyCombo>,
    #[serde(default)]
    pub role_mode: RoleMode,
    #[serde(default)]
    pub role_fixed_positions: Vec<u8>,
    #[serde(default)]
    pub auto_rescan_enabled: bool,
    #[serde(default)]
    pub dota_window: Option<Rect>,
    #[serde(default)]
    pub gsi_connected: bool,
    #[serde(default)]
    pub game_phase: Option<String>,
    #[serde(default)]
    pub pick_templates_loaded: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OverlayCommand {
    TriggerScan { is_initial: bool },
    SelectMySpot { hero_order: u8, db_hero_id: i64 },
    SelectMyModel { hero_order: u8, db_hero_id: i64 },
    SetRoleMode { mode: RoleMode, fixed_positions: Vec<u8> },
    SetAutoRescan { enabled: bool },
    ResetDraft,
    CloseOverlay,
    ReportFailedScan,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StreamEnvelope<T> {
    pub v: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub ts: u64,
    pub payload: T,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StreamBoardSummary {
    pub status: String,
    pub pool_count: usize,
    pub op_combos: Vec<SynergyCombo>,
    pub trap_combos: Vec<SynergyCombo>,
    pub gsi_connected: bool,
    pub game_phase: Option<String>,
}
