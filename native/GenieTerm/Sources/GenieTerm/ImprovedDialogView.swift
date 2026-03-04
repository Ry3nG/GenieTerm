import SwiftUI

/// Enhanced command input area with Warp-like features
struct ImprovedDialogView: View {
    @EnvironmentObject var terminal: TerminalBridge
    @Binding var commandInput: String
    @FocusState.Binding var inputFocused: Bool

    @State private var commandHistory: [CommandBlock] = []
    @State private var showSuggestions = false
    @State private var historyIndex: Int? = nil
    @State private var isMultiline = false
    @State private var completions: [String] = []
    @State private var showCompletions = false

    let onSubmit: () -> Void
    let onTab: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Command history blocks
            if !commandHistory.isEmpty {
                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(commandHistory.suffix(5)) { block in
                            CommandBlockView(
                                block: block,
                                onRerun: { rerunCommand(block.command) },
                                onEdit: { editCommand(block.command) }
                            )
                        }
                    }
                    .padding(.vertical, 8)
                }
                .frame(maxHeight: 150)
                .background(Color(nsColor: .controlBackgroundColor).opacity(0.5))

                Divider()
            }

            // Main input area
            HStack(alignment: isMultiline ? .top : .center, spacing: 12) {
                // Prompt indicator
                Text(">")
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .foregroundColor(.blue)
                    .padding(.top, isMultiline ? 8 : 0)

                // Input field
                if isMultiline {
                    MultilineCommandInput(
                        text: $commandInput,
                        onSubmit: handleSubmit,
                        onCancel: { isMultiline = false }
                    )
                    .focused($inputFocused)
                } else {
                    CommandTextField(
                        text: $commandInput,
                        onSubmit: handleSubmit,
                        onTab: handleTabCompletion
                    )
                    .focused($inputFocused)
                    .onChange(of: commandInput) { _ in
                        showCompletions = false
                    }
                }

                // Action buttons
                HStack(spacing: 8) {
                    // Multiline toggle
                    Button(action: { isMultiline.toggle() }) {
                        Image(systemName: isMultiline ? "text.alignleft" : "text.aligncenter")
                            .font(.system(size: 16))
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help(isMultiline ? "Single line mode" : "Multi-line mode (Shift+Enter)")

                    // Submit button
                    if !commandInput.isEmpty {
                        Button(action: handleSubmit) {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 20))
                                .foregroundStyle(.blue)
                        }
                        .buttonStyle(.plain)
                        .keyboardShortcut(.return, modifiers: [])
                    }
                }
                .padding(.top, isMultiline ? 8 : 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color(nsColor: .controlBackgroundColor))

            // Suggestions bar
            if showSuggestions && !commandInput.isEmpty {
                suggestionsView
            }

            // Completions popup
            if showCompletions && !completions.isEmpty {
                completionsView
            }
        }
    }

    private var suggestionsView: some View {
        HStack(spacing: 8) {
            Text("Suggestions:")
                .font(.system(size: 11))
                .foregroundColor(.secondary)

            // Show recent matching commands
            ForEach(filteredSuggestions, id: \.self) { suggestion in
                Button(action: { commandInput = suggestion }) {
                    Text(suggestion)
                        .font(.system(size: 11, design: .monospaced))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(4)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.8))
    }

    private var completionsView: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Tab completions:")
                .font(.system(size: 11))
                .foregroundColor(.secondary)
                .padding(.horizontal, 16)
                .padding(.top, 8)

            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(completions.prefix(10), id: \.self) { completion in
                        Button(action: { applyCompletion(completion) }) {
                            HStack {
                                Text(completion)
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundColor(.primary)
                                Spacer()
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 4)
                            .background(Color.clear)
                        }
                        .buttonStyle(.plain)
                        .onHover { hovering in
                            if hovering {
                                NSCursor.pointingHand.push()
                            } else {
                                NSCursor.pop()
                            }
                        }
                    }
                }
            }
            .frame(maxHeight: 200)
        }
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(6)
        .shadow(radius: 4)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private var filteredSuggestions: [String] {
        let unique = Array(Set(commandHistory.map { $0.command }))
        return unique.filter { $0.lowercased().contains(commandInput.lowercased()) }
            .prefix(3)
            .map { $0 }
    }

    private func handleSubmit() {
        let trimmed = commandInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Add to history
        let block = CommandBlock(command: trimmed, timestamp: Date(), isExecuting: true)
        commandHistory.append(block)

        // Execute
        onSubmit()

        // Mark as completed after a short delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            if let index = commandHistory.firstIndex(where: { $0.id == block.id }) {
                commandHistory[index].isExecuting = false
            }
        }

        isMultiline = false
    }

    private func rerunCommand(_ command: String) {
        commandInput = command
        handleSubmit()
    }

    private func editCommand(_ command: String) {
        commandInput = command
        inputFocused = true
    }

    private func handleTabCompletion() {
        // Get current working directory from terminal
        let workingDir = terminal.workingDirectory ?? FileManager.default.currentDirectoryPath

        // Get completions
        completions = CommandCompletion.getCompletions(for: commandInput, workingDirectory: workingDir)

        if completions.isEmpty {
            // No completions, do nothing
            showCompletions = false
        } else if completions.count == 1 {
            // Single completion, apply it directly
            applyCompletion(completions[0])
            showCompletions = false
        } else {
            // Multiple completions, show them
            // Try to auto-complete common prefix
            if let commonPrefix = CommandCompletion.commonPrefix(of: completions) {
                let currentLastToken = commandInput.split(separator: " ").last.map(String.init) ?? ""
                if commonPrefix.count > currentLastToken.count {
                    commandInput = CommandCompletion.applyCompletion(commonPrefix, to: commandInput)
                }
            }
            showCompletions = true
        }
    }

    private func applyCompletion(_ completion: String) {
        commandInput = CommandCompletion.applyCompletion(completion, to: commandInput)
        showCompletions = false
        inputFocused = true
    }
}

/// Multi-line text editor for complex commands
struct MultilineCommandInput: NSViewRepresentable {
    @Binding var text: String
    let onSubmit: () -> Void
    let onCancel: () -> Void

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSTextView.scrollableTextView()
        let textView = scrollView.documentView as! NSTextView

        textView.delegate = context.coordinator
        textView.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        textView.isRichText = false
        textView.backgroundColor = .clear
        textView.textContainerInset = NSSize(width: 4, height: 4)

        return scrollView
    }

    func updateNSView(_ nsView: NSScrollView, context: Context) {
        let textView = nsView.documentView as! NSTextView
        if textView.string != text {
            textView.string = text
        }
        context.coordinator.onSubmit = onSubmit
        context.coordinator.onCancel = onCancel
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, onSubmit: onSubmit, onCancel: onCancel)
    }

    class Coordinator: NSObject, NSTextViewDelegate {
        @Binding var text: String
        var onSubmit: () -> Void
        var onCancel: () -> Void

        init(text: Binding<String>, onSubmit: @escaping () -> Void, onCancel: @escaping () -> Void) {
            _text = text
            self.onSubmit = onSubmit
            self.onCancel = onCancel
        }

        func textDidChange(_ notification: Notification) {
            if let textView = notification.object as? NSTextView {
                text = textView.string
            }
        }

        func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            if commandSelector == #selector(NSResponder.insertNewline(_:)) {
                // Cmd+Enter to submit
                if NSEvent.modifierFlags.contains(.command) {
                    onSubmit()
                    return true
                }
            } else if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
                onCancel()
                return true
            }
            return false
        }
    }
}
