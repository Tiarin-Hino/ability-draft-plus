//! Win32 transparent layered topmost overlay window and OS-cursor passthrough watcher.

use std::sync::{Arc, RwLock};

use ad_protocol::Rect;
use anyhow::Context;
use tracing::{info, warn};
use windows::{
    core::w,
    Win32::{
        Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, WPARAM},
        Graphics::Gdi::{CreateSolidBrush, GetDC, GetDeviceCaps, ReleaseDC, ScreenToClient, LOGPIXELSX},
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            Input::KeyboardAndMouse::{
                GetAsyncKeyState, RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_CONTROL,
                MOD_NOREPEAT, MOD_SHIFT, VK_LBUTTON,
            },
            WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DispatchMessageW, GetCursorPos, GetMessageW,
                GetSystemMetrics, GetWindowLongPtrW, IsWindow, PostQuitMessage, RegisterClassW,
                SetLayeredWindowAttributes, SetWindowLongPtrW, SetWindowPos, ShowWindow,
                TranslateMessage, WindowFromPoint, CW_USEDEFAULT, GWLP_USERDATA, GWL_EXSTYLE,
                HTCLIENT, HTTRANSPARENT, LWA_ALPHA, MA_NOACTIVATE, MSG, SM_CXSCREEN, SM_CYSCREEN,
                SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
                SW_SHOWNOACTIVATE, WM_DESTROY, WM_HOTKEY, WM_MOUSEACTIVATE, WM_NCHITTEST,
                WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
                WS_EX_TRANSPARENT, WS_POPUP,
            },
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

/// Returns the initial primary-monitor physical bounds (shrunk 1px off width for DWM click-through).
pub fn initial_overlay_bounds_phys() -> Rect {
    let (w, h) = unsafe {
        let cx = GetSystemMetrics(SM_CXSCREEN).max(640);
        let cy = GetSystemMetrics(SM_CYSCREEN).max(480);
        ((cx - 1).max(640) as u32, cy as u32)
    };
    Rect {
        x: 0,
        y: 0,
        width: w,
        height: h,
    }
}

/// Returns initial `(x, y, width, height)` in logical points so `winit` creates the overlay
/// at full monitor dimensions BEFORE `WS_EX_LAYERED` is applied (preventing frozen 800x600 hit-test bounds).
pub fn initial_overlay_bounds_logical() -> (f32, f32, f32, f32) {
    let phys = initial_overlay_bounds_phys();
    let scale = unsafe {
        let hdc = GetDC(None);
        if hdc.is_invalid() {
            1.0
        } else {
            let dpi = GetDeviceCaps(Some(hdc), LOGPIXELSX);
            let _ = ReleaseDC(None, hdc);
            if dpi > 0 {
                (dpi as f32 / 96.0).max(0.5)
            } else {
                1.0
            }
        }
    };
    (0.0, 0.0, phys.width as f32 / scale, phys.height as f32 / scale)
}

