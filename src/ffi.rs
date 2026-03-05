use crate::engine::TerminalEngine;
use std::ffi::{c_char, c_uchar, CStr, CString};

pub struct GenieTermHandle {
    engine: TerminalEngine,
}

#[no_mangle]
pub extern "C" fn genieterm_create(cols: u16, rows: u16) -> *mut GenieTermHandle {
    let handle = GenieTermHandle {
        engine: TerminalEngine::new(cols.max(10), rows.max(5)),
    };
    Box::into_raw(Box::new(handle))
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_destroy(handle: *mut GenieTermHandle) {
    if !handle.is_null() {
        let _ = Box::from_raw(handle);
    }
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_send_command(
    handle: *mut GenieTermHandle,
    command: *const c_char,
) {
    if handle.is_null() || command.is_null() {
        return;
    }

    let command = match CStr::from_ptr(command).to_str() {
        Ok(value) => value,
        Err(_) => return,
    };

    (*handle).engine.send_command(command);
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_send_input(
    handle: *mut GenieTermHandle,
    data: *const c_uchar,
    len: usize,
) {
    if handle.is_null() || data.is_null() || len == 0 {
        return;
    }

    let bytes = std::slice::from_raw_parts(data, len);
    (*handle).engine.send_input(bytes);
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_resize(handle: *mut GenieTermHandle, cols: u16, rows: u16) {
    if handle.is_null() {
        return;
    }

    (*handle).engine.resize(cols.max(10), rows.max(5));
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_poll_snapshot_json(handle: *mut GenieTermHandle) -> *mut c_char {
    if handle.is_null() {
        return std::ptr::null_mut();
    }

    let json = (*handle).engine.snapshot_json();
    match CString::new(json) {
        Ok(cstr) => cstr.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_recent_scrollback_json(
    handle: *mut GenieTermHandle,
    limit: usize,
) -> *mut c_char {
    if handle.is_null() {
        return std::ptr::null_mut();
    }

    let json = (*handle).engine.recent_scrollback_json(limit);
    match CString::new(json) {
        Ok(cstr) => cstr.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_snapshot_version(handle: *mut GenieTermHandle) -> u64 {
    if handle.is_null() {
        return 0;
    }

    (*handle).engine.snapshot_version()
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_bracketed_paste_enabled(handle: *mut GenieTermHandle) -> u8 {
    if handle.is_null() {
        return 0;
    }

    if (*handle).engine.bracketed_paste_mode() {
        1
    } else {
        0
    }
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_mouse_tracking_mode(handle: *mut GenieTermHandle) -> u8 {
    if handle.is_null() {
        return 0;
    }

    (*handle).engine.mouse_tracking_mode()
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_mouse_sgr_enabled(handle: *mut GenieTermHandle) -> u8 {
    if handle.is_null() {
        return 0;
    }

    if (*handle).engine.mouse_sgr_mode() {
        1
    } else {
        0
    }
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_focus_reporting_enabled(handle: *mut GenieTermHandle) -> u8 {
    if handle.is_null() {
        return 0;
    }

    if (*handle).engine.focus_event_mode() {
        1
    } else {
        0
    }
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_free_string(value: *mut c_char) {
    if !value.is_null() {
        let _ = CString::from_raw(value);
    }
}
