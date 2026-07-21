#!/bin/sh
set -eu

if [ -n "${AI_GATEWAY_DB_PASSWORD_FILE:-}" ] && [ -f "${AI_GATEWAY_DB_PASSWORD_FILE}" ]; then
  AI_GATEWAY_DB_PASSWORD="$(tr -d '\r\n' < "${AI_GATEWAY_DB_PASSWORD_FILE}")"
  export AI_GATEWAY_DB_PASSWORD
fi

echo "Waiting for AI gateway PostgreSQL at ${AI_GATEWAY_DB_HOST:-ai-gateway-postgres}:${AI_GATEWAY_DB_PORT:-5432}"
until pg_isready \
  -h "${AI_GATEWAY_DB_HOST:-ai-gateway-postgres}" \
  -p "${AI_GATEWAY_DB_PORT:-5432}" \
  -U "${AI_GATEWAY_DB_USER:-postgres}" \
  -d "${AI_GATEWAY_DB_NAME:-ai_gateway}" >/dev/null 2>&1; do
  sleep 1
done

cd /app
npm run migrate
exec node dist/index.js
