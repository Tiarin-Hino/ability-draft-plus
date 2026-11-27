//! Windows Graphics Capture (WGC) runtime capability check.

use windows::Graphics::Capture::GraphicsCaptureSession;

pub fn is_wgc_supported() -> bool {
    GraphicsCaptureSession::IsSupported().unwrap_or(false)
}
