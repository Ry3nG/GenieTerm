#!/usr/bin/env bash
set -euo pipefail

RUNS=20
STRICT=0
MAX_LOAD=3.0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runs)
      RUNS="${2:-20}"
      shift 2
      ;;
    --strict)
      STRICT=1
      shift
      ;;
    --max-load)
      MAX_LOAD="${2:-3.0}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
SUITE_DIR="$ROOT_DIR/benchmarks/results/suite-${STAMP}-${COMMIT}"
mkdir -p "$SUITE_DIR"

echo "Running preflight check..."
"$ROOT_DIR/benchmarks/preflight_check.sh" \
  $( [[ "$STRICT" == "1" ]] && echo --strict ) \
  --max-load "$MAX_LOAD" \
  --output "$SUITE_DIR/preflight.json" >/dev/null

echo "Building benchmark binaries once..."
cargo build --release --bin core_bench --lib >/dev/null
if [[ ! -x "$ROOT_DIR/native/GenieTerm/.build/release/GenieTermE2EBench" ]]; then
  (cd "$ROOT_DIR/native/GenieTerm" && swift build -c release --product GenieTermE2EBench >/dev/null)
fi

for i in $(seq 1 "$RUNS"); do
  echo "Core run $i/$RUNS"
  GIT_COMMIT="$COMMIT" \
    "$ROOT_DIR/target/release/core_bench" \
    --output "$SUITE_DIR/core-${i}.json" >/dev/null

  echo "E2E run $i/$RUNS"
  GIT_COMMIT="$COMMIT" \
    "$ROOT_DIR/native/GenieTerm/.build/release/GenieTermE2EBench" \
    --output "$SUITE_DIR/e2e-${i}.json" >/dev/null
done

echo "Aggregating core suite..."
"$ROOT_DIR/benchmarks/aggregate_runs.py" \
  --inputs "$SUITE_DIR/core-*.json" \
  --output "$SUITE_DIR/core-summary.json" \
  --label "core-stable-suite-$COMMIT" >/dev/null

echo "Aggregating e2e suite..."
"$ROOT_DIR/benchmarks/aggregate_runs.py" \
  --inputs "$SUITE_DIR/e2e-*.json" \
  --output "$SUITE_DIR/e2e-summary.json" \
  --label "e2e-stable-suite-$COMMIT" >/dev/null

cp "$SUITE_DIR/core-summary.json" "$ROOT_DIR/benchmarks/results/latest_core_summary.json"
cp "$SUITE_DIR/e2e-summary.json" "$ROOT_DIR/benchmarks/results/latest_e2e_summary.json"
echo "Suite complete: $SUITE_DIR"
echo "Latest summaries:"
echo "  $ROOT_DIR/benchmarks/results/latest_core_summary.json"
echo "  $ROOT_DIR/benchmarks/results/latest_e2e_summary.json"
