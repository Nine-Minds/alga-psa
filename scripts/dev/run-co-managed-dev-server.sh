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
# Register it as the card service command, not the raw entrypoint line:
#   alga-dev workflow-ensure-service \
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

# Development must run server/dev-server.ts, not `next dev`. Next's built-in dev
# server owns the HTTP `upgrade` event and silently leaves upgrades it does not
# recognise open; an unanswered handshake holds one of Chromium's per-origin
# WebSocket slots and stalls HMR and hydration. dev-server.ts is the same Next
# app wrapped in an http.Server whose single `upgrade` listener delegates
# /_next/webpack-hmr back to Next, proxies /hocuspocus, and promptly 404s the
# rest. server/src/test/unit/devScriptWiring.test.ts guards the npm scripts;
# this launcher is the review-environment equivalent and must not drift from it.
TSX_BIN="$REPO_ROOT/node_modules/.bin/tsx"
if [ ! -x "$TSX_BIN" ]; then
  echo "tsx not found at $TSX_BIN -- run npm install at the repo root" >&2
  exit 1
fi

# `npm run dev` reaches the same entrypoint but goes through nx, whose
# build-deps include server:build -- a full Next production build that has OOMed
# repeatedly on this host even at 32GB. The workspace dists are prebuilt, so
# invoke the entrypoint directly and skip nx entirely.

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
# nx's dotenv loading fights .env.local; `npm run dev` disables it for the same
# reason.
export NX_LOAD_DOT_ENV_FILES=false

# dev-server.ts binds `process.env.HOSTNAME ?? '0.0.0.0'`. Interactive bash
# exports HOSTNAME as the machine name, which would bind the listener to that
# name's single address (127.0.1.1 here) and make the tailnet review URL
# unreachable while localhost still answered. `next dev -p` ignored HOSTNAME, so
# this trap arrives with the custom entrypoint. Pin it.
export HOSTNAME=0.0.0.0

# Send the browser's notification/collaboration socket to this origin's
# /hocuspocus, which dev-server.ts proxies to HOCUSPOCUS_HOST:HOCUSPOCUS_PORT.
# server/.env.local ships NEXT_PUBLIC_HOCUSPOCUS_URL=ws://localhost:1235, which
# names the *reviewer's own* machine once the app is served over the tailnet, so
# it can never connect for a remote reviewer regardless of what runs here. Going
# through the proxy means a missing upstream is answered by a bounded 502
# instead of a browser-side error against the wrong host; the notification hook
# then falls back to its 30s poll.
export NEXT_PUBLIC_HOCUSPOCUS_URL="ws://${ADVERTISED_HOST}:${PORT}/hocuspocus"

echo "co-managed dev server"
echo "  repo        : $REPO_ROOT"
echo "  entrypoint  : server/dev-server.ts (owns the upgrade event)"
echo "  reviewer URL: $HOST"
echo "  dev origins : $DEV_ALLOWED_ORIGINS"
echo "  hocuspocus  : $NEXT_PUBLIC_HOCUSPOCUS_URL -> \${HOCUSPOCUS_HOST}:\${HOCUSPOCUS_PORT}"
echo "  readiness   : curl -s -o /dev/null -w '%{http_code}' $HOST/auth/signin  # expect 200 or 307"
echo

cd "$SERVER_DIR"
exec node "$TSX_BIN" dev-server.ts
