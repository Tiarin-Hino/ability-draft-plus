//! Win32 transparent layered topmost overlay window and OS-cursor passthrough watcher.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, RwLock,
};

use ad_protocol::Rect;
use anyhow::Context;
use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, WPARAM},
        Graphics::Gdi::{CreateSolidBrush, ScreenToClient},
        System::LibraryLoader::GetModuleHandleW,
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DispatchMessageW, FindWindowW, GetCursorPos,
            GetMessageW, GetWindowLongPtrW, IsWindow, PostQuitMessage, RegisterClassW,
            SetLayeredWindowAttributes, SetWindowLongPtrW, ShowWindow, TranslateMessage,
            CW_USEDEFAULT, GWLP_USERDATA, GWL_EXSTYLE, HTCLIENT, HTTRANSPARENT, LWA_ALPHA,
            MA_NOACTIVATE, MSG, SW_SHOWNOACTIVATE, WM_DESTROY, WM_MOUSEACTIVATE, WM_NCHITTEST,
            WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
            WS_EX_TRANSPARENT, WS_POPUP,
        },
    },
};

use crate::hit_test::HitTester;

fn point_in_rect(x: i32, y: i32, r: &Rect) -> bool {
    x >= r.x
        && y >= r.y
        && i64::from(x) < i64::from(r.x) + i64::from(r.width)
        && i64::from(y) < i64::from(r.y) + i64::from(r.height)
}

fn find_window_by_title(wide_title: &[u16]) -> Option<HWND> {
    match unsafe { FindWindowW(PCWSTR::null(), PCWSTR(wide_title.as_ptr())) } {
        Ok(hwnd) if !hwnd.is_invalid() => Some(hwnd),
        _ => None,
    }
}

/// Polls OS cursor position independently of `WM_MOUSEMOVE` (which Windows stops sending when
/// `WS_EX_TRANSPARENT` is set) and toggles ONLY `WS_EX_TRANSPARENT` while keeping `WS_EX_LAYERED`
/// permanently set so DWM per-pixel alpha transparency never breaks.
pub fn spawn_cursor_passthrough_watcher(
    window_title: &str,
    hit_tester: Arc<RwLock<HitTester>>,
    hover_rects: Arc<RwLock<Vec<Rect>>>,
    cursor_phys: Arc<RwLock<Option<(i32, i32)>>>,
    pointer_down: Arc<AtomicBool>,
    request_repaint: Arc<dyn Fn() + Send + Sync>,
) {
    let wide_title: Vec<u16> = window_title
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    std::thread::spawn(move || {
        let mut cached_hwnd: Option<HWND> = None;
        let mut last_interactive: Option<bool> = None;
        let mut last_hovered: Option<usize> = None;
        let mut last_cursor: Option<(i32, i32)> = None;

        let layered_bit = WS_EX_LAYERED.0 as isize;
        let transparent_bit = WS_EX_TRANSPARENT.0 as isize;

        loop {
            std::thread::sleep(std::time::Duration::from_millis(16));

            let valid = cached_hwnd.is_some_and(|h| unsafe { IsWindow(Some(h)).as_bool() });
            if !valid {
                cached_hwnd = find_window_by_title(&wide_title);
            }
            let Some(hwnd) = cached_hwnd else {
                continue;
            };

            let mut pt = POINT::default();
            if unsafe { GetCursorPos(&mut pt) }.is_err() {
                continue;
            }
            if !unsafe { ScreenToClient(hwnd, &mut pt) }.as_bool() {
                continue;
            }

            let hit_interactive = hit_tester
                .read()
                .map(|guard| guard.is_interactive(pt.x, pt.y))
                .unwrap_or(false);
            let interactive = hit_interactive || pointer_down.load(Ordering::Relaxed);
            let hovered = hover_rects
                .read()
                .ok()
                .and_then(|rects| rects.iter().position(|r| point_in_rect(pt.x, pt.y, r)));

            unsafe {
                let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                let next_ex = if interactive {
                    (ex | layered_bit) & !transparent_bit
                } else {
                    ex | layered_bit | transparent_bit
                };
                if next_ex != ex {
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_ex);
                }
            }

            if last_interactive != Some(interactive) {
                last_interactive = Some(interactive);
                if let Ok(mut guard) = cursor_phys.write() {
                    *guard = Some((pt.x, pt.y));
                }
                last_cursor = Some((pt.x, pt.y));
                request_repaint();
                continue;
            }

            let cur_pos = Some((pt.x, pt.y));
            if last_hovered != hovered || (hovered.is_some() && last_cursor != cur_pos) {
                last_hovered = hovered;
                last_cursor = cur_pos;
                if let Ok(mut guard) = cursor_phys.write() {
                    *guard = cur_pos;
                }
                request_repaint();
            } else if last_cursor != cur_pos {
                last_cursor = cur_pos;
                if let Ok(mut guard) = cursor_phys.write() {
                    *guard = cur_pos;
                }
            }
        }
    });
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_NCHITTEST => {
            let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const RwLock<HitTester>;
            if !ptr.is_null() {
                let x = (lparam.0 & 0xFFFF) as i16 as i32;
                let y = ((lparam.0 >> 16) & 0xFFFF) as i16 as i32;
                let mut pt = POINT { x, y };
                if ScreenToClient(hwnd, &mut pt).as_bool() {
                    if let Ok(guard) = (*ptr).read() {
                        if guard.is_interactive(pt.x, pt.y) {
                            return LRESULT(HTCLIENT as isize);
                        }
                    }
                }
            }
            LRESULT(HTTRANSPARENT as isize)
        }
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

pub fn run_demo_window(bounds: Rect, hit_tester: Arc<RwLock<HitTester>>) -> anyhow::Result<()> {
    unsafe {
        let hinstance = GetModuleHandleW(None).context("GetModuleHandleW failed")?;
        let class_name = w!("AbilityDraftPlusOverlaySurface");

        let wc = WNDCLASSW {
            lpfnWndProc: Some(wnd_proc),
            hInstance: hinstance.into(),
            lpszClassName: class_name,
            hbrBackground: CreateSolidBrush(COLORREF(0x00000000)),
            ..Default::default()
        };
        RegisterClassW(&wc);

        let ex_style = WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        let hwnd = CreateWindowExW(
            ex_style,
            class_name,
            w!("Ability Draft Plus Overlay"),
            WS_POPUP,
            bounds.x,
            bounds.y,
            bounds.width as i32,
            bounds.height as i32,
            None,
            None,
            Some(hinstance.into()),
            None,
        )
        .context("CreateWindowExW failed")?;

        let raw_ptr = Arc::into_raw(hit_tester);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, raw_ptr as isize);
        SetLayeredWindowAttributes(hwnd, COLORREF(0), 220, LWA_ALPHA)
            .context("SetLayeredWindowAttributes failed")?;
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
        drop(Arc::from_raw(raw_ptr));
    }
    let _ = CW_USEDEFAULT;
    Ok(())
}
