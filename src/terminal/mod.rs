pub mod color;
pub mod parser;
pub mod screen_buffer;

pub use color::RgbaColor;
pub use parser::TerminalParser;
pub use screen_buffer::{Cell, ScreenBuffer};
