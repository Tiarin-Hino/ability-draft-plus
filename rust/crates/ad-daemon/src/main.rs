//! Headless Ability Draft Plus daemon hosting GSI ingestion, OBS streams,
//! local web Control Panel assets, SQLite storage, ML/OCR pipeline, and overlay IPC.

mod app;
mod db;
mod scanner;

use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use tracing::{info, warn};

use crate::{
    app::{build_router, window_bounds_to_rect, DaemonState},
    db::{AdDatabase, DbSummary},
    scanner::ScanPipeline,
};

fn resolve_resources_dir() -> PathBuf {
    std::env::var("AD_RESOURCES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new("resources").to_path_buf())
}

fn resolve_web_dir() -> Option<PathBuf> {
    let candidate = std::env::var("AD_WEB_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new("out/renderer").to_path_buf());
    if candidate.is_dir() {
        info!(dir = %candidate.display(), "Serving built renderer web assets");
        Some(candidate)
    } else {
        None
    }
}

fn resolve_db_summary(resources_dir: &Path) -> Option<DbSummary> {
    let candidate = std::env::var("AD_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| resources_dir.join("dota_ad_data.db"));
    if !candidate.exists() {
        info!(path = %candidate.display(), "Database file not found at startup path");
        return None;
    }
    match AdDatabase::open_immutable_readonly(&candidate).and_then(|db| db.summary()) {
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

fn resolve_pipeline(resources_dir: &Path) -> Option<Arc<ScanPipeline>> {
    if !resources_dir.join("config/layout_coordinates.json").exists() {
        info!(dir = %resources_dir.display(), "Resources dir missing layout_coordinates.json; scan pipeline disabled");
        return None;
    }
    match ScanPipeline::from_resources_dir(resources_dir) {
        Ok(pipeline) => {
            info!(
                layouts = pipeline.layout_count(),
                "ScanPipeline initialized"
            );
            Some(Arc::new(pipeline))
        }
        Err(err) => {
            warn!(%err, "Failed to initialize ScanPipeline");
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

    let resources_dir = resolve_resources_dir();
    let state = DaemonState::new(
        resolve_db_summary(&resources_dir),
        resolve_pipeline(&resources_dir),
        resolve_web_dir(),
    );
    let tracker_state = state.clone();
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

            let changed = {
                let mut guard = tracker_state.dota_window.write().await;
                if *guard != bounds {
                    *guard = bounds;
                    true
                } else {
                    false
                }
            };
            if changed {
                let updated = {
                    let mut snap = tracker_state.latest_snapshot.write().await;
                    snap.sequence += 1;
                    snap.dota_window = bounds.map(window_bounds_to_rect);
                    snap.clone()
                };
                let _ = tracker_state.overlay_tx.send(updated);
            }
        }
    });

    let port: u16 = std::env::var("AD_DAEMON_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(41234);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!(
        %addr,
        backend = ?ad_capture::active_display_backend(),
        "ad-daemon listening"
    );
    axum::serve(listener, build_router(state)).await?;
    Ok(())
}
