use genieterm_ffi::engine::{recent_scrollback_json_from_screen, snapshot_json_from_screen};
use genieterm_ffi::terminal::{ScreenBuffer, TerminalParser};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

const BENCH_ROWS: usize = 50;
const BENCH_COLS: usize = 120;

#[derive(Serialize)]
struct BenchConfig {
    rows: usize,
    cols: usize,
    plain_lines: usize,
    ansi_lines: usize,
    snapshot_iterations: usize,
    scrollback_chunk_limit: usize,
}

#[derive(Serialize)]
struct BenchMetrics {
    parser_plain_lines_per_sec: f64,
    parser_plain_bytes_per_sec: f64,
    parser_ansi_lines_per_sec: f64,
    parser_ansi_bytes_per_sec: f64,
    scrollback_plain_lines_per_sec: f64,
    snapshot_visible_ms_p50: f64,
    snapshot_visible_ms_p95: f64,
    snapshot_visible_json_bytes: usize,
    snapshot_recent_scrollback_ms_p50: f64,
    snapshot_recent_scrollback_ms_p95: f64,
    snapshot_recent_scrollback_json_bytes: usize,
    scrollback_lines_after_workload: usize,
}

#[derive(Serialize)]
struct CoreBenchReport {
    schema_version: u32,
    benchmark: &'static str,
    commit: String,
    platform: String,
    rustc_release: String,
    config: BenchConfig,
    metrics: BenchMetrics,
    total_runtime_ms: f64,
}

struct RunArgs {
    output_path: Option<PathBuf>,
}

