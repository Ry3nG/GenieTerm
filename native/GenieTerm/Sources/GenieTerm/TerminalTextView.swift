import AppKit
import CoreText
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

        let canvas = TerminalCanvasView()
        canvas.coordinator = context.coordinator
        canvas.configure(font: .monospacedSystemFont(ofSize: 13, weight: .regular), textInset: NSSize(width: 16, height: 16))

        scrollView.documentView = canvas
        context.coordinator.attach(scrollView: scrollView, canvas: canvas)

        DispatchQueue.main.async {
            scrollView.window?.makeFirstResponder(canvas)
        }

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let canvas = context.coordinator.canvas else { return }
        let coordinator = context.coordinator
        let clipView = scrollView.contentView
        let oldClipBounds = clipView.bounds

        if coordinator.lastRenderedVersion == terminal.snapshotVersion,
           coordinator.lastSnapshotRows == snapshot.rows,
           coordinator.lastSnapshotCols == snapshot.cols,
           coordinator.lastCursorRow == snapshot.cursor_row,
           coordinator.lastCursorCol == snapshot.cursor_col,
           coordinator.lastRenderedLines.count == snapshot.lines.count {
            return
        }

        Self.applySnapshot(snapshot, to: canvas, coordinator: coordinator)
        coordinator.lastRenderedVersion = terminal.snapshotVersion
        coordinator.lastSnapshotRows = snapshot.rows
        coordinator.lastSnapshotCols = snapshot.cols
        coordinator.lastCursorRow = snapshot.cursor_row
        coordinator.lastCursorCol = snapshot.cursor_col

        canvas.backgroundColor = .textBackgroundColor
        scrollView.backgroundColor = .textBackgroundColor

        if coordinator.autoScroll {
            let targetY = max(0, canvas.bounds.height - scrollView.contentView.bounds.height)
            scrollView.contentView.scroll(to: NSPoint(x: 0, y: targetY))
            scrollView.reflectScrolledClipView(scrollView.contentView)
        } else if coordinator.pendingBottomAnchorRestore {
            let viewportHeight = oldClipBounds.height
            var targetY = max(
                0,
                canvas.bounds.height - viewportHeight - coordinator.bottomDistanceBeforeViewportExpand
            )
            if coordinator.pendingScrollNudgeUp > 0 {
                targetY = max(0, targetY - coordinator.pendingScrollNudgeUp)
                coordinator.pendingScrollNudgeUp = 0
            }
            scrollView.contentView.scroll(to: NSPoint(x: oldClipBounds.origin.x, y: targetY))
            scrollView.reflectScrolledClipView(scrollView.contentView)
            coordinator.pendingBottomAnchorRestore = false
        }
    }

    private static let fontCache = NSCache<NSNumber, NSFont>()
    private static let colorCache = NSCache<NSNumber, NSColor>()
    private struct StyleKey: Hashable {
        let fg: UInt32
        let bg: UInt32
        let bold: Bool
        let italic: Bool
        let underline: Bool
    }
    private static var attributesCache: [StyleKey: [NSAttributedString.Key: Any]] = [:]
    private static let paragraphStyle: NSParagraphStyle = {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 0
        return style
    }()

    fileprivate static func makeAttributedLine(_ line: TerminalLine) -> NSAttributedString {
        if line.spans.isEmpty {
            return NSAttributedString(string: "")
        }

        let output = NSMutableAttributedString()
        output.beginEditing()
        defer { output.endEditing() }

        for span in line.spans {
            output.append(NSAttributedString(string: span.text, attributes: attributes(for: span)))
        }

        return output
    }

    private static func attributes(for span: TerminalSpan) -> [NSAttributedString.Key: Any] {
        let key = StyleKey(
            fg: span.fg,
            bg: span.bg,
            bold: span.bold,
            italic: span.italic,
            underline: span.underline
        )

        if let cached = attributesCache[key] {
            return cached
        }

        let fgColor: NSColor
        if span.fg == 0xFFFFFFFF || span.fg == 0x000000FF {
            fgColor = .labelColor
        } else {
            fgColor = color(fromRGBA: span.fg)
        }

        var attributes: [NSAttributedString.Key: Any] = [
            .foregroundColor: fgColor,
            .font: fontForSpan(span),
            .paragraphStyle: paragraphStyle
        ]

        if span.bg != 0x00000000 && span.bg != 0x000000FF {
            let bgColor = color(fromRGBA: span.bg)
            if bgColor.alphaComponent > 0.01 {
                attributes[.backgroundColor] = bgColor
            }
        }

        if span.underline {
            attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
        }

        attributesCache[key] = attributes
        return attributes
    }

    private static func changedLineIndices(old: [TerminalLine], new: [TerminalLine]) -> [Int] {
        var changed: [Int] = []
        changed.reserveCapacity(16)

        for index in new.indices where old[index].sig != new[index].sig {
            changed.append(index)
        }

        return changed
    }

    private static func applySnapshot(
        _ snapshot: TerminalSnapshot,
        to canvas: TerminalCanvasView,
        coordinator: Coordinator
    ) {
        let newLines = snapshot.lines

        if coordinator.lastRenderedLines.count != newLines.count {
            coordinator.lastRenderedLines = newLines
            canvas.replaceAllLines(
                lines: newLines,
                rows: Int(snapshot.rows),
                cols: Int(snapshot.cols)
            )
            return
        }

        let changed = changedLineIndices(old: coordinator.lastRenderedLines, new: newLines)
        if changed.isEmpty {
            canvas.updateViewport(rows: Int(snapshot.rows), cols: Int(snapshot.cols))
            return
        }

        coordinator.lastRenderedLines = newLines
        canvas.updateChangedLines(
            changedIndices: changed,
            lines: newLines,
            rows: Int(snapshot.rows),
            cols: Int(snapshot.cols)
        )
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
        weak var canvas: TerminalCanvasView?
        weak var scrollView: NSScrollView?
        var autoScroll = true
        var lastAutoScrollState = true
        var lastRenderedVersion: UInt64 = 0
        var lastSnapshotRows: UInt16 = 0
        var lastSnapshotCols: UInt16 = 0
        var lastCursorRow: UInt16 = 0
        var lastCursorCol: UInt16 = 0
        var lastRenderedLines: [TerminalLine] = []
        var pendingBottomAnchorRestore = false
        var bottomDistanceBeforeViewportExpand: CGFloat = 0
        var pendingScrollNudgeUp: CGFloat = 0
        var isScrollbackViewportEnabled = false
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

        func attach(scrollView: NSScrollView, canvas: TerminalCanvasView) {
            self.scrollView = scrollView
            self.canvas = canvas

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

            if autoScroll != lastAutoScrollState {
                if !autoScroll && !isScrollbackViewportEnabled {
                    activateScrollbackViewport(withNudge: 0)
                }
                lastAutoScrollState = autoScroll
            }
        }

        func activateScrollbackViewport(withNudge nudge: CGFloat) {
            guard !isScrollbackViewportEnabled else { return }
            guard let scrollView else { return }
            let clipBounds = scrollView.contentView.bounds
            let docRect = scrollView.documentView?.bounds ?? .zero

            bottomDistanceBeforeViewportExpand = max(0, docRect.maxY - clipBounds.maxY)
            pendingBottomAnchorRestore = true
            pendingScrollNudgeUp = max(0, nudge)
            autoScroll = false
            lastAutoScrollState = false
            isScrollbackViewportEnabled = true
            terminal.setScrollbackViewportEnabled(true)
        }

        func deactivateScrollbackViewport() {
            guard isScrollbackViewportEnabled else { return }
            guard let scrollView else { return }

            let clipBounds = scrollView.contentView.bounds
            let docRect = scrollView.documentView?.bounds ?? .zero
            let targetY = max(0, docRect.maxY - clipBounds.height)
            scrollView.contentView.scroll(to: NSPoint(x: clipBounds.origin.x, y: targetY))
            scrollView.reflectScrolledClipView(scrollView.contentView)

            pendingBottomAnchorRestore = false
            pendingScrollNudgeUp = 0
            autoScroll = true
            lastAutoScrollState = true
            isScrollbackViewportEnabled = false
            terminal.setScrollbackViewportEnabled(false)
        }
    }
}

