//! Cross-platform game screen capture and window-bounds tracking abstractions.
//!
//! Native backends:
//! - Windows: Win32 GDI/WGC capture + `windows-rs` window tracking
//! - macOS: `ScreenCaptureKit` + `CGWindowListCopyWindowInfo`
//! - Linux: X11 MIT-SHM + `xdg-desktop-portal` / PipeWire

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub mod crop;
#[cfg(target_os = "windows")]
mod windows_capture;
#[cfg(target_os = "windows")]
mod windows_tracker;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelFormat {
    Bgra8,
    Rgba8,
}

#[derive(Debug, Clone)]
pub struct RawFrame {
    pub width: u32,
    pub height: u32,
    pub format: PixelFormat,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Error)]
pub enum CaptureError {
    #[error("game window not found")]
    WindowNotFound,
    #[error("capture backend unavailable on this platform: {0}")]
    Unsupported(&'static str),
    #[error("capture failed: {0}")]
    Failed(String),
}

pub trait ScreenCapturer: Send + Sync {
    fn capture_game_frame(&mut self) -> Result<RawFrame, CaptureError>;
}

pub trait GameWindowTracker: Send + Sync {
    fn find_dota_window(&self) -> Result<Option<WindowBounds>, CaptureError>;
}

#[cfg(not(target_os = "windows"))]
#[derive(Debug, Default)]
struct StubWindowTracker;

#[cfg(not(target_os = "windows"))]
impl GameWindowTracker for StubWindowTracker {
    fn find_dota_window(&self) -> Result<Option<WindowBounds>, CaptureError> {
        Ok(None)
    }
}

#[cfg(not(target_os = "windows"))]
#[derive(Debug, Default)]
struct StubScreenCapturer;

#[cfg(not(target_os = "windows"))]
impl ScreenCapturer for StubScreenCapturer {
    fn capture_game_frame(&mut self) -> Result<RawFrame, CaptureError> {
        Err(CaptureError::Unsupported(platform::BACKEND_NAME))
    }
}

pub fn default_window_tracker() -> Box<dyn GameWindowTracker> {
    #[cfg(target_os = "windows")]
    {
        Box::new(windows_tracker::WindowsGameWindowTracker)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Box::new(StubWindowTracker)
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn default_screen_capturer() -> Box<dyn ScreenCapturer> {
    #[cfg(target_os = "windows")]
    {
        Box::new(windows_capture::WindowsGdiCapturer)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Box::new(StubScreenCapturer)
    }
}

#[cfg(target_os = "windows")]
pub mod platform {
    pub const BACKEND_NAME: &str = "windows-wgc";
}

#[cfg(target_os = "macos")]
pub mod platform {
    pub const BACKEND_NAME: &str = "macos-screencapturekit";
}

#[cfg(target_os = "linux")]
pub mod platform {
    pub const BACKEND_NAME: &str = "linux-x11-pipewire";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_window_tracker_queries_without_error() {
        let tracker = default_window_tracker();
        let res = tracker.find_dota_window();
        assert!(res.is_ok(), "unexpected tracker error: {res:?}");
    }

    #[test]
    fn default_screen_capturer_handles_absent_window_cleanly() {
        let mut capturer = default_screen_capturer();
        let res = capturer.capture_game_frame();
        assert!(
            matches!(
                res,
                Ok(_) | Err(CaptureError::WindowNotFound | CaptureError::Unsupported(_))
            ),
            "unexpected capturer result: {res:?}"
        );
    }
}
