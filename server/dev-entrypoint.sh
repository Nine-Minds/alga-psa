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
exec npx --no-install next dev --turbo --hostname 0.0.0.0 --port 3000
