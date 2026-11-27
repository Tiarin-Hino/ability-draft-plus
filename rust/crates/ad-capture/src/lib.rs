//! Cross-platform game screen capture and window-bounds tracking abstractions.
//!
//! Planned native backends:
//! - Windows: Windows Graphics Capture (`windows-capture`) + Win32 `windows-rs`
//! - macOS: `ScreenCaptureKit` + `CGWindowListCopyWindowInfo`
//! - Linux: X11 MIT-SHM + `xdg-desktop-portal` / PipeWire

use thiserror::Error;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
