import Foundation
import CGenieTerm
import SwiftUI

enum MouseTrackingMode: UInt8 {
    case off = 0
    case click = 1
    case drag = 2
    case motion = 3

    var supportsPress: Bool { self != .off }
    var supportsDrag: Bool { self == .drag || self == .motion }
    var supportsMotion: Bool { self == .motion }
}

final class TerminalBridge: ObservableObject {
    @Published private(set) var snapshot: TerminalSnapshot = .empty
    @Published private(set) var snapshotVersion: UInt64 = 0
    @Published private(set) var statusMessage: String = "Disconnected"
    @Published private(set) var bracketedPasteEnabled = false
    @Published private(set) var mouseTrackingMode: MouseTrackingMode = .off
    @Published private(set) var mouseSGREnabled = false
    @Published private(set) var focusReportingEnabled = false
    @Published var windowTitle: String = ""
    @Published var workingDirectory: String?

    private var handle: UnsafeMutablePointer<GenieTermHandle>?
    private var timer: Timer?
    private var lastSnapshotVersion: UInt64 = 0
    private var lastContentChangeAt = Date()
    private var pollingInterval: TimeInterval = 0
    private var scrollbackViewportEnabled = false
    private var latestVisibleSnapshot: TerminalSnapshot = .empty

    private let activePollingInterval: TimeInterval = 1.0 / 30.0
    private let idlePollingInterval: TimeInterval = 0.1
    private let idleSwitchDelay: TimeInterval = 1.0
    private let scrollbackContextLineLimit: Int = 1200
    private let decoder = JSONDecoder()

    init() {
        // Initialize with home directory
        workingDirectory = FileManager.default.homeDirectoryForCurrentUser.path
        updateWindowTitle()
        start()
    }

    deinit {
        stop()
    }

    func start(cols: UInt16 = 120, rows: UInt16 = 50) {
        stop()
        handle = genieterm_create(cols, rows)
        statusMessage = handle == nil ? "Failed to initialize PTY" : "Connected"
        lastSnapshotVersion = 0
        lastContentChangeAt = Date()
        beginPolling()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        pollingInterval = 0
        statusMessage = "Disconnected"
        snapshot = .empty
        snapshotVersion = 0
        bracketedPasteEnabled = false
        mouseTrackingMode = .off
        mouseSGREnabled = false
        focusReportingEnabled = false
        lastSnapshotVersion = 0
        lastContentChangeAt = Date()
        scrollbackViewportEnabled = false
        latestVisibleSnapshot = .empty

        if let handle {
            genieterm_destroy(handle)
            self.handle = nil
        }
    }

    func send(command: String) {
        let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard let handle else { return }

        // Track directory changes
        if trimmed.hasPrefix("cd ") {
            let path = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
            updateWorkingDirectory(path)
        }

        trimmed.withCString { cString in
            genieterm_send_command(handle, cString)
        }
    }

    func clearScreen() {
        send(command: "clear")
    }

    func interrupt() {
        sendRaw([3]) // Ctrl+C
    }

