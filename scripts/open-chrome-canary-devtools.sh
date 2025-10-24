#!/usr/bin/env bash
set -euo pipefail

# Use the provided port or default to the typical Chrome DevTools port.
PORT="${1:-9222}"
shift || true

# Allow overriding the Canary binary path via CHROME_CANARY_BIN.
CANARY_BIN="${CHROME_CANARY_BIN:-/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary}"

if [[ ! -x "$CANARY_BIN" ]]; then
  echo "Chrome Canary binary not found or not executable: $CANARY_BIN" >&2
  echo "Set CHROME_CANARY_BIN to the correct path if Canary is installed elsewhere." >&2
  exit 1
fi

# Create a temporary user data directory for remote debugging
# Chrome requires a non-default data directory for remote debugging to work
USER_DATA_DIR="${TMPDIR:-/tmp}/chrome-debug-profile"
mkdir -p "$USER_DATA_DIR"

echo "$PORT"

"$CANARY_BIN" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$USER_DATA_DIR" \
  "$@"
