#!/bin/sh
# Starts the dev app on the isolated film profile with CDP on 9333.
# Vite must get port 5173: on the 5174 fallback the main process never opens a window.
cd "$(dirname "$0")/../.."
if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port 5173 is busy" >&2
    exit 1
fi
WAVETERM_CONFIG_HOME=/private/tmp/claude-501/film/c \
WAVETERM_DATA_HOME=/private/tmp/claude-501/film/d \
exec npx electron-vite dev --remoteDebuggingPort 9333
