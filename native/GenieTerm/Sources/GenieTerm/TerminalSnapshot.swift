import Foundation

struct TerminalSnapshot: Decodable, Equatable {
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
}

struct TerminalLine: Decodable, Equatable {
    let sig: UInt64
    let spans: [TerminalSpan]
}

struct TerminalSpan: Decodable, Equatable {
    let text: String
    let fg: UInt32
    let bg: UInt32
    let bold: Bool
    let italic: Bool
    let underline: Bool
}
