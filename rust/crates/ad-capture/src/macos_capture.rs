//! macOS ScreenCaptureKit + CoreGraphics window tracker stubs for cross-platform compilation.

use crate::{CaptureError, GameWindowTracker, RawFrame, ScreenCapturer, WindowBounds};

#[derive(Debug, Default)]
pub struct MacOsWindowTracker;

impl GameWindowTracker for MacOsWindowTracker {
    fn find_dota_window(&self) -> Result<Option<WindowBounds>, CaptureError> {
        Ok(None)
    }
}

#[derive(Debug, Default)]
pub struct MacOsScreenCapturer;

impl ScreenCapturer for MacOsScreenCapturer {
    fn capture_game_frame(&mut self) -> Result<RawFrame, CaptureError> {
        Err(CaptureError::Unsupported("macos-screencapturekit"))
    }
}
