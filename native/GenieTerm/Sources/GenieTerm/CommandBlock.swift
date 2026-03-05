import SwiftUI

/// Represents a single command execution block (like Warp)
struct CommandBlock: Identifiable {
    let id = UUID()
    let command: String
    let timestamp: Date
    var isExecuting: Bool = false

    var formattedTime: String {
        CommandBlockFormatter.shortTime.string(from: timestamp)
    }
}

private enum CommandBlockFormatter {
    static let shortTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter
    }()
}

/// Visual representation of a command block
struct CommandBlockView: View {
    let block: CommandBlock
    let onRerun: () -> Void
    let onEdit: () -> Void

    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 8) {
            // Status indicator
            Circle()
                .fill(block.isExecuting ? Color.blue : Color.green)
                .frame(width: 6, height: 6)

            // Command text
            Text(block.command)
                .font(.system(size: 13, design: .monospaced))
                .foregroundColor(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Timestamp
            Text(block.formattedTime)
                .font(.system(size: 11))
                .foregroundColor(.secondary)

            // Action buttons (shown on hover)
            if isHovered {
                HStack(spacing: 4) {
                    Button(action: onEdit) {
                        Image(systemName: "pencil")
                            .font(.system(size: 11))
                    }
                    .buttonStyle(.plain)
                    .help("Edit command")

                    Button(action: onRerun) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 11))
                    }
                    .buttonStyle(.plain)
                    .help("Rerun command")
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isHovered ? Color.gray.opacity(0.1) : Color.clear)
        )
        .onHover { hovering in
            isHovered = hovering
        }
    }
}
