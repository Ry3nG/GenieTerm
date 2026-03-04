# GenieTerm Optimization Roadmap

## Overview

This document outlines potential improvements and optimizations for GenieTerm, organized by priority and implementation complexity. Each item includes estimated effort and impact.

---

## 🔥 High Priority - Quick Wins

### 1. Command History Persistence
**Effort:** Low | **Impact:** High

Currently, command history is lost when the app closes. Implement persistent storage:

- Save command history to `~/Library/Application Support/GenieTerm/history.json`
- Load on startup
- Configurable history size (default: 1000 commands)
- Search through history with Cmd+R (reverse search like bash)

**Implementation:**
- Add `HistoryManager` class in Swift
- Use `UserDefaults` or JSON file storage
- Hook into `ImprovedDialogView` to save/load

### 2. Keyboard Shortcuts
**Effort:** Low | **Impact:** High

Add essential keyboard shortcuts:

- `Cmd+T` - New tab/window
- `Cmd+W` - Close tab/window
- `Cmd+K` - Clear screen
- `Cmd+F` - Find in output
- `Cmd+,` - Preferences
- `Cmd+Up/Down` - Navigate command history
- `Ctrl+C` - Interrupt (already works, but add visual feedback)

**Implementation:**
- Add `.keyboardShortcut()` modifiers in SwiftUI
- Create `KeyboardShortcutHandler` to centralize logic

### 3. Copy/Paste Improvements
**Effort:** Low | **Impact:** Medium

- Right-click context menu with Copy/Paste
- Copy selected text from terminal output
- Paste with Cmd+V (currently works, but add visual feedback)
- Smart paste: detect multi-line and ask for confirmation

**Implementation:**
- Add `NSTextView` selection support in `TerminalTextView`
- Implement context menu with `NSMenu`

### 4. Visual Feedback for Running Commands
**Effort:** Low | **Impact:** Medium

- Show spinner/progress indicator when command is executing
- Highlight the currently running command block
- Show elapsed time for long-running commands
- Add "Stop" button to send Ctrl+C

**Implementation:**
- Track command execution state in `CommandBlock`
- Add timer to measure duration
- Update UI with animation

---

## 🎯 Medium Priority - Core Features

### 5. Tab Support
**Effort:** Medium | **Impact:** High

Multiple terminal sessions in tabs:

- Tab bar at the top
- Cmd+T to create new tab
- Cmd+1-9 to switch tabs
- Drag to reorder tabs
- Each tab has independent PTY and history

**Implementation:**
- Create `TabManager` to manage multiple `TerminalBridge` instances
- Update `ContentView` with `TabView`
- Handle PTY lifecycle per tab

### 6. Split Panes
**Effort:** Medium | **Impact:** High

Split terminal into multiple panes:

- Cmd+D - Split horizontally
- Cmd+Shift+D - Split vertically
- Cmd+[ / Cmd+] - Navigate between panes
- Drag divider to resize
- Close pane with Cmd+W

**Implementation:**
- Create `PaneManager` with tree structure
- Use `HSplitView` / `VSplitView` in SwiftUI
- Each pane has its own `TerminalBridge`

### 7. Search in Output
**Effort:** Medium | **Impact:** Medium

Find text in terminal output:

- Cmd+F to open search bar
- Highlight all matches
- Next/Previous navigation
- Regex support
- Case-sensitive toggle

**Implementation:**
- Add search bar overlay in `ContentView`
- Implement search in `TerminalSnapshot`
- Highlight matches in `TerminalTextView`

### 8. Themes and Customization
**Effort:** Medium | **Impact:** Medium

Customizable appearance:

- Built-in themes (Dracula, Solarized, Nord, etc.)
- Custom color schemes
- Font selection and size
- Background opacity
- Cursor style (block, underline, bar)

**Implementation:**
- Create `Theme` struct with color definitions
- Add `ThemeManager` for loading/saving
- Preferences window with theme picker
- Store in `UserDefaults`

### 9. Smart Suggestions
**Effort:** Medium | **Impact:** Medium

Context-aware command suggestions:

- Suggest based on current directory (e.g., `npm` commands in Node projects)
- Learn from frequently used commands
- Suggest flags and options for common commands
- Show command descriptions/help

**Implementation:**
- Extend `CommandCompletion` with context awareness
- Add command database (JSON file with common commands)
- Machine learning for personalized suggestions (optional)

---

## 🚀 Advanced Features

### 10. AI Integration
**Effort:** High | **Impact:** High

