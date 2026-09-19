#!/usr/bin/env bash
#
# Launch the co-managed review dev server.
#
# Exists so the dev-origin environment cannot be lost by retyping a service
# registration. Every previous relaunch of this card's `dev-server` hand-typed
# the command, and the one that omitted HOST/NEXTAUTH_URL/DEV_ALLOWED_ORIGINS
# left Next 403ing /_next/* HMR, font and RSC requests from the reviewer's
# browser: the page stalled at "Loading translations..." while curl still
# returned 200, so the port check passed and nobody noticed.
#
# Register it as the card service command, not the raw `next dev` line:
#   alga-dev workflow-register-service \
#     --projectId=964ce5e0-45a5-41b2-8e2c-73903742a85a \
#     --name=dev-server \
#     --cwd=/home/robert/alga-copies/feature-co-managed-it/server \
#     --command='../scripts/dev/run-co-managed-dev-server.sh' \
#     --readinessPort=3374 --readinessPath=/auth/signin
#
# Usage: scripts/dev/run-co-managed-dev-server.sh [--host <addr>] [--port <n>]
#   ADVERTISED_HOST  address a reviewer's browser uses (default: 100.82.172.57)
#   PORT             listen port (default: 3374)
#
set -euo pipefail

ADVERTISED_HOST="${ADVERTISED_HOST:-100.82.172.57}"
PORT="${PORT:-3374}"

while [ $# -gt 0 ]; do
  case "$1" in
    --host) ADVERTISED_HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"

# `npm run dev` goes through nx, whose build-deps include server:build -- a full
# Next production build that has OOMed repeatedly on this host even at 32GB.
# The workspace dists are prebuilt, so invoke next directly.
NEXT_BIN="$REPO_ROOT/node_modules/.bin/next"
if [ ! -x "$NEXT_BIN" ]; then
  echo "next binary not found at $NEXT_BIN -- run npm install at the repo root" >&2
  exit 1
fi

# Next blocks /_next/* asset, HMR and RSC requests from unrecognised origins.
# DEV_ALLOWED_ORIGINS feeds next.config.mjs's allowedDevOrigins, which asserts
# at startup that it covers whatever HOST/NEXTAUTH_URL advertise.
export HOST="http://${ADVERTISED_HOST}:${PORT}"
export NEXTAUTH_URL="http://${ADVERTISED_HOST}:${PORT}"
export DEV_ALLOWED_ORIGINS="${ADVERTISED_HOST},localhost"
export PORT
export NODE_ENV=development
# The dev server resolves workspace packages from the repo-root node_modules.
export NODE_PATH="$REPO_ROOT/node_modules"

echo "co-managed dev server"
echo "  repo        : $REPO_ROOT"
echo "  reviewer URL: $HOST"
echo "  dev origins : $DEV_ALLOWED_ORIGINS"
echo "  readiness   : curl -s -o /dev/null -w '%{http_code}' $HOST/auth/signin  # expect 200 or 307"
echo

cd "$SERVER_DIR"
exec node "$NEXT_BIN" dev -p "$PORT"
