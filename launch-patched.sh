#!/bin/bash
# Launch the patched Dyad build with the local model catalog.
#
#   ./launch-patched.sh [path/to/Dyad.app]
#
# Starts the catalog server, points Dyad at it, and tears the server down on exit.

set -euo pipefail

CATALOG_PORT="${DYAD_CATALOG_PORT:-39471}"
CATALOG_URL="http://127.0.0.1:${CATALOG_PORT}/llm-catalog.json"
APP="${1:-}"

if [[ -z "$APP" ]]; then
  APP=$(find "$(dirname "$0")/out" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)
fi

if [[ -z "$APP" || ! -d "$APP" ]]; then
  echo "No .app found. Build it first (npm run package), or pass the path." >&2
  exit 1
fi

cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

DYAD_CATALOG_PORT="$CATALOG_PORT" node "$HOME/.dyad/serve-catalog.mjs" &
SERVER_PID=$!
sleep 1

export DYAD_LANGUAGE_MODEL_CATALOG_URL="$CATALOG_URL"
echo "catalog: $CATALOG_URL"
echo "launching: $APP"
open -a "$APP"
wait
