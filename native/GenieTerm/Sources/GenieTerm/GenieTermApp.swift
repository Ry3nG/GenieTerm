import AppKit
import SwiftUI

final class GenieTermAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        // 设置应用图标
        loadAppIcon()

        if let window = NSApp.windows.first {
            window.titlebarAppearsTransparent = false
            window.titleVisibility = .visible
            window.backgroundColor = NSColor.windowBackgroundColor
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func loadAppIcon() {
        // 尝试多种方式加载图标

        // 方法 1: 从 Bundle.module 加载
        if let iconURL = Bundle.module.url(forResource: "AppIcon", withExtension: "png"),
           let icon = NSImage(contentsOf: iconURL) {
            NSApp.applicationIconImage = icon
            print("✅ App icon loaded from Bundle.module")
            return
        }

        // 方法 2: 从 bundle 中的 appiconset 加载
        if let iconURL = Bundle.module.url(forResource: "icon_512x512@2x", withExtension: "png"),
           let icon = NSImage(contentsOf: iconURL) {
            NSApp.applicationIconImage = icon
            print("✅ App icon loaded from appiconset")
            return
        }

        // 方法 3: 从项目 assets 目录加载（开发时）
        let projectIcon = "/Users/zerui/iSpace/Code/GenieTerm/assets/avatar.png"
        if let icon = NSImage(contentsOfFile: projectIcon) {
            NSApp.applicationIconImage = icon
            print("✅ App icon loaded from assets")
            return
        }

        print("⚠️ Failed to load app icon from all sources")
    }
}

@main
struct GenieTermApp: App {
    @NSApplicationDelegateAdaptor(GenieTermAppDelegate.self) private var appDelegate
    @StateObject private var terminal = TerminalBridge()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(terminal)
        }
        .windowStyle(.automatic)
        .commands {
            CommandGroup(replacing: .newItem) {}

            CommandGroup(replacing: .help) {
                Button("GenieTerm Help") {
                    if let url = URL(string: "https://github.com/yourusername/genieterm") {
                        NSWorkspace.shared.open(url)
                    }
                }
                .keyboardShortcut("?", modifiers: .command)
            }

            CommandMenu("Shell") {
                Button("Interrupt (^C)") {
                    terminal.interrupt()
                }
                .keyboardShortcut("c", modifiers: [.command])

                Button("Clear Screen") {
                    terminal.clearScreen()
                }
                .keyboardShortcut("k", modifiers: [.command])

                Divider()

                Button("Restart Shell") {
                    terminal.start()
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])
            }
        }
    }
}