fn parse_args() -> RunArgs {
    let mut output_path: Option<PathBuf> = None;
    let args: Vec<String> = std::env::args().collect();
    let mut i = 1usize;
    while i < args.len() {
        match args[i].as_str() {
            "--output" => {
                if i + 1 < args.len() {
                    output_path = Some(PathBuf::from(&args[i + 1]));
                    i += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }
    RunArgs { output_path }
}

fn build_plain_workload(lines: usize, width: usize) -> Vec<u8> {
    let mut output = String::with_capacity(lines.saturating_mul(width + 16));
    for i in 0..lines {
        output.push_str(&format!("{i:06} "));
        let payload_width = width.saturating_sub(8);
        for j in 0..payload_width {
            let ch = (b'a' + (j % 26) as u8) as char;
            output.push(ch);
        }
        output.push('\n');
    }
    output.into_bytes()
}

fn build_ansi_workload(lines: usize, width: usize) -> Vec<u8> {
    let mut output = String::with_capacity(lines.saturating_mul(width + 32));
    let colors = [31, 32, 33, 34, 35, 36, 91, 92];
    for i in 0..lines {
        let c = colors[i % colors.len()];
        output.push_str(&format!("\u{1b}[{c}m"));
        output.push_str(&format!("{i:06} "));
        let payload_width = width.saturating_sub(8);
        for j in 0..payload_width {
            let ch = (b'A' + (j % 26) as u8) as char;
            output.push(ch);
        }
        output.push_str("\u{1b}[0m\n");
    }
    output.into_bytes()
}

fn run_parser_workload(payload: &[u8], rows: usize, cols: usize) -> (ScreenBuffer, f64, f64) {
    let mut screen = ScreenBuffer::new(rows, cols);
    let mut parser = TerminalParser::new();

    let start = Instant::now();
    for &b in payload {
        parser.process_byte(b, &mut screen);
    }
    let secs = start.elapsed().as_secs_f64().max(1e-9);
    (screen, payload.len() as f64 / secs, secs)
}

fn percentile(values: &[f64], p: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let pos = ((sorted.len() - 1) as f64 * p).round() as usize;
    sorted[pos.min(sorted.len() - 1)]
}

fn benchmark_snapshot_visible(screen: &ScreenBuffer, iterations: usize) -> (f64, f64, usize) {
    let mut samples_ms = Vec::with_capacity(iterations);
    let mut bytes = 0usize;
    for _ in 0..iterations {
        let start = Instant::now();
        let json = snapshot_json_from_screen(screen);
        let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
        samples_ms.push(elapsed_ms);
        bytes = json.len();
    }
    (
        percentile(&samples_ms, 0.50),
        percentile(&samples_ms, 0.95),
        bytes,
    )
}

fn benchmark_snapshot_recent_scrollback(
    screen: &ScreenBuffer,
    limit: usize,
    iterations: usize,
) -> (f64, f64, usize) {
    let mut samples_ms = Vec::with_capacity(iterations);
    let mut bytes = 0usize;
    for _ in 0..iterations {
        let start = Instant::now();
        let json = recent_scrollback_json_from_screen(screen, limit);
        let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
        samples_ms.push(elapsed_ms);
        bytes = json.len();
    }
    (
        percentile(&samples_ms, 0.50),
        percentile(&samples_ms, 0.95),
        bytes,
    )
}

fn current_commit() -> String {
    std::env::var("GIT_COMMIT").unwrap_or_else(|_| "unknown".to_string())
}

fn main() {
    let args = parse_args();
    let suite_start = Instant::now();

    let config = BenchConfig {
        rows: BENCH_ROWS,
        cols: BENCH_COLS,
        plain_lines: 100_000,
        ansi_lines: 80_000,
        snapshot_iterations: 30,
        scrollback_chunk_limit: 5_000,
    };

    let plain_payload = build_plain_workload(config.plain_lines, config.cols);
    let (plain_screen, plain_bytes_per_sec, plain_secs) =
        run_parser_workload(&plain_payload, config.rows, config.cols);
    let plain_lines_per_sec = config.plain_lines as f64 / plain_secs.max(1e-9);

    let ansi_payload = build_ansi_workload(config.ansi_lines, config.cols);
    let (_ansi_screen, ansi_bytes_per_sec, ansi_secs) =
        run_parser_workload(&ansi_payload, config.rows, config.cols);
    let ansi_lines_per_sec = config.ansi_lines as f64 / ansi_secs.max(1e-9);

    let (visible_p50, visible_p95, visible_bytes) =
        benchmark_snapshot_visible(&plain_screen, config.snapshot_iterations);

    let (scrollback_p50, scrollback_p95, scrollback_bytes) = benchmark_snapshot_recent_scrollback(
        &plain_screen,
        config.scrollback_chunk_limit,
        config.snapshot_iterations,
    );

    let metrics = BenchMetrics {
        parser_plain_lines_per_sec: plain_lines_per_sec,
        parser_plain_bytes_per_sec: plain_bytes_per_sec,
        parser_ansi_lines_per_sec: ansi_lines_per_sec,
        parser_ansi_bytes_per_sec: ansi_bytes_per_sec,
        scrollback_plain_lines_per_sec: plain_lines_per_sec,
        snapshot_visible_ms_p50: visible_p50,
        snapshot_visible_ms_p95: visible_p95,
        snapshot_visible_json_bytes: visible_bytes,
        snapshot_recent_scrollback_ms_p50: scrollback_p50,
        snapshot_recent_scrollback_ms_p95: scrollback_p95,
        snapshot_recent_scrollback_json_bytes: scrollback_bytes,
        scrollback_lines_after_workload: plain_screen.scrollback.len(),
    };

    let report = CoreBenchReport {
        schema_version: 1,
        benchmark: "core_bench",
        commit: current_commit(),
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        rustc_release: option_env!("RUSTC_VERSION")
            .unwrap_or("unknown")
            .to_string(),
        config,
        metrics,
        total_runtime_ms: suite_start.elapsed().as_secs_f64() * 1000.0,
    };

    let json = serde_json::to_string_pretty(&report).expect("serialize benchmark report");
    if let Some(path) = args.output_path {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(path, json.as_bytes()).expect("write benchmark output");
    }
    println!("{json}");
}
