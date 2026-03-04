use super::color::RgbaColor;
use unicode_width::UnicodeWidthChar;

#[derive(Clone, Copy, Debug)]
pub struct Cell {
    pub ch: char,
    pub fg_color: RgbaColor,
    pub bg_color: RgbaColor,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
}

impl Default for Cell {
    fn default() -> Self {
        Cell {
            ch: ' ',
            fg_color: RgbaColor::WHITE,
            bg_color: RgbaColor::BLACK,
            bold: false,
            italic: false,
            underline: false,
        }
    }
}

pub struct ScreenBuffer {
    pub rows: usize,
    pub cols: usize,
    pub cells: Vec<Vec<Cell>>,
    pub scrollback: Vec<Vec<Cell>>,
    pub cursor_row: usize,
    pub cursor_col: usize,
    pub max_scrollback: usize,
}

impl ScreenBuffer {
    pub fn new(rows: usize, cols: usize) -> Self {
        let cells = vec![vec![Cell::default(); cols]; rows];
        ScreenBuffer {
            rows,
            cols,
            cells,
            scrollback: Vec::new(),
            cursor_row: 0,
            cursor_col: 0,
            max_scrollback: 10000,
        }
    }

    pub fn resize(&mut self, rows: usize, cols: usize) {
        self.rows = rows;
        self.cols = cols;
        self.cells.resize(rows, vec![Cell::default(); cols]);
        for row in &mut self.cells {
            row.resize(cols, Cell::default());
        }
    }

    pub fn write_char(
        &mut self,
        ch: char,
        fg: RgbaColor,
        bg: RgbaColor,
        bold: bool,
        italic: bool,
        underline: bool,
    ) {
        if self.cursor_row >= self.rows {
            self.scroll_up();
            self.cursor_row = self.rows - 1;
        }

        if self.cursor_col >= self.cols {
            self.cursor_col = 0;
            self.cursor_row += 1;
            if self.cursor_row >= self.rows {
                self.scroll_up();
                self.cursor_row = self.rows - 1;
            }
        }

        // 写入字符
        self.cells[self.cursor_row][self.cursor_col] = Cell {
            ch,
            fg_color: fg,
            bg_color: bg,
            bold,
            italic,
            underline,
        };

        // 获取字符宽度（中文等宽字符占2列）
        let char_width = ch.width().unwrap_or(1);

        // 如果是宽字符，在下一列放置占位符
        if char_width == 2 && self.cursor_col + 1 < self.cols {
            self.cells[self.cursor_row][self.cursor_col + 1] = Cell {
                ch: '\0', // 占位符
                fg_color: fg,
                bg_color: bg,
                bold,
                italic,
                underline,
            };
        }

        // 移动光标
        self.cursor_col += char_width;
    }

    pub fn newline(&mut self) {
        self.cursor_col = 0;
        self.cursor_row += 1;
        if self.cursor_row >= self.rows {
            self.scroll_up();
            self.cursor_row = self.rows - 1;
        }
    }

    pub fn carriage_return(&mut self) {
        self.cursor_col = 0;
    }

    pub fn move_cursor(&mut self, row: usize, col: usize) {
        self.cursor_row = row.min(self.rows - 1);
        self.cursor_col = col.min(self.cols - 1);
    }

    fn scroll_up(&mut self) {
        if let Some(first_row) = self.cells.first().cloned() {
            self.scrollback.push(first_row);
            if self.scrollback.len() > self.max_scrollback {
                self.scrollback.remove(0);
            }
        }
        self.cells.remove(0);
        self.cells.push(vec![Cell::default(); self.cols]);
    }

    pub fn clear_screen(&mut self) {
        for row in &mut self.cells {
            for cell in row {
                *cell = Cell::default();
            }
        }
        self.cursor_row = 0;
        self.cursor_col = 0;
    }

    pub fn visible_text(&self) -> String {
        let mut lines = Vec::with_capacity(self.rows);

        for row in &self.cells {
            let mut line = String::with_capacity(self.cols);
            for cell in row {
                line.push(cell.ch);
            }
            let trimmed = line.trim_end_matches(' ');
            lines.push(trimmed.to_string());
        }

        while lines.last().is_some_and(|line| line.is_empty()) {
            lines.pop();
        }

        lines.join("\n")
    }
}
