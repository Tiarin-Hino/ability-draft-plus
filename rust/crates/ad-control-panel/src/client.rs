//! Asynchronous HTTP client and daemon auto-bootstrap for `ad-control-panel`.

use std::{
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command},
    sync::{Arc, RwLock},
    time::Duration,
};

use ad_protocol::{
    AbilityCatalogEntry, DaemonSettings, HeroCatalogEntry, OverlayCommand, OverlayProcessStatus,
    OverlaySnapshot,
};
use serde::Deserialize;
use tokio::sync::mpsc;
use tracing::{info, warn};

#[derive(Debug, Clone, Deserialize)]
pub struct DaemonDbSummary {
    pub heroes_count: i64,
    pub abilities_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DaemonHealth {
    pub capture_backend: String,
    pub gsi_connected: bool,
    #[serde(default)]
    pub pick_templates_loaded: usize,
    pub db_summary: Option<DaemonDbSummary>,
}

#[derive(Debug, Clone, Default)]
pub struct PanelState {
    pub daemon_connected: bool,
    pub health: Option<DaemonHealth>,
    pub snapshot: Option<OverlaySnapshot>,
    pub overlay_status: Option<OverlayProcessStatus>,
    pub settings: DaemonSettings,
    pub settings_loaded: bool,
    pub catalog_loaded: bool,
    pub abilities: Vec<AbilityCatalogEntry>,
    pub heroes: Vec<HeroCatalogEntry>,
    pub status_banner: Option<String>,
}

#[derive(Debug, Clone)]
pub enum PanelAction {
    SendCommand(OverlayCommand),
    SaveSettings(DaemonSettings),
    LaunchOverlay,
    StopOverlay,
    RefreshAll,
}

pub fn find_daemon_binary() -> Option<PathBuf> {
    let exe_name = if cfg!(target_os = "windows") {
        "ad-daemon.exe"
    } else {
        "ad-daemon"
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

fn is_port_listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

/// Ensures `ad-daemon` is reachable on `port`, spawning a managed sibling daemon process
/// if nothing is already listening there.
pub fn ensure_daemon_running(port: u16) -> Option<Child> {
    if is_port_listening(port) {
        info!(port, "Reusing running ad-daemon instance");
        return None;
    }
    let Some(daemon_bin) = find_daemon_binary() else {
        warn!("Could not locate ad-daemon binary to auto-start");
        return None;
    };

    let mut cmd = Command::new(&daemon_bin);
    cmd.env("AD_DAEMON_PORT", port.to_string());
    if std::env::var_os("AD_AUTO_RESCAN").is_some() {
        cmd.env("AD_AUTO_RESCAN", "1");
    }

    match cmd.spawn() {
        Ok(mut child) => {
            let pid = child.id();
            info!(pid, port, path = %daemon_bin.display(), "Spawned managed ad-daemon");
            for _ in 0..30 {
                if let Ok(Some(status)) = child.try_wait() {
                    warn!(%status, "Managed ad-daemon exited during startup");
                    return None;
                }
                if is_port_listening(port) {
                    return Some(child);
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Some(child)
        }
        Err(err) => {
            warn!(%err, path = %daemon_bin.display(), "Failed to start ad-daemon");
            None
        }
    }
}

async fn poll_once(
    client: &reqwest::Client,
    base: &str,
    shared: &Arc<RwLock<PanelState>>,
    force_catalog: bool,
) {
    let health_res = client.get(format!("{base}/health")).send().await;
    let Ok(health_resp) = health_res else {
        if let Ok(mut guard) = shared.write() {
            guard.daemon_connected = false;
        }
        return;
    };
    let health = health_resp.json::<DaemonHealth>().await.ok();

    let snapshot = match client.get(format!("{base}/overlay/snapshot")).send().await {
        Ok(resp) if resp.status().is_success() => resp.json::<OverlaySnapshot>().await.ok(),
        _ => None,
    };
    let overlay_status = match client.get(format!("{base}/api/overlay/status")).send().await {
        Ok(resp) if resp.status().is_success() => resp.json::<OverlayProcessStatus>().await.ok(),
        _ => None,
    };

    let (need_settings, need_catalog) = shared
        .read()
        .map(|g| (!g.settings_loaded || force_catalog, !g.catalog_loaded || force_catalog))
        .unwrap_or((true, true));

    let fetched_settings = if need_settings {
        match client.get(format!("{base}/api/settings")).send().await {
            Ok(resp) if resp.status().is_success() => resp.json::<DaemonSettings>().await.ok(),
            _ => None,
        }
    } else {
        None
    };

    let fetched_abilities = if need_catalog {
        match client.get(format!("{base}/api/abilities")).send().await {
            Ok(resp) if resp.status().is_success() => {
                resp.json::<Vec<AbilityCatalogEntry>>().await.ok()
            }
            _ => None,
        }
    } else {
        None
    };

    let fetched_heroes = if need_catalog {
        match client.get(format!("{base}/api/heroes")).send().await {
            Ok(resp) if resp.status().is_success() => {
                resp.json::<Vec<HeroCatalogEntry>>().await.ok()
            }
            _ => None,
        }
    } else {
        None
    };

    if let Ok(mut guard) = shared.write() {
        guard.daemon_connected = health.is_some();
        if health.is_some() {
            guard.health = health;
        }
        if let Some(snap) = snapshot {
            guard.snapshot = Some(snap);
        }
        if let Some(st) = overlay_status {
            guard.overlay_status = Some(st);
        }
        if let Some(cfg) = fetched_settings {
            guard.settings = cfg;
            guard.settings_loaded = true;
        }
        if let Some(abilities) = fetched_abilities {
            guard.abilities = abilities;
            guard.catalog_loaded = true;
        }
        if let Some(heroes) = fetched_heroes {
            guard.heroes = heroes;
        }
    }
}

pub fn spawn_panel_worker(
    daemon_url: String,
    shared: Arc<RwLock<PanelState>>,
    mut action_rx: mpsc::UnboundedReceiver<PanelAction>,
    on_update: Arc<dyn Fn() + Send + Sync>,
) {
    std::thread::spawn(move || {
        let Ok(rt) = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        else {
            warn!("Failed to build tokio runtime for control-panel worker");
            return;
        };

        rt.block_on(async move {
            let client = reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(2))
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new());
            let base = daemon_url.trim_end_matches('/').to_string();

            poll_once(&client, &base, &shared, true).await;
            on_update();

            let mut ticker = tokio::time::interval(Duration::from_millis(750));
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        poll_once(&client, &base, &shared, false).await;
                        on_update();
                    }
                    maybe_action = action_rx.recv() => {
                        let Some(action) = maybe_action else {
                            break;
                        };
                        match action {
                            PanelAction::RefreshAll => {
                                poll_once(&client, &base, &shared, true).await;
                            }
                            PanelAction::SendCommand(cmd) => {
                                match client.post(format!("{base}/overlay/command")).json(&cmd).send().await {
                                    Ok(resp) if resp.status().is_success() => {
                                        if let Ok(snap) = resp.json::<OverlaySnapshot>().await {
                                            if let Ok(mut guard) = shared.write() {
                                                guard.snapshot = Some(snap);
                                            }
                                        }
                                    }
                                    Ok(resp) => {
                                        if let Ok(mut guard) = shared.write() {
                                            guard.status_banner = Some(format!("Command rejected: HTTP {}", resp.status()));
                                        }
                                    }
                                    Err(err) => {
                                        if let Ok(mut guard) = shared.write() {
                                            guard.status_banner = Some(format!("Command failed: {err}"));
                                        }
                                    }
                                }
                            }
                            PanelAction::SaveSettings(cfg) => {
                                match client.post(format!("{base}/api/settings")).json(&cfg).send().await {
                                    Ok(resp) if resp.status().is_success() => {
                                        if let Ok(saved) = resp.json::<DaemonSettings>().await {
                                            if let Ok(mut guard) = shared.write() {
                                                guard.settings = saved;
                                                guard.settings_loaded = true;
                                                guard.status_banner = Some("Settings saved".to_string());
                                            }
                                        }
                                    }
                                    Ok(resp) => {
                                        if let Ok(mut guard) = shared.write() {
                                            guard.status_banner = Some(format!("Failed to save settings: HTTP {}", resp.status()));
                                        }
                                    }
                                    Err(err) => {
                                        if let Ok(mut guard) = shared.write() {
                                            guard.status_banner = Some(format!("Failed to save settings: {err}"));
                                        }
                                    }
                                }
                            }
                            PanelAction::LaunchOverlay => {
                                if let Ok(resp) = client.post(format!("{base}/api/overlay/launch")).send().await {
                                    if let Ok(st) = resp.json::<OverlayProcessStatus>().await {
                                        if let Ok(mut guard) = shared.write() {
                                            guard.status_banner = if st.running {
                                                Some("Native overlay launched".to_string())
                                            } else if !st.binary_found {
                                                Some("ad-overlay binary not found alongside daemon".to_string())
                                            } else {
                                                Some("Failed to launch ad-overlay".to_string())
                                            };
                                            guard.overlay_status = Some(st);
                                        }
                                    }
                                }
                            }
                            PanelAction::StopOverlay => {
                                if let Ok(resp) = client.post(format!("{base}/api/overlay/stop")).send().await {
                                    if let Ok(st) = resp.json::<OverlayProcessStatus>().await {
                                        if let Ok(mut guard) = shared.write() {
                                            guard.overlay_status = Some(st);
                                            guard.status_banner = Some("Overlay stopped".to_string());
                                        }
                                    }
                                }
                            }
                        }
                        on_update();
                    }
                }
            }
        });
    });
}