    func sendRaw(_ bytes: [UInt8]) {
        guard let handle else { return }
        guard !bytes.isEmpty else { return }

        bytes.withUnsafeBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            genieterm_send_input(handle, base, buffer.count)
        }
    }

    func sendPaste(_ text: String) {
        guard !text.isEmpty else { return }

        var payload = Array(text.utf8)
        if bracketedPasteEnabled {
            let start: [UInt8] = [0x1B, 0x5B, 0x32, 0x30, 0x30, 0x7E] // \e[200~
            let end:   [UInt8] = [0x1B, 0x5B, 0x32, 0x30, 0x31, 0x7E] // \e[201~
            payload = start + payload + end
        }

        sendRaw(payload)
    }

    func sendFocusEvent(focused: Bool) {
        guard focusReportingEnabled else { return }
        sendRaw(focused ? [27, 91, 73] : [27, 91, 79]) // CSI I / CSI O
    }

    func resize(cols: UInt16, rows: UInt16) {
        guard let handle else { return }
        genieterm_resize(handle, cols, rows)
    }

    func setScrollbackViewportEnabled(_ enabled: Bool) {
        guard scrollbackViewportEnabled != enabled else { return }
        scrollbackViewportEnabled = enabled

        guard handle != nil else { return }

        if enabled {
            snapshot = snapshotWithRecentScrollback(from: latestVisibleSnapshot)
        }
    }

    private func beginPolling() {
        schedulePollingTimer(interval: activePollingInterval)
    }

    private func poll() {
        guard let handle else { return }

        let version = genieterm_snapshot_version(handle)
        if version == lastSnapshotVersion {
            if Date().timeIntervalSince(lastContentChangeAt) >= idleSwitchDelay {
                schedulePollingTimer(interval: idlePollingInterval)
            }
            return
        }

        lastSnapshotVersion = version
        snapshotVersion = version
        lastContentChangeAt = Date()
        schedulePollingTimer(interval: activePollingInterval)
        bracketedPasteEnabled = genieterm_bracketed_paste_enabled(handle) != 0
        mouseTrackingMode = MouseTrackingMode(rawValue: genieterm_mouse_tracking_mode(handle)) ?? .off
        mouseSGREnabled = genieterm_mouse_sgr_enabled(handle) != 0
        focusReportingEnabled = genieterm_focus_reporting_enabled(handle) != 0

        guard let cString = genieterm_poll_snapshot_json(handle) else { return }
        defer { genieterm_free_string(cString) }

        let payload = String(cString: cString)

        guard let data = payload.data(using: .utf8) else {
            statusMessage = "Snapshot encoding error"
            return
        }

        do {
            let nextSnapshot = try decoder.decode(TerminalSnapshot.self, from: data)
            latestVisibleSnapshot = nextSnapshot
            if scrollbackViewportEnabled {
                // Keep the viewport stable while user is reading history.
                // We only refresh the merged history snapshot when toggling modes.
            } else {
                snapshot = nextSnapshot
            }
            statusMessage = "Connected"
        } catch {
            statusMessage = "Snapshot decode error: \(error)"
        }
    }

    private func snapshotWithRecentScrollback(from visible: TerminalSnapshot) -> TerminalSnapshot {
        guard let handle else {
            return visible
        }

        guard let cString = genieterm_recent_scrollback_json(handle, scrollbackContextLineLimit) else {
            return visible
        }
        defer { genieterm_free_string(cString) }

        let payload = String(cString: cString)
        guard let data = payload.data(using: .utf8) else {
            return visible
        }

        guard let chunk = try? decoder.decode(TerminalScrollbackChunk.self, from: data) else {
            return visible
        }

        guard !chunk.lines.isEmpty else {
            return visible
        }

        let combinedLines = chunk.lines + visible.lines
        let combinedCursorRow = min(Int(visible.cursor_row) + chunk.lines.count, Int(UInt16.max))

        return TerminalSnapshot(
            rows: visible.rows,
            cols: visible.cols,
            cursor_row: UInt16(combinedCursorRow),
            cursor_col: visible.cursor_col,
            lines: combinedLines
        )
    }

    private func schedulePollingTimer(interval: TimeInterval) {
        guard timer == nil || abs(pollingInterval - interval) > 0.000_1 else {
            return
        }

        timer?.invalidate()
        pollingInterval = interval
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            self?.poll()
        }
        timer?.tolerance = interval * 0.2

        if let timer {
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    private func updateWindowTitle() {
        let userName = NSUserName()
        let hostName = ProcessInfo.processInfo.hostName.components(separatedBy: ".").first ?? "localhost"
        windowTitle = "\(userName) — \(hostName)"
    }

    private func updateWorkingDirectory(_ path: String) {
        let fileManager = FileManager.default

        // Handle special cases
        if path == "~" {
            workingDirectory = fileManager.homeDirectoryForCurrentUser.path
            return
        }

        if path.hasPrefix("~/") {
            let relativePath = String(path.dropFirst(2))
            workingDirectory = (fileManager.homeDirectoryForCurrentUser.path as NSString)
                .appendingPathComponent(relativePath)
            return
        }

        if path.hasPrefix("/") {
            // Absolute path
            workingDirectory = path
            return
        }

        // Relative path
        if let currentDir = workingDirectory {
            workingDirectory = (currentDir as NSString).appendingPathComponent(path)
        }
    }
}

private struct TerminalScrollbackChunk: Decodable {
    let total: Int
    let start: Int
    let lines: [TerminalLine]
}
