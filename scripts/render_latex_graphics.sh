#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LATEX_DIR="$ROOT/assets/latex"
OUT_DIR="$ROOT/assets"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

render_one() {
  local name="$1"
  cp "$LATEX_DIR/$name.tex" "$TMP_DIR/$name.tex"
  (cd "$TMP_DIR" && pdflatex -interaction=nonstopmode -halt-on-error "$name.tex" >/dev/null)
  magick -density 220 "$TMP_DIR/$name.pdf" -background white -alpha remove -alpha off "$OUT_DIR/$name.png"
}

render_one "perf-overview"
render_one "data-path"

echo "Rendered: $OUT_DIR/perf-overview.png"
echo "Rendered: $OUT_DIR/data-path.png"
