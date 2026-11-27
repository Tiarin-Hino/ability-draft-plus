//! Native transparent overlay binary for Ability Draft Plus.
//!
//! Renders recommendations and HUD controls directly via native GPU surfaces (`egui`/`wgpu`)
//! without an embedded browser, using stateless OS hit-testing (`WM_NCHITTEST` on Windows,
//! `NSWindow` region tracking on macOS, `XShape` / `wlr-layer-shell` or Vulkan layer on Linux)
//! so empty pixels can never get stuck blocking Dota 2 mouse input.

use ad_protocol::PROTOCOL_VERSION;
use tracing::info;

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ad_overlay=info".into()),
        )
        .init();

    let daemon_url =
        std::env::var("AD_DAEMON_URL").unwrap_or_else(|_| "http://127.0.0.1:41234".to_string());

    info!(
        protocol_version = PROTOCOL_VERSION,
        %daemon_url,
        "ad-overlay host initialized (awaiting Milestone 1 window surface implementation)"
    );
    Ok(())
}
