import SwiftUI

struct ContentView: View {
    @EnvironmentObject var terminal: TerminalBridge
    @State private var commandInput: String = ""
    @FocusState private var inputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // 终端输出区域
            terminalView

            // 分隔线
            Divider()

            // 命令输入区域
            commandInputArea
        }
        .frame(minWidth: 600, minHeight: 400)
        .navigationTitle(terminal.windowTitle)
    }

    private var terminalView: some View {
        GeometryReader { geometry in
            TerminalTextView(snapshot: terminal.snapshot)
                .environmentObject(terminal)
                .background(Color(nsColor: .textBackgroundColor))
                .onAppear {
                    updateGridSize(from: geometry.size)
                }
                .onChange(of: geometry.size) { newValue in
                    updateGridSize(from: newValue)
                }
        }
    }

    private var commandInputArea: some View {
        ImprovedDialogView(
            commandInput: $commandInput,
            inputFocused: $inputFocused,
            onSubmit: submitCommand,
            onTab: handleTab
        )
        .environmentObject(terminal)
        .onAppear {
            inputFocused = true
        }
    }

    private func submitCommand() {
        let trimmed = commandInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        terminal.send(command: trimmed)
        commandInput = ""
        inputFocused = true
    }

    private func handleTab() {
        // 发送 Tab 键到终端进行自动补全
        terminal.sendRaw([9]) // Tab = ASCII 9
    }

    private func updateGridSize(from size: CGSize) {
        let font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        let charWidth = font.advancement(forGlyph: font.glyph(withName: "M")).width
        let layoutManager = NSLayoutManager()
        let lineHeight = layoutManager.defaultLineHeight(for: font)

        let horizontalInset: CGFloat = 32.0
        let verticalInset: CGFloat = 32.0

        let availableWidth = max(0, size.width - horizontalInset)
        let availableHeight = max(0, size.height - verticalInset)

        let cols = UInt16(max(80, Int(availableWidth / charWidth)))
        let rows = UInt16(max(24, Int(availableHeight / lineHeight)))

        terminal.resize(cols: cols, rows: rows)
    }
}

// 自定义 TextField 支持 Tab 键
struct CommandTextField: NSViewRepresentable {
    @Binding var text: String
    let onSubmit: () -> Void
    let onTab: () -> Void

    func makeNSView(context: Context) -> NSTextField {
        let textField = CustomNSTextField()
        textField.delegate = context.coordinator
        textField.placeholderString = "Type a command..."
        textField.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        textField.isBordered = false
        textField.focusRingType = .none
        textField.backgroundColor = .clear
        return textField
    }

    func updateNSView(_ nsView: NSTextField, context: Context) {
        nsView.stringValue = text
        context.coordinator.onSubmit = onSubmit
        context.coordinator.onTab = onTab
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, onSubmit: onSubmit, onTab: onTab)
    }

    class Coordinator: NSObject, NSTextFieldDelegate {
        @Binding var text: String
        var onSubmit: () -> Void
        var onTab: () -> Void

        init(text: Binding<String>, onSubmit: @escaping () -> Void, onTab: @escaping () -> Void) {
            _text = text
            self.onSubmit = onSubmit
            self.onTab = onTab
        }

        func controlTextDidChange(_ obj: Notification) {
            if let textField = obj.object as? NSTextField {
                text = textField.stringValue
            }
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            if commandSelector == #selector(NSResponder.insertTab(_:)) {
                onTab()
                return true
            }
            return false
        }
    }
}

class CustomNSTextField: NSTextField {
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.keyCode == 48 { // Tab key
            return false // Let delegate handle it
        }
        return super.performKeyEquivalent(with: event)
    }
}
