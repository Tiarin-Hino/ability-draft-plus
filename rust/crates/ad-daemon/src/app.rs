//! Shared Axum router and daemon state for `ad-daemon`.

use std::{
    convert::Infallible,
    path::PathBuf,
    process::{Child, Command},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use ad_capture::WindowBounds;
use ad_core::gsi::{parse_gsi_payload, GsiSnapshot};
use ad_protocol::{
    AbilityCatalogEntry, DaemonSettings, HeroCatalogEntry, OverlayCommand, OverlayProcessStatus,
    OverlaySnapshot, Rect, ResolutionSource, RoleMode, StreamBoardSummary, StreamEnvelope,
    PROTOCOL_VERSION, STREAM_PROTOCOL_VERSION,
};
use axum::{
    body::Bytes,
    extract::State,
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Json, Router,
};
use futures_core::Stream;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::{broadcast, RwLock};
use tokio_stream::{wrappers::BroadcastStream, StreamExt};
use tower_http::{cors::CorsLayer, services::ServeDir};
use tracing::{info, warn};

use crate::{
    auto_rescan::{AutoRescanController, RescanAction},
    db::DbSummary,
    scanner::{ScanOptions, ScanPipeline},
};

pub fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Clone)]
pub struct DaemonState {
    pub db_summary: Option<DbSummary>,
    pub pipeline: Option<Arc<ScanPipeline>>,
    pub web_dir: Option<PathBuf>,
    pub latest_gsi: Arc<RwLock<Option<GsiSnapshot>>>,
    pub latest_snapshot: Arc<RwLock<OverlaySnapshot>>,
    pub overlay_tx: broadcast::Sender<OverlaySnapshot>,
    pub stream_tx: broadcast::Sender<StreamEnvelope<StreamBoardSummary>>,
    pub picks_tx: broadcast::Sender<Value>,
    pub picks_snapshot: Arc<RwLock<Option<Value>>>,
    pub stream_layout: Arc<RwLock<Value>>,
    pub dota_window: Arc<RwLock<Option<WindowBounds>>>,
    pub role_mode: Arc<RwLock<RoleMode>>,
    pub role_fixed_positions: Arc<RwLock<Vec<u8>>>,
    pub auto_rescan: Arc<RwLock<AutoRescanController>>,
    pub daemon_port: Arc<RwLock<u16>>,
    pub settings: Arc<RwLock<DaemonSettings>>,
    pub settings_path: Option<PathBuf>,
    pub overlay_child: Arc<Mutex<Option<Child>>>,
}

fn resolve_settings_path() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("AD_SETTINGS_PATH").map(PathBuf::from) {
        return Some(explicit);
    }
    if cfg!(test) {
        return None;
    }
    #[cfg(target_os = "windows")]
    if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
        return Some(appdata.join("ability-draft-plus/rust-daemon-settings.json"));
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        return Some(home.join("Library/Application Support/ability-draft-plus/rust-daemon-settings.json"));
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from) {
            return Some(xdg.join("ability-draft-plus/rust-daemon-settings.json"));
        }
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            return Some(home.join(".config/ability-draft-plus/rust-daemon-settings.json"));
        }
    }
    None
}

fn load_persisted_settings(path: Option<&PathBuf>) -> Option<DaemonSettings> {
    let p = path?;
    let raw = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_persisted_settings(path: Option<&PathBuf>, settings: &DaemonSettings) {
    let Some(p) = path else {
        return;
    };
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = std::fs::write(p, json);
    }
}

fn find_overlay_binary() -> Option<PathBuf> {
    let exe_name = if cfg!(target_os = "windows") {
        "ad-overlay.exe"
    } else {
        "ad-overlay"
    };
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(exe_name));
            if let Some(parent) = dir.parent() {
                candidates.push(parent.join(exe_name));
            }
        }
    }
    candidates.push(PathBuf::from(format!("rust/target/debug/{exe_name}")));
    candidates.push(PathBuf::from(format!("target/debug/{exe_name}")));
    candidates.into_iter().find(|p| p.is_file())
}

