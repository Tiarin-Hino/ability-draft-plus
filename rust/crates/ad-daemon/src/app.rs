//! Shared Axum router and daemon state for `ad-daemon`.

use std::{convert::Infallible, sync::Arc};

use ad_capture::WindowBounds;
use ad_core::gsi::{parse_gsi_payload, GsiSnapshot};
use ad_protocol::{OverlayCommand, OverlaySnapshot, ResolutionSource, RoleMode, PROTOCOL_VERSION};
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
use tracing::warn;

use crate::{
    db::DbSummary,
    scanner::{ScanOptions, ScanPipeline},
};

#[derive(Clone)]
pub struct DaemonState {
    pub db_summary: Option<DbSummary>,
    pub pipeline: Option<Arc<ScanPipeline>>,
    pub latest_gsi: Arc<RwLock<Option<GsiSnapshot>>>,
    pub latest_snapshot: Arc<RwLock<OverlaySnapshot>>,
    pub overlay_tx: broadcast::Sender<OverlaySnapshot>,
    pub dota_window: Arc<RwLock<Option<WindowBounds>>>,
    pub role_mode: Arc<RwLock<RoleMode>>,
    pub role_fixed_positions: Arc<RwLock<Vec<u8>>>,
}

impl DaemonState {
    pub fn new(db_summary: Option<DbSummary>, pipeline: Option<Arc<ScanPipeline>>) -> Self {
        let initial_snapshot = OverlaySnapshot {
            protocol_version: PROTOCOL_VERSION,
            sequence: 0,
            target_resolution: "1920x1080".to_string(),
            resolution_source: ResolutionSource::Preset,
            scanning: false,
            slots: Vec::new(),
            selected_spot_hero_order: None,
            selected_model_hero_order: None,
        };
        let (overlay_tx, _) = broadcast::channel(32);
        Self {
            db_summary,
            pipeline,
            latest_gsi: Arc::new(RwLock::new(None)),
            latest_snapshot: Arc::new(RwLock::new(initial_snapshot)),
            overlay_tx,
            dota_window: Arc::new(RwLock::new(None)),
            role_mode: Arc::new(RwLock::new(RoleMode::Off)),
            role_fixed_positions: Arc::new(RwLock::new(Vec::new())),
        }
    }
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
    *state.latest_gsi.write().await = Some(snapshot);
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

async fn overlay_command(
    State(state): State<DaemonState>,
    Json(cmd): Json<OverlayCommand>,
) -> Json<OverlaySnapshot> {
    let mut trigger_scan = false;
    match &cmd {
        OverlayCommand::SetRoleMode {
            mode,
            fixed_positions,
        } => {
            *state.role_mode.write().await = *mode;
            *state.role_fixed_positions.write().await = fixed_positions.clone();
        }
        OverlayCommand::TriggerScan { .. } => {
            trigger_scan = true;
        }
        _ => {}
    }

    let updated = {
        let mut snap = state.latest_snapshot.write().await;
        snap.sequence += 1;
        match cmd {
            OverlayCommand::TriggerScan { .. } => {
                snap.scanning = true;
            }
            OverlayCommand::SelectMySpot { hero_order, .. } => {
                snap.selected_spot_hero_order = Some(hero_order);
            }
            OverlayCommand::SelectMyModel { hero_order, .. } => {
                snap.selected_model_hero_order = Some(hero_order);
            }
            OverlayCommand::ResetDraft => {
                snap.scanning = false;
                snap.slots.clear();
                snap.selected_spot_hero_order = None;
                snap.selected_model_hero_order = None;
            }
            OverlayCommand::SetRoleMode { .. }
            | OverlayCommand::CloseOverlay
            | OverlayCommand::ReportFailedScan => {}
        }
        snap.clone()
    };

    let _ = state.overlay_tx.send(updated.clone());

    if trigger_scan {
        if let Some(pipeline) = state.pipeline.clone() {
            let state_bg = state.clone();
            let options = ScanOptions {
                role_mode: *state.role_mode.read().await,
                role_fixed_positions: state.role_fixed_positions.read().await.clone(),
                selected_spot_hero_order: updated.selected_spot_hero_order,
                selected_model_hero_order: updated.selected_model_hero_order,
            };
            let next_seq = updated.sequence + 1;
            tokio::spawn(async move {
                let res =
                    tokio::task::spawn_blocking(move || pipeline.scan_live_game(&options, next_seq))
                        .await;
                let final_snap = match res {
                    Ok(Ok(scanned)) => scanned,
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
            });
        }
    }

    Json(updated)
}

pub fn build_router(state: DaemonState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/gsi", post(ingest_gsi))
        .route("/api/gsi", get(get_gsi))
        .route("/overlay/snapshot", get(get_overlay_snapshot))
        .route("/overlay/events", get(overlay_events))
        .route("/overlay/command", post(overlay_command))
        .with_state(state)
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
        let app = build_router(DaemonState::new(None, None));
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
        let app = build_router(DaemonState::new(None, None));
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
        let app = build_router(DaemonState::new(None, None));

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
        assert_eq!(snap2.sequence, 2);
        assert_eq!(snap2.selected_spot_hero_order, None);

        let res3 = app
            .oneshot(Request::get("/overlay/snapshot").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res3.status(), StatusCode::OK);
        let snap3: OverlaySnapshot =
            serde_json::from_slice(&to_bytes(res3.into_body(), 1024 * 64).await.unwrap()).unwrap();
        assert_eq!(snap3.sequence, 2);
    }
}
