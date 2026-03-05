use super::{screen_buffer::ScreenBuffer, RgbaColor};
use vte::{Params, Perform};

#[derive(Clone, Copy)]
struct StyleState {
    current_fg: RgbaColor,
    current_bg: RgbaColor,
    bold: bool,
    italic: bool,
    underline: bool,
    inverse: bool,
}

impl Default for StyleState {
    fn default() -> Self {
        Self {
            current_fg: RgbaColor::WHITE,
            current_bg: RgbaColor::BLACK,
            bold: false,
            italic: false,
            underline: false,
            inverse: false,
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
        match code % 10 {
            0 => RgbaColor::new(50, 50, 50, 255),
            1 => RgbaColor::new(205, 49, 49, 255),
            2 => RgbaColor::new(13, 188, 121, 255),
            3 => RgbaColor::new(229, 229, 16, 255),
            4 => RgbaColor::new(36, 114, 200, 255),
            5 => RgbaColor::new(188, 63, 188, 255),
            6 => RgbaColor::new(17, 168, 205, 255),
            7 => RgbaColor::new(229, 229, 229, 255),
            _ => RgbaColor::WHITE,
        }
    }

    fn bright_color_from_ansi(code: u16) -> RgbaColor {
        match code % 10 {
            0 => RgbaColor::DARK_GRAY,
            1 => RgbaColor::new(241, 76, 76, 255),
            2 => RgbaColor::new(35, 209, 139, 255),
            3 => RgbaColor::new(245, 245, 67, 255),
            4 => RgbaColor::new(59, 142, 234, 255),
            5 => RgbaColor::new(214, 112, 214, 255),
            6 => RgbaColor::new(41, 184, 219, 255),
            7 => RgbaColor::WHITE,
            _ => RgbaColor::WHITE,
        }
    }

    fn color_from_256(index: u16) -> RgbaColor {
        match index {
            0..=7 => Self::color_from_ansi(30 + index),
            8..=15 => Self::bright_color_from_ansi(90 + (index - 8)),
            16..=231 => {
                let idx = index - 16;
                let r = idx / 36;
                let g = (idx % 36) / 6;
                let b = idx % 6;

                fn channel(v: u16) -> u8 {
                    if v == 0 {
                        0
                    } else {
                        (v * 40 + 55) as u8
                    }
                }

                RgbaColor::new(channel(r), channel(g), channel(b), 255)
            }
            232..=255 => {
                let gray = ((index - 232) * 10 + 8) as u8;
                RgbaColor::new(gray, gray, gray, 255)
            }
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

    fn for_each_param(params: &Params, mut f: impl FnMut(u16)) {
        let mut has_any = false;

        for param in params.iter() {
            has_any = true;
            if param.is_empty() {
                f(0);
            } else {
                for &value in param {
                    f(value);
                }
            }
        }

        if !has_any {
            f(0);
        }
    }

    fn flatten_params(params: &Params) -> Vec<u16> {
        let mut values = Vec::with_capacity(8);

        for param in params.iter() {
            if param.is_empty() {
                values.push(0);
            } else {
                for &value in param {
                    values.push(value);
                }
            }
        }

        if values.is_empty() {
            values.push(0);
        }

        values
    }

    fn to_u8_clamped(value: u16) -> u8 {
        value.min(255) as u8
    }

    fn decode_extended_color(values: &[u16], start: usize) -> Option<(RgbaColor, usize)> {
        if start >= values.len() {
            return None;
        }

        match values[start] {
            5 => {
                if start + 1 < values.len() {
                    Some((Self::color_from_256(values[start + 1]), 2))
                } else {
                    None
                }
            }
            2 => {
                if start + 3 < values.len() {
                    Some((
                        RgbaColor::new(
                            Self::to_u8_clamped(values[start + 1]),
                            Self::to_u8_clamped(values[start + 2]),
                            Self::to_u8_clamped(values[start + 3]),
                            255,
                        ),
                        4,
                    ))
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    fn apply_sgr(&mut self, params: &Params) {
        let mut params_iter = params.iter();
        if let Some(first) = params_iter.next() {
            if params_iter.next().is_none() && first.len() <= 1 {
                match first.first().copied().unwrap_or(0) {
                    0 => {
                        *self.style = StyleState::default();
                        return;
                    }
                    1 => {
                        self.style.bold = true;
                        return;
                    }
                    3 => {
                        self.style.italic = true;
                        return;
                    }
                    4 => {
                        self.style.underline = true;
                        return;
                    }
                    7 => {
                        self.style.inverse = true;
                        return;
                    }
                    22 => {
                        self.style.bold = false;
                        return;
                    }
                    23 => {
                        self.style.italic = false;
                        return;
                    }
                    24 => {
                        self.style.underline = false;
                        return;
                    }
                    27 => {
                        self.style.inverse = false;
                        return;
                    }
                    39 => {
                        self.style.current_fg = RgbaColor::WHITE;
                        return;
                    }
                    49 => {
                        self.style.current_bg = RgbaColor::BLACK;
                        return;
                    }
                    value @ 30..=37 => {
                        self.style.current_fg = Self::color_from_ansi(value);
                        return;
                    }
                    value @ 40..=47 => {
                        self.style.current_bg = Self::color_from_ansi(value - 10);
                        return;
                    }
                    value @ 90..=97 => {
                        self.style.current_fg = Self::bright_color_from_ansi(value);
                        return;
                    }
                    value @ 100..=107 => {
                        self.style.current_bg = Self::bright_color_from_ansi(value - 10);
                        return;
                    }
                    _ => {}
                }
            }
        } else {
            *self.style = StyleState::default();
            return;
        }

        let values = Self::flatten_params(params);
        let mut i = 0usize;

        while i < values.len() {
            match values[i] {
                0 => *self.style = StyleState::default(),
                1 => self.style.bold = true,
                3 => self.style.italic = true,
                4 => self.style.underline = true,
                7 => self.style.inverse = true,
                22 => self.style.bold = false,
                23 => self.style.italic = false,
                24 => self.style.underline = false,
                27 => self.style.inverse = false,
                30..=37 => self.style.current_fg = Self::color_from_ansi(values[i]),
                40..=47 => self.style.current_bg = Self::color_from_ansi(values[i] - 10),
                90..=97 => self.style.current_fg = Self::bright_color_from_ansi(values[i]),
                100..=107 => self.style.current_bg = Self::bright_color_from_ansi(values[i] - 10),
                39 => self.style.current_fg = RgbaColor::WHITE,
                49 => self.style.current_bg = RgbaColor::BLACK,
                38 => {
                    if let Some((color, consumed)) = Self::decode_extended_color(&values, i + 1) {
                        self.style.current_fg = color;
                        i += consumed;
                    }
                }
                48 => {
                    if let Some((color, consumed)) = Self::decode_extended_color(&values, i + 1) {
                        self.style.current_bg = color;
                        i += consumed;
                    }
                }
                _ => {}
            }

            i += 1;
        }
    }

    fn handle_private_mode(&mut self, params: &Params, action: char) {
        let enable = action == 'h';

        Self::for_each_param(params, |mode| {
            match mode {
                25 => self.buffer.set_cursor_visible(enable),
                1000 | 1002 | 1003 => self.buffer.set_mouse_tracking_mode(mode, enable),
                1004 => self.buffer.set_focus_event_mode(enable),
                1006 => self.buffer.set_mouse_sgr_mode(enable),
                47 => {
                    if enable {
                        self.buffer.enter_alternate_screen(false);
                    } else {
                        self.buffer.exit_alternate_screen();
                    }
                }
                1047 | 1049 => {
                    if enable {
                        self.buffer.enter_alternate_screen(true);
                    } else {
                        self.buffer.exit_alternate_screen();
                    }
                }
                1048 => {
                    if enable {
                        self.buffer.save_cursor();
                    } else {
                        self.buffer.restore_cursor();
                    }
                }
                2004 => self.buffer.set_bracketed_paste_mode(enable),
                _ => {}
            }
        });
    }
}

impl<'a> Perform for AnsiParser<'a> {
    fn print(&mut self, c: char) {
        let (fg, bg) = if self.style.inverse {
            (self.style.current_bg, self.style.current_fg)
        } else {
            (self.style.current_fg, self.style.current_bg)
        };

        self.buffer.write_char(
            c,
            fg,
            bg,
            self.style.bold,
            self.style.italic,
            self.style.underline,
        );
    }

    fn execute(&mut self, byte: u8) {
        match byte {
            b'\n' => self.buffer.newline(),
            b'\r' => self.buffer.carriage_return(),
            b'\t' => self.buffer.tab(),
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

    fn csi_dispatch(&mut self, params: &Params, intermediates: &[u8], _ignore: bool, c: char) {
        let is_private = intermediates.contains(&b'?');
        if is_private && (c == 'h' || c == 'l') {
            self.handle_private_mode(params, c);
            return;
        }

        match c {
            'm' => {
                self.apply_sgr(params);
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
            'a' => {
                // Cursor forward alias
                let n = Self::param_or(params, 0, 1);
                let col = self.buffer.cursor_col.saturating_add(n);
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
            '`' => {
                // Cursor horizontal absolute alias
                let col = Self::param_or(params, 0, 1).saturating_sub(1);
                self.buffer.move_cursor(self.buffer.cursor_row, col);
            }
            'd' => {
                // Cursor vertical absolute
                let row = Self::param_or(params, 0, 1).saturating_sub(1);
                self.buffer.move_cursor(row, self.buffer.cursor_col);
            }
            'e' => {
                // Cursor down alias
                let n = Self::param_or(params, 0, 1);
                let row = self.buffer.cursor_row.saturating_add(n);
                self.buffer.move_cursor(row, self.buffer.cursor_col);
            }
            'J' => {
                // Clear screen
                let mode = Self::param_or(params, 0, 0);
                self.buffer.erase_in_display(mode);
            }
            'K' => {
                // Clear line
                let mode = Self::param_or(params, 0, 0);
                self.buffer.erase_in_line(mode);
            }
            '@' => {
                let n = Self::param_or(params, 0, 1);
                self.buffer.insert_blank_chars(n);
            }
            'P' => {
                let n = Self::param_or(params, 0, 1);
                self.buffer.delete_chars(n);
            }
            'X' => {
                let n = Self::param_or(params, 0, 1);
                self.buffer.erase_chars(n);
            }
            'L' => {
                let n = Self::param_or(params, 0, 1);
                self.buffer.insert_lines(n);
            }
            'M' => {
                let n = Self::param_or(params, 0, 1);
                self.buffer.delete_lines(n);
            }
            'S' => {
                let n = Self::param_or(params, 0, 1);
                self.buffer.scroll_up_lines(n);
            }
            'T' => {
                let n = Self::param_or(params, 0, 1);
                self.buffer.scroll_down_lines(n);
            }
            'r' => {
                let rows = self.buffer.rows.max(1);
                let top = Self::param_or(params, 0, 1).saturating_sub(1);
                let bottom = Self::param_or(params, 1, rows).saturating_sub(1);
                if top == 0 && bottom + 1 >= rows {
                    self.buffer.reset_scroll_region();
                } else {
                    self.buffer.set_scroll_region(top, bottom);
                }
            }
            's' => self.buffer.save_cursor(),
            'u' => self.buffer.restore_cursor(),
            _ => {}
        }
    }

    fn esc_dispatch(&mut self, _intermediates: &[u8], _ignore: bool, byte: u8) {
        match byte {
            b'7' => self.buffer.save_cursor(),
            b'8' => self.buffer.restore_cursor(),
            b'D' => self.buffer.index(),
            b'E' => self.buffer.newline(),
            b'M' => self.buffer.reverse_index(),
            _ => {}
        }
    }
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
