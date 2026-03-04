import AppKit
import SwiftUI

struct TerminalTextView: NSViewRepresentable {
    let snapshot: TerminalSnapshot
    @EnvironmentObject private var terminal: TerminalBridge

    func makeCoordinator() -> Coordinator {
        Coordinator(terminal: terminal)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
        scrollView.drawsBackground = true
        scrollView.backgroundColor = .textBackgroundColor
        scrollView.wantsLayer = true

        let textView = TerminalInputTextView()
        textView.coordinator = context.coordinator
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = true
        textView.allowsUndo = false
        textView.usesFindBar = true
        textView.drawsBackground = true
        textView.backgroundColor = .textBackgroundColor
        textView.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        textView.textColor = .labelColor
        textView.insertionPointColor = .controlAccentColor
        textView.textContainerInset = NSSize(width: 16, height: 16)
        textView.textContainer?.lineFragmentPadding = 0
        textView.isHorizontallyResizable = true
        textView.isVerticallyResizable = true
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDataDetectionEnabled = false
        textView.isAutomaticLinkDetectionEnabled = false
        textView.textContainer?.containerSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.textContainer?.widthTracksTextView = false
        textView.usesAdaptiveColorMappingForDarkAppearance = true

        scrollView.documentView = textView
        context.coordinator.attach(scrollView: scrollView, textView: textView)

        DispatchQueue.main.async {
            scrollView.window?.makeFirstResponder(textView)
        }

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = context.coordinator.textView else { return }

        let newHash = snapshot.hashValue
        if context.coordinator.lastSnapshotHash == newHash {
            return
        }
        context.coordinator.lastSnapshotHash = newHash

        let attributed = Self.makeAttributedText(from: snapshot)
        textView.textStorage?.setAttributedString(attributed)
        textView.backgroundColor = .textBackgroundColor
        scrollView.backgroundColor = .textBackgroundColor

        if context.coordinator.autoScroll {
            textView.scrollToEndOfDocument(nil)
        }
    }

    private static let fontCache = NSCache<NSNumber, NSFont>()
    private static let colorCache = NSCache<NSNumber, NSColor>()

    private static func makeAttributedText(from snapshot: TerminalSnapshot) -> NSAttributedString {
        let output = NSMutableAttributedString()
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.lineSpacing = 0

        for (lineIndex, line) in snapshot.lines.enumerated() {
            if line.spans.isEmpty {
                if lineIndex + 1 < snapshot.lines.count {
                    output.append(NSAttributedString(string: "\n"))
                }
                continue
            }

            for span in line.spans {
                // 处理前景色：如果是白色，使用系统 labelColor（自适应）
                let fgColor: NSColor
                if span.fg == 0xFFFFFFFF {  // 白色
                    fgColor = .labelColor
                } else if span.fg == 0x000000FF {  // 黑色
                    fgColor = .labelColor
                } else {
                    fgColor = color(fromRGBA: span.fg)
                }

                var attributes: [NSAttributedString.Key: Any] = [
                    .foregroundColor: fgColor,
                    .font: fontForSpan(span),
                    .paragraphStyle: paragraphStyle
                ]

                // 处理背景色：只有非默认背景才应用
                if span.bg != 0x00000000 && span.bg != 0x000000FF {
                    let bgColor = color(fromRGBA: span.bg)
                    if bgColor.alphaComponent > 0.01 {
                        attributes[.backgroundColor] = bgColor
                    }
                }

                if span.underline {
                    attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
                }

                output.append(NSAttributedString(string: span.text, attributes: attributes))
            }

            if lineIndex + 1 < snapshot.lines.count {
                output.append(NSAttributedString(string: "\n"))
            }
        }

        return output
    }

