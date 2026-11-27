//! Headless Ability Draft Plus daemon hosting GSI ingestion, OBS streams,
//! local web Control Panel assets, SQLite storage, ML/OCR pipeline, and overlay IPC.

mod app;
mod db;

use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    time::Duration,
};

use tracing::{info, warn};

use crate::{
    app::{build_router, DaemonState},
    db::{AdDatabase, DbSummary},
};

fn resolve_db_summary() -> Option<DbSummary> {
    let candidate = std::env::var("AD_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new("resources/dota_ad_data.db").to_path_buf());
    if !candidate.exists() {
        info!(path = %candidate.display(), "Database file not found at startup path");
        return None;
    }
    match AdDatabase::open_readonly(&candidate).and_then(|db| db.summary()) {
        Ok(summary) => {
            info!(
                path = %candidate.display(),
                heroes = summary.heroes_count,
                abilities = summary.abilities_count,
                "Loaded SQLite database summary"
            );
            Some(summary)
        }
        Err(err) => {
            warn!(path = %candidate.display(), %err, "Failed to open SQLite database");
            None
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ad_daemon=info".into()),
        )
        .init();

    let state = DaemonState::new(resolve_db_summary());
    let window_state = state.dota_window.clone();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(2));
        loop {
            ticker.tick().await;
            let bounds = tokio::task::spawn_blocking(|| {
                ad_capture::default_window_tracker()
                    .find_dota_window()
                    .ok()
                    .flatten()
            })
            .await
            .ok()
            .flatten();
            *window_state.write().await = bounds;
        }
    });

    let port: u16 = std::env::var("AD_DAEMON_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(41234);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!(%addr, backend = ad_capture::platform::BACKEND_NAME, "ad-daemon listening");
    axum::serve(listener, build_router(state)).await?;
    Ok(())
}