Integrate AI assistance:

- Cmd+Shift+A - Ask AI about command/error
- Explain command before running
- Suggest fixes for errors
- Natural language to command conversion
- "What does this command do?"

**Implementation:**
- Add OpenAI/Anthropic API integration
- Create `AIAssistant` service
- Add UI for AI chat/suggestions
- Privacy: make it opt-in, allow local models

### 11. Session Recording and Playback
**Effort:** High | **Impact:** Medium

Record and replay terminal sessions:

- Record all input/output
- Save as `.cast` file (asciinema format)
- Playback with speed control
- Share recordings
- Export to GIF/video

**Implementation:**
- Add `SessionRecorder` to capture PTY I/O
- Implement asciinema format writer
- Create playback UI with timeline
- Use `AVFoundation` for video export

### 12. Remote SSH Sessions
**Effort:** High | **Impact:** High

Built-in SSH client:

- Connect to remote servers
- Save connection profiles
- Key-based authentication
- Port forwarding
- SFTP integration for file transfer

**Implementation:**
- Integrate `libssh2` or use `ssh` command
- Create connection manager UI
- Store credentials securely in Keychain
- Handle connection lifecycle

### 13. Command Palette
**Effort:** Medium | **Impact:** Medium

Warp-style command palette:

- Cmd+K to open
- Fuzzy search for commands
- Recent commands
- Saved snippets
- Quick actions (clear, split, new tab, etc.)

**Implementation:**
- Create overlay UI with search
- Implement fuzzy matching algorithm
- Add command registry
- Keyboard navigation

### 14. Notifications and Alerts
**Effort:** Low | **Impact:** Low

Notify when long-running commands complete:

- macOS notification when command finishes
- Configurable threshold (e.g., notify if > 10 seconds)
- Sound alert option
- Badge on dock icon

**Implementation:**
- Use `UNUserNotificationCenter`
- Track command duration
- Request notification permissions

---

## 🎨 UI/UX Improvements

### 15. Smooth Scrolling
**Effort:** Low | **Impact:** Medium

Improve scrolling experience:

- Momentum scrolling
- Smooth animation
- Scroll to bottom on new output
- "Jump to bottom" button when scrolled up

**Implementation:**
- Optimize `TerminalTextView` rendering
- Add scroll position tracking
- Implement auto-scroll logic

### 16. Minimap
**Effort:** Medium | **Impact:** Low

VSCode-style minimap for long output:

- Show overview of entire buffer
- Click to jump to position
- Highlight search results
- Show current viewport

**Implementation:**
- Create minimap view with scaled-down text
- Render in separate view
- Update on scroll/output changes

### 17. Status Bar
**Effort:** Low | **Impact:** Low

Bottom status bar showing:

- Current directory
- Git branch (if in repo)
- Command execution time
- Cursor position (row, col)
- Encoding

**Implementation:**
- Add status bar view at bottom
- Parse git info from shell
- Update on directory change

### 18. Welcome Screen
**Effort:** Low | **Impact:** Low

First-run experience:

- Welcome message
- Quick tutorial
- Keyboard shortcuts reference
- Sample commands to try

**Implementation:**
- Show on first launch
- Store flag in `UserDefaults`
- Create onboarding UI

---

## 🔧 Technical Improvements

### 19. Performance Optimization
**Effort:** Medium | **Impact:** High

Optimize for large outputs:

- Virtual scrolling (only render visible lines)
- Incremental rendering
- Buffer size limits with circular buffer
- Lazy loading of history

**Implementation:**
- Refactor `TerminalTextView` with virtual scrolling
- Optimize `ScreenBuffer` in Rust
- Profile and benchmark

### 20. Better ANSI Support
**Effort:** Medium | **Impact:** Medium

Improve terminal compatibility:

- Support more ANSI escape sequences
- Hyperlinks (OSC 8)
- Images (iTerm2 inline images)
- Sixel graphics
- True color (24-bit)

**Implementation:**
- Extend `parser.rs` with more sequences
- Add image rendering in Swift
- Test with various CLI tools

### 21. Shell Integration
**Effort:** Medium | **Impact:** High

Deep shell integration:

