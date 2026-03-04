use crossbeam_channel::{unbounded, Sender};
use portable_pty::PtySize;
use serde::Serialize;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::thread;

use crate::pty::PtyManager;
use crate::terminal::{Cell, RgbaColor, ScreenBuffer, TerminalParser};

#[derive(Serialize)]
pub struct TerminalSnapshot {
    pub rows: u16,
    pub cols: u16,
    pub cursor_row: u16,
    pub cursor_col: u16,
    pub lines: Vec<TerminalLine>,
}

#[derive(Serialize)]
pub struct TerminalLine {
    pub spans: Vec<TerminalSpan>,
}

#[derive(Serialize)]
pub struct TerminalSpan {
    pub text: String,
    pub fg: u32,
    pub bg: u32,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct StyleKey {
    fg: u32,
    bg: u32,
    bold: bool,
    italic: bool,
    underline: bool,
}

impl StyleKey {
    fn from_cell(cell: &Cell) -> Self {
        Self {
            fg: color_to_rgba_u32(cell.fg_color),
            bg: color_to_rgba_u32(cell.bg_color),
            bold: cell.bold,
            italic: cell.italic,
            underline: cell.underline,
        }
    }
}

fn color_to_rgba_u32(color: RgbaColor) -> u32 {
    ((color.r as u32) << 24) | ((color.g as u32) << 16) | ((color.b as u32) << 8) | (color.a as u32)
}

fn push_span(spans: &mut Vec<TerminalSpan>, style: StyleKey, text: String) {
    if text.is_empty() {
        return;
    }

    spans.push(TerminalSpan {
        text,
        fg: style.fg,
        bg: style.bg,
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
    });
}

pub struct TerminalEngine {
    screen_buffer: Arc<Mutex<ScreenBuffer>>,
    command_tx: Sender<EngineCommand>,
}

enum EngineCommand {
    Input(Vec<u8>),
    Resize { cols: u16, rows: u16 },
}

impl TerminalEngine {
    pub fn new(cols: u16, rows: u16) -> Self {
        let (command_tx, command_rx) = unbounded::<EngineCommand>();
        let screen_buffer = Arc::new(Mutex::new(ScreenBuffer::new(rows as usize, cols as usize)));
        let screen_buffer_for_output = Arc::clone(&screen_buffer);

        thread::spawn(move || {
            let mut pty = match PtyManager::new(cols, rows) {
                Ok(pty) => pty,
                Err(err) => {
                    eprintln!("FFI PTY init failed: {err}");
                    return;
                }
            };

            let writer = pty.writer_handle();
            let master = pty.master_handle();
            thread::spawn(move || {
                while let Ok(command) = command_rx.recv() {
                    match command {
                        EngineCommand::Input(data) => {
                            let mut writer = writer.lock().unwrap();
                            if let Err(err) = writer.write_all(&data).and_then(|_| writer.flush()) {
                                eprintln!("FFI PTY write failed: {err}");
                                break;
                            }
                        }
                        EngineCommand::Resize { cols, rows } => {
                            let size = PtySize {
                                rows,
                                cols,
                                pixel_width: 0,
                                pixel_height: 0,
                            };
                            let resize_result = {
                                let master = master.lock().unwrap();
                                master.resize(size)
                            };
                            if let Err(err) = resize_result {
                                eprintln!("FFI PTY resize failed: {err}");
                            }
                        }
                    }
                }
            });

            let mut parser = TerminalParser::new();
            loop {
                let mut read_buf = [0u8; 4096];
                match pty.read_output(&mut read_buf) {
                    Ok(n) if n > 0 => {
                        let mut screen = screen_buffer_for_output.lock().unwrap();
                        for &byte in &read_buf[..n] {
                            parser.process_byte(byte, &mut screen);
                        }
                    }
                    Ok(_) => {}
                    Err(err) => {
                        eprintln!("FFI PTY read failed: {err}");
                        break;
                    }
                }
            }
        });

        Self {
            screen_buffer,
            command_tx,
        }
    }

    pub fn send_command(&self, command: &str) {
        if command.trim().is_empty() {
            return;
        }

        let mut bytes = command.as_bytes().to_vec();
        if !bytes.ends_with(b"\n") {
            bytes.push(b'\n');
        }
        let _ = self.command_tx.send(EngineCommand::Input(bytes));
    }

