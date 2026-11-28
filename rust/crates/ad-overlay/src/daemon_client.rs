//! Live HTTP + SSE client bridging `ad-overlay` to `ad-daemon`.

use std::{
    sync::{Arc, RwLock},
    time::Duration,
};

use ad_protocol::{OverlayCommand, OverlaySnapshot, ResolutionSource, RoleMode, PROTOCOL_VERSION};
use tokio::sync::mpsc;
use tokio_stream::StreamExt;
use tracing::{debug, warn};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonConnectionState {
    Connecting,
    Connected,
    Disconnected,
}

pub fn empty_snapshot() -> OverlaySnapshot {
    OverlaySnapshot {
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
        auto_rescan_enabled: false,
        dota_window: None,
    }
}

pub fn parse_sse_snapshot_line(line: &str) -> Option<OverlaySnapshot> {
    let trimmed = line.trim();
    let payload = trimmed.strip_prefix("data:")?.trim();
    if payload.is_empty() {
        return None;
    }
    serde_json::from_str::<OverlaySnapshot>(payload).ok()
}

pub fn spawn_daemon_bridge(
    daemon_url: String,
    snapshot: Arc<RwLock<OverlaySnapshot>>,
    conn_state: Arc<RwLock<DaemonConnectionState>>,
    mut cmd_rx: mpsc::UnboundedReceiver<OverlayCommand>,
    on_update: Arc<dyn Fn() + Send + Sync>,
) {
    std::thread::spawn(move || {
        let Ok(rt) = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        else {
            warn!("Failed to build tokio runtime for daemon bridge");
            return;
        };

        rt.block_on(async move {
            let client = reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(2))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new());

            let cmd_client = client.clone();
            let cmd_url = format!("{}/overlay/command", daemon_url.trim_end_matches('/'));
            let cmd_snapshot = snapshot.clone();
            let cmd_notify = on_update.clone();

            tokio::spawn(async move {
                while let Some(cmd) = cmd_rx.recv().await {
                    match cmd_client.post(&cmd_url).json(&cmd).send().await {
                        Ok(res) if res.status().is_success() => {
                            if let Ok(updated) = res.json::<OverlaySnapshot>().await {
                                if let Ok(mut guard) = cmd_snapshot.write() {
                                    *guard = updated;
                                }
                                cmd_notify();
                            }
                        }
                        Ok(res) => {
                            warn!(status = %res.status(), "Daemon rejected overlay command");
                        }
                        Err(err) => {
                            warn!(%err, "Failed to post overlay command to daemon");
                        }
                    }
                }
            });

            let base = daemon_url.trim_end_matches('/').to_string();
            let snapshot_url = format!("{base}/overlay/snapshot");
            let events_url = format!("{base}/overlay/events");
            let mut backoff_ms = 500u64;

            loop {
                if let Ok(mut state) = conn_state.write() {
                    *state = DaemonConnectionState::Connecting;
                }
                on_update();

                if let Ok(res) = client.get(&snapshot_url).send().await {
                    if let Ok(initial) = res.json::<OverlaySnapshot>().await {
                        if let Ok(mut guard) = snapshot.write() {
                            *guard = initial;
                        }
                        on_update();
                    }
                }

                match client.get(&events_url).send().await {
                    Ok(res) if res.status().is_success() => {
                        backoff_ms = 500;
                        if let Ok(mut state) = conn_state.write() {
                            *state = DaemonConnectionState::Connected;
                        }
                        on_update();

                        let mut stream = res.bytes_stream();
                        let mut buf = String::new();
                        while let Some(chunk_res) = stream.next().await {
                            match chunk_res {
                                Ok(chunk) => {
                                    buf.push_str(&String::from_utf8_lossy(&chunk));
                                    while let Some(pos) = buf.find('\n') {
                                        let line: String = buf.drain(..=pos).collect();
                                        if let Some(next_snap) = parse_sse_snapshot_line(&line) {
                                            if let Ok(mut guard) = snapshot.write() {
                                                *guard = next_snap;
                                            }
                                            on_update();
                                        }
                                    }
                                }
                                Err(err) => {
                                    debug!(%err, "SSE stream chunk error");
                                    break;
                                }
                            }
                        }
                    }
                    Ok(res) => {
                        debug!(status = %res.status(), "SSE connection returned non-200");
                    }
                    Err(err) => {
                        debug!(%err, "SSE connection failed");
                    }
                }

                if let Ok(mut state) = conn_state.write() {
                    *state = DaemonConnectionState::Disconnected;
                }
                on_update();
                tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * 2).min(5_000);
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_sse_data_line_and_ignores_non_data_lines() {
        let snap = empty_snapshot();
        let line = format!("data: {}", serde_json::to_string(&snap).unwrap());
        let parsed = parse_sse_snapshot_line(&line).expect("parsed snapshot");
        assert_eq!(parsed, snap);

        assert!(parse_sse_snapshot_line("event: snapshot").is_none());
        assert!(parse_sse_snapshot_line(": keepalive").is_none());
        assert!(parse_sse_snapshot_line("data: {not-json}").is_none());
    }
}
