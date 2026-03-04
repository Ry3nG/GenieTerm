import Foundation
import CGenieTerm
import SwiftUI

final class TerminalBridge: ObservableObject {
    @Published private(set) var snapshot: TerminalSnapshot = .empty
    @Published private(set) var statusMessage: String = "Disconnected"
    @Published var windowTitle: String = ""
    @Published var workingDirectory: String?

    private var handle: UnsafeMutablePointer<GenieTermHandle>?
    private var timer: Timer?
    private var lastPayload: String = ""
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
        beginPolling()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        statusMessage = "Disconnected"
        snapshot = .empty
        lastPayload = ""

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

    func resize(cols: UInt16, rows: UInt16) {
        guard let handle else { return }
        genieterm_resize(handle, cols, rows)
    }

    private func beginPolling() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.033, repeats: true) { [weak self] _ in
            self?.poll()
        }
        if let timer {
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    private func poll() {
        guard let handle else { return }

        guard let cString = genieterm_poll_snapshot_json(handle) else { return }
        defer { genieterm_free_string(cString) }

        let payload = String(cString: cString)
        if payload == lastPayload {
            return
        }
        lastPayload = payload

        guard let data = payload.data(using: .utf8) else {
            statusMessage = "Snapshot encoding error"
            return
        }

        do {
            let nextSnapshot = try decoder.decode(TerminalSnapshot.self, from: data)
            snapshot = nextSnapshot
            statusMessage = "Connected"
        } catch {
            statusMessage = "Snapshot decode error: \(error)"
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
