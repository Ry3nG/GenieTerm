import Foundation

struct TerminalSnapshot: Decodable, Equatable, Hashable {
    let rows: UInt16
    let cols: UInt16
    let cursor_row: UInt16
    let cursor_col: UInt16
    let lines: [TerminalLine]

    static let empty = TerminalSnapshot(
        rows: 0,
        cols: 0,
        cursor_row: 0,
        cursor_col: 0,
        lines: []
    )

    func hash(into hasher: inout Hasher) {
        hasher.combine(rows)
        hasher.combine(cols)
        hasher.combine(cursor_row)
        hasher.combine(cursor_col)
        for line in lines {
            hasher.combine(line)
        }
    }
}

struct TerminalLine: Decodable, Equatable, Hashable {
    let spans: [TerminalSpan]
}

struct TerminalSpan: Decodable, Equatable, Hashable {
    let text: String
    let fg: UInt32
    let bg: UInt32
    let bold: Bool
    let italic: Bool
    let underline: Bool
}
