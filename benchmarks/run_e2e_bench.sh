#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESULTS_DIR="$ROOT_DIR/benchmarks/results"
mkdir -p "$RESULTS_DIR"

cd "$ROOT_DIR"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT_FILE="$RESULTS_DIR/e2e-${STAMP}-${COMMIT}.json"

echo "Building Rust core (release)..."
cargo build --release --lib >/dev/null

E2E_BIN="$ROOT_DIR/native/GenieTerm/.build/release/GenieTermE2EBench"
if [[ ! -x "$E2E_BIN" || "${FORCE_SWIFT_BUILD:-0}" == "1" ]]; then
  echo "Building Swift E2E benchmark binary..."
  (
    cd "$ROOT_DIR/native/GenieTerm"
    swift build -c release --product GenieTermE2EBench >/dev/null
  )
else
  echo "Using existing Swift E2E benchmark binary: $E2E_BIN"
fi

echo "Running Swift E2E benchmark..."
GIT_COMMIT="$COMMIT" "$E2E_BIN" --output "$OUT_FILE" >/dev/null

cp "$OUT_FILE" "$RESULTS_DIR/latest_e2e.json"
echo "E2E benchmark result written: $OUT_FILE"
echo "Latest E2E result updated: $RESULTS_DIR/latest_e2e.json"

if [[ -f "$ROOT_DIR/benchmarks/e2e_baseline.json" ]]; then
  echo "Running E2E regression check against baseline..."
  "$ROOT_DIR/benchmarks/check_regression.py" \
    --baseline "$ROOT_DIR/benchmarks/e2e_baseline.json" \
    --result "$RESULTS_DIR/latest_e2e.json" \
    --thresholds "$ROOT_DIR/benchmarks/e2e_thresholds.json"
fi