- Detect command boundaries
- Show exit codes
- Jump between commands
- Semantic history (know what's a command vs output)

**Implementation:**
- Inject shell hooks (like iTerm2 shell integration)
- Parse shell prompts
- Track command execution

### 22. Plugin System
**Effort:** High | **Impact:** Medium

Extensibility via plugins:

- JavaScript/Lua plugin API
- Custom commands
- UI extensions
- Theme plugins
- Share plugins via registry

**Implementation:**
- Embed JavaScript engine (JavaScriptCore)
- Define plugin API
- Create plugin manager
- Sandbox for security

---

## 📊 Analytics and Insights

### 23. Command Analytics
**Effort:** Low | **Impact:** Low

Track usage patterns (privacy-respecting):

- Most used commands
- Time spent in terminal
- Command success/failure rates
- Productivity insights

**Implementation:**
- Local-only analytics (no telemetry)
- Store in SQLite database
- Visualization dashboard

### 24. Error Detection
**Effort:** Medium | **Impact:** Medium

Smart error handling:

- Detect common errors (command not found, permission denied)
- Suggest fixes
- Link to documentation
- Stack Overflow integration

**Implementation:**
- Pattern matching on stderr
- Error database with solutions
- Web search integration

---

## 🔐 Security and Privacy

### 25. Secure Input
**Effort:** Low | **Impact:** High

Protect sensitive data:

- Mask password input
- Don't save sensitive commands to history
- Detect API keys and warn
- Secure clipboard handling

**Implementation:**
- Detect password prompts
- Pattern matching for secrets
- Add "sensitive mode" toggle

### 26. Sandboxing
**Effort:** High | **Impact:** Medium

macOS App Sandbox support:

- Enable sandbox for App Store distribution
- Request necessary entitlements
- Handle file access properly

**Implementation:**
- Update entitlements
- Test with sandbox enabled
- Handle permission requests

---

## 🌐 Cloud and Sync

### 27. Settings Sync
**Effort:** Medium | **Impact:** Low

Sync settings across devices:

- iCloud sync for preferences
- Command history sync
- Theme sync
- SSH profiles sync

**Implementation:**
- Use `NSUbiquitousKeyValueStore`
- CloudKit for larger data
- Conflict resolution

### 28. Snippet Library
**Effort:** Medium | **Impact:** Medium

Save and share command snippets:

- Local snippet storage
- Tags and categories
- Variables/placeholders
- Share via URL or file

**Implementation:**
- Create snippet manager
- UI for browsing/editing
- Export/import functionality

---

## 📱 Platform Expansion

### 29. iOS/iPadOS Version
**Effort:** Very High | **Impact:** High

Mobile terminal app:

- Shared Rust core
- SwiftUI for iOS
- Touch-optimized UI
- External keyboard support

**Implementation:**
- Make Rust core platform-agnostic
- Create iOS target
- Adapt UI for mobile

### 30. Linux/Windows Support
**Effort:** Very High | **Impact:** Medium

Cross-platform terminal:

- Keep Rust core
- Platform-specific UI (GTK/WPF)
- Or use cross-platform framework (Tauri, Flutter)

**Implementation:**
- Abstract platform-specific code
- Create platform layers
- Test on each platform

---

## 📝 Implementation Priority Matrix

### Phase 1 (v0.2.0) - Quick Wins
- Command history persistence
- Keyboard shortcuts
- Copy/paste improvements
- Visual feedback for running commands

### Phase 2 (v0.3.0) - Core Features
- Tab support
- Themes and customization
- Search in output
- Smart suggestions

### Phase 3 (v0.4.0) - Advanced
- Split panes
- Command palette
- Shell integration
- Performance optimization

### Phase 4 (v0.5.0+) - Future
- AI integration
- Remote SSH
- Plugin system
- Session recording

---

## 🎯 Success Metrics

Track these to measure improvement:

- **Performance:** Time to render 10,000 lines
- **Usability:** Keyboard shortcut usage rate
- **Stability:** Crash-free sessions
- **Adoption:** GitHub stars, downloads
- **Engagement:** Daily active users, session duration

---

## 🤝 Community Contributions

Encourage contributions:

- Label issues as "good first issue"
- Create contribution guidelines
- Set up CI/CD for PRs
- Code review process
- Recognition for contributors

---

## 📚 Documentation Needs

- User guide with screenshots
- Keyboard shortcuts reference
- API documentation for plugins
- Architecture overview
- Contributing guide
- FAQ

---

## 🔄 Continuous Improvement

Regular maintenance:

- Update dependencies
- Fix bugs reported by users
- Performance profiling
- Security audits
- Accessibility improvements
- Localization (i18n)

---

*This roadmap is a living document. Priorities may change based on user feedback and technical constraints.*
