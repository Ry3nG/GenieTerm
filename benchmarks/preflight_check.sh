#!/usr/bin/env bash
set -euo pipefail

STRICT=0
MAX_LOAD=3.0
OUT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT=1
      shift
      ;;
    --max-load)
      MAX_LOAD="${2:-3.0}"
      shift 2
      ;;
    --output)
      OUT_FILE="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

OS="$(uname -s)"
HOST="$(hostname)"
DATE_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if LOAD_RAW="$(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}')"; then
  LOAD_1="$(echo "$LOAD_RAW" | awk '{print $1}')"
else
  LOAD_1="$(uptime | awk -F'load averages?: ' '{print $2}' | tr ',' ' ' | awk '{print $1}')"
fi
if CPU_HOGS="$(ps -A -o %cpu=,comm= 2>/dev/null | sort -nr | head -n 8)"; then
  :
else
  CPU_HOGS="0.0 unavailable_in_sandbox"
fi
POWER_MODE="$(pmset -g | awk -F': ' '/power mode/{print $2; exit}')"
if [[ -z "${POWER_MODE:-}" ]]; then
  POWER_MODE="unknown"
fi

PASS=1
REASON="ok"

awk -v l="$LOAD_1" -v m="$MAX_LOAD" 'BEGIN { exit (l <= m) ? 0 : 1 }' || {
  PASS=0
  REASON="loadavg_1min_exceeds_threshold"
}

if [[ "$STRICT" == "1" && "$PASS" != "1" ]]; then
  echo "Preflight failed: $REASON (load1=$LOAD_1, threshold=$MAX_LOAD)" >&2
  exit 1
fi

REPORT=$(cat <<JSON
{
  "schema_version": 1,
  "timestamp_utc": "$DATE_UTC",
  "host": "$HOST",
  "os": "$OS",
  "power_mode": "$POWER_MODE",
  "loadavg_1min": $LOAD_1,
  "max_load_threshold": $MAX_LOAD,
  "strict": $STRICT,
  "pass": $PASS,
  "reason": "$REASON",
  "top_cpu_processes": [
$(echo "$CPU_HOGS" | awk '{printf "    {\"cpu_pct\": %s, \"command\": \"%s\"},\n", $1, $2}' | sed '$ s/,$//')
  ]
}
JSON
)

if [[ -n "$OUT_FILE" ]]; then
  mkdir -p "$(dirname "$OUT_FILE")"
  echo "$REPORT" > "$OUT_FILE"
fi

echo "$REPORT"