/// Polls OS cursor position independently of `WM_MOUSEMOVE` (which Windows stops sending when
/// `WS_EX_TRANSPARENT` is set) and toggles ONLY `WS_EX_TRANSPARENT` while keeping
/// `WS_EX_LAYERED | WS_EX_NOACTIVATE` permanently set and flushing changes with `SWP_FRAMECHANGED`.
pub fn spawn_cursor_passthrough_watcher(
    raw_hwnd: isize,
    hit_tester: Arc<RwLock<HitTester>>,
    hover_rects: Arc<RwLock<Vec<Rect>>>,
    cursor_phys: Arc<RwLock<Option<(i32, i32)>>>,
    request_repaint: Arc<dyn Fn() + Send + Sync>,
) {
    std::thread::spawn(move || {
        let hwnd = HWND(raw_hwnd as *mut core::ffi::c_void);
        let mut dragging_hud = false;
        let mut last_lbutton_down = false;
        let mut last_interactive: Option<bool> = None;
        let mut last_hovered: Option<usize> = None;
        let mut last_cursor: Option<(i32, i32)> = None;
        let mut logged_init = false;

        let layered_bit = WS_EX_LAYERED.0 as isize;
        let transparent_bit = WS_EX_TRANSPARENT.0 as isize;
        let noactivate_bit = WS_EX_NOACTIVATE.0 as isize;
        let swp_flags =
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED;

        loop {
            std::thread::sleep(std::time::Duration::from_millis(16));

            if !unsafe { IsWindow(Some(hwnd)).as_bool() } {
                break;
            }

            let mut screen_pt = POINT::default();
            if unsafe { GetCursorPos(&mut screen_pt) }.is_err() {
                continue;
            }
            let mut client_pt = screen_pt;
            if !unsafe { ScreenToClient(hwnd, &mut client_pt) }.as_bool() {
                continue;
            }

            let lbutton_down = unsafe { GetAsyncKeyState(i32::from(VK_LBUTTON.0)) } < 0;
            let hit_interactive = hit_tester
                .read()
                .map(|guard| guard.is_interactive(client_pt.x, client_pt.y))
                .unwrap_or(false);

            if !lbutton_down {
                dragging_hud = false;
            } else if !last_lbutton_down && hit_interactive {
                dragging_hud = true;
            }
            last_lbutton_down = lbutton_down;

            let interactive = hit_interactive || dragging_hud;
            let hovered = hover_rects
                .read()
                .ok()
                .and_then(|rects| rects.iter().position(|r| point_in_rect(client_pt.x, client_pt.y, r)));

            let ex_before = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
            // Keep WS_EX_LAYERED | WS_EX_NOACTIVATE permanently set so wgpu transparent DWM
            // composition never exposes a white backdrop; toggle ONLY WS_EX_TRANSPARENT.
            let next_ex = if interactive {
                (ex_before | layered_bit | noactivate_bit) & !transparent_bit
            } else {
                ex_before | layered_bit | transparent_bit | noactivate_bit
            };
            let mut swp_ok = true;
            if next_ex != ex_before {
                unsafe {
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_ex);
                    swp_ok = SetWindowPos(hwnd, None, 0, 0, 0, 0, swp_flags).is_ok();
                }
                if !swp_ok {
                    warn!(
                        hwnd = format_args!("0x{:x}", raw_hwnd),
                        ex_before = format_args!("0x{:x}", ex_before),
                        next_ex = format_args!("0x{:x}", next_ex),
                        "SetWindowPos(SWP_FRAMECHANGED) failed after GWL_EXSTYLE update"
                    );
                }
            }

            let transition = last_interactive != Some(interactive);
            if !logged_init || transition {
                logged_init = true;
                let ex_after = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
                let wfp = unsafe { WindowFromPoint(screen_pt) };
                info!(
                    hwnd = format_args!("0x{:x}", raw_hwnd),
                    interactive,
                    hit_interactive,
                    dragging_hud,
                    client_x = client_pt.x,
                    client_y = client_pt.y,
                    ex_before = format_args!("0x{:x}", ex_before),
                    ex_after = format_args!("0x{:x}", ex_after),
                    swp_ok,
                    window_from_point_is_overlay = (wfp == hwnd),
                    "Win32 overlay passthrough state"
                );
            }

            if transition {
                last_interactive = Some(interactive);
                if let Ok(mut guard) = cursor_phys.write() {
                    *guard = Some((client_pt.x, client_pt.y));
                }
                last_cursor = Some((client_pt.x, client_pt.y));
                request_repaint();
                continue;
            }

            let cur_pos = Some((client_pt.x, client_pt.y));
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

const HOTKEY_SCAN_ID: i32 = 1;
const HOTKEY_RESET_ID: i32 = 2;

/// Registers global Windows hotkeys (`Ctrl+Shift+S` scan, `Ctrl+Shift+R` reset) so triggers work
/// even while Dota 2 holds keyboard focus and the overlay stays non-activating.
pub fn spawn_global_hotkeys(
    on_scan: Arc<dyn Fn() + Send + Sync>,
    on_reset: Arc<dyn Fn() + Send + Sync>,
) {
    std::thread::spawn(move || {
        let mods: HOT_KEY_MODIFIERS = MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT;
        let scan_ok = unsafe { RegisterHotKey(None, HOTKEY_SCAN_ID, mods, b'S' as u32) }.is_ok();
        let reset_ok = unsafe { RegisterHotKey(None, HOTKEY_RESET_ID, mods, b'R' as u32) }.is_ok();
        if scan_ok {
            info!("Registered global Windows hotkey Ctrl+Shift+S (Scan)");
        } else {
            warn!("Failed to register global hotkey Ctrl+Shift+S (already in use)");
        }
        if reset_ok {
            info!("Registered global Windows hotkey Ctrl+Shift+R (Reset)");
        } else {
            warn!("Failed to register global hotkey Ctrl+Shift+R (already in use)");
        }
        if !scan_ok && !reset_ok {
            return;
        }

        let mut msg = MSG::default();
        while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
            if msg.message == WM_HOTKEY {
                match msg.wParam.0 as i32 {
                    HOTKEY_SCAN_ID => on_scan(),
                    HOTKEY_RESET_ID => on_reset(),
                    _ => {}
                }
            }
        }

        unsafe {
            if scan_ok {
                let _ = UnregisterHotKey(None, HOTKEY_SCAN_ID);
            }
            if reset_ok {
                let _ = UnregisterHotKey(None, HOTKEY_RESET_ID);
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
