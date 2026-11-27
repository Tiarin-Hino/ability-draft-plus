//! Linux X11 / Wayland display detection and capture backend boundaries.

use crate::{CaptureError, GameWindowTracker, RawFrame, ScreenCapturer, WindowBounds};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinuxDisplayServer {
    Wayland,
    X11,
    Headless,
}

pub fn detect_display_server() -> LinuxDisplayServer {
    if std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE")
            .is_ok_and(|v| v.eq_ignore_ascii_case("wayland"))
    {
        LinuxDisplayServer::Wayland
    } else if std::env::var_os("DISPLAY").is_some() {
        LinuxDisplayServer::X11
    } else {
        LinuxDisplayServer::Headless
    }
}

#[derive(Debug, Default)]
pub struct LinuxWindowTracker;

impl GameWindowTracker for LinuxWindowTracker {
    fn find_dota_window(&self) -> Result<Option<WindowBounds>, CaptureError> {
        Ok(None)
    }
}

#[derive(Debug, Default)]
pub struct LinuxScreenCapturer;

impl ScreenCapturer for LinuxScreenCapturer {
    fn capture_game_frame(&mut self) -> Result<RawFrame, CaptureError> {
        match detect_display_server() {
            LinuxDisplayServer::Wayland => Err(CaptureError::Unsupported("linux-wayland-portal")),
            LinuxDisplayServer::X11 => Err(CaptureError::Unsupported("linux-x11-shm")),
            LinuxDisplayServer::Headless => Err(CaptureError::Unsupported("linux-headless")),
        }
    }
}
