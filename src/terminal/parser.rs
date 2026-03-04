use super::{screen_buffer::ScreenBuffer, RgbaColor};
use vte::{Params, Perform};

#[derive(Clone, Copy)]
struct StyleState {
    current_fg: RgbaColor,
    current_bg: RgbaColor,
    bold: bool,
    italic: bool,
    underline: bool,
}

impl Default for StyleState {
    fn default() -> Self {
        Self {
            current_fg: RgbaColor::WHITE,
            current_bg: RgbaColor::BLACK,
            bold: false,
            italic: false,
            underline: false,
        }
    }
}

pub struct AnsiParser<'a> {
    buffer: &'a mut ScreenBuffer,
    style: &'a mut StyleState,
}

impl<'a> AnsiParser<'a> {
    fn new(buffer: &'a mut ScreenBuffer, style: &'a mut StyleState) -> Self {
        AnsiParser { buffer, style }
    }

    fn color_from_ansi(code: u16) -> RgbaColor {
        match code {
            30 | 40 => RgbaColor::new(50, 50, 50, 255),
            31 | 41 => RgbaColor::new(205, 49, 49, 255),
            32 | 42 => RgbaColor::new(13, 188, 121, 255),
            33 | 43 => RgbaColor::new(229, 229, 16, 255),
            34 | 44 => RgbaColor::new(36, 114, 200, 255),
            35 | 45 => RgbaColor::new(188, 63, 188, 255),
            36 | 46 => RgbaColor::new(17, 168, 205, 255),
            37 | 47 => RgbaColor::new(229, 229, 229, 255),
            90 | 100 => RgbaColor::DARK_GRAY,
            91 | 101 => RgbaColor::new(241, 76, 76, 255),
            92 | 102 => RgbaColor::new(35, 209, 139, 255),
            93 | 103 => RgbaColor::new(245, 245, 67, 255),
            94 | 104 => RgbaColor::new(59, 142, 234, 255),
            95 | 105 => RgbaColor::new(214, 112, 214, 255),
            96 | 106 => RgbaColor::new(41, 184, 219, 255),
            97 | 107 => RgbaColor::WHITE,
            _ => RgbaColor::WHITE,
        }
    }

    fn param_or(params: &Params, index: usize, default: usize) -> usize {
        params
            .iter()
            .nth(index)
            .and_then(|p| p.first().copied())
            .map(|v| if v == 0 { default } else { v as usize })
            .unwrap_or(default)
    }
}

impl<'a> Perform for AnsiParser<'a> {
    fn print(&mut self, c: char) {
        self.buffer.write_char(
            c,
            self.style.current_fg,
            self.style.current_bg,
            self.style.bold,
            self.style.italic,
            self.style.underline,
        );
    }

    fn execute(&mut self, byte: u8) {
        match byte {
            b'\n' => self.buffer.newline(),
            b'\r' => self.buffer.carriage_return(),
            b'\x08' => {
                // Backspace
                if self.buffer.cursor_col > 0 {
                    self.buffer.cursor_col -= 1;
                }
            }
            _ => {}
        }
    }

    fn hook(&mut self, _params: &Params, _intermediates: &[u8], _ignore: bool, _c: char) {}

    fn put(&mut self, _byte: u8) {}

    fn unhook(&mut self) {}

    fn osc_dispatch(&mut self, _params: &[&[u8]], _bell_terminated: bool) {}

    fn csi_dispatch(&mut self, params: &Params, _intermediates: &[u8], _ignore: bool, c: char) {
        match c {
            'm' => {
                if params.is_empty() {
                    *self.style = StyleState::default();
                } else {
                    for param in params.iter() {
                        for &code in param {
                            match code {
                                0 => *self.style = StyleState::default(),
                                1 => self.style.bold = true,
                                3 => self.style.italic = true,
                                4 => self.style.underline = true,
                                22 => self.style.bold = false,
                                23 => self.style.italic = false,
                                24 => self.style.underline = false,
                                30..=37 | 90..=97 => {
                                    self.style.current_fg = Self::color_from_ansi(code)
                                }
                                40..=47 | 100..=107 => {
                                    self.style.current_bg = Self::color_from_ansi(code)
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
            'H' | 'f' => {
                // Cursor position
                let row = Self::param_or(params, 0, 1).saturating_sub(1);
                let col = Self::param_or(params, 1, 1).saturating_sub(1);
                self.buffer.move_cursor(row, col);
            }
            'A' => {
                // Cursor up
                let n = Self::param_or(params, 0, 1);
                let row = self.buffer.cursor_row.saturating_sub(n);
                self.buffer.move_cursor(row, self.buffer.cursor_col);
            }
            'B' => {
                // Cursor down
                let n = Self::param_or(params, 0, 1);
                let row = self.buffer.cursor_row.saturating_add(n);
                self.buffer.move_cursor(row, self.buffer.cursor_col);
            }
            'C' => {
                // Cursor forward
                let n = Self::param_or(params, 0, 1);
                let col = self.buffer.cursor_col.saturating_add(n);
                self.buffer.move_cursor(self.buffer.cursor_row, col);
            }
            'D' => {
                // Cursor backward
                let n = Self::param_or(params, 0, 1);
                let col = self.buffer.cursor_col.saturating_sub(n);
                self.buffer.move_cursor(self.buffer.cursor_row, col);
            }
            'E' => {
                // Cursor next line
                let n = Self::param_or(params, 0, 1);
                let row = self.buffer.cursor_row.saturating_add(n);
                self.buffer.move_cursor(row, 0);
            }
            'F' => {
                // Cursor previous line
                let n = Self::param_or(params, 0, 1);
                let row = self.buffer.cursor_row.saturating_sub(n);
                self.buffer.move_cursor(row, 0);
            }
            'G' => {
                // Cursor horizontal absolute
                let col = Self::param_or(params, 0, 1).saturating_sub(1);
                self.buffer.move_cursor(self.buffer.cursor_row, col);
            }
            'J' => {
                // Clear screen
                let mode = Self::param_or(params, 0, 0);
                if mode == 2 || mode == 3 {
                    self.buffer.clear_screen();
                }
            }
            'K' => {
                // Clear line
                let mode = Self::param_or(params, 0, 0);
                let row = self.buffer.cursor_row;
                let col = self.buffer.cursor_col;
                match mode {
                    0 => {
                        for i in col..self.buffer.cols {
                            self.buffer.cells[row][i] = super::screen_buffer::Cell::default();
                        }
                    }
                    1 => {
                        for i in 0..=col.min(self.buffer.cols.saturating_sub(1)) {
                            self.buffer.cells[row][i] = super::screen_buffer::Cell::default();
                        }
                    }
                    2 => {
                        for i in 0..self.buffer.cols {
                            self.buffer.cells[row][i] = super::screen_buffer::Cell::default();
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    fn esc_dispatch(&mut self, _intermediates: &[u8], _ignore: bool, _byte: u8) {}
}

pub struct TerminalParser {
    parser: vte::Parser,
    style: StyleState,
}

impl TerminalParser {
    pub fn new() -> Self {
        TerminalParser {
            parser: vte::Parser::new(),
            style: StyleState::default(),
        }
    }

    pub fn process_byte(&mut self, byte: u8, buffer: &mut ScreenBuffer) {
        let mut performer = AnsiParser::new(buffer, &mut self.style);
        self.parser.advance(&mut performer, byte);
    }
}