final class TerminalCanvasView: NSView {
    private struct GridPosition: Equatable {
        let line: Int
        let col: Int
    }

    weak var coordinator: TerminalTextView.Coordinator?

    var backgroundColor: NSColor = .textBackgroundColor {
        didSet {
            needsDisplay = true
        }
    }

    private var renderedCoreTextLines: [CTLine] = []
    private var renderedPlainLines: [String] = []
    private var terminalRows: Int = 24
    private var terminalCols: Int = 80

    private var drawingFont: NSFont = .monospacedSystemFont(ofSize: 13, weight: .regular)
    private var textInset = NSSize(width: 16, height: 16)
    private var cellWidth: CGFloat = 8.0
    private var lineHeight: CGFloat = 18.0
    private var selectionAnchor: GridPosition?
    private var selectionFocus: GridPosition?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    func configure(font: NSFont, textInset: NSSize) {
        self.drawingFont = font
        self.textInset = textInset

        let glyph = font.glyph(withName: "M")
        cellWidth = max(1.0, font.advancement(forGlyph: glyph).width)
        lineHeight = max(1.0, NSLayoutManager().defaultLineHeight(for: font))

        recalculateFrameSize()
    }

    func replaceAllLines(lines: [TerminalLine], rows: Int, cols: Int) {
        renderedCoreTextLines = lines.map(Self.makeCTLine(from:))
        renderedPlainLines = lines.map(Self.makePlainText(from:))
        terminalRows = max(rows, 1)
        terminalCols = max(cols, 1)
        updateFrameSize(forceRedraw: true)
    }

