//! Native transparent overlay binary for Ability Draft Plus.
//!
//! Renders recommendations and HUD controls directly via native GPU surfaces (`eframe`/`wgpu`)
//! without an embedded browser, using stateless hit-testing so empty pixels can never get
//! stuck blocking Dota 2 mouse input.

mod daemon_client;
mod hit_test;
mod hud;
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
    let headless = std::env::args().any(|arg| arg == "--headless");
    let win32_demo = std::env::args().any(|arg| arg == "--win32-demo");

    info!(
        protocol_version = PROTOCOL_VERSION,
        %daemon_url,
        headless,
        win32_demo,
        "ad-overlay host initialized"
    );

    if headless {
        let _ = build_demo_hit_tester();
        return Ok(());
    }

    if win32_demo {
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
            anyhow::bail!("--win32-demo surface is only available on Windows");
        }
        return Ok(());
    }

    hud::run_hud(daemon_url)
}
