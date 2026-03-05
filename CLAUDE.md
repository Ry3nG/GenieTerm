# GenieTerm Development Guide

## Product Scope

GenieTerm has one supported app implementation:
- Native macOS frontend: `native/GenieTerm`
- Rust PTY/terminal core: `src/`

No legacy frontend is maintained.

## Build Commands

From repository root:

```bash
cargo build --lib
cd native/GenieTerm
swift build
swift run
```

Alternative launcher:

```bash
./run.sh
```

Release build:

```bash
./build_release.sh
```

Benchmark run:

```bash
./benchmarks/run_benchmarks.sh
./benchmarks/run_e2e_bench.sh
./benchmarks/run_stable_suite.sh --runs 20
```

## Core Architecture

1. SwiftUI/AppKit frontend renders terminal snapshot.
2. Rust engine owns PTY, ANSI parser, and screen buffer.
3. FFI boundary is C ABI in `src/ffi.rs` and `genieterm_ffi.h`.

## Key Files

### Swift

- `native/GenieTerm/Sources/GenieTerm/GenieTermApp.swift` - App entry point
- `native/GenieTerm/Sources/GenieTerm/ContentView.swift` - Main view layout
- `native/GenieTerm/Sources/GenieTerm/TerminalTextView.swift` - Terminal rendering
- `native/GenieTerm/Sources/GenieTerm/TerminalBridge.swift` - FFI bridge to Rust
- `native/GenieTerm/Sources/GenieTerm/ImprovedDialogView.swift` - Command input UI
- `native/GenieTerm/Sources/GenieTerm/CommandBlock.swift` - Legacy Warp-style command block UI (not in default input path)
- `native/GenieTerm/Sources/GenieTerm/CommandCompletion.swift` - Tab completion logic
- `native/GenieTerm/Sources/GenieTermE2EBench/main.swift` - Swift E2E benchmark runner

### Rust

- `src/engine.rs`
- `src/ffi.rs`
- `src/pty/pty_manager.rs`
- `src/terminal/parser.rs`
- `src/terminal/screen_buffer.rs`
- `src/terminal/color.rs`

## FFI Contract

Swift calls:
- `genieterm_create`
- `genieterm_destroy`
- `genieterm_send_command`
- `genieterm_send_input`
- `genieterm_resize`
- `genieterm_poll_snapshot_json`
- `genieterm_recent_scrollback_json`
- `genieterm_snapshot_version`
- `genieterm_bracketed_paste_enabled`
- `genieterm_mouse_tracking_mode`
- `genieterm_mouse_sgr_enabled`
- `genieterm_focus_reporting_enabled`
- `genieterm_free_string`

Header path:
- `native/GenieTerm/Sources/CGenieTerm/include/genieterm_ffi.h`

## Change Rules

1. Keep UI logic in Swift, terminal correctness logic in Rust.
2. Update docs in the same change when behavior or paths change.
3. Preserve app naming as `GenieTerm`.
4. Tab completion happens in Swift layer, not PTY.
5. Command history navigation is managed by ImprovedDialogView (`Up/Down` in single-line input).

## Pre-Push Performance Checklist

Every push must pass a full-codebase review against these rules:

1. **No dead FFI**: Every function in `genieterm_ffi.h` must have a caller in Swift. Every Rust `#[no_mangle]` must have a matching header declaration. Remove any that are unused.
2. **No redundant data paths**: If information is available via a lightweight FFI call (e.g. `snapshot_version`), do not duplicate it inside heavier payloads (e.g. JSON snapshot).
3. **No duplicated logic**: Identical code blocks must be extracted into a shared function. Zero tolerance for copy-paste.
4. **Minimize mutex acquisitions**: Batch reads from `screen_buffer` where possible. Never lock the same mutex multiple times in a single poll cycle without justification.
5. **Minimize allocations on the hot path**: `poll()` runs at 30 fps when active. Avoid unnecessary `String`, `Vec`, or JSON work when nothing has changed.
6. **No dead code**: Unused `pub` functions, unreachable match arms, commented-out blocks — delete them.
7. **Polling must be adaptive**: Active polling (30 fps) only while content is changing; drop to idle rate (10 fps) after 1 second of no change.

## Features

### Command Input Dialog

- **Single-line shell input**: Minimal default input path
- **Keyboard history navigation**: `Up/Down` to traverse session history
- **Tab completion**: Local file/directory/command completion
- **Enter to submit**: Immediate command execution

### Terminal Display

- **Username and hostname** in window title
- **Full color support**: xterm-256color + true color (256-color palette + RGB)
- **Scrollback history**: Navigate through output
- **Dynamic resizing**: Adapts to window size
- **Alternate screen**: Proper save/restore for TUI apps (vim, htop, etc.)
- **Scroll regions**: DECSTBM support for partial-screen scrolling
- **Mouse tracking**: X10, button-event, any-event modes with SGR encoding
- **Bracketed paste**: Wraps pasted text for paste-aware applications
- **Focus reporting**: Sends focus in/out events when enabled
- **Snapshot versioning**: Lightweight polling via version counter to skip redundant JSON decoding

## Release Process

1. Local: `./build_release.sh` creates DMG in `release/`
2. GitHub: Push tag `v*` triggers automated release
3. CI workflow: `.github/workflows/release.yml`
