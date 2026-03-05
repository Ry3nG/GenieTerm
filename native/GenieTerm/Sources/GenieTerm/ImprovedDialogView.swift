import SwiftUI

/// Minimal command input area: single-line shell style with keyboard history navigation.
struct ImprovedDialogView: View {
    @EnvironmentObject var terminal: TerminalBridge
    @Binding var commandInput: String
    @FocusState.Binding var inputFocused: Bool

    @State private var commandHistory: [String] = []
    @State private var historyIndex: Int? = nil
    @State private var historyDraft: String = ""
    @State private var isApplyingHistory = false
    @State private var completions: [String] = []
    @State private var showCompletions = false

    let onSubmit: () -> Void
    let onTab: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                Text(">")
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .foregroundColor(.blue)

                CommandTextField(
                    text: $commandInput,
                    onSubmit: handleSubmit,
                    onTab: handleTabCompletion,
                    onHistoryUp: navigateHistoryUp,
                    onHistoryDown: navigateHistoryDown
                )
                .focused($inputFocused)
                .onChange(of: commandInput) { _ in
                    showCompletions = false
                    if isApplyingHistory {
                        isApplyingHistory = false
                    } else {
                        historyIndex = nil
                    }
                }

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
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color(nsColor: .controlBackgroundColor))

            if showCompletions && !completions.isEmpty {
                completionsView
            }
        }
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

    private func handleSubmit() {
        let trimmed = commandInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        commandHistory.append(trimmed)
        historyIndex = nil
        historyDraft = ""
        showCompletions = false

        onSubmit()
    }

    private func handleTabCompletion() {
        let workingDir = terminal.workingDirectory ?? FileManager.default.currentDirectoryPath
        completions = CommandCompletion.getCompletions(for: commandInput, workingDirectory: workingDir)

        if completions.isEmpty {
            showCompletions = false
        } else if completions.count == 1 {
            applyCompletion(completions[0])
            showCompletions = false
        } else {
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

    private func navigateHistoryUp() {
        guard !commandHistory.isEmpty else { return }

        if historyIndex == nil {
            historyDraft = commandInput
            historyIndex = commandHistory.count - 1
        } else if let index = historyIndex, index > 0 {
            historyIndex = index - 1
        }

        guard let index = historyIndex else { return }
        isApplyingHistory = true
        commandInput = commandHistory[index]
    }

    private func navigateHistoryDown() {
        guard !commandHistory.isEmpty else { return }
        guard let index = historyIndex else { return }

        if index < commandHistory.count - 1 {
            historyIndex = index + 1
            if let next = historyIndex {
                isApplyingHistory = true
                commandInput = commandHistory[next]
            }
            return
        }

        historyIndex = nil
        isApplyingHistory = true
        commandInput = historyDraft
    }
}
