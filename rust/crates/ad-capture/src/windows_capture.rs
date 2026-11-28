//! Win32 screen-region capture (`PrintWindow` + `BitBlt` / `GetDIBits`) for Dota 2 game frames.

use windows::Win32::{
    Foundation::HWND,
    Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        HDC, SRCCOPY,
    },
    Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS, PW_CLIENTONLY},
    UI::WindowsAndMessaging::PW_RENDERFULLCONTENT,
};

use crate::{
    windows_tracker::{client_bounds_for_hwnd, find_dota_hwnd, WindowsGameWindowTracker},
    CaptureError, GameWindowTracker, PixelFormat, RawFrame, ScreenCapturer, WindowBounds,
};

struct ScreenDcGuard(HDC);

impl Drop for ScreenDcGuard {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_invalid() {
                let _ = ReleaseDC(None, self.0);
            }
        }
    }
}

struct MemDcGuard(HDC);

impl Drop for MemDcGuard {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_invalid() {
                let _ = DeleteDC(self.0);
            }
        }
    }
}

pub fn is_frame_uniform_black(bytes: &[u8]) -> bool {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .step_by(64)
        .all(|px| px[0] == 0 && px[1] == 0 && px[2] == 0)
}

unsafe fn read_bitmap_bgra(
    mem_dc: HDC,
    bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
    width: u32,
    height: u32,
) -> Result<RawFrame, CaptureError> {
    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32), // top-down DIB
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut bytes = vec![0u8; (width as usize) * (height as usize) * 4];
    let lines = GetDIBits(
        mem_dc,
        bitmap,
        0,
        height,
        Some(bytes.as_mut_ptr().cast()),
        &mut bmi,
        DIB_RGB_COLORS,
    );
    if lines == 0 {
        return Err(CaptureError::Failed(
            "GetDIBits returned 0 scanlines".to_string(),
        ));
    }

    Ok(RawFrame {
        width,
        height,
        format: PixelFormat::Bgra8,
        bytes,
    })
}

#[derive(Debug, Default)]
pub struct WindowsGdiCapturer;

impl WindowsGdiCapturer {
    pub fn capture_region(bounds: WindowBounds) -> Result<RawFrame, CaptureError> {
        unsafe {
            let screen_dc = GetDC(None);
            if screen_dc.is_invalid() {
                return Err(CaptureError::Failed("GetDC(None) failed".to_string()));
            }
            let _screen_guard = ScreenDcGuard(screen_dc);
            Self::capture_from_dc(screen_dc, bounds)
        }
    }

    pub fn capture_window_printwindow(
        hwnd: HWND,
        bounds: WindowBounds,
    ) -> Result<RawFrame, CaptureError> {
        if bounds.width == 0 || bounds.height == 0 {
            return Err(CaptureError::Failed(
                "capture region must be non-zero".to_string(),
            ));
        }

        unsafe {
            let screen_dc = GetDC(None);
            if screen_dc.is_invalid() {
                return Err(CaptureError::Failed("GetDC(None) failed".to_string()));
            }
            let _screen_guard = ScreenDcGuard(screen_dc);

            let mem_dc = CreateCompatibleDC(Some(screen_dc));
            if mem_dc.is_invalid() {
                return Err(CaptureError::Failed("CreateCompatibleDC failed".to_string()));
            }
            let _mem_guard = MemDcGuard(mem_dc);

            let bitmap = CreateCompatibleBitmap(screen_dc, bounds.width as i32, bounds.height as i32);
            if bitmap.is_invalid() {
                return Err(CaptureError::Failed(
                    "CreateCompatibleBitmap failed".to_string(),
                ));
            }

            let prev_obj = SelectObject(mem_dc, bitmap.into());
            if prev_obj.is_invalid() {
                let _ = DeleteObject(bitmap.into());
                return Err(CaptureError::Failed("SelectObject failed".to_string()));
            }

            let flags = PRINT_WINDOW_FLAGS(PW_CLIENTONLY.0 | PW_RENDERFULLCONTENT);
            let ok = PrintWindow(hwnd, mem_dc, flags).as_bool();
            let _ = SelectObject(mem_dc, prev_obj);

            if !ok {
                let _ = DeleteObject(bitmap.into());
                return Err(CaptureError::Failed("PrintWindow returned false".to_string()));
            }

            let frame = read_bitmap_bgra(mem_dc, bitmap, bounds.width, bounds.height);
            let _ = DeleteObject(bitmap.into());
            let frame = frame?;
            if is_frame_uniform_black(&frame.bytes) {
                return Err(CaptureError::Failed(
                    "PrintWindow returned blank frame".to_string(),
                ));
            }
            Ok(frame)
        }
    }