    func updateChangedLines(changedIndices: [Int], lines: [TerminalLine], rows: Int, cols: Int) {
        if renderedCoreTextLines.count != lines.count {
            renderedCoreTextLines = lines.map(Self.makeCTLine(from:))
            renderedPlainLines = lines.map(Self.makePlainText(from:))
        } else {
            for index in changedIndices where index >= 0 && index < lines.count {
                renderedCoreTextLines[index] = Self.makeCTLine(from: lines[index])
                renderedPlainLines[index] = Self.makePlainText(from: lines[index])
            }
        }
        terminalRows = max(rows, 1)
        terminalCols = max(cols, 1)
        if updateFrameSize(forceRedraw: false) {
            return
        }

        for index in changedIndices {
            setNeedsDisplay(lineRect(at: index))
        }
    }

    func updateViewport(rows: Int, cols: Int) {
        terminalRows = max(rows, 1)
        terminalCols = max(cols, 1)
        _ = updateFrameSize(forceRedraw: false)
    }

    @discardableResult
    private func updateFrameSize(forceRedraw: Bool) -> Bool {
        let oldSize = bounds.size
        recalculateFrameSize()
        let frameChanged = bounds.size != oldSize

        if frameChanged || forceRedraw {
            needsDisplay = true
        }
        return frameChanged
    }

    private func lineRect(at index: Int) -> NSRect {
        let y = textInset.height + CGFloat(index) * lineHeight
        return NSRect(x: 0, y: y, width: bounds.width, height: lineHeight)
    }

    private func recalculateFrameSize() {
        let displayLineCount = max(renderedCoreTextLines.count, terminalRows)
        let contentHeight = textInset.height * 2 + CGFloat(displayLineCount) * lineHeight
        let contentWidth = textInset.width * 2 + CGFloat(terminalCols) * cellWidth

        let minWidth = enclosingScrollView?.contentView.bounds.width ?? 0
        let minHeight = enclosingScrollView?.contentView.bounds.height ?? 0

        setFrameSize(NSSize(
            width: max(contentWidth, minWidth),
            height: max(contentHeight, minHeight)
        ))
    }

