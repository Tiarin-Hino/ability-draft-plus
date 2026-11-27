//! Win32 transparent layered topmost overlay window with stateless `WM_NCHITTEST` click-through.

use std::sync::{Arc, RwLock};

use ad_protocol::Rect;
use anyhow::Context;
use windows::{
    core::w,
    Win32::{
        Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, WPARAM},
        Graphics::Gdi::{CreateSolidBrush, ScreenToClient},
        System::LibraryLoader::GetModuleHandleW,
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetWindowLongPtrW,
            PostQuitMessage, RegisterClassW, SetLayeredWindowAttributes, SetWindowLongPtrW,
            ShowWindow, TranslateMessage, CW_USEDEFAULT, GWLP_USERDATA, HTCLIENT, HTTRANSPARENT,
            LWA_ALPHA, MA_NOACTIVATE, MSG, SW_SHOWNOACTIVATE, WM_DESTROY, WM_MOUSEACTIVATE,
            WM_NCHITTEST, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
            WS_EX_TOPMOST, WS_POPUP,
        },
    },
};

use crate::hit_test::HitTester;

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
