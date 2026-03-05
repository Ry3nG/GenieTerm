#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LATEST="$ROOT_DIR/benchmarks/results/latest_e2e.json"
BASELINE="$ROOT_DIR/benchmarks/e2e_baseline.json"

if [[ ! -f "$LATEST" ]]; then
  echo "missing latest E2E benchmark result: $LATEST"
  echo "run ./benchmarks/run_e2e_bench.sh first"
  exit 1
fi

cp "$LATEST" "$BASELINE"
echo "E2E baseline updated: $BASELINE"
