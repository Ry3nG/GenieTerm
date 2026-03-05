#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LATEST="$ROOT_DIR/benchmarks/results/latest.json"
BASELINE="$ROOT_DIR/benchmarks/baseline.json"

if [[ ! -f "$LATEST" ]]; then
  echo "missing latest benchmark result: $LATEST"
  echo "run ./benchmarks/run_benchmarks.sh first"
  exit 1
fi

cp "$LATEST" "$BASELINE"
echo "baseline updated: $BASELINE"