    pub fn send_input(&self, input: &[u8]) {
        if input.is_empty() {
            return;
        }
        let _ = self.command_tx.send(EngineCommand::Input(input.to_vec()));
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let _ = self.command_tx.send(EngineCommand::Resize { cols, rows });
        let mut screen = self.screen_buffer.lock().unwrap();
        screen.resize(rows as usize, cols as usize);
    }

    pub fn screen_text(&self) -> String {
        self.screen_buffer.lock().unwrap().visible_text()
    }

    pub fn snapshot_json(&self) -> String {
        let snapshot = {
            let screen = self.screen_buffer.lock().unwrap();
            snapshot_from_screen(&screen)
        };

        serde_json::to_string(&snapshot).unwrap_or_else(|_| "{}".to_string())
    }

    pub fn cursor(&self) -> (u16, u16) {
        let screen = self.screen_buffer.lock().unwrap();
        (screen.cursor_row as u16, screen.cursor_col as u16)
    }

    pub fn size(&self) -> (u16, u16) {
        let screen = self.screen_buffer.lock().unwrap();
        (screen.rows as u16, screen.cols as u16)
    }
}

fn snapshot_from_screen(screen: &ScreenBuffer) -> TerminalSnapshot {
    let mut lines = Vec::with_capacity(screen.scrollback.len() + screen.rows);

    // 首先包含 scrollback 历史
    for row in &screen.scrollback {
        let Some(last_non_blank) = row
            .iter()
            .rposition(|cell| cell.ch != ' ' && cell.ch != '\0')
        else {
            lines.push(TerminalLine { spans: Vec::new() });
            continue;
        };

        let mut spans = Vec::new();
        let mut current_style: Option<StyleKey> = None;
        let mut current_text = String::new();

        for cell in row.iter().take(last_non_blank + 1) {
            let ch = if cell.ch == '\0' { ' ' } else { cell.ch };
            let style = StyleKey::from_cell(cell);

            match current_style {
                Some(existing) if existing == style => {
                    current_text.push(ch);
                }
                Some(existing) => {
                    let completed = std::mem::take(&mut current_text);
                    push_span(&mut spans, existing, completed);
                    current_style = Some(style);
                    current_text.push(ch);
                }
                None => {
                    current_style = Some(style);
                    current_text.push(ch);
                }
            }
        }

        if let Some(style) = current_style {
            push_span(&mut spans, style, current_text);
        }

        lines.push(TerminalLine { spans });
    }

    // 然后包含当前可见的屏幕内容
    for row in &screen.cells {
        let Some(last_non_blank) = row
            .iter()
            .rposition(|cell| cell.ch != ' ' && cell.ch != '\0')
        else {
            lines.push(TerminalLine { spans: Vec::new() });
            continue
        };

        let mut spans = Vec::new();
        let mut current_style: Option<StyleKey> = None;
        let mut current_text = String::new();

        for cell in row.iter().take(last_non_blank + 1) {
            let ch = if cell.ch == '\0' { ' ' } else { cell.ch };
            let style = StyleKey::from_cell(cell);

            match current_style {
                Some(existing) if existing == style => {
                    current_text.push(ch);
                }
                Some(existing) => {
                    let completed = std::mem::take(&mut current_text);
                    push_span(&mut spans, existing, completed);
                    current_style = Some(style);
                    current_text.push(ch);
                }
                None => {
                    current_style = Some(style);
                    current_text.push(ch);
                }
            }
        }

        if let Some(style) = current_style {
            push_span(&mut spans, style, current_text);
        }

        lines.push(TerminalLine { spans });
    }

    // 不要删除末尾的空行！保持完整的行数
    // while lines.last().is_some_and(|line| line.spans.is_empty()) {
    //     lines.pop();
    // }

    TerminalSnapshot {
        rows: screen.rows as u16,
        cols: screen.cols as u16,
        cursor_row: (screen.scrollback.len() + screen.cursor_row) as u16,
        cursor_col: screen.cursor_col as u16,
        lines,
    }
}