    override func draw(_ dirtyRect: NSRect) {
        backgroundColor.setFill()
        dirtyRect.fill()

        guard !renderedCoreTextLines.isEmpty else { return }

        let startLine = max(0, Int(floor((dirtyRect.minY - textInset.height) / lineHeight)))
        let endLine = min(renderedCoreTextLines.count, Int(ceil((dirtyRect.maxY - textInset.height) / lineHeight)))
        guard startLine < endLine else { return }

        drawSelectionOverlay(startLine: startLine, endLine: endLine)

        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.saveGState()
        defer { context.restoreGState() }

        context.textMatrix = .identity
        context.translateBy(x: 0, y: bounds.height)
        context.scaleBy(x: 1, y: -1)

        for lineIndex in startLine..<endLine {
            let topY = textInset.height + CGFloat(lineIndex) * lineHeight
            let baselineFromTop = topY + drawingFont.ascender
            let baselineY = bounds.height - baselineFromTop
            context.textPosition = CGPoint(x: textInset.width, y: baselineY)
            CTLineDraw(renderedCoreTextLines[lineIndex], context)
        }
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.makeFirstResponder(self)
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        needsDisplay = true
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted {
            coordinator?.terminal.sendFocusEvent(focused: true)
        }
        return accepted
    }

    override func resignFirstResponder() -> Bool {
        let accepted = super.resignFirstResponder()
        if accepted {
            coordinator?.terminal.sendFocusEvent(focused: false)
        }
        return accepted
    }

