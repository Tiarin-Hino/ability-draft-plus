//! Win32 Dota 2 client-area window bounds tracker (`FindWindowW` -> `GetClientRect` -> `ClientToScreen`).

use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::{HWND, POINT, RECT},
        Graphics::Gdi::ClientToScreen,
        UI::WindowsAndMessaging::{FindWindowW, GetClientRect},
    },
};

use crate::{CaptureError, GameWindowTracker, WindowBounds};

#[derive(Debug, Default)]
pub struct WindowsGameWindowTracker;

impl GameWindowTracker for WindowsGameWindowTracker {
    fn find_dota_window(&self) -> Result<Option<WindowBounds>, CaptureError> {
        let hwnd: HWND = match unsafe { FindWindowW(PCWSTR::null(), w!("Dota 2")) } {
            Ok(h) if !h.is_invalid() => h,
            _ => return Ok(None),
        };

        let mut rect = RECT::default();
        if unsafe { GetClientRect(hwnd, &mut rect) }.is_err() {
            return Ok(None);
        }

        let mut origin = POINT { x: 0, y: 0 };
        if !unsafe { ClientToScreen(hwnd, &mut origin) }.as_bool() {
            return Ok(None);
        }

        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 {
            return Ok(None);
        }
        if origin.x <= -25000 || origin.y <= -25000 {
            return Ok(None);
        }

        Ok(Some(WindowBounds {
            x: origin.x,
            y: origin.y,
            width: width as u32,
            height: height as u32,
        }))
    }
}
