use super::color::RgbaColor;
use std::collections::VecDeque;
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

#[derive(Clone)]
struct SavedPrimaryScreen {
    cells: Vec<Vec<Cell>>,
    cursor_row: usize,
    cursor_col: usize,
    scroll_top: usize,
    scroll_bottom: usize,
}

pub struct ScreenBuffer {
    pub rows: usize,
    pub cols: usize,
    pub cells: Vec<Vec<Cell>>,
    pub scrollback: VecDeque<Vec<Cell>>,
    pub cursor_row: usize,
    pub cursor_col: usize,
    pub max_scrollback: usize,
    saved_cursor: Option<(usize, usize)>,
    saved_primary: Option<SavedPrimaryScreen>,
    alternate_screen: bool,
    bracketed_paste_mode: bool,
    mode_1000: bool,
    mode_1002: bool,
    mode_1003: bool,
    mouse_sgr_mode: bool,
    focus_event_mode: bool,
    cursor_visible: bool,
    scroll_top: usize,
    scroll_bottom: usize,
}

impl ScreenBuffer {
    pub fn new(rows: usize, cols: usize) -> Self {
        let cells = vec![Self::blank_row(cols); rows];
        ScreenBuffer {
            rows,
            cols,
            cells,
            scrollback: VecDeque::new(),
            cursor_row: 0,
            cursor_col: 0,
            max_scrollback: 10000,
            saved_cursor: None,
            saved_primary: None,
            alternate_screen: false,
            bracketed_paste_mode: false,
            mode_1000: false,
            mode_1002: false,
            mode_1003: false,
            mouse_sgr_mode: false,
            focus_event_mode: false,
            cursor_visible: true,
            scroll_top: 0,
            scroll_bottom: rows.saturating_sub(1),
        }
    }

