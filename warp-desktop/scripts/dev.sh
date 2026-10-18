#!/usr/bin/env bash
set -euo pipefail

# Convenience: build the local warp binary (if missing) and run electron-vite dev.
HERE="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_ROOT="$(cd "$HERE/.." && pwd)"
CORE_BIN="$DESKTOP_ROOT/../warp-go/warp"

if [ ! -f "$CORE_BIN" ]; then
  echo "Building dev warp binary..."
  (cd "$(dirname "$CORE_BIN")" && go build -o warp ./cmd/warp)
fi

cd "$DESKTOP_ROOT"
exec npm run dev
