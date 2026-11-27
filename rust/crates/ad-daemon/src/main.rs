//! Headless Ability Draft Plus daemon hosting GSI ingestion, OBS streams,
//! local web Control Panel assets, SQLite storage, ML/OCR pipeline, and overlay IPC.

use std::net::SocketAddr;

use ad_core::gsi::GamePhase;
use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tracing::info;

#[derive(Clone, Default)]
struct DaemonState;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    capture_backend: &'static str,
    protocol_version: u32,
}

#[derive(Deserialize)]
struct RawGsiPayload {
    map: Option<RawGsiMap>,
}

#[derive(Deserialize)]
struct RawGsiMap {
    matchid: Option<String>,
    game_state: Option<String>,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        capture_backend: ad_capture::platform::BACKEND_NAME,
        protocol_version: ad_protocol::PROTOCOL_VERSION,
    })
}

async fn ingest_gsi(
    State(_state): State<DaemonState>,
    Json(payload): Json<RawGsiPayload>,
) -> StatusCode {
    if let Some(map) = payload.map {
        let phase = map
            .game_state
            .as_deref()
            .map(GamePhase::from_dota_str)
            .unwrap_or(GamePhase::Unknown);
        tracing::debug!(match_id = ?map.matchid, ?phase, "Received GSI snapshot");
    }
    StatusCode::OK
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ad_daemon=info".into()),
        )
        .init();

    let port: u16 = std::env::var("AD_DAEMON_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(41234);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    let app = Router::new()
        .route("/health", get(health))
        .route("/gsi", post(ingest_gsi))
        .with_state(DaemonState);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!(%addr, backend = ad_capture::platform::BACKEND_NAME, "ad-daemon listening");
    axum::serve(listener, app).await?;
    Ok(())
}
