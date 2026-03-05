use genieterm_ffi::terminal::{Cell, RgbaColor, ScreenBuffer, TerminalParser};
use serde::Serialize;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Clone, Copy)]
struct StyleKey {
    fg: u32,
    bg: u32,
    bold: bool,
    italic: bool,
    underline: bool,
}

#[derive(Serialize)]
struct Span {
    text: String,
    fg: u32,
    bg: u32,
    bold: bool,
    italic: bool,
    underline: bool,
}

#[derive(Serialize)]
struct Line {
    spans: Vec<Span>,
}

#[derive(Serialize)]
struct Snapshot {
    rows: u16,
    cols: u16,
    cursor_row: u16,
    cursor_col: u16,
    lines: Vec<Line>,
}

#[derive(Serialize)]
struct ScrollbackChunk {
    total: usize,
    start: usize,
    lines: Vec<Line>,
}

#[derive(Serialize)]
struct Report {
    schema_version: u32,
    benchmark: &'static str,
    mode: String,
    metrics: std::collections::BTreeMap<String, f64>,
}

struct Args {
    mode: String,
    output: Option<PathBuf>,
}

fn parse_args() -> Args {
    let mut mode = "new".to_string();
    let mut output: Option<PathBuf> = None;
    let values: Vec<String> = env::args().collect();
    let mut i = 1;
    while i < values.len() {
        match values[i].as_str() {
            "--mode" => {
                if i + 1 < values.len() {
                    mode = values[i + 1].clone();
                    i += 1;
                }
            }
            "--output" => {
                if i + 1 < values.len() {
                    output = Some(PathBuf::from(&values[i + 1]));
                    i += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }
    Args { mode, output }
}

fn rgba(color: RgbaColor) -> u32 {
    ((color.r as u32) << 24)
        | ((color.g as u32) << 16)
        | ((color.b as u32) << 8)
        | (color.a as u32)
}

fn style_from(cell: &Cell) -> StyleKey {
    StyleKey {
        fg: rgba(cell.fg_color),
        bg: rgba(cell.bg_color),
        bold: cell.bold,
        italic: cell.italic,
        underline: cell.underline,
    }
}

fn row_to_line(row: &[Cell]) -> Line {
    let Some(last_non_blank) = row.iter().rposition(|c| c.ch != ' ' && c.ch != '\0') else {
        return Line { spans: Vec::new() };
    };

    let mut spans: Vec<Span> = Vec::new();
    let mut current_style: Option<StyleKey> = None;
    let mut current_text = String::new();

    for cell in row.iter().take(last_non_blank + 1) {
        let ch = if cell.ch == '\0' { ' ' } else { cell.ch };
        let style = style_from(cell);
        match current_style {
            Some(s)
                if s.fg == style.fg
                    && s.bg == style.bg
                    && s.bold == style.bold
                    && s.italic == style.italic
                    && s.underline == style.underline =>
            {
                current_text.push(ch);
            }
            Some(s) => {
                if !current_text.is_empty() {
                    spans.push(Span {
                        text: std::mem::take(&mut current_text),
                        fg: s.fg,
                        bg: s.bg,
                        bold: s.bold,
                        italic: s.italic,
                        underline: s.underline,
                    });
                }
                current_style = Some(style);
                current_text.push(ch);
            }
            None => {
                current_style = Some(style);
                current_text.push(ch);
            }
        }
    }

    if let Some(s) = current_style {
        if !current_text.is_empty() {
            spans.push(Span {
                text: current_text,
                fg: s.fg,
                bg: s.bg,
                bold: s.bold,
                italic: s.italic,
                underline: s.underline,
            });
        }
    }

    Line { spans }
}

fn snapshot_old(screen: &ScreenBuffer) -> Snapshot {
    let mut lines = Vec::with_capacity(screen.scrollback.len() + screen.cells.len());
    for row in &screen.scrollback {
        lines.push(row_to_line(row));
    }
    for row in &screen.cells {
        lines.push(row_to_line(row));
    }
    Snapshot {
        rows: screen.rows as u16,
        cols: screen.cols as u16,
        cursor_row: (screen.scrollback.len() + screen.cursor_row) as u16,
        cursor_col: screen.cursor_col as u16,
        lines,
    }
}

fn snapshot_new(screen: &ScreenBuffer) -> Snapshot {
    let mut lines = Vec::with_capacity(screen.cells.len());
    for row in &screen.cells {
        lines.push(row_to_line(row));
    }
    Snapshot {
        rows: screen.rows as u16,
        cols: screen.cols as u16,
        cursor_row: screen.cursor_row as u16,
        cursor_col: screen.cursor_col as u16,
        lines,
    }
}

fn recent_scrollback(screen: &ScreenBuffer, limit: usize) -> ScrollbackChunk {
    let total = screen.scrollback.len();
    let take = total.min(limit);
    let start = total.saturating_sub(take);
    let mut lines = Vec::with_capacity(take);
    for row in screen.scrollback.iter().skip(start) {
        lines.push(row_to_line(row));
    }
    ScrollbackChunk { total, start, lines }
}

fn percentile(mut values: Vec<f64>, p: f64) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let i = ((values.len() - 1) as f64 * p).round() as usize;
    values[i.min(values.len() - 1)]
}

fn build_plain(lines: usize, cols: usize) -> Vec<u8> {
    let mut out = String::with_capacity(lines * (cols + 8));
    for i in 0..lines {
        out.push_str(&format!("{i:06} "));
        for j in 0..(cols.saturating_sub(8)) {
            out.push((b'a' + (j % 26) as u8) as char);
        }
        out.push('\n');
    }
    out.into_bytes()
}

fn build_ansi(lines: usize, cols: usize) -> Vec<u8> {
    let mut out = String::with_capacity(lines * (cols + 24));
    let colors = [31, 32, 33, 34, 35, 36, 91, 92];
    for i in 0..lines {
        out.push_str(&format!("\x1b[{}m", colors[i % colors.len()]));
        out.push_str(&format!("{i:06} "));
        for j in 0..(cols.saturating_sub(8)) {
            out.push((b'A' + (j % 26) as u8) as char);
        }
        out.push_str("\x1b[0m\n");
    }
    out.into_bytes()
}

fn parser_lps(payload: &[u8], rows: usize, cols: usize, lines: usize) -> f64 {
    let mut parser = TerminalParser::new();
    let mut screen = ScreenBuffer::new(rows, cols);
    let start = Instant::now();
    for &b in payload {
        parser.process_byte(b, &mut screen);
    }
    let secs = start.elapsed().as_secs_f64().max(1e-9);
    lines as f64 / secs
}

fn main() {
    let args = parse_args();
    let rows = 50usize;
    let cols = 120usize;

    let plain = build_plain(100_000, cols);
    let ansi = build_ansi(80_000, cols);

    let mut parser = TerminalParser::new();
    let mut screen = ScreenBuffer::new(rows, cols);
    for &b in &plain {
        parser.process_byte(b, &mut screen);
    }

    let plain_lps = parser_lps(&plain, rows, cols, 100_000);
    let ansi_lps = parser_lps(&ansi, rows, cols, 80_000);

    let mut hot_samples = Vec::new();
    let mut hot_bytes = 0usize;
    for _ in 0..30 {
        let st = Instant::now();
        let s = if args.mode == "old" {
            snapshot_old(&screen)
        } else {
            snapshot_new(&screen)
        };
        let json = serde_json::to_string(&s).unwrap();
        hot_samples.push(st.elapsed().as_secs_f64() * 1000.0);
        hot_bytes = json.len();
    }

    let mut recent_samples = Vec::new();
    let mut recent_bytes = 0usize;
    for _ in 0..30 {
        let st = Instant::now();
        let chunk = recent_scrollback(&screen, 5000);
        let json = serde_json::to_string(&chunk).unwrap();
        recent_samples.push(st.elapsed().as_secs_f64() * 1000.0);
        recent_bytes = json.len();
    }

    let mut metrics = std::collections::BTreeMap::new();
    metrics.insert("parser_plain_lines_per_sec".to_string(), plain_lps);
    metrics.insert("parser_ansi_lines_per_sec".to_string(), ansi_lps);
    metrics.insert("hot_snapshot_ms_p95".to_string(), percentile(hot_samples, 0.95));
    metrics.insert("hot_snapshot_json_bytes".to_string(), hot_bytes as f64);
    metrics.insert(
        "recent_scrollback_ms_p95".to_string(),
        percentile(recent_samples, 0.95),
    );
    metrics.insert("recent_scrollback_json_bytes".to_string(), recent_bytes as f64);
    metrics.insert("scrollback_lines".to_string(), screen.scrollback.len() as f64);

    let report = Report {
        schema_version: 1,
        benchmark: "release_core_compare",
        mode: args.mode,
        metrics,
    };
    let json = serde_json::to_string_pretty(&report).unwrap();

    if let Some(path) = args.output {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(path, json.as_bytes()).expect("write output");
    }
    println!("{json}");
}
