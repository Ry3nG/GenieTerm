#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESULTS_DIR="$ROOT_DIR/benchmarks/results"
mkdir -p "$RESULTS_DIR"

cd "$ROOT_DIR"

COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT_FILE="$RESULTS_DIR/${STAMP}-${COMMIT}.json"

echo "Building core benchmark binary..."
cargo build --release --bin core_bench >/dev/null

echo "Running core benchmark..."
GIT_COMMIT="$COMMIT" "$ROOT_DIR/target/release/core_bench" --output "$OUT_FILE" >/dev/null

cp "$OUT_FILE" "$RESULTS_DIR/latest.json"
echo "Benchmark result written: $OUT_FILE"
echo "Latest result updated: $RESULTS_DIR/latest.json"

if [[ -f "$ROOT_DIR/benchmarks/baseline.json" ]]; then
  echo "Running regression check against baseline..."
  "$ROOT_DIR/benchmarks/check_regression.py" \
    --baseline "$ROOT_DIR/benchmarks/baseline.json" \
    --result "$RESULTS_DIR/latest.json" \
    --thresholds "$ROOT_DIR/benchmarks/thresholds.json"
fi
