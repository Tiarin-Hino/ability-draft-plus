//! Linux X11 / Wayland display detection, X11 window tracking, and root-region capture.

use x11rb::{
    connection::Connection,
    protocol::xproto::{AtomEnum, ConnectionExt, ImageFormat, Window},
};

use crate::{CaptureError, GameWindowTracker, PixelFormat, RawFrame, ScreenCapturer, WindowBounds};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinuxDisplayServer {
    Wayland,
    X11,
    Headless,
}

pub fn detect_display_server() -> LinuxDisplayServer {
    if std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE")
            .is_ok_and(|v| v.eq_ignore_ascii_case("wayland"))
    {
        LinuxDisplayServer::Wayland
    } else if std::env::var_os("DISPLAY").is_some() {
        LinuxDisplayServer::X11
    } else {
        LinuxDisplayServer::Headless
    }
}

fn read_window_title<C: Connection>(
    conn: &C,
    win: Window,
    net_wm_name: Option<u32>,
    utf8_string: Option<u32>,
) -> Option<String> {
    if let (Some(atom), Some(utf8)) = (net_wm_name, utf8_string) {
        if let Ok(cookie) = conn.get_property(false, win, atom, utf8, 0, 256) {
            if let Ok(reply) = cookie.reply() {
                if !reply.value.is_empty() {
                    if let Ok(s) = String::from_utf8(reply.value) {
                        return Some(s);
                    }
                }
            }
        }
    }

    if let Ok(cookie) = conn.get_property(false, win, AtomEnum::WM_NAME, AtomEnum::STRING, 0, 256)
    {
        if let Ok(reply) = cookie.reply() {
            if !reply.value.is_empty() {
                return Some(String::from_utf8_lossy(&reply.value).into_owned());
            }
        }
    }
    None
}

fn find_dota_x11_window() -> Result<Option<WindowBounds>, CaptureError> {
    if std::env::var_os("DISPLAY").is_none() {
        return Ok(None);
    }
    let Ok((conn, screen_num)) = x11rb::connect(None) else {
        return Ok(None);
    };
    let Some(screen) = conn.setup().roots.get(screen_num) else {
        return Ok(None);
    };
    let root = screen.root;

    let net_client_list = conn
        .intern_atom(false, b"_NET_CLIENT_LIST")
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|r| r.atom);
    let net_wm_name = conn
        .intern_atom(false, b"_NET_WM_NAME")
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|r| r.atom);
    let utf8_string = conn
        .intern_atom(false, b"UTF8_STRING")
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|r| r.atom);

    let Some(client_list_atom) = net_client_list else {
        return Ok(None);
    };

    let Ok(prop_cookie) =
        conn.get_property(false, root, client_list_atom, AtomEnum::WINDOW, 0, 1024)
    else {
        return Ok(None);
    };
    let Ok(prop_reply) = prop_cookie.reply() else {
        return Ok(None);
    };
    let Some(windows) = prop_reply.value32() else {
        return Ok(None);
    };

    for win in windows {
        let Some(title) = read_window_title(&conn, win, net_wm_name, utf8_string) else {
            continue;
        };
        if title.trim() != "Dota 2" {
            continue;
        }
        let Ok(geom_cookie) = conn.get_geometry(win) else {
            continue;
        };
        let Ok(geom) = geom_cookie.reply() else {
            continue;
        };
        let Ok(trans_cookie) = conn.translate_coordinates(win, root, 0, 0) else {
            continue;
        };
        let Ok(trans) = trans_cookie.reply() else {
            continue;
        };
        if geom.width == 0 || geom.height == 0 {
            continue;
        }
        return Ok(Some(WindowBounds {
            x: i32::from(trans.dst_x),
            y: i32::from(trans.dst_y),
            width: u32::from(geom.width),
            height: u32::from(geom.height),
        }));
    }

    Ok(None)
}

#[derive(Debug, Default)]
pub struct LinuxWindowTracker;

impl GameWindowTracker for LinuxWindowTracker {
    fn find_dota_window(&self) -> Result<Option<WindowBounds>, CaptureError> {
        find_dota_x11_window()
    }
}

#[derive(Debug, Default)]
pub struct LinuxScreenCapturer;

impl ScreenCapturer for LinuxScreenCapturer {
    fn capture_game_frame(&mut self) -> Result<RawFrame, CaptureError> {
        match detect_display_server() {
            LinuxDisplayServer::Wayland => {
                Err(CaptureError::Unsupported("linux-wayland-portal"))
            }
            LinuxDisplayServer::Headless => Err(CaptureError::Unsupported("linux-headless")),
            LinuxDisplayServer::X11 => {
                let bounds =
                    find_dota_x11_window()?.ok_or(CaptureError::WindowNotFound)?;
                let (conn, screen_num) = x11rb::connect(None)
                    .map_err(|e| CaptureError::Failed(format!("X11 connect failed: {e}")))?;
                let screen = conn
                    .setup()
                    .roots
                    .get(screen_num)
                    .ok_or_else(|| CaptureError::Failed("missing X11 root screen".to_string()))?;

                let x = i16::try_from(bounds.x.max(0)).unwrap_or(0);
                let y = i16::try_from(bounds.y.max(0)).unwrap_or(0);
                let w = u16::try_from(bounds.width).unwrap_or(u16::MAX);
                let h = u16::try_from(bounds.height).unwrap_or(u16::MAX);

                let reply = conn
                    .get_image(
                        ImageFormat::Z_PIXMAP,
                        screen.root,
                        x,
                        y,
                        w,
                        h,
                        u32::MAX,
                    )
                    .map_err(|e| CaptureError::Failed(format!("X11 get_image failed: {e}")))?
                    .reply()
                    .map_err(|e| {
                        CaptureError::Failed(format!("X11 get_image reply failed: {e}"))
                    })?;

                let expected = usize::from(w) * usize::from(h) * 4;
                if reply.data.len() < expected {
                    return Err(CaptureError::Failed(format!(
                        "X11 image buffer too small: {} < {expected}",
                        reply.data.len()
                    )));
                }

                Ok(RawFrame {
                    width: u32::from(w),
                    height: u32::from(h),
                    format: PixelFormat::Bgra8,
                    bytes: reply.data[..expected].to_vec(),
                })
            }
        }
    }
}
