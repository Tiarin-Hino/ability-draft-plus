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

pub(crate) fn find_dota_hwnd() -> Option<HWND> {
    match unsafe { FindWindowW(PCWSTR::null(), w!("Dota 2")) } {
        Ok(h) if !h.is_invalid() => Some(h),
        _ => None,
    }
}

pub(crate) fn client_bounds_for_hwnd(hwnd: HWND) -> Option<WindowBounds> {
    let mut rect = RECT::default();
    if unsafe { GetClientRect(hwnd, &mut rect) }.is_err() {
        return None;
    }

    let mut origin = POINT { x: 0, y: 0 };
    if !unsafe { ClientToScreen(hwnd, &mut origin) }.as_bool() {
        return None;
    }

    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width <= 0 || height <= 0 {
        return None;
    }
    if origin.x <= -25000 || origin.y <= -25000 {
        return None;
    }

    Some(WindowBounds {
        x: origin.x,
        y: origin.y,
        width: width as u32,
        height: height as u32,
    })
}

impl GameWindowTracker for WindowsGameWindowTracker {
    fn find_dota_window(&self) -> Result<Option<WindowBounds>, CaptureError> {
        Ok(find_dota_hwnd().and_then(client_bounds_for_hwnd))
    }
}
