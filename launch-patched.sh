#!/bin/bash
# Launch the patched Dyad build with the local model catalog.
#
#   ./launch-patched.sh [path/to/dyad.app]
#
# Starts the catalog server, then launches the .app bundle through
# LaunchServices so the process registers as Dyad rather than a bare
# Electron binary.

set -euo pipefail

CATALOG_PORT="${DYAD_CATALOG_PORT:-39471}"
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="${1:-}"

if [[ -z "$APP" ]]; then
  APP=$(find "$DIR/out" -maxdepth 2 -name 'dyad.app' -print -quit 2>/dev/null || true)
fi

if [[ -z "$APP" || ! -d "$APP" ]]; then
  echo "No dyad.app found. Build it first (npm run package), or pass the path." >&2
  exit 1
fi

if ! curl -sf --max-time 2 "http://127.0.0.1:${CATALOG_PORT}/llm-catalog.json" >/dev/null 2>&1; then
  DYAD_CATALOG_PORT="$CATALOG_PORT" nohup node "$HOME/.dyad/serve-catalog.mjs" \
    >/tmp/dyad-catalog.log 2>&1 &
  sleep 1
fi

if ! curl -sf --max-time 2 "http://127.0.0.1:${CATALOG_PORT}/llm-catalog.json" >/dev/null 2>&1; then
  echo "Catalog server failed to start; see /tmp/dyad-catalog.log" >&2
  exit 1
fi

echo "catalog: http://127.0.0.1:${CATALOG_PORT}/llm-catalog.json"
echo "launching: $APP"
# Launch the bundle, not the inner binary, so macOS registers it as Dyad.
open -a "$APP"
