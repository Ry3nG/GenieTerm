# Developer Guide

## Building

### Quick Start

```bash
./run.sh
```

### Manual Build

```bash
cargo build --lib
cd native/GenieTerm
swift build
swift run
```

### Release Build

```bash
./build_release.sh
```

Creates a DMG in `release/` directory.

## Architecture

### Components

- **Rust Core** (`src/`) - PTY management, ANSI parsing, screen buffer
- **Swift UI** (`native/GenieTerm/Sources/`) - SwiftUI interface, user interaction
- **FFI Bridge** (`src/ffi.rs`, `genieterm_ffi.h`) - C ABI between Rust and Swift

### Key Files

**Rust:**
- `src/engine.rs` - Terminal engine
- `src/ffi.rs` - FFI interface
- `src/pty/pty_manager.rs` - PTY management
- `src/terminal/parser.rs` - ANSI parser
- `src/terminal/screen_buffer.rs` - Screen buffer

**Swift:**
- `GenieTermApp.swift` - App entry point
- `ContentView.swift` - Main layout
- `TerminalTextView.swift` - Terminal rendering
- `TerminalBridge.swift` - FFI bridge
- `ImprovedDialogView.swift` - Command input
- `CommandCompletion.swift` - Tab completion

## Release Process

### Automated (GitHub Actions)

Push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will:
1. Build release binaries
2. Create DMG installer
3. Create GitHub Release
4. Upload artifacts

### Manual

```bash
./build_release.sh
```

Output: `release/GenieTerm-YYYYMMDD.dmg`

## Code Signing

With Apple Developer account:

```bash
codesign --force --deep --sign "Developer ID Application: Your Name" \
  release/GenieTerm.app

# Verify
codesign --verify --verbose release/GenieTerm.app

# Notarize
xcrun notarytool submit release/GenieTerm-*.dmg \
  --apple-id "your@email.com" \
  --team-id "TEAM_ID" \
  --password "app-specific-password"
```

## Distribution

### GitHub Releases
Standard approach. Users download DMG from releases page.

### Homebrew Cask

Create a cask formula:

```ruby
cask "genieterm" do
  version "1.0.0"
  sha256 "..."

  url "https://github.com/user/GenieTerm/releases/download/v#{version}/GenieTerm-#{version}.dmg"
  name "GenieTerm"
  desc "Modern terminal for macOS"
  homepage "https://github.com/user/GenieTerm"

  app "GenieTerm.app"
end
```

### Mac App Store
Requires Apple Developer Program ($99/year) and app review.

## Development

### Requirements

- macOS 13.0+
- Rust 1.70+
- Swift 5.9+
- Xcode Command Line Tools

### Project Structure

```
GenieTerm/
├── src/                    # Rust core
│   ├── engine.rs
│   ├── ffi.rs
│   └── terminal/
├── native/GenieTerm/       # Swift UI
│   └── Sources/
│       ├── GenieTerm/      # Swift code
│       └── CGenieTerm/     # C headers
├── assets/                 # Icons, images
├── .github/workflows/      # CI/CD
└── build_release.sh        # Release script
```

### FFI Contract

Swift calls these C functions:

- `genieterm_create(cols, rows)` - Initialize
- `genieterm_destroy(handle)` - Cleanup
- `genieterm_send_command(handle, cmd)` - Send command
- `genieterm_send_input(handle, bytes, len)` - Send raw input
- `genieterm_resize(handle, cols, rows)` - Resize terminal
- `genieterm_poll_snapshot_json(handle)` - Get state as JSON
- `genieterm_free_string(ptr)` - Free C strings

### Design Principles

1. **UI in Swift, logic in Rust** - Keep platform code separate from core logic
2. **Minimal FFI surface** - JSON snapshots reduce complexity
3. **Native feel** - Use SwiftUI patterns, not web-style UI
4. **Performance** - Rust handles heavy lifting, Swift handles rendering

## Testing

```bash
# Run Rust tests
cargo test

# Run Swift tests
cd native/GenieTerm
swift test
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

Keep changes focused and well-documented.
