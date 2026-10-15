#!/bin/bash
# Real email-service (IMAP poller + unified queue consumer) restricted to one provider.
cd "$(dirname "$0")/../../.."
while IFS= read -r line; do
  [[ "$line" =~ ^[A-Z_][A-Z0-9_]*= ]] && export "${line%%=*}=${line#*=}"
done < server/.env.local
export PORT=18569
[ -n "$SMOKE_DURABLE_MODE" ] && export UNIFIED_INBOUND_EMAIL_DURABLE_MODE="$SMOKE_DURABLE_MODE"
export SMOKE_ONLY_IMAP_PROVIDER_ID=20260924-0000-4000-8000-000000002569
export IMAP_WEBHOOK_URL=${SMOKE_WEBHOOK_URL:-http://localhost:3335/api/email/webhooks/imap}
export IMAP_POLL_INTERVAL_MS=3000 IMAP_PROVIDER_REFRESH_MS=10000
exec env "TENANT_dd8cb218-d46d-47f3-be27-8aa50aad5fce_imap_password_20260924-0000-4000-8000-000000002569=imap_pass" \
  node_modules/.bin/tsx --tsconfig services/email-service/tsconfig.json tools/smoke-sim/inbound-2569/index.ts