impl DaemonState {
    pub fn new(
        db_summary: Option<DbSummary>,
        pipeline: Option<Arc<ScanPipeline>>,
        web_dir: Option<PathBuf>,
    ) -> Self {
        let settings_path = resolve_settings_path();
        let mut settings = load_persisted_settings(settings_path.as_ref()).unwrap_or_default();
        if let Ok(v) = std::env::var("AD_AUTO_RESCAN") {
            settings.auto_rescan_enabled = v == "1" || v.eq_ignore_ascii_case("true");
        }
        let auto_rescan_default = settings.auto_rescan_enabled;
        let pick_templates_loaded = pipeline
            .as_ref()
            .map(|p| p.pick_template_count())
            .unwrap_or(0);
        let initial_snapshot = OverlaySnapshot {
            protocol_version: PROTOCOL_VERSION,
            sequence: 0,
            target_resolution: "1920x1080".to_string(),
            resolution_source: ResolutionSource::Preset,
            scanning: false,
            slots: Vec::new(),
            hero_models: Vec::new(),
            hero_spots: Vec::new(),
            picked_abilities: Vec::new(),
            selected_spot_hero_order: None,
            selected_model_hero_order: None,
            op_combinations: Vec::new(),
            trap_combinations: Vec::new(),
            role_mode: settings.role_mode,
            role_fixed_positions: settings.role_fixed_positions.clone(),
            auto_rescan_enabled: auto_rescan_default,
            dota_window: None,
            gsi_connected: false,
            game_phase: None,
            pick_templates_loaded,
        };
        let (overlay_tx, _) = broadcast::channel(32);
        let (stream_tx, _) = broadcast::channel(32);
        let (picks_tx, _) = broadcast::channel(32);
        Self {
            db_summary,
            pipeline,
            web_dir,
            latest_gsi: Arc::new(RwLock::new(None)),
            latest_snapshot: Arc::new(RwLock::new(initial_snapshot)),
            overlay_tx,
            stream_tx,
            picks_tx,
            picks_snapshot: Arc::new(RwLock::new(None)),
            stream_layout: Arc::new(RwLock::new(serde_json::json!({}))),
            dota_window: Arc::new(RwLock::new(None)),
            role_mode: Arc::new(RwLock::new(settings.role_mode)),
            role_fixed_positions: Arc::new(RwLock::new(settings.role_fixed_positions.clone())),
            auto_rescan: Arc::new(RwLock::new(AutoRescanController::new(auto_rescan_default))),
            daemon_port: Arc::new(RwLock::new(41234)),
            settings: Arc::new(RwLock::new(settings)),
            settings_path,
            overlay_child: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn build_stream_envelope(&self) -> StreamEnvelope<StreamBoardSummary> {
        let snap = self.latest_snapshot.read().await;
        let gsi = self.latest_gsi.read().await;
        let status = if snap.slots.is_empty() {
            "waiting".to_string()
        } else {
            "drafting".to_string()
        };
        StreamEnvelope {
            v: STREAM_PROTOCOL_VERSION,
            kind: "state".to_string(),
            ts: now_epoch_ms(),
            payload: StreamBoardSummary {
                status,
                pool_count: snap.slots.iter().filter(|s| !s.is_unknown).count(),
                op_combos: snap.op_combinations.clone(),
                trap_combos: snap.trap_combinations.clone(),
                gsi_connected: gsi.is_some(),
                game_phase: gsi
                    .as_ref()
                    .and_then(|g| g.game_phase.map(|p| format!("{p:?}"))),
            },
        }
    }
    pub async fn build_picks_payload(&self) -> Value {
        let custom = self.picks_snapshot.read().await.clone();
        if let Some(value) = custom {
            return value;
        }
        let snap = self.latest_snapshot.read().await;
        let gsi = self.latest_gsi.read().await;
        serde_json::json!({
            "sequence": snap.sequence,
            "target_resolution": snap.target_resolution,
            "gsi_connected": gsi.is_some(),
            "match_id": gsi.as_ref().and_then(|g| g.match_id.clone()),
            "game_phase": gsi.as_ref().and_then(|g| g.game_phase.map(|p| format!("{p:?}"))),
            "local_slot_index": gsi.as_ref().and_then(|g| g.local_slot_index),
            "hero_spots": snap.hero_spots,
            "hero_models": snap.hero_models,
            "picked_abilities": snap.picked_abilities,
            "players": gsi.as_ref().map(|g| &g.players),
        })
    }
}

pub fn window_bounds_to_rect(bounds: WindowBounds) -> Rect {
    Rect {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
    }
}

async fn gsi_local_context(state: &DaemonState) -> (Option<String>, Option<u8>, bool, Option<String>) {
    let gsi_guard = state.latest_gsi.read().await;
    let Some(gsi) = gsi_guard.as_ref() else {
        return (None, None, false, None);
    };
    let hero = gsi
        .local_player
        .as_ref()
        .and_then(|p| p.hero_npc_name.clone());
    let half = gsi
        .local_slot_index
        .map(|slot| if slot < 5 { 0 } else { 5 });
    let phase = gsi.game_phase.map(|p| format!("{p:?}"));
    (hero, half, true, phase)
}

fn clear_snapshot_draft_fields(snap: &mut OverlaySnapshot) {
    snap.scanning = false;
    snap.slots.clear();
    snap.hero_models.clear();
    snap.hero_spots.clear();
    snap.picked_abilities.clear();
    snap.op_combinations.clear();
    snap.trap_combinations.clear();
    snap.selected_spot_hero_order = None;
    snap.selected_model_hero_order = None;
}

pub async fn reset_draft_state(state: &DaemonState) -> OverlaySnapshot {
    if let Some(pipeline) = &state.pipeline {
        pipeline.reset_session();
    }
    state.auto_rescan.write().await.reset_draft();
    let updated = {
        let mut snap = state.latest_snapshot.write().await;
        snap.sequence += 1;
        clear_snapshot_draft_fields(&mut snap);
        snap.clone()
    };
    let _ = state.overlay_tx.send(updated.clone());
    let _ = state.stream_tx.send(state.build_stream_envelope().await);
    let _ = state.picks_tx.send(state.build_picks_payload().await);
    updated
}

pub async fn spawn_background_scan(state: &DaemonState) {
    let Some(pipeline) = state.pipeline.clone() else {
        return;
    };
    let current_role_mode = *state.role_mode.read().await;
    let current_role_positions = state.role_fixed_positions.read().await.clone();
    let current_window = (*state.dota_window.read().await).map(window_bounds_to_rect);
    let auto_enabled = state.auto_rescan.read().await.enabled;
    let (gsi_local_hero, gsi_team_half_start, gsi_connected, game_phase) =
        gsi_local_context(state).await;

    let (next_seq, options) = {
        let mut snap = state.latest_snapshot.write().await;
        snap.sequence += 1;
        snap.scanning = true;
        snap.auto_rescan_enabled = auto_enabled;
        snap.dota_window = current_window;
        snap.gsi_connected = gsi_connected;
        snap.game_phase = game_phase.clone();
        let opts = ScanOptions {
            role_mode: current_role_mode,
            role_fixed_positions: current_role_positions,
            selected_spot_hero_order: snap.selected_spot_hero_order,
            selected_model_hero_order: snap.selected_model_hero_order,
            auto_rescan_enabled: auto_enabled,
            dota_window: current_window,
            gsi_local_hero,
            gsi_team_half_start,
            gsi_connected,
            game_phase,
        };
        let copy = snap.clone();
        let _ = state.overlay_tx.send(copy);
        (snap.sequence + 1, opts)
    };

    let state_bg = state.clone();
    tokio::spawn(async move {
        let res =
            tokio::task::spawn_blocking(move || pipeline.scan_live_game(&options, next_seq))
                .await;
        let final_snap = match res {
            Ok(Ok(scanned)) => {
                let picked_count = scanned
                    .picked_abilities
                    .iter()
                    .filter(|p| p.ability_name.is_some())
                    .count();
                state_bg
                    .auto_rescan
                    .write()
                    .await
                    .set_picks_tracked(picked_count);
                scanned
            }
            Ok(Err(err)) => {
                warn!(%err, "Live scan failed");
                let mut guard = state_bg.latest_snapshot.write().await;
                guard.sequence = guard.sequence.max(next_seq);
                guard.scanning = false;
                guard.clone()
            }
            Err(err) => {
                warn!(%err, "Scan task panicked");
                let mut guard = state_bg.latest_snapshot.write().await;
                guard.sequence = guard.sequence.max(next_seq);
                guard.scanning = false;
                guard.clone()
            }
        };
        *state_bg.latest_snapshot.write().await = final_snap.clone();
        let _ = state_bg.overlay_tx.send(final_snap);
        let _ = state_bg
            .stream_tx
            .send(state_bg.build_stream_envelope().await);
        let _ = state_bg
            .picks_tx
            .send(state_bg.build_picks_payload().await);
    });
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    capture_backend: &'static str,
    protocol_version: u32,
    gsi_connected: bool,
    layouts_loaded: usize,
    pick_templates_loaded: usize,
    db_summary: Option<DbSummary>,
    dota_window: Option<WindowBounds>,
}

async fn health(State(state): State<DaemonState>) -> Json<HealthResponse> {
    let gsi_connected = state.latest_gsi.read().await.is_some();
    let dota_window = *state.dota_window.read().await;
    let layouts_loaded = state
        .pipeline
        .as_ref()
        .map(|p| p.layout_count())
        .unwrap_or(0);
    let pick_templates_loaded = state
        .pipeline
        .as_ref()
        .map(|p| p.pick_template_count())
        .unwrap_or(0);
    Json(HealthResponse {
        status: "ok",
        capture_backend: ad_capture::platform::BACKEND_NAME,
        protocol_version: PROTOCOL_VERSION,
        gsi_connected,
        layouts_loaded,
        pick_templates_loaded,
        db_summary: state.db_summary.clone(),
        dota_window,
    })
}

async fn ingest_gsi(State(state): State<DaemonState>, Json(payload): Json<Value>) -> StatusCode {
    let snapshot = parse_gsi_payload(&payload);
    let next_phase = snapshot.game_phase.map(|p| format!("{p:?}"));
    let (prev_match_id, prev_phase) = {
        let prev = state.latest_gsi.read().await;
        match prev.as_ref() {
            Some(g) => (g.match_id.clone(), g.game_phase.map(|p| format!("{p:?}"))),
            None => (None, None),
        }
    };
    if prev_phase.is_none() && !state.latest_snapshot.read().await.gsi_connected
        || prev_match_id != snapshot.match_id
        || prev_phase != next_phase
    {
        info!(
            match_id = ?snapshot.match_id,
            game_phase = ?snapshot.game_phase,
            mode = ?snapshot.mode,
            "GSI state transition"
        );
    }

    let action = state
        .auto_rescan
        .write()
        .await
        .on_gsi_snapshot(&snapshot, now_epoch_ms());
    *state.latest_gsi.write().await = Some(snapshot);

    if action == RescanAction::ResetDraft {
        if let Some(pipeline) = &state.pipeline {
            pipeline.reset_session();
        }
    }

    let should_broadcast_overlay = {
        let mut snap = state.latest_snapshot.write().await;
        let meta_changed = !snap.gsi_connected || snap.game_phase != next_phase;
        snap.gsi_connected = true;
        snap.game_phase = next_phase;
        if action == RescanAction::ResetDraft {
            snap.sequence += 1;
            clear_snapshot_draft_fields(&mut snap);
            Some(snap.clone())
        } else if meta_changed {
            snap.sequence += 1;
            Some(snap.clone())
        } else {
            None
        }
    };
    if let Some(updated_overlay) = should_broadcast_overlay {
        let _ = state.overlay_tx.send(updated_overlay);
    }

    let envelope = state.build_stream_envelope().await;
    let _ = state.stream_tx.send(envelope);
    let _ = state.picks_tx.send(state.build_picks_payload().await);
    StatusCode::OK
}

async fn get_gsi(State(state): State<DaemonState>) -> Json<Option<GsiSnapshot>> {
    Json(state.latest_gsi.read().await.clone())
}

async fn get_overlay_snapshot(State(state): State<DaemonState>) -> Json<OverlaySnapshot> {
    Json(state.latest_snapshot.read().await.clone())
}

async fn debug_scan_image(
    State(state): State<DaemonState>,
    body: Bytes,
) -> Result<Json<OverlaySnapshot>, StatusCode> {
    let Some(pipeline) = state.pipeline.clone() else {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    };
    let current_role_mode = *state.role_mode.read().await;
    let current_role_positions = state.role_fixed_positions.read().await.clone();
    let current_window = (*state.dota_window.read().await).map(window_bounds_to_rect);
    let auto_enabled = state.auto_rescan.read().await.enabled;
    let (gsi_local_hero, gsi_team_half_start, gsi_connected, game_phase) =
        gsi_local_context(&state).await;

    let (next_seq, options) = {
        let snap = state.latest_snapshot.read().await;
        (
            snap.sequence + 1,
            ScanOptions {
                role_mode: current_role_mode,
                role_fixed_positions: current_role_positions,
                selected_spot_hero_order: snap.selected_spot_hero_order,
                selected_model_hero_order: snap.selected_model_hero_order,
                auto_rescan_enabled: auto_enabled,
                dota_window: current_window,
                gsi_local_hero,
                gsi_team_half_start,
                gsi_connected,
                game_phase,
            },
        )
    };

    let scanned = tokio::task::spawn_blocking(move || {
        pipeline.scan_png_bytes(&body, &options, next_seq)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map_err(|_| StatusCode::BAD_REQUEST)?;

    *state.latest_snapshot.write().await = scanned.clone();
    let _ = state.overlay_tx.send(scanned.clone());
    let _ = state.stream_tx.send(state.build_stream_envelope().await);
    let _ = state.picks_tx.send(state.build_picks_payload().await);
    Ok(Json(scanned))
}

async fn overlay_events(
    State(state): State<DaemonState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let current = state.latest_snapshot.read().await.clone();
    let initial = tokio_stream::once(Ok::<Event, Infallible>(
        Event::default()
            .event("snapshot")
            .data(serde_json::to_string(&current).unwrap_or_default()),
    ));

    let updates = BroadcastStream::new(state.overlay_tx.subscribe()).filter_map(|msg| match msg {
        Ok(snapshot) => serde_json::to_string(&snapshot)
            .ok()
            .map(|data| Ok(Event::default().event("snapshot").data(data))),
        Err(_) => None,
    });

    Sse::new(initial.chain(updates)).keep_alive(KeepAlive::default())
}

async fn stream_events(
    State(state): State<DaemonState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let initial_env = state.build_stream_envelope().await;
    let initial = tokio_stream::once(Ok::<Event, Infallible>(
        Event::default()
            .event("state")
            .data(serde_json::to_string(&initial_env).unwrap_or_default()),
    ));

    let updates = BroadcastStream::new(state.stream_tx.subscribe()).filter_map(|msg| match msg {
        Ok(env) => serde_json::to_string(&env)
            .ok()
            .map(|data| Ok(Event::default().event("state").data(data))),
        Err(_) => None,
    });

    Sse::new(initial.chain(updates)).keep_alive(KeepAlive::default())
}

async fn picks_events(
    State(state): State<DaemonState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let initial_picks = state.build_picks_payload().await;
    let env = StreamEnvelope {
        v: STREAM_PROTOCOL_VERSION,
        kind: "picks".to_string(),
        ts: now_epoch_ms(),
        payload: Some(initial_picks),
    };
    let initial = tokio_stream::once(Ok::<Event, Infallible>(
        Event::default()
            .event("picks")
            .data(serde_json::to_string(&env).unwrap_or_default()),
    ));
    let updates = BroadcastStream::new(state.picks_tx.subscribe()).filter_map(|msg| match msg {
        Ok(payload) => {
            let env = StreamEnvelope {
                v: STREAM_PROTOCOL_VERSION,
                kind: "picks".to_string(),
                ts: now_epoch_ms(),
                payload: Some(payload),
            };
            serde_json::to_string(&env)
                .ok()
                .map(|data| Ok(Event::default().event("picks").data(data)))
        }
        Err(_) => None,
    });
    Sse::new(initial.chain(updates)).keep_alive(KeepAlive::default())
}

async fn get_stream_layout(State(state): State<DaemonState>) -> Json<Value> {
    Json(state.stream_layout.read().await.clone())
}

async fn set_stream_layout(
    State(state): State<DaemonState>,
    Json(layout): Json<Value>,
) -> Json<Value> {
    *state.stream_layout.write().await = layout.clone();
    Json(layout)
}

async fn overlay_command(
    State(state): State<DaemonState>,
    Json(cmd): Json<OverlayCommand>,
) -> Json<OverlaySnapshot> {
    let mut trigger_scan = false;
    let mut should_rescore = false;
    match &cmd {
        OverlayCommand::SetRoleMode {
            mode,
            fixed_positions,
        } => {
            *state.role_mode.write().await = *mode;
            *state.role_fixed_positions.write().await = fixed_positions.clone();
            should_rescore = true;
        }
        OverlayCommand::SelectMySpot { .. } | OverlayCommand::SelectMyModel { .. } => {
            should_rescore = true;
        }
        OverlayCommand::SetAutoRescan { enabled } => {
            state.auto_rescan.write().await.enabled = *enabled;
        }
        OverlayCommand::TriggerScan { .. } => {
            trigger_scan = true;
        }
        OverlayCommand::ResetDraft => {
            return Json(reset_draft_state(&state).await);
        }
        OverlayCommand::CloseOverlay | OverlayCommand::ReportFailedScan => {}
    }

    let current_role_mode = *state.role_mode.read().await;
    let current_role_positions = state.role_fixed_positions.read().await.clone();
    let current_window = (*state.dota_window.read().await).map(window_bounds_to_rect);
    let auto_enabled = state.auto_rescan.read().await.enabled;
    let (gsi_local_hero, gsi_team_half_start, gsi_connected, game_phase) =
        gsi_local_context(&state).await;

    let updated = {
        let mut snap = state.latest_snapshot.write().await;
        snap.sequence += 1;
        snap.role_mode = current_role_mode;
        snap.role_fixed_positions = current_role_positions.clone();
        snap.auto_rescan_enabled = auto_enabled;
        snap.dota_window = current_window;
        snap.gsi_connected = gsi_connected;
        snap.game_phase = game_phase.clone();
        match &cmd {
            OverlayCommand::SelectMySpot { hero_order, .. } => {
                snap.selected_spot_hero_order = Some(*hero_order);
            }
            OverlayCommand::SelectMyModel { hero_order, .. } => {
                snap.selected_model_hero_order = Some(*hero_order);
            }
            OverlayCommand::TriggerScan { .. } => {
                snap.scanning = true;
            }
            OverlayCommand::SetRoleMode { .. }
            | OverlayCommand::SetAutoRescan { .. }
            | OverlayCommand::ResetDraft
            | OverlayCommand::CloseOverlay
            | OverlayCommand::ReportFailedScan => {}
        }

        if should_rescore {
            if let Some(pipeline) = &state.pipeline {
                let opts = ScanOptions {
                    role_mode: current_role_mode,
                    role_fixed_positions: current_role_positions.clone(),
                    selected_spot_hero_order: snap.selected_spot_hero_order,
                    selected_model_hero_order: snap.selected_model_hero_order,
                    auto_rescan_enabled: auto_enabled,
                    dota_window: current_window,
                    gsi_local_hero,
                    gsi_team_half_start,
                    gsi_connected,
                    game_phase,
                };
                if let Some(rescored) = pipeline.rescore_cached(&opts, snap.sequence) {
                    *snap = rescored;
                }
            }
        }
        snap.clone()
    };

    let _ = state.overlay_tx.send(updated.clone());
    let _ = state.stream_tx.send(state.build_stream_envelope().await);
    let _ = state.picks_tx.send(state.build_picks_payload().await);

    if trigger_scan {
        spawn_background_scan(&state).await;
    }

    Json(updated)
}

async fn get_abilities(State(state): State<DaemonState>) -> Json<Vec<AbilityCatalogEntry>> {
    let entries = state
        .pipeline
        .as_ref()
        .map(|p| p.ability_catalog())
        .unwrap_or_default();
    Json(entries)
}

async fn get_heroes(State(state): State<DaemonState>) -> Json<Vec<HeroCatalogEntry>> {
    let entries = state
        .pipeline
        .as_ref()
        .map(|p| p.hero_catalog())
        .unwrap_or_default();
    Json(entries)
}

async fn get_settings(State(state): State<DaemonState>) -> Json<DaemonSettings> {
    Json(state.settings.read().await.clone())
}

async fn set_settings(
    State(state): State<DaemonState>,
    Json(next): Json<DaemonSettings>,
) -> Json<DaemonSettings> {
    *state.settings.write().await = next.clone();
    *state.role_mode.write().await = next.role_mode;
    *state.role_fixed_positions.write().await = next.role_fixed_positions.clone();
    state.auto_rescan.write().await.enabled = next.auto_rescan_enabled;
    save_persisted_settings(state.settings_path.as_ref(), &next);

    let current_window = (*state.dota_window.read().await).map(window_bounds_to_rect);
    let (gsi_local_hero, gsi_team_half_start, gsi_connected, game_phase) =
        gsi_local_context(&state).await;

    let updated = {
        let mut snap = state.latest_snapshot.write().await;
        snap.sequence += 1;
        snap.role_mode = next.role_mode;
        snap.role_fixed_positions = next.role_fixed_positions.clone();
        snap.auto_rescan_enabled = next.auto_rescan_enabled;
        snap.dota_window = current_window;
        snap.gsi_connected = gsi_connected;
        snap.game_phase = game_phase.clone();
        if let Some(pipeline) = &state.pipeline {
            let opts = ScanOptions {
                role_mode: next.role_mode,
                role_fixed_positions: next.role_fixed_positions.clone(),
                selected_spot_hero_order: snap.selected_spot_hero_order,
                selected_model_hero_order: snap.selected_model_hero_order,
                auto_rescan_enabled: next.auto_rescan_enabled,
                dota_window: current_window,
                gsi_local_hero,
                gsi_team_half_start,
                gsi_connected,
                game_phase,
            };
            if let Some(rescored) = pipeline.rescore_cached(&opts, snap.sequence) {
                *snap = rescored;
            }
        }
        snap.clone()
    };

    let _ = state.overlay_tx.send(updated);
    let _ = state.stream_tx.send(state.build_stream_envelope().await);
    let _ = state.picks_tx.send(state.build_picks_payload().await);
    Json(next)
}

fn current_overlay_status(state: &DaemonState) -> OverlayProcessStatus {
    let binary_found = find_overlay_binary().is_some();
    let mut guard = state.overlay_child.lock().unwrap_or_else(|e| e.into_inner());
    let mut pid = None;
    let mut running = false;
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => {
                running = true;
                pid = Some(child.id());
            }
            _ => {
                *guard = None;
            }
        }
    }
    OverlayProcessStatus {
        running,
        pid,
        binary_found,
    }
}

async fn get_overlay_status(State(state): State<DaemonState>) -> Json<OverlayProcessStatus> {
    Json(current_overlay_status(&state))
}

async fn launch_overlay(State(state): State<DaemonState>) -> Json<OverlayProcessStatus> {
    let existing = current_overlay_status(&state);
    if existing.running {
        return Json(existing);
    }
    let Some(bin_path) = find_overlay_binary() else {
        warn!("Could not find ad-overlay binary alongside daemon");
        return Json(OverlayProcessStatus {
            running: false,
            pid: None,
            binary_found: false,
        });
    };
    let port = *state.daemon_port.read().await;
    let mut cmd = Command::new(&bin_path);
    cmd.env("AD_DAEMON_URL", format!("http://127.0.0.1:{port}"));
    match cmd.spawn() {
        Ok(child) => {
            let pid = child.id();
            info!(pid, path = %bin_path.display(), "Launched native ad-overlay process");
            let mut guard = state.overlay_child.lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some(child);
            Json(OverlayProcessStatus {
                running: true,
                pid: Some(pid),
                binary_found: true,
            })
        }
        Err(err) => {
            warn!(%err, path = %bin_path.display(), "Failed to spawn ad-overlay");
            Json(OverlayProcessStatus {
                running: false,
                pid: None,
                binary_found: true,
            })
        }
    }
}

async fn stop_overlay(State(state): State<DaemonState>) -> Json<OverlayProcessStatus> {
    let binary_found = find_overlay_binary().is_some();
    let mut guard = state.overlay_child.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        info!("Stopped managed ad-overlay process");
    }
    Json(OverlayProcessStatus {
        running: false,
        pid: None,
        binary_found,
    })
}

pub fn build_router(state: DaemonState) -> Router {
    let web_dir = state.web_dir.clone();
    let mut router = Router::new()
        .route("/health", get(health))
        .route("/gsi", post(ingest_gsi))
        .route("/api/gsi", get(get_gsi))
        .route("/api/abilities", get(get_abilities))
        .route("/api/heroes", get(get_heroes))
        .route("/api/settings", get(get_settings).post(set_settings))
        .route("/api/overlay/status", get(get_overlay_status))
        .route("/api/overlay/launch", post(launch_overlay))
        .route("/api/overlay/stop", post(stop_overlay))
        .route("/events", get(stream_events))
        .route("/picks/events", get(picks_events))
        .route("/stream/layout", get(get_stream_layout).post(set_stream_layout))
        .route("/overlay/snapshot", get(get_overlay_snapshot))
        .route("/overlay/events", get(overlay_events))
        .route("/overlay/command", post(overlay_command))
        .route("/debug/scan-image", post(debug_scan_image))
        .with_state(state);

    if let Some(root) = web_dir {
        let stream_dir = root.join("stream");
        if stream_dir.is_dir() {
            router = router.nest_service("/stream", ServeDir::new(stream_dir));
        }
        let picks_dir = root.join("picks");
        if picks_dir.is_dir() {
            router = router.nest_service("/picks", ServeDir::new(picks_dir));
        }
        let cp_dir = root.join("control-panel");
        if cp_dir.is_dir() {
            router = router.nest_service("/app", ServeDir::new(cp_dir));
        }
    }

    router.layer(CorsLayer::permissive())
}

#[cfg(test)]
mod tests {
    use ad_core::gsi::{GamePhase, GsiMode};
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
    };
    use serde_json::json;
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn health_endpoint_reports_ok() {
        let app = build_router(DaemonState::new(None, None, None));
        let res = app
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let body = to_bytes(res.into_body(), 1024 * 64).await.unwrap();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"], "ok");
        assert_eq!(json["gsi_connected"], false);
        assert_eq!(json["protocol_version"], PROTOCOL_VERSION);
    }