    private static func fontForSpan(_ span: TerminalSpan) -> NSFont {
        let key = (span.bold ? 1 : 0) | (span.italic ? 2 : 0)
        let cacheKey = NSNumber(value: key)

        if let cached = fontCache.object(forKey: cacheKey) {
            return cached
        }

        let base = NSFont.monospacedSystemFont(
            ofSize: 13,
            weight: span.bold ? .semibold : .regular
        )

        let font: NSFont
        if span.italic {
            let italicDescriptor = base.fontDescriptor.withSymbolicTraits(.italic)
            font = NSFont(descriptor: italicDescriptor, size: 13) ?? base
        } else {
            font = base
        }

        fontCache.setObject(font, forKey: cacheKey)
        return font
    }

    private static func color(fromRGBA value: UInt32) -> NSColor {
        let cacheKey = NSNumber(value: value)

        if let cached = colorCache.object(forKey: cacheKey) {
            return cached
        }

        let r = CGFloat((value >> 24) & 0xFF) / 255.0
        let g = CGFloat((value >> 16) & 0xFF) / 255.0
        let b = CGFloat((value >> 8) & 0xFF) / 255.0
        let a = CGFloat(value & 0xFF) / 255.0
        let color = NSColor(srgbRed: r, green: g, blue: b, alpha: a)

        colorCache.setObject(color, forKey: cacheKey)
        return color
    }

    final class Coordinator {
        weak var textView: TerminalInputTextView?
        weak var scrollView: NSScrollView?
        var autoScroll = true
        var lastSnapshotHash: Int = 0
        private var observer: NSObjectProtocol?
        let terminal: TerminalBridge

        init(terminal: TerminalBridge) {
            self.terminal = terminal
        }

        deinit {
            if let observer {
                NotificationCenter.default.removeObserver(observer)
            }
        }

        func attach(scrollView: NSScrollView, textView: TerminalInputTextView) {
            self.scrollView = scrollView
            self.textView = textView

            let clipView = scrollView.contentView
            clipView.postsBoundsChangedNotifications = true

            observer = NotificationCenter.default.addObserver(
                forName: NSView.boundsDidChangeNotification,
                object: clipView,
                queue: .main
            ) { [weak self] _ in
                self?.updateAutoScroll()
            }
        }

        private func updateAutoScroll() {
            guard let scrollView else { return }
            let clipBounds = scrollView.contentView.bounds
            let docRect = scrollView.documentView?.bounds ?? .zero
            autoScroll = (docRect.maxY - clipBounds.maxY) < 20
        }
    }
}

final class TerminalInputTextView: NSTextView {
    weak var coordinator: TerminalTextView.Coordinator?

    override var acceptsFirstResponder: Bool { true }

    override func keyDown(with event: NSEvent) {
        guard let coordinator else {
            super.keyDown(with: event)
            return
        }

        if event.modifierFlags.contains(.command) {
            super.keyDown(with: event)
            return
        }

        if let sequence = escapeSequence(for: event.keyCode) {
            coordinator.terminal.sendRaw(sequence)
            return
        }

        if event.modifierFlags.contains(.control),
           let chars = event.charactersIgnoringModifiers,
           let scalar = chars.unicodeScalars.first,
           scalar.isASCII {
            let ascii = UInt8(scalar.value)
            coordinator.terminal.sendRaw([ascii & 0x1F])
            return
        }

        if let characters = event.characters, !characters.isEmpty {
            coordinator.terminal.sendRaw(Array(characters.utf8))
            return
        }

        super.keyDown(with: event)
    }

    override func mouseDown(with event: NSEvent) {
        super.mouseDown(with: event)
        window?.makeFirstResponder(self)
    }

    private func escapeSequence(for keyCode: UInt16) -> [UInt8]? {
        switch keyCode {
        case 36, 76: return [13] // Return
        case 48: return [9] // Tab
        case 51: return [127] // Backspace
        case 53: return [27] // Esc
        case 123: return [27, 91, 68] // Left
        case 124: return [27, 91, 67] // Right
        case 125: return [27, 91, 66] // Down
        case 126: return [27, 91, 65] // Up
        case 115: return [27, 91, 72] // Home
        case 119: return [27, 91, 70] // End
        case 116: return [27, 91, 53, 126] // Page Up
        case 121: return [27, 91, 54, 126] // Page Down
        case 117: return [27, 91, 51, 126] // Delete
        default: return nil
        }
    }
}
