//! Native transparent overlay binary for Ability Draft Plus.
//!
//! Renders recommendations and HUD controls directly via native GPU surfaces (`egui`/`wgpu`)
//! without an embedded browser, using stateless OS hit-testing (`WM_NCHITTEST` on Windows,
//! `NSWindow` region tracking on macOS, `XShape` / `wlr-layer-shell` or Vulkan layer on Linux)
//! so empty pixels can never get stuck blocking Dota 2 mouse input.

mod hit_test;
#[cfg(target_os = "windows")]
mod win32_surface;

use std::sync::{Arc, RwLock};

use ad_protocol::{Rect, PROTOCOL_VERSION};
use hit_test::{HitRegion, HitTester};
use tracing::info;

fn build_demo_hit_tester() -> Arc<RwLock<HitTester>> {
    let mut tester = HitTester::new();
    tester.set_regions(vec![HitRegion {
        id: "demo-controls".to_string(),
        rect: Rect {
            x: 16,
            y: 16,
            width: 240,
            height: 64,
        },
    }]);
    Arc::new(RwLock::new(tester))
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ad_overlay=info".into()),
        )
        .init();

    let daemon_url =
        std::env::var("AD_DAEMON_URL").unwrap_or_else(|_| "http://127.0.0.1:41234".to_string());
    let demo_mode = std::env::args().any(|arg| arg == "--demo");

    info!(
        protocol_version = PROTOCOL_VERSION,
        %daemon_url,
        demo_mode,
        "ad-overlay host initialized"
    );

    if demo_mode {
        #[cfg(target_os = "windows")]
        {
            let bounds = Rect {
                x: 40,
                y: 40,
                width: 640,
                height: 360,
            };
            win32_surface::run_demo_window(bounds, build_demo_hit_tester())?;
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = build_demo_hit_tester();
            anyhow::bail!("--demo Win32 surface is only available on Windows");
        }
    } else {
        let _ = build_demo_hit_tester();
    }

    Ok(())
}