    #[tokio::test]
    async fn debug_scan_image_handles_disabled_pipeline_and_invalid_png() {
        let app_no_pipe = build_router(DaemonState::new(None, None, None));
        let res_503 = app_no_pipe
            .oneshot(
                Request::post("/debug/scan-image")
                    .body(Body::from(vec![1, 2, 3]))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_503.status(), StatusCode::SERVICE_UNAVAILABLE);

        let resources_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../resources");
        let pipe = Arc::new(ScanPipeline::from_resources_dir(&resources_dir).unwrap());
        let app_with_pipe = build_router(DaemonState::new(None, Some(pipe), None));
        let res_400 = app_with_pipe
            .oneshot(
                Request::post("/debug/scan-image")
                    .body(Body::from(b"not a png".to_vec()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_400.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn post_gsi_updates_latest_snapshot_exposed_on_api_gsi() {
        let app = build_router(DaemonState::new(None, None, None));
        let payload = json!({
            "map": {
                "matchid": "12345",
                "game_state": "DOTA_GAMERULES_STATE_HERO_SELECTION",
                "clock_time": -15
            },
            "player": {
                "name": "PlayerOne",
                "accountid": "45008415",
                "team_name": "radiant",
                "team_slot": 1
            }
        });

        let post_res = app
            .clone()
            .oneshot(
                Request::post("/gsi")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(post_res.status(), StatusCode::OK);

        let get_res = app
            .oneshot(Request::get("/api/gsi").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(get_res.status(), StatusCode::OK);

        let body = to_bytes(get_res.into_body(), 1024 * 64).await.unwrap();
        let snapshot: Option<GsiSnapshot> = serde_json::from_slice(&body).unwrap();
        let snapshot = snapshot.expect("snapshot stored");
        assert_eq!(snapshot.match_id.as_deref(), Some("12345"));
        assert_eq!(snapshot.game_phase, Some(GamePhase::HeroSelection));
        assert_eq!(snapshot.mode, GsiMode::Playing);
        assert_eq!(snapshot.local_slot_index, Some(1));
    }

    #[tokio::test]
    async fn overlay_command_updates_snapshot_and_resets_cleanly() {
        let app = build_router(DaemonState::new(None, None, None));

        let select_cmd = OverlayCommand::SelectMySpot {
            hero_order: 3,
            db_hero_id: 42,
        };
        let res1 = app
            .clone()
            .oneshot(
                Request::post("/overlay/command")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&select_cmd).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res1.status(), StatusCode::OK);
        let snap1: OverlaySnapshot =
            serde_json::from_slice(&to_bytes(res1.into_body(), 1024 * 64).await.unwrap()).unwrap();
        assert_eq!(snap1.sequence, 1);
        assert_eq!(snap1.selected_spot_hero_order, Some(3));

        let auto_cmd = OverlayCommand::SetAutoRescan { enabled: true };
        let res_auto = app
            .clone()
            .oneshot(
                Request::post("/overlay/command")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&auto_cmd).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_auto.status(), StatusCode::OK);
        let snap_auto: OverlaySnapshot =
            serde_json::from_slice(&to_bytes(res_auto.into_body(), 1024 * 64).await.unwrap())
                .unwrap();
        assert!(snap_auto.auto_rescan_enabled);

        let res2 = app
            .clone()
            .oneshot(
                Request::post("/overlay/command")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&OverlayCommand::ResetDraft).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res2.status(), StatusCode::OK);
        let snap2: OverlaySnapshot =
            serde_json::from_slice(&to_bytes(res2.into_body(), 1024 * 64).await.unwrap()).unwrap();
        assert_eq!(snap2.sequence, 3);
        assert_eq!(snap2.selected_spot_hero_order, None);

        let res3 = app
            .oneshot(Request::get("/overlay/snapshot").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res3.status(), StatusCode::OK);
        let snap3: OverlaySnapshot =
            serde_json::from_slice(&to_bytes(res3.into_body(), 1024 * 64).await.unwrap()).unwrap();
        assert_eq!(snap3.sequence, 3);
    }

    #[tokio::test]
    async fn stream_layout_and_sse_endpoints_respond_cleanly() {
        let app = build_router(DaemonState::new(None, None, None));

        let layout = json!({ "scale": 0.9, "offsetX": 12 });
        let post_layout = app
            .clone()
            .oneshot(
                Request::post("/stream/layout")
                    .header("content-type", "application/json")
                    .body(Body::from(layout.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(post_layout.status(), StatusCode::OK);

        let get_layout = app
            .clone()
            .oneshot(Request::get("/stream/layout").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(get_layout.status(), StatusCode::OK);
        let parsed: Value =
            serde_json::from_slice(&to_bytes(get_layout.into_body(), 1024 * 64).await.unwrap())
                .unwrap();
        assert_eq!(parsed, layout);

        let sse_stream = app
            .clone()
            .oneshot(Request::get("/events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(sse_stream.status(), StatusCode::OK);
        assert!(sse_stream
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap()
            .contains("text/event-stream"));

        let sse_picks = app
            .oneshot(Request::get("/picks/events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(sse_picks.status(), StatusCode::OK);
        assert!(sse_picks
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap()
            .contains("text/event-stream"));
    }

    #[tokio::test]
    async fn picks_tx_and_snapshot_track_gsi_connection_and_phase() {
        let state = DaemonState::new(None, None, None);
        let mut rx = state.picks_tx.subscribe();
        let app = build_router(state);

        let payload = json!({
            "map": {
                "matchid": "999",
                "game_state": "DOTA_GAMERULES_STATE_HERO_SELECTION",
                "clock_time": -40
            }
        });
        let res = app
            .clone()
            .oneshot(
                Request::post("/gsi")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let broadcasted = rx.try_recv().expect("expected picks_tx broadcast on GSI update");
        assert_eq!(broadcasted["gsi_connected"], true);
        assert_eq!(broadcasted["game_phase"], "HeroSelection");

        let snap_res = app
            .oneshot(Request::get("/overlay/snapshot").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let snap: OverlaySnapshot =
            serde_json::from_slice(&to_bytes(snap_res.into_body(), 1024 * 64).await.unwrap())
                .unwrap();
        assert!(snap.gsi_connected);
        assert_eq!(snap.game_phase.as_deref(), Some("HeroSelection"));
    }

    #[tokio::test]
    async fn catalog_settings_and_overlay_status_endpoints_respond_cleanly() {
        let resources_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../resources");
        let pipe = Arc::new(ScanPipeline::from_resources_dir(&resources_dir).unwrap());
        let app = build_router(DaemonState::new(None, Some(pipe), None));

        let abilities_res = app
            .clone()
            .oneshot(Request::get("/api/abilities").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(abilities_res.status(), StatusCode::OK);
        let abilities: Vec<AbilityCatalogEntry> = serde_json::from_slice(
            &to_bytes(abilities_res.into_body(), 4 * 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        assert!(abilities.len() > 400);

        let heroes_res = app
            .clone()
            .oneshot(Request::get("/api/heroes").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(heroes_res.status(), StatusCode::OK);
        let heroes: Vec<HeroCatalogEntry> = serde_json::from_slice(
            &to_bytes(heroes_res.into_body(), 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        assert!(heroes.len() > 100);

        let updated_settings = DaemonSettings {
            role_mode: RoleMode::Fixed,
            role_fixed_positions: vec![1, 3],
            auto_rescan_enabled: true,
            op_threshold: 0.14,
            trap_threshold: 0.06,
        };
        let post_settings = app
            .clone()
            .oneshot(
                Request::post("/api/settings")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&updated_settings).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(post_settings.status(), StatusCode::OK);

        let get_settings_res = app
            .clone()
            .oneshot(Request::get("/api/settings").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let persisted: DaemonSettings = serde_json::from_slice(
            &to_bytes(get_settings_res.into_body(), 64 * 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(persisted, updated_settings);

        let ov_res = app
            .oneshot(
                Request::get("/api/overlay/status")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ov_res.status(), StatusCode::OK);
        let ov_status: OverlayProcessStatus =
            serde_json::from_slice(&to_bytes(ov_res.into_body(), 64 * 1024).await.unwrap())
                .unwrap();
        assert!(!ov_status.running);
    }
}
