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
pub unsafe extern "C" fn genieterm_poll_screen_text(handle: *mut GenieTermHandle) -> *mut c_char {
    if handle.is_null() {
        return std::ptr::null_mut();
    }

    let text = (*handle).engine.screen_text().replace('\0', " ");
    match CString::new(text) {
        Ok(cstr) => cstr.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_poll_snapshot_json(handle: *mut GenieTermHandle) -> *mut c_char {
    if handle.is_null() {
        return std::ptr::null_mut();
    }

    let json = (*handle).engine.snapshot_json().replace('\0', " ");
    match CString::new(json) {
        Ok(cstr) => cstr.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_free_string(value: *mut c_char) {
    if !value.is_null() {
        let _ = CString::from_raw(value);
    }
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_cursor_row(handle: *mut GenieTermHandle) -> u16 {
    if handle.is_null() {
        return 0;
    }
    (*handle).engine.cursor().0
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_cursor_col(handle: *mut GenieTermHandle) -> u16 {
    if handle.is_null() {
        return 0;
    }
    (*handle).engine.cursor().1
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_rows(handle: *mut GenieTermHandle) -> u16 {
    if handle.is_null() {
        return 0;
    }
    (*handle).engine.size().0
}

#[no_mangle]
pub unsafe extern "C" fn genieterm_cols(handle: *mut GenieTermHandle) -> u16 {
    if handle.is_null() {
        return 0;
    }
    (*handle).engine.size().1
}
