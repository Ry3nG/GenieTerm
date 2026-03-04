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
- `native/GenieTerm/Sources/GenieTerm/CommandBlock.swift` - Command history blocks
- `native/GenieTerm/Sources/GenieTerm/CommandCompletion.swift` - Tab completion logic

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
- `genieterm_free_string`

Header path:
- `native/GenieTerm/Sources/CGenieTerm/include/genieterm_ffi.h`

## Change Rules

1. Keep UI logic in Swift, terminal correctness logic in Rust.
2. Update docs in the same change when behavior or paths change.
3. Preserve app naming as `GenieTerm`.
4. Tab completion happens in Swift layer, not PTY.
5. Command history is managed by ImprovedDialogView.

## Features

### Command Input Dialog

- **Block-based history**: Shows last 5 commands with timestamps
- **Tab completion**: Local file/directory/command completion
- **Multi-line mode**: Toggle for complex commands
- **Quick actions**: Edit and rerun previous commands
- **Smart suggestions**: Recent command matching

### Terminal Display

- **Username and hostname** in window title
- **Full color support**: xterm-256color + true color
- **Scrollback history**: Navigate through output
- **Dynamic resizing**: Adapts to window size

## Release Process

1. Local: `./build_release.sh` creates DMG in `release/`
2. GitHub: Push tag `v*` triggers automated release
3. See `RELEASE.md` for detailed instructions
