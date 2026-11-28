//! Headless Ability Draft Plus daemon hosting GSI ingestion, OBS streams,
//! local web Control Panel assets, SQLite storage, ML/OCR pipeline, and overlay IPC.

mod app;
mod auto_rescan;
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
    app::{
        build_router, now_epoch_ms, reset_draft_state, spawn_background_scan,
        window_bounds_to_rect, DaemonState,
    },
    auto_rescan::RescanAction,
    db::{AdDatabase, DbSummary},
    scanner::ScanPipeline,
};

fn push_unique_path(list: &mut Vec<PathBuf>, p: PathBuf) {
    if !list.iter().any(|existing| existing == &p) {
        list.push(p);
    }
}

fn resolve_resources_dir() -> PathBuf {
    if let Ok(env_dir) = std::env::var("AD_RESOURCES_DIR") {
        let p = PathBuf::from(env_dir);
        if p.exists() {
            return p;
        }
    }

    let mut candidates = Vec::new();
    push_unique_path(&mut candidates, PathBuf::from("resources"));
    push_unique_path(&mut candidates, PathBuf::from("../resources"));
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent().map(Path::to_path_buf);
        for _ in 0..4 {
            if let Some(dir) = cur {
                push_unique_path(&mut candidates, dir.join("resources"));
                cur = dir.parent().map(Path::to_path_buf);
            }
        }
    }

    for candidate in &candidates {
        if candidate.join("config/layout_coordinates.json").exists() {
            info!(dir = %candidate.display(), "Resolved resources directory");
            return candidate.clone();
        }
    }
    PathBuf::from("resources")
}

fn resolve_web_dir() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(env_dir) = std::env::var("AD_WEB_DIR") {
        push_unique_path(&mut candidates, PathBuf::from(env_dir));
    }
    push_unique_path(&mut candidates, PathBuf::from("out/renderer"));
    push_unique_path(&mut candidates, PathBuf::from("../out/renderer"));
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent().map(Path::to_path_buf);
        for _ in 0..4 {
            if let Some(dir) = cur {
                push_unique_path(&mut candidates, dir.join("out/renderer"));
                cur = dir.parent().map(Path::to_path_buf);
            }
        }
    }

    for candidate in candidates {
        if candidate.is_dir() {
            info!(dir = %candidate.display(), "Serving built renderer web assets");
            return Some(candidate);
        }
    }
    None
}

fn extract_gsi_cfg_port(contents: &str) -> Option<u16> {
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("//") {
            continue;
        }
        for host in ["127.0.0.1:", "localhost:"] {
            if let Some(pos) = trimmed.find(host) {
                let after = &trimmed[pos + host.len()..];
                let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
                if let Ok(port) = digits.parse::<u16>() {
                    return Some(port);
                }
            }
        }
    }
    None
}

fn check_dota_gsi_cfg_port(daemon_port: u16) {
    let mut cfg_candidates = Vec::new();
    if let Ok(explicit) = std::env::var("AD_DOTA_GSI_CFG") {
        cfg_candidates.push(PathBuf::from(explicit));
    }
    #[cfg(target_os = "windows")]
    {
        cfg_candidates.push(PathBuf::from(
            r"C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\gamestate_integration_ability_draft_plus.cfg",
        ));
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    if let Ok(home) = std::env::var("HOME") {
        let h = PathBuf::from(home);
        cfg_candidates.push(h.join(".local/share/Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/gamestate_integration_ability_draft_plus.cfg"));
        cfg_candidates.push(h.join("Library/Application Support/Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/gamestate_integration_ability_draft_plus.cfg"));
    }

    let Some(cfg_path) = cfg_candidates.into_iter().find(|p| p.is_file()) else {
        info!(
            daemon_port,
            "No Dota 2 GSI config file found at default Steam path (set AD_DOTA_GSI_CFG to check custom Steam library)"
        );
        return;
    };

    match std::fs::read_to_string(&cfg_path) {
        Ok(contents) => match extract_gsi_cfg_port(&contents) {
            Some(cfg_port) if cfg_port == daemon_port => {
                info!(path = %cfg_path.display(), port = cfg_port, "Dota 2 GSI config port matches daemon");
            }
            Some(cfg_port) => {
                warn!(
                    path = %cfg_path.display(),
                    cfg_port,
                    daemon_port,
                    "Dota 2 GSI config port mismatch: update the .cfg URI or pass -Port matching Dota 2"
                );
            }
            None => {
                warn!(path = %cfg_path.display(), "Could not parse URI port from Dota 2 GSI config");
            }
        },
        Err(err) => {
            warn!(path = %cfg_path.display(), %err, "Failed to read Dota 2 GSI config");
        }
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
                pick_templates = pipeline.pick_template_count(),
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

    let rescan_state = state.clone();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(1));
        loop {
            ticker.tick().await;
            let action = rescan_state
                .auto_rescan
                .write()
                .await
                .poll_tick(now_epoch_ms());
            match action {
                RescanAction::None => {}
                RescanAction::ResetDraft => {
                    reset_draft_state(&rescan_state).await;
                }
                RescanAction::TriggerInitialScan
                | RescanAction::TriggerTurnRescan { .. }
                | RescanAction::TriggerRoundBreakRescan => {
                    info!(?action, "Auto-rescan triggering live capture");
                    spawn_background_scan(&rescan_state).await;
                }
            }
        }
    });

    let port: u16 = std::env::var("AD_DAEMON_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(41234);
    check_dota_gsi_cfg_port(port);
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
