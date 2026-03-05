# Benchmarks

This folder provides a stable, repeatable benchmark workflow for GenieTerm core and E2E performance.

## What is measured

Automated metrics from `core_bench`:

- `parser_plain_lines_per_sec`: plain-text ANSI parser throughput
- `parser_plain_bytes_per_sec`: plain-text parser byte throughput
- `parser_ansi_lines_per_sec`: color/ANSI parser throughput
- `parser_ansi_bytes_per_sec`: color/ANSI parser byte throughput
- `snapshot_visible_ms_p50` / `snapshot_visible_ms_p95`: visible-screen JSON snapshot latency
- `snapshot_recent_scrollback_ms_p50` / `snapshot_recent_scrollback_ms_p95`: recent scrollback JSON snapshot latency
- `snapshot_visible_json_bytes`: visible snapshot payload size
- `snapshot_recent_scrollback_json_bytes`: scrollback chunk payload size
- `scrollback_lines_after_workload`: scrollback growth after workload

Automated metrics from `GenieTermE2EBench`:

- `e2e_poll_json_ms_p95`: FFI snapshot polling latency
- `e2e_decode_ms_p95`: Swift JSON decode latency
- `e2e_coretext_build_ms_p95`: CoreText line-build latency
- `e2e_frame_total_ms_p95`: end-to-end per-frame latency
- `e2e_input_to_render_ms_p95`: input-to-render latency (send input -> decoded frame containing marker)

## Run benchmarks

From repository root:

```bash
./benchmarks/run_benchmarks.sh
./benchmarks/run_e2e_bench.sh
./benchmarks/run_stable_suite.sh --runs 20
./benchmarks/compare_releases_core.sh --ref-a v0.1.0 --ref-b v0.2.0 --runs 20
```

Artifacts:

- Timestamped result JSON: `benchmarks/results/<utc>-<commit>.json`
- Latest result copy: `benchmarks/results/latest.json`
- Timestamped E2E result JSON: `benchmarks/results/e2e-<utc>-<commit>.json`
- Latest E2E result copy: `benchmarks/results/latest_e2e.json`

## Regression check

Compare latest result against baseline:

```bash
./benchmarks/check_regression.py \
  --baseline benchmarks/baseline.json \
  --result benchmarks/results/latest.json \
  --thresholds benchmarks/thresholds.json
```

Failing metrics return non-zero exit code.

For E2E results:

```bash
./benchmarks/check_regression.py \
  --baseline benchmarks/e2e_baseline.json \
  --result benchmarks/results/latest_e2e.json \
  --thresholds benchmarks/e2e_thresholds.json
```

## Environment preflight

Run before benchmarking to capture machine state:

```bash
./benchmarks/preflight_check.sh --strict --max-load 3.0 --output benchmarks/results/preflight.json
```

`--strict` fails fast when 1-minute load average exceeds threshold.

## Baseline maintenance

1. Run benchmarks on a stable machine state.
2. Copy a trusted result to `benchmarks/baseline.json`.
   or run:
   ```bash
   ./benchmarks/update_baseline.sh
   ```
   For E2E baseline:
   ```bash
   ./benchmarks/update_e2e_baseline.sh
   ```
3. Keep `thresholds.json` strict enough to catch regressions.
