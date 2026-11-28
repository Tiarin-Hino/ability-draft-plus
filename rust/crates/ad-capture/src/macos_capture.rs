//! macOS CoreGraphics window discovery (`CGWindowListCopyWindowInfo`) and capture (`CGWindowListCreateImage`).

use std::ffi::c_void;

use core_foundation::{
    array::CFArray,
    base::{CFType, TCFType},
    dictionary::CFDictionary,
    number::CFNumber,
    string::CFString,
};
use core_graphics::{
    geometry::{CGPoint, CGRect, CGSize},
    window::{
        copy_window_info, create_image, kCGNullWindowID, kCGWindowImageDefault,
        kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
    },
};

use crate::{CaptureError, GameWindowTracker, PixelFormat, RawFrame, ScreenCapturer, WindowBounds};

fn read_dict_string(dict: &CFDictionary<CFString, CFType>, key: &str) -> Option<String> {
    let cf_key = CFString::new(key);
    let val = dict.find(&cf_key)?;
    val.downcast::<CFString>().map(|s| s.to_string())
}

fn read_dict_f64(dict: &CFDictionary<CFString, CFType>, key: &str) -> Option<f64> {
    let cf_key = CFString::new(key);
    let val = dict.find(&cf_key)?;
    val.downcast::<CFNumber>().and_then(|n| n.to_f64())
}

fn find_dota_macos_window() -> Result<Option<WindowBounds>, CaptureError> {
    let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
    let Some(array) = copy_window_info(options, kCGNullWindowID) else {
        return Ok(None);
    };
    let cf_array: CFArray<*const c_void> = unsafe { CFArray::wrap_under_get_rule(array.as_concrete_TypeRef()) };
    let bounds_key = CFString::new("kCGWindowBounds");

    for entry in cf_array.iter() {
        let dict_ref = (*entry) as core_foundation::dictionary::CFDictionaryRef;
        if dict_ref.is_null() {
            continue;
        }
        let dict: CFDictionary<CFString, CFType> = unsafe { CFDictionary::wrap_under_get_rule(dict_ref) };
        let owner = read_dict_string(&dict, "kCGWindowOwnerName").unwrap_or_default();
        let name = read_dict_string(&dict, "kCGWindowName").unwrap_or_default();
        let matches = name.trim() == "Dota 2"
            || owner.trim().eq_ignore_ascii_case("dota 2")
            || owner.trim().eq_ignore_ascii_case("dota2");
        if !matches {
            continue;
        }

        let Some(bounds_val) = dict.find(&bounds_key) else {
            continue;
        };
        let Some(bounds_untyped) = bounds_val.downcast::<CFDictionary>() else {
            continue;
        };
        let bounds_dict: CFDictionary<CFString, CFType> =
            unsafe { CFDictionary::wrap_under_get_rule(bounds_untyped.as_concrete_TypeRef()) };
        let (Some(x), Some(y), Some(w), Some(h)) = (
            read_dict_f64(&bounds_dict, "X"),
            read_dict_f64(&bounds_dict, "Y"),
            read_dict_f64(&bounds_dict, "Width"),
            read_dict_f64(&bounds_dict, "Height"),
        ) else {
            continue;
        };
        if w <= 0.0 || h <= 0.0 {
            continue;
        }
        return Ok(Some(WindowBounds {
            x: x.round() as i32,
            y: y.round() as i32,
            width: w.round() as u32,
            height: h.round() as u32,
        }));
    }

    Ok(None)
}

#[derive(Debug, Default)]
pub struct MacOsWindowTracker;

impl GameWindowTracker for MacOsWindowTracker {
    fn find_dota_window(&self) -> Result<Option<WindowBounds>, CaptureError> {
        find_dota_macos_window()
    }
}

#[derive(Debug, Default)]
pub struct MacOsScreenCapturer;

impl ScreenCapturer for MacOsScreenCapturer {
    fn capture_game_frame(&mut self) -> Result<RawFrame, CaptureError> {
        let bounds = find_dota_macos_window()?.ok_or(CaptureError::WindowNotFound)?;
        let rect = CGRect::new(
            &CGPoint::new(f64::from(bounds.x), f64::from(bounds.y)),
            &CGSize::new(f64::from(bounds.width), f64::from(bounds.height)),
        );
        let Some(img) = create_image(
            rect,
            kCGWindowListOptionOnScreenOnly,
            kCGNullWindowID,
            kCGWindowImageDefault,
        ) else {
            return Err(CaptureError::Failed(
                "CGWindowListCreateImage returned None (check Screen Recording permissions)".to_string(),
            ));
        };

        let width = img.width() as u32;
        let height = img.height() as u32;
        let row_bytes = img.bytes_per_row();
        let src_row_len = (width as usize) * 4;
        let data = img.data();
        let src = data.bytes();

        let mut bytes = Vec::with_capacity((height as usize) * src_row_len);
        for row in 0..(height as usize) {
            let start = row * row_bytes;
            let end = start + src_row_len;
            if end > src.len() {
                return Err(CaptureError::Failed(format!(
                    "CGImage buffer truncated at row {row}: {end} > {}",
                    src.len()
                )));
            }
            bytes.extend_from_slice(&src[start..end]);
        }

        Ok(RawFrame {
            width,
            height,
            format: PixelFormat::Bgra8,
            bytes,
        })
    }
}
