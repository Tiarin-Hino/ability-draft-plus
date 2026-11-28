//! Shared Axum router and daemon state for `ad-daemon`.

use std::{
    convert::Infallible,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use ad_capture::WindowBounds;
use ad_core::gsi::{parse_gsi_payload, GsiSnapshot};
use ad_protocol::{
    OverlayCommand, OverlaySnapshot, Rect, ResolutionSource, RoleMode, StreamBoardSummary,
    StreamEnvelope, PROTOCOL_VERSION, STREAM_PROTOCOL_VERSION,
};
use axum::{
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
use tracing::warn;

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
    pub picks_snapshot: Arc<RwLock<Option<Value>>>,
    pub stream_layout: Arc<RwLock<Value>>,
    pub dota_window: Arc<RwLock<Option<WindowBounds>>>,
    pub role_mode: Arc<RwLock<RoleMode>>,
    pub role_fixed_positions: Arc<RwLock<Vec<u8>>>,
    pub auto_rescan: Arc<RwLock<AutoRescanController>>,
}

impl DaemonState {
    pub fn new(
        db_summary: Option<DbSummary>,
        pipeline: Option<Arc<ScanPipeline>>,
        web_dir: Option<PathBuf>,
    ) -> Self {
        let auto_rescan_default = std::env::var("AD_AUTO_RESCAN")
            .ok()
            .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"));
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
            role_mode: RoleMode::Off,
            role_fixed_positions: Vec::new(),
            auto_rescan_enabled: auto_rescan_default,
            dota_window: None,
        };
        let (overlay_tx, _) = broadcast::channel(32);
        let (stream_tx, _) = broadcast::channel(32);
        Self {
            db_summary,
            pipeline,
            web_dir,
            latest_gsi: Arc::new(RwLock::new(None)),
            latest_snapshot: Arc::new(RwLock::new(initial_snapshot)),
            overlay_tx,
            stream_tx,
            picks_snapshot: Arc::new(RwLock::new(None)),
            stream_layout: Arc::new(RwLock::new(serde_json::json!({}))),
            dota_window: Arc::new(RwLock::new(None)),
            role_mode: Arc::new(RwLock::new(RoleMode::Off)),
            role_fixed_positions: Arc::new(RwLock::new(Vec::new())),
            auto_rescan: Arc::new(RwLock::new(AutoRescanController::new(auto_rescan_default))),
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
}

pub fn window_bounds_to_rect(bounds: WindowBounds) -> Rect {
    Rect {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
    }
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

    let (next_seq, options) = {
        let mut snap = state.latest_snapshot.write().await;
        snap.sequence += 1;
        snap.scanning = true;
        snap.auto_rescan_enabled = auto_enabled;
        snap.dota_window = current_window;
        let opts = ScanOptions {
            role_mode: current_role_mode,
            role_fixed_positions: current_role_positions,
            selected_spot_hero_order: snap.selected_spot_hero_order,
            selected_model_hero_order: snap.selected_model_hero_order,
            auto_rescan_enabled: auto_enabled,
            dota_window: current_window,
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
    });
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    capture_backend: &'static str,
    protocol_version: u32,
    gsi_connected: bool,
    layouts_loaded: usize,
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
    Json(HealthResponse {
        status: "ok",
        capture_backend: ad_capture::platform::BACKEND_NAME,
        protocol_version: PROTOCOL_VERSION,
        gsi_connected,
        layouts_loaded,
        db_summary: state.db_summary.clone(),
        dota_window,
    })
}

async fn ingest_gsi(State(state): State<DaemonState>, Json(payload): Json<Value>) -> StatusCode {
    let snapshot = parse_gsi_payload(&payload);
    tracing::debug!(
        match_id = ?snapshot.match_id,
        game_phase = ?snapshot.game_phase,
        mode = ?snapshot.mode,
        "Received GSI snapshot"
    );
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
        let mut snap = state.latest_snapshot.write().await;
        snap.sequence += 1;
        clear_snapshot_draft_fields(&mut snap);
        let _ = state.overlay_tx.send(snap.clone());
    }

    let envelope = state.build_stream_envelope().await;
    let _ = state.stream_tx.send(envelope);
    StatusCode::OK
}

async fn get_gsi(State(state): State<DaemonState>) -> Json<Option<GsiSnapshot>> {
    Json(state.latest_gsi.read().await.clone())
}

async fn get_overlay_snapshot(State(state): State<DaemonState>) -> Json<OverlaySnapshot> {
    Json(state.latest_snapshot.read().await.clone())
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
    let current_picks = state.picks_snapshot.read().await.clone();
    let env = StreamEnvelope {
        v: STREAM_PROTOCOL_VERSION,
        kind: "picks".to_string(),
        ts: now_epoch_ms(),
        payload: current_picks,
    };
    let initial = tokio_stream::once(Ok::<Event, Infallible>(
        Event::default()
            .event("picks")
            .data(serde_json::to_string(&env).unwrap_or_default()),
    ));
    Sse::new(initial).keep_alive(KeepAlive::default())
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

    let updated = {
        let mut snap = state.latest_snapshot.write().await;
        snap.sequence += 1;
        snap.role_mode = current_role_mode;
        snap.role_fixed_positions = current_role_positions.clone();
        snap.auto_rescan_enabled = auto_enabled;
        snap.dota_window = current_window;
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

    if trigger_scan {
        spawn_background_scan(&state).await;
    }

    Json(updated)
}

pub fn build_router(state: DaemonState) -> Router {
    let web_dir = state.web_dir.clone();
    let mut router = Router::new()
        .route("/health", get(health))
        .route("/gsi", post(ingest_gsi))
        .route("/api/gsi", get(get_gsi))
        .route("/events", get(stream_events))
        .route("/picks/events", get(picks_events))
        .route("/stream/layout", get(get_stream_layout).post(set_stream_layout))
        .route("/overlay/snapshot", get(get_overlay_snapshot))
        .route("/overlay/events", get(overlay_events))
        .route("/overlay/command", post(overlay_command))
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
}