    override func keyDown(with event: NSEvent) {
        guard let coordinator else {
            super.keyDown(with: event)
            return
        }

        if event.modifierFlags.contains(.command) {
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

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard isCurrentFirstResponder else {
            return super.performKeyEquivalent(with: event)
        }

        if event.modifierFlags.contains(.command),
           !event.modifierFlags.contains(.option),
           !event.modifierFlags.contains(.control),
           let key = event.charactersIgnoringModifiers?.lowercased() {
            if key == "c" {
                return copySelectionToPasteboard()
            }
            if key == "v" {
                pasteFromClipboard()
                return true
            }
        }
        return super.performKeyEquivalent(with: event)
    }

    @objc func copy(_ sender: Any?) {
        _ = copySelectionToPasteboard()
    }

    private func pasteFromClipboard() {
        guard let coordinator else { return }
        guard let text = NSPasteboard.general.string(forType: .string), !text.isEmpty else {
            return
        }

        coordinator.terminal.sendPaste(text)
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        if shouldHandleNativeSelection(for: event, button: 0) {
            beginSelection(with: event)
            return
        }
        if !handleMouseButtonEvent(event, button: 0, pressed: true, dragged: false) {
            super.mouseDown(with: event)
        }
    }

    override func mouseUp(with event: NSEvent) {
        if shouldHandleNativeSelection(for: event, button: 0), selectionAnchor != nil {
            updateSelection(with: event)
            return
        }
        if !handleMouseButtonEvent(event, button: 0, pressed: false, dragged: false) {
            super.mouseUp(with: event)
        }
    }

    override func mouseDragged(with event: NSEvent) {
        if shouldHandleNativeSelection(for: event, button: 0), selectionAnchor != nil {
            updateSelection(with: event)
            return
        }
        if !handleMouseButtonEvent(event, button: 0, pressed: true, dragged: true) {
            super.mouseDragged(with: event)
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        if !handleMouseButtonEvent(event, button: 2, pressed: true, dragged: false) {
            super.rightMouseDown(with: event)
        }
    }

    override func rightMouseUp(with event: NSEvent) {
        if !handleMouseButtonEvent(event, button: 2, pressed: false, dragged: false) {
            super.rightMouseUp(with: event)
        }
    }

    override func rightMouseDragged(with event: NSEvent) {
        if !handleMouseButtonEvent(event, button: 2, pressed: true, dragged: true) {
            super.rightMouseDragged(with: event)
        }
    }

    override func otherMouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        if !handleMouseButtonEvent(event, button: 1, pressed: true, dragged: false) {
            super.otherMouseDown(with: event)
        }
    }

    override func otherMouseUp(with event: NSEvent) {
        if !handleMouseButtonEvent(event, button: 1, pressed: false, dragged: false) {
            super.otherMouseUp(with: event)
        }
    }

    override func otherMouseDragged(with event: NSEvent) {
        if !handleMouseButtonEvent(event, button: 1, pressed: true, dragged: true) {
            super.otherMouseDragged(with: event)
        }
    }

    override func scrollWheel(with event: NSEvent) {
        if !handleScrollEvent(event) {
            if shouldActivateScrollbackViewport(for: event) {
                coordinator?.activateScrollbackViewport(withNudge: preferredScrollStep())
                return
            }
            if shouldDeactivateScrollbackViewport(for: event) {
                coordinator?.deactivateScrollbackViewport()
                return
            }
            super.scrollWheel(with: event)
        }
    }

    private func handleMouseButtonEvent(
        _ event: NSEvent,
        button: Int,
        pressed: Bool,
        dragged: Bool
    ) -> Bool {
        guard let coordinator else { return false }
        let terminal = coordinator.terminal

        if dragged {
            guard terminal.mouseTrackingMode.supportsDrag else { return false }
        } else {
            guard terminal.mouseTrackingMode.supportsPress else { return false }
        }

        guard let (col, row) = terminalCell(for: event) else { return false }

        let modifierMask = mouseModifierMask(from: event)
        let buttonBase = max(0, min(button, 3))

        if terminal.mouseSGREnabled {
            var code = buttonBase + modifierMask
            if dragged {
                code += 32
            }

            let terminator = pressed ? "M" : "m"
            terminal.sendRaw(Array("\u{1B}[<\(code);\(col);\(row)\(terminator)".utf8))
            return true
        }

        var code = pressed ? buttonBase : 3
        if dragged {
            code += 32
        }
        code += modifierMask

        let clampedCol = max(1, min(col, 223))
        let clampedRow = max(1, min(row, 223))
        terminal.sendRaw([27, 91, 77, UInt8(32 + code), UInt8(32 + clampedCol), UInt8(32 + clampedRow)])
        return true
    }

    private func handleScrollEvent(_ event: NSEvent) -> Bool {
        guard let coordinator else { return false }
        let terminal = coordinator.terminal
        guard terminal.mouseTrackingMode.supportsPress else { return false }
        guard let (col, row) = terminalCell(for: event) else { return false }

        let dy = event.scrollingDeltaY
        let dx = event.scrollingDeltaX
        if abs(dy) < 0.01 && abs(dx) < 0.01 {
            return false
        }

        let baseCode: Int
        if abs(dy) >= abs(dx) {
            baseCode = dy > 0 ? 64 : 65
        } else {
            baseCode = dx > 0 ? 66 : 67
        }

        let code = baseCode + mouseModifierMask(from: event)
        if terminal.mouseSGREnabled {
            terminal.sendRaw(Array("\u{1B}[<\(code);\(col);\(row)M".utf8))
            return true
        }

        let clampedCol = max(1, min(col, 223))
        let clampedRow = max(1, min(row, 223))
        terminal.sendRaw([27, 91, 77, UInt8(32 + code), UInt8(32 + clampedCol), UInt8(32 + clampedRow)])
        return true
    }

    private func mouseModifierMask(from event: NSEvent) -> Int {
        var mask = 0
        if event.modifierFlags.contains(.shift) {
            mask += 4
        }
        if event.modifierFlags.contains(.option) {
            mask += 8
        }
        if event.modifierFlags.contains(.control) {
            mask += 16
        }
        return mask
    }

    private func terminalCell(for event: NSEvent) -> (Int, Int)? {
        let local = convert(event.locationInWindow, from: nil)
        let x = local.x - textInset.width
        let y = local.y - textInset.height

        guard x >= 0, y >= 0 else { return nil }

        let col = Int(floor(x / max(cellWidth, 1))) + 1
        let absoluteRow = Int(floor(y / max(lineHeight, 1)))

        let rows = max(terminalRows, 1)
        let cols = max(terminalCols, 1)
        let visibleStartLine = max(0, renderedCoreTextLines.count - rows)
        guard absoluteRow >= visibleStartLine else { return nil }

        let row = absoluteRow - visibleStartLine + 1
        return (
            max(1, min(col, cols)),
            max(1, min(row, rows))
        )
    }

    private func shouldActivateScrollbackViewport(for event: NSEvent) -> Bool {
        guard let coordinator else { return false }
        guard coordinator.autoScroll else { return false }
        guard !coordinator.isScrollbackViewportEnabled else { return false }
        guard !coordinator.terminal.mouseTrackingMode.supportsPress else { return false }

        let dy = event.scrollingDeltaY
        let dx = event.scrollingDeltaX
        guard abs(dy) >= abs(dx) else { return false }
        return dy > 0
    }

    private func shouldDeactivateScrollbackViewport(for event: NSEvent) -> Bool {
        guard let coordinator else { return false }
        guard coordinator.isScrollbackViewportEnabled else { return false }
        guard !coordinator.terminal.mouseTrackingMode.supportsPress else { return false }
        guard let scrollView = coordinator.scrollView else { return false }

        let dy = event.scrollingDeltaY
        let dx = event.scrollingDeltaX
        guard abs(dy) >= abs(dx) else { return false }
        guard dy < 0 else { return false }

        let clipBounds = scrollView.contentView.bounds
        let docRect = scrollView.documentView?.bounds ?? .zero
        let distanceFromBottom = max(0, docRect.maxY - clipBounds.maxY)
        return distanceFromBottom <= max(lineHeight * 2, 20)
    }

    private func preferredScrollStep() -> CGFloat {
        max(lineHeight * 3, 24)
    }

    private func shouldHandleNativeSelection(for event: NSEvent, button: Int) -> Bool {
        guard button == 0 else { return false }
        guard let coordinator else { return false }
        guard !coordinator.terminal.mouseTrackingMode.supportsPress else { return false }
        guard !event.modifierFlags.contains(.option), !event.modifierFlags.contains(.control) else {
            return false
        }
        return true
    }

    private func beginSelection(with event: NSEvent) {
        guard let point = gridPosition(for: event) else {
            clearSelection()
            return
        }
        selectionAnchor = point
        selectionFocus = point
        needsDisplay = true
    }

    private func updateSelection(with event: NSEvent) {
        guard selectionAnchor != nil else { return }
        guard let point = gridPosition(for: event) else { return }
        if point != selectionFocus {
            selectionFocus = point
            needsDisplay = true
        }
    }

    private func clearSelection() {
        if selectionAnchor != nil || selectionFocus != nil {
            selectionAnchor = nil
            selectionFocus = nil
            needsDisplay = true
        }
    }

    private func hasSelection() -> Bool {
        guard let anchor = selectionAnchor, let focus = selectionFocus else { return false }
        return anchor != focus
    }

    private func normalizedSelection() -> (GridPosition, GridPosition)? {
        guard let anchor = selectionAnchor, let focus = selectionFocus, anchor != focus else { return nil }
        if anchor.line < focus.line {
            return (anchor, focus)
        }
        if anchor.line > focus.line {
            return (focus, anchor)
        }
        if anchor.col <= focus.col {
            return (anchor, focus)
        }
        return (focus, anchor)
    }

    private func drawSelectionOverlay(startLine: Int, endLine: Int) {
        guard let (start, end) = normalizedSelection() else { return }

        let firstLine = max(start.line, startLine)
        let lastLine = min(end.line, endLine - 1)
        guard firstLine <= lastLine else { return }

        NSColor.selectedTextBackgroundColor.withAlphaComponent(0.35).setFill()

        for line in firstLine...lastLine {
            let fromCol = (line == start.line) ? start.col : 0
            let toCol = (line == end.line) ? end.col : terminalCols
            guard toCol > fromCol else { continue }

            let rect = NSRect(
                x: textInset.width + CGFloat(fromCol) * cellWidth,
                y: textInset.height + CGFloat(line) * lineHeight,
                width: CGFloat(toCol - fromCol) * cellWidth,
                height: lineHeight
            )
            rect.fill()
        }
    }

    private func copySelectionToPasteboard() -> Bool {
        guard hasSelection() else { return false }
        guard let content = selectedText(), !content.isEmpty else { return false }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(content, forType: .string)
        return true
    }

    private func selectedText() -> String? {
        guard let (start, end) = normalizedSelection() else { return nil }
        var parts: [String] = []
        parts.reserveCapacity(max(1, end.line - start.line + 1))

        for line in start.line...end.line {
            let fromCol = (line == start.line) ? start.col : 0
            let toCol = (line == end.line) ? end.col : terminalCols
            guard toCol >= fromCol else { continue }
            let raw = plainText(at: line)
            parts.append(substring(raw, fromColumn: fromCol, toColumn: toCol))
        }

        return parts.joined(separator: "\n")
    }

    private func plainText(at line: Int) -> String {
        guard line >= 0 && line < renderedPlainLines.count else { return "" }
        return renderedPlainLines[line]
    }

    private func substring(_ text: String, fromColumn: Int, toColumn: Int) -> String {
        guard toColumn > fromColumn else { return "" }
        var chars = Array(text)
        if chars.count < terminalCols {
            chars.append(contentsOf: repeatElement(" ", count: terminalCols - chars.count))
        }
        let safeStart = max(0, min(fromColumn, chars.count))
        let safeEnd = max(safeStart, min(toColumn, chars.count))
        if safeStart == safeEnd { return "" }
        return String(chars[safeStart..<safeEnd])
    }

    private func gridPosition(for event: NSEvent) -> GridPosition? {
        let local = convert(event.locationInWindow, from: nil)
        let x = local.x - textInset.width
        let y = local.y - textInset.height

        let lineCount = max(renderedCoreTextLines.count, terminalRows)
        guard lineCount > 0 else { return nil }

        let rawLine = Int(floor(y / max(lineHeight, 1)))
        let rawCol = Int(floor(x / max(cellWidth, 1)))
        let line = max(0, min(rawLine, lineCount - 1))
        let col = max(0, min(rawCol, terminalCols))
        return GridPosition(line: line, col: col)
    }

    override func mouseMoved(with event: NSEvent) {
        guard let coordinator else {
            super.mouseMoved(with: event)
            return
        }
        guard coordinator.terminal.mouseTrackingMode.supportsMotion else {
            super.mouseMoved(with: event)
            return
        }
        _ = handleMouseButtonEvent(event, button: 3, pressed: true, dragged: true)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        let options: NSTrackingArea.Options = [
            .activeInKeyWindow,
            .mouseMoved,
            .inVisibleRect
        ]
        addTrackingArea(NSTrackingArea(rect: .zero, options: options, owner: self, userInfo: nil))
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

    private static func makeCTLine(from line: TerminalLine) -> CTLine {
        let attributed = TerminalTextView.makeAttributedLine(line)
        return CTLineCreateWithAttributedString(attributed as CFAttributedString)
    }

    private var isCurrentFirstResponder: Bool {
        guard let window else { return false }
        return window.firstResponder === self
    }

    private static func makePlainText(from line: TerminalLine) -> String {
        var output = String()
        for span in line.spans {
            output.append(span.text)
        }
        return output
    }
}
