#!/usr/bin/env bash
set -euo pipefail

REF_A="v0.1.0"
REF_B="v0.2.0"
RUNS=20
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT_DIR/benchmarks/results/release-compare-$STAMP"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref-a)
      REF_A="${2:?}"
      shift 2
      ;;
    --ref-b)
      REF_B="${2:?}"
      shift 2
      ;;
    --runs)
      RUNS="${2:?}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$OUT_DIR"

run_ref() {
  local ref="$1"
  local mode="$2"
  local worktree="/tmp/genieterm-compare-${ref//[^a-zA-Z0-9]/_}"
  local ref_out="$OUT_DIR/$ref"
  mkdir -p "$ref_out"

  git worktree add --detach "$worktree" "$ref" >/dev/null
  trap 'git worktree remove --force "$worktree" >/dev/null 2>&1 || true' RETURN

  mkdir -p "$worktree/src/bin"
  cp "$ROOT_DIR/benchmarks/templates/release_core_bench.rs" "$worktree/src/bin/release_core_bench.rs"

  for i in $(seq 1 "$RUNS"); do
    echo "$ref run $i/$RUNS"
    cargo run --manifest-path "$worktree/Cargo.toml" --offline --release --bin release_core_bench -- \
      --mode "$mode" \
      --output "$ref_out/run-$i.json" >/dev/null
  done

  "$ROOT_DIR/benchmarks/aggregate_runs.py" \
    --inputs "$ref_out/run-*.json" \
    --output "$ref_out/summary.json" \
    --label "release-core-$ref" >/dev/null

  git worktree remove --force "$worktree" >/dev/null
  trap - RETURN
}

echo "Comparing $REF_A vs $REF_B (runs=$RUNS)"

# v0.1.x used old hot-snapshot behavior (visible + scrollback).
run_ref "$REF_A" "old"
# v0.2.x uses visible-only hot snapshot.
run_ref "$REF_B" "new"

cp "$OUT_DIR/$REF_A/summary.json" "$ROOT_DIR/benchmarks/results/latest_release_${REF_A}.json"
cp "$OUT_DIR/$REF_B/summary.json" "$ROOT_DIR/benchmarks/results/latest_release_${REF_B}.json"

echo "Done. Summaries:"
echo "  $OUT_DIR/$REF_A/summary.json"
echo "  $OUT_DIR/$REF_B/summary.json"
