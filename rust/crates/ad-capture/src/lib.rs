//! Cross-platform game screen capture and window-bounds tracking abstractions.
//!
//! Native backends:
//! - Windows: Win32 GDI + Windows Graphics Capture capability probe + `windows-rs` window tracking
//! - macOS: `ScreenCaptureKit` + `CGWindowListCopyWindowInfo`
//! - Linux: X11 MIT-SHM + `xdg-desktop-portal` / PipeWire

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub mod crop;
#[cfg(target_os = "linux")]
mod linux_capture;
#[cfg(target_os = "macos")]
mod macos_capture;
#[cfg(target_os = "windows")]
mod windows_capture;
#[cfg(target_os = "windows")]
mod windows_tracker;
#[cfg(target_os = "windows")]
mod windows_wgc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DisplayBackend {
    WindowsWgc,
    WindowsGdi,
    MacOsScreenCaptureKit,
    LinuxX11,
    LinuxWaylandPortal,
}

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

pub fn active_display_backend() -> DisplayBackend {
    #[cfg(target_os = "windows")]
    {
        if windows_wgc::is_wgc_supported() {
            DisplayBackend::WindowsWgc
        } else {
            DisplayBackend::WindowsGdi
        }
    }
    #[cfg(target_os = "macos")]
    {
        DisplayBackend::MacOsScreenCaptureKit
    }
    #[cfg(target_os = "linux")]
    {
        match linux_capture::detect_display_server() {
            linux_capture::LinuxDisplayServer::Wayland => DisplayBackend::LinuxWaylandPortal,
            linux_capture::LinuxDisplayServer::X11 | linux_capture::LinuxDisplayServer::Headless => {
                DisplayBackend::LinuxX11
            }
        }
    }
}

pub fn default_window_tracker() -> Box<dyn GameWindowTracker> {
    #[cfg(target_os = "windows")]
    {
        Box::new(windows_tracker::WindowsGameWindowTracker)
    }
    #[cfg(target_os = "macos")]
    {
        Box::new(macos_capture::MacOsWindowTracker)
    }
    #[cfg(target_os = "linux")]
    {
        Box::new(linux_capture::LinuxWindowTracker)
    }
}

pub fn default_screen_capturer() -> Box<dyn ScreenCapturer> {
    #[cfg(target_os = "windows")]
    {
        Box::new(windows_capture::WindowsGdiCapturer)
    }
    #[cfg(target_os = "macos")]
    {
        Box::new(macos_capture::MacOsScreenCapturer)
    }
    #[cfg(target_os = "linux")]
    {
        Box::new(linux_capture::LinuxScreenCapturer)
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

    #[test]
    fn active_display_backend_matches_host_platform() {
        let backend = active_display_backend();
        #[cfg(target_os = "windows")]
        assert!(matches!(
            backend,
            DisplayBackend::WindowsWgc | DisplayBackend::WindowsGdi
        ));
        #[cfg(target_os = "macos")]
        assert_eq!(backend, DisplayBackend::MacOsScreenCaptureKit);
        #[cfg(target_os = "linux")]
        assert!(matches!(
            backend,
            DisplayBackend::LinuxX11 | DisplayBackend::LinuxWaylandPortal
        ));
    }
}