    pub fn resize(&mut self, rows: usize, cols: usize) {
        self.rows = rows;
        self.cols = cols;

        Self::resize_grid(&mut self.cells, rows, cols);

        if let Some(saved_primary) = &mut self.saved_primary {
            Self::resize_grid(&mut saved_primary.cells, rows, cols);
            saved_primary.cursor_row = saved_primary.cursor_row.min(rows.saturating_sub(1));
            saved_primary.cursor_col = saved_primary.cursor_col.min(cols);
            saved_primary.scroll_top = saved_primary.scroll_top.min(rows.saturating_sub(1));
            saved_primary.scroll_bottom = saved_primary.scroll_bottom.min(rows.saturating_sub(1));
            if saved_primary.scroll_top > saved_primary.scroll_bottom {
                saved_primary.scroll_top = 0;
                saved_primary.scroll_bottom = rows.saturating_sub(1);
            }
        }

        self.cursor_row = self.cursor_row.min(rows.saturating_sub(1));
        self.cursor_col = self.cursor_col.min(cols);
        self.scroll_top = self.scroll_top.min(rows.saturating_sub(1));
        self.scroll_bottom = self.scroll_bottom.min(rows.saturating_sub(1));
        if self.scroll_top > self.scroll_bottom {
            self.reset_scroll_region();
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
        if self.rows == 0 || self.cols == 0 {
            return;
        }

        if self.cursor_row >= self.rows {
            self.cursor_row = self.rows - 1;
        }

        if self.cursor_col >= self.cols {
            self.cursor_col = 0;
            self.index();
        }

        self.cells[self.cursor_row][self.cursor_col] = Cell {
            ch,
            fg_color: fg,
            bg_color: bg,
            bold,
            italic,
            underline,
        };

        let char_width = if ch.is_ascii() {
            1
        } else {
            ch.width().unwrap_or(1)
        };

        if char_width == 2 && self.cursor_col + 1 < self.cols {
            self.cells[self.cursor_row][self.cursor_col + 1] = Cell {
                ch: '\0',
                fg_color: fg,
                bg_color: bg,
                bold,
                italic,
                underline,
            };
        }

        self.cursor_col += char_width;
    }

    pub fn newline(&mut self) {
        self.carriage_return();
        self.index();
    }

    pub fn index(&mut self) {
        if self.rows == 0 {
            return;
        }

        let bottom = self.scroll_bottom.min(self.rows.saturating_sub(1));
        let top = self.scroll_top.min(bottom);

        if self.cursor_row == bottom {
            self.scroll_up_region(top, bottom);
        } else {
            self.cursor_row = self.cursor_row.saturating_add(1).min(self.rows.saturating_sub(1));
        }
    }

    pub fn carriage_return(&mut self) {
        self.cursor_col = 0;
    }

    pub fn move_cursor(&mut self, row: usize, col: usize) {
        self.cursor_row = row.min(self.rows.saturating_sub(1));
        self.cursor_col = col.min(self.cols.saturating_sub(1));
    }

    pub fn save_cursor(&mut self) {
        self.saved_cursor = Some((self.cursor_row, self.cursor_col));
    }

    pub fn restore_cursor(&mut self) {
        if let Some((row, col)) = self.saved_cursor {
            self.move_cursor(row, col);
        }
    }

    pub fn tab(&mut self) {
        if self.cols == 0 {
            return;
        }

        let next_tab_stop = ((self.cursor_col / 8) + 1) * 8;
        self.cursor_col = next_tab_stop.min(self.cols.saturating_sub(1));
    }

    pub fn reverse_index(&mut self) {
        if self.rows == 0 {
            return;
        }

        let top = self.scroll_top.min(self.scroll_bottom);
        let bottom = self.scroll_bottom.min(self.rows.saturating_sub(1));

        if self.cursor_row == top {
            self.scroll_down_region(top, bottom);
        } else {
            self.cursor_row = self.cursor_row.saturating_sub(1);
        }
    }

    pub fn erase_in_display(&mut self, mode: usize) {
        if self.rows == 0 || self.cols == 0 {
            return;
        }

        match mode {
            0 => {
                self.erase_in_line(0);
                for row in (self.cursor_row + 1)..self.rows {
                    self.clear_row(row);
                }
            }
            1 => {
                self.erase_in_line(1);
                for row in 0..self.cursor_row {
                    self.clear_row(row);
                }
            }
            2 => {
                for row in 0..self.rows {
                    self.clear_row(row);
                }
            }
            3 => {
                for row in 0..self.rows {
                    self.clear_row(row);
                }
                self.scrollback.clear();
            }
            _ => {}
        }
    }

    pub fn erase_in_line(&mut self, mode: usize) {
        if self.rows == 0 || self.cols == 0 || self.cursor_row >= self.rows {
            return;
        }

        match mode {
            0 => {
                for col in self.cursor_col.min(self.cols)..self.cols {
                    self.cells[self.cursor_row][col] = Cell::default();
                }
            }
            1 => {
                let end = self.cursor_col.min(self.cols.saturating_sub(1));
                for col in 0..=end {
                    self.cells[self.cursor_row][col] = Cell::default();
                }
            }
            2 => {
                self.clear_row(self.cursor_row);
            }
            _ => {}
        }
    }

    pub fn insert_blank_chars(&mut self, count: usize) {
        if self.rows == 0 || self.cols == 0 || self.cursor_row >= self.rows {
            return;
        }

        let row = self.cursor_row;
        let start = self.cursor_col.min(self.cols);
        let count = count.min(self.cols.saturating_sub(start));
        if count == 0 {
            return;
        }

        for col in (start + count..self.cols).rev() {
            self.cells[row][col] = self.cells[row][col - count];
        }
        for col in start..start + count {
            self.cells[row][col] = Cell::default();
        }
    }

    pub fn delete_chars(&mut self, count: usize) {
        if self.rows == 0 || self.cols == 0 || self.cursor_row >= self.rows {
            return;
        }

        let row = self.cursor_row;
        let start = self.cursor_col.min(self.cols);
        let count = count.min(self.cols.saturating_sub(start));
        if count == 0 {
            return;
        }

        for col in start..self.cols - count {
            self.cells[row][col] = self.cells[row][col + count];
        }
        for col in self.cols - count..self.cols {
            self.cells[row][col] = Cell::default();
        }
    }

    pub fn erase_chars(&mut self, count: usize) {
        if self.rows == 0 || self.cols == 0 || self.cursor_row >= self.rows {
            return;
        }

        let start = self.cursor_col.min(self.cols);
        let end = (start + count).min(self.cols);
        for col in start..end {
            self.cells[self.cursor_row][col] = Cell::default();
        }
    }

    pub fn insert_lines(&mut self, count: usize) {
        if self.rows == 0 || self.cursor_row >= self.rows {
            return;
        }

        if !self.cursor_in_scroll_region() {
            return;
        }

        let row = self.cursor_row;
        let bottom = self.scroll_bottom.min(self.rows.saturating_sub(1));
        let count = count.min(bottom.saturating_sub(row) + 1);
        for _ in 0..count {
            self.cells.insert(row, Self::blank_row(self.cols));
            self.cells.remove(bottom + 1);
        }
    }

    pub fn delete_lines(&mut self, count: usize) {
        if self.rows == 0 || self.cursor_row >= self.rows {
            return;
        }

        if !self.cursor_in_scroll_region() {
            return;
        }

        let row = self.cursor_row;
        let bottom = self.scroll_bottom.min(self.rows.saturating_sub(1));
        let count = count.min(bottom.saturating_sub(row) + 1);
        for _ in 0..count {
            self.cells.remove(row);
            self.cells.insert(bottom, Self::blank_row(self.cols));
        }
    }

    pub fn scroll_up_lines(&mut self, count: usize) {
        if self.rows == 0 {
            return;
        }

        let top = self.scroll_top.min(self.scroll_bottom);
        let bottom = self.scroll_bottom.min(self.rows.saturating_sub(1));
        for _ in 0..count.max(1) {
            self.scroll_up_region(top, bottom);
        }
    }

    pub fn scroll_down_lines(&mut self, count: usize) {
        if self.rows == 0 {
            return;
        }

        let top = self.scroll_top.min(self.scroll_bottom);
        let bottom = self.scroll_bottom.min(self.rows.saturating_sub(1));
        for _ in 0..count.max(1) {
            self.scroll_down_region(top, bottom);
        }
    }

    pub fn enter_alternate_screen(&mut self, clear: bool) {
        if !self.alternate_screen {
            self.saved_primary = Some(SavedPrimaryScreen {
                cells: self.cells.clone(),
                cursor_row: self.cursor_row,
                cursor_col: self.cursor_col,
                scroll_top: self.scroll_top,
                scroll_bottom: self.scroll_bottom,
            });
            self.alternate_screen = true;
        }

        if clear {
            self.cells = vec![Self::blank_row(self.cols); self.rows];
            self.cursor_row = 0;
            self.cursor_col = 0;
        }

        self.reset_scroll_region();
    }

    pub fn exit_alternate_screen(&mut self) {
        if !self.alternate_screen {
            return;
        }

        if let Some(saved_primary) = self.saved_primary.take() {
            self.cells = saved_primary.cells;
            self.cursor_row = saved_primary.cursor_row.min(self.rows.saturating_sub(1));
            self.cursor_col = saved_primary.cursor_col.min(self.cols);
            self.scroll_top = saved_primary.scroll_top.min(self.rows.saturating_sub(1));
            self.scroll_bottom = saved_primary.scroll_bottom.min(self.rows.saturating_sub(1));
            if self.scroll_top > self.scroll_bottom {
                self.reset_scroll_region();
            }
        }

        self.alternate_screen = false;
    }

    pub fn set_bracketed_paste_mode(&mut self, enabled: bool) {
        self.bracketed_paste_mode = enabled;
    }

    pub fn bracketed_paste_mode(&self) -> bool {
        self.bracketed_paste_mode
    }

    pub fn set_mouse_tracking_mode(&mut self, mode: u16, enabled: bool) {
        match mode {
            1000 => self.mode_1000 = enabled,
            1002 => self.mode_1002 = enabled,
            1003 => self.mode_1003 = enabled,
            _ => {}
        }
    }

    pub fn mouse_tracking_mode(&self) -> u8 {
        if self.mode_1003 {
            3
        } else if self.mode_1002 {
            2
        } else if self.mode_1000 {
            1
        } else {
            0
        }
    }

    pub fn set_mouse_sgr_mode(&mut self, enabled: bool) {
        self.mouse_sgr_mode = enabled;
    }

    pub fn mouse_sgr_mode(&self) -> bool {
        self.mouse_sgr_mode
    }

    pub fn set_focus_event_mode(&mut self, enabled: bool) {
        self.focus_event_mode = enabled;
    }

    pub fn focus_event_mode(&self) -> bool {
        self.focus_event_mode
    }

    pub fn set_cursor_visible(&mut self, visible: bool) {
        self.cursor_visible = visible;
    }

    pub fn cursor_visible(&self) -> bool {
        self.cursor_visible
    }

    pub fn is_alternate_screen(&self) -> bool {
        self.alternate_screen
    }

    pub fn set_scroll_region(&mut self, top: usize, bottom: usize) {
        if self.rows == 0 {
            return;
        }

        let top = top.min(self.rows.saturating_sub(1));
        let bottom = bottom.min(self.rows.saturating_sub(1));

        if top >= bottom {
            self.reset_scroll_region();
            return;
        }

        self.scroll_top = top;
        self.scroll_bottom = bottom;
        self.cursor_row = self.scroll_top;
        self.cursor_col = 0;
    }

    pub fn reset_scroll_region(&mut self) {
        self.scroll_top = 0;
        self.scroll_bottom = self.rows.saturating_sub(1);
    }

    pub fn clear_screen(&mut self) {
        for row in 0..self.rows {
            self.clear_row(row);
        }
        self.cursor_row = 0;
        self.cursor_col = 0;
    }

    fn cursor_in_scroll_region(&self) -> bool {
        self.cursor_row >= self.scroll_top && self.cursor_row <= self.scroll_bottom
    }

    fn scroll_up_region(&mut self, top: usize, bottom: usize) {
        if self.rows == 0 || top >= self.rows || bottom >= self.rows || top > bottom {
            return;
        }

        let removed = self.cells.remove(top);
        if !self.alternate_screen && top == 0 {
            self.scrollback.push_back(removed);
            if self.scrollback.len() > self.max_scrollback {
                let _ = self.scrollback.pop_front();
            }
        }
        self.cells.insert(bottom, Self::blank_row(self.cols));
    }

    fn scroll_down_region(&mut self, top: usize, bottom: usize) {
        if self.rows == 0 || top >= self.rows || bottom >= self.rows || top > bottom {
            return;
        }

        self.cells.remove(bottom);
        self.cells.insert(top, Self::blank_row(self.cols));
    }

    fn clear_row(&mut self, row: usize) {
        if row >= self.rows {
            return;
        }

        for cell in &mut self.cells[row] {
            *cell = Cell::default();
        }
    }

    fn blank_row(cols: usize) -> Vec<Cell> {
        vec![Cell::default(); cols]
    }

    fn resize_grid(cells: &mut Vec<Vec<Cell>>, rows: usize, cols: usize) {
        cells.resize(rows, Self::blank_row(cols));
        for row in cells {
            row.resize(cols, Cell::default());
        }
    }
}
