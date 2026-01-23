#!/bin/sh
set -euo pipefail

# Nx project-graph caching/daemon can get into a bad state across container restarts and then fail
# with "Cannot find configuration for task server:next:dev". Reset it on boot for stability.
export NX_DAEMON="${NX_DAEMON:-false}"
export NX_CACHE_DIRECTORY="${NX_CACHE_DIRECTORY:-/tmp/nx-cache}"
export NX_WORKSPACE_DATA_DIRECTORY="${NX_WORKSPACE_DATA_DIRECTORY:-/tmp/nx-workspace-data}"
export NX_PROJECT_GRAPH_CACHE_DIRECTORY="${NX_PROJECT_GRAPH_CACHE_DIRECTORY:-/tmp/nx-workspace-data}"
rm -rf "$NX_CACHE_DIRECTORY" "$NX_WORKSPACE_DATA_DIRECTORY" >/dev/null 2>&1 || true
mkdir -p "$NX_CACHE_DIRECTORY" "$NX_WORKSPACE_DATA_DIRECTORY" >/dev/null 2>&1 || true

cd /app
npx --no-install nx reset >/dev/null 2>&1 || true

# If Enterprise Edition is enabled, overlay EE-only routes/libs into `server/src/*`.
# This is required because Next.js file-system routing only picks up pages that exist under `server/src/app`.
if [ "${NEXT_PUBLIC_EDITION:-community}" = "enterprise" ] || [ "${EDITION:-}" = "ee" ] || [ "${EDITION:-}" = "enterprise" ]; then
  echo "[server-dev-entrypoint] Enterprise edition enabled; applying EE overlay"
  if [ -x /app/scripts/build-enterprise.sh ]; then
    /bin/bash /app/scripts/build-enterprise.sh
  else
    echo "[server-dev-entrypoint] WARN: /app/scripts/build-enterprise.sh not found; EE overlay skipped" >&2
  fi
fi

DB_PASSWORD=""
SECRET_FILE="/run/secrets/db_password_server"
if [ -f "$SECRET_FILE" ]; then
  DB_PASSWORD=$(tr -d '\r\n' < "$SECRET_FILE")
elif [ -n "${DB_PASSWORD_SERVER:-}" ]; then
  DB_PASSWORD="${DB_PASSWORD_SERVER}"
else
  echo "[server-dev-entrypoint] ERROR: db password not found in /run/secrets/db_password_server or DB_PASSWORD_SERVER env" >&2
  exit 1
fi

PG_HOST="${PGBOUNCER_HOST:-pgbouncer}"
PG_PORT="${PGBOUNCER_PORT:-6432}"
export DATABASE_URL="postgresql://app_user:${DB_PASSWORD}@${PG_HOST}:${PG_PORT}/server"
export NODE_ENV="development"
export DB_HOST="${PG_HOST}"
export DB_PORT="${PG_PORT}"
export REDIS_HOST="${REDIS_HOST:-redis}"
export REDIS_PORT="${REDIS_PORT:-6379}"
export HOCUSPOCUS_URL="${HOCUSPOCUS_URL:-ws://hocuspocus:1234}"

cd /app/server
# Avoid Nx flakiness inside long-lived containers (e.g. `docker compose restart`) by running Next directly.
# Next 16 defaults to Turbopack; keep that default. Webpack can be forced for debugging via ALGA_NEXT_WEBPACK=1.
NEXT_DEV_FLAGS="--hostname 0.0.0.0 --port 3000"
if [ "${ALGA_NEXT_WEBPACK:-0}" = "1" ]; then
  NEXT_DEV_FLAGS="--webpack ${NEXT_DEV_FLAGS}"
fi
exec npx --no-install next dev ${NEXT_DEV_FLAGS}
