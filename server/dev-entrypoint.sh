#!/bin/sh
set -euo pipefail

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
export NODE_ENV="${NODE_ENV:-development}"
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=12288"

cd /app
exec npm run dev