    pub(crate) unsafe fn capture_from_dc(
        src_dc: HDC,
        bounds: WindowBounds,
    ) -> Result<RawFrame, CaptureError> {
        if bounds.width == 0 || bounds.height == 0 {
            return Err(CaptureError::Failed(
                "capture region must be non-zero".to_string(),
            ));
        }

        let mem_dc = CreateCompatibleDC(Some(src_dc));
        if mem_dc.is_invalid() {
            return Err(CaptureError::Failed("CreateCompatibleDC failed".to_string()));
        }
        let _mem_guard = MemDcGuard(mem_dc);

        let bitmap = CreateCompatibleBitmap(src_dc, bounds.width as i32, bounds.height as i32);
        if bitmap.is_invalid() {
            return Err(CaptureError::Failed(
                "CreateCompatibleBitmap failed".to_string(),
            ));
        }

        let prev_obj = SelectObject(mem_dc, bitmap.into());
        if prev_obj.is_invalid() {
            let _ = DeleteObject(bitmap.into());
            return Err(CaptureError::Failed("SelectObject failed".to_string()));
        }

        let blt_res = BitBlt(
            mem_dc,
            0,
            0,
            bounds.width as i32,
            bounds.height as i32,
            Some(src_dc),
            bounds.x,
            bounds.y,
            SRCCOPY,
        );
        let _ = SelectObject(mem_dc, prev_obj);

        if let Err(err) = blt_res {
            let _ = DeleteObject(bitmap.into());
            return Err(CaptureError::Failed(format!("BitBlt failed: {err}")));
        }

        let frame = read_bitmap_bgra(mem_dc, bitmap, bounds.width, bounds.height);
        let _ = DeleteObject(bitmap.into());
        frame
    }
}

impl ScreenCapturer for WindowsGdiCapturer {
    fn capture_game_frame(&mut self) -> Result<RawFrame, CaptureError> {
        let tracker = WindowsGameWindowTracker;
        let bounds = tracker
            .find_dota_window()?
            .ok_or(CaptureError::WindowNotFound)?;
        Self::capture_region(bounds)
    }
}

#[derive(Debug, Default)]
pub struct WindowsHybridCapturer;

impl ScreenCapturer for WindowsHybridCapturer {
    fn capture_game_frame(&mut self) -> Result<RawFrame, CaptureError> {
        let hwnd = find_dota_hwnd().ok_or(CaptureError::WindowNotFound)?;
        let bounds = client_bounds_for_hwnd(hwnd).ok_or(CaptureError::WindowNotFound)?;
        WindowsGdiCapturer::capture_window_printwindow(hwnd, bounds)
            .or_else(|_| WindowsGdiCapturer::capture_region(bounds))
    }
}

#[cfg(test)]
mod tests {
    use windows::Win32::{Foundation::COLORREF, Graphics::Gdi::SetPixel};

    use super::*;

    #[test]
    fn detects_uniform_black_frames() {
        let blank = vec![0u8; 8 * 8 * 4];
        assert!(is_frame_uniform_black(&blank));

        let mut lit = vec![0u8; 8 * 8 * 4];
        lit[0] = 10;
        assert!(!is_frame_uniform_black(&lit));
    }

    #[test]
    fn captures_from_memory_dc_roundtrip_bgra() {
        unsafe {
            let screen_dc = GetDC(None);
            assert!(!screen_dc.is_invalid());
            let _screen_guard = ScreenDcGuard(screen_dc);

            let src_dc = CreateCompatibleDC(Some(screen_dc));
            assert!(!src_dc.is_invalid());
            let _src_guard = MemDcGuard(src_dc);

            let src_bmp = CreateCompatibleBitmap(screen_dc, 8, 8);
            assert!(!src_bmp.is_invalid());
            let prev = SelectObject(src_dc, src_bmp.into());

            // COLORREF is 0x00BBGGRR (R=0x12, G=0x34, B=0x56)
            SetPixel(src_dc, 2, 3, COLORREF(0x0056_3412));

            let frame = WindowsGdiCapturer::capture_from_dc(
                src_dc,
                WindowBounds {
                    x: 0,
                    y: 0,
                    width: 8,
                    height: 8,
                },
            )
            .expect("BitBlt + GetDIBits from memory DC");

            let _ = SelectObject(src_dc, prev);
            let _ = DeleteObject(src_bmp.into());

            assert_eq!(frame.width, 8);
            assert_eq!(frame.height, 8);
            assert_eq!(frame.format, PixelFormat::Bgra8);
            let idx = (3 * 8 + 2) * 4;
            assert_eq!(&frame.bytes[idx..idx + 3], &[0x56, 0x34, 0x12]);
        }
    }

    #[test]
    fn captures_desktop_region_or_reports_locked_desktop_error() {
        match WindowsGdiCapturer::capture_region(WindowBounds {
            x: 0,
            y: 0,
            width: 16,
            height: 16,
        }) {
            Ok(frame) => {
                assert_eq!(frame.width, 16);
                assert_eq!(frame.height, 16);
                assert_eq!(frame.format, PixelFormat::Bgra8);
                assert_eq!(frame.bytes.len(), 16 * 16 * 4);
            }
            // Locked / non-interactive desktop sessions reject desktop BitBlt
            Err(CaptureError::Failed(msg)) if msg.contains("BitBlt failed") => {}
            Err(other) => panic!("unexpected desktop capture error: {other:?}"),
        }
    }
}
