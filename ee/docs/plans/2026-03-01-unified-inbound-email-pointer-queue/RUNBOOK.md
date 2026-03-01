# Unified Inbound Pointer Queue Runbook

## Scope

This runbook documents the unified inbound email pointer queue architecture and local validation workflow for Microsoft, Google, and IMAP ingress.

## Architecture

### Ingress (enqueue-only)

- Microsoft webhook (`packages/integrations/src/webhooks/email/microsoft.ts`)
- Google webhook (`packages/integrations/src/webhooks/email/google.ts`)
- IMAP webhook (`packages/integrations/src/webhooks/email/imap.ts`)

When unified mode is enabled for a tenant/provider, each ingress path validates/authenticates the request, builds a pointer-only job payload, and enqueues to Redis using `enqueueUnifiedInboundEmailQueueJob`.

### Queue storage (Redis)

`shared/services/email/unifiedInboundEmailQueue.ts` manages queue lifecycle:

- Ready queue: `UNIFIED_INBOUND_EMAIL_QUEUE_KEY` (default `email:inbound:unified:pointer:ready`)
- Processing queue: `UNIFIED_INBOUND_EMAIL_PROCESSING_QUEUE_KEY`
- Inflight hash: `UNIFIED_INBOUND_EMAIL_INFLIGHT_HASH_KEY`
- Inflight lease zset: `UNIFIED_INBOUND_EMAIL_INFLIGHT_LEASE_KEY`
- DLQ: `UNIFIED_INBOUND_EMAIL_DLQ_KEY`

Semantics:

- `BRPOPLPUSH` claim from ready -> processing
- inflight lease record tracks claim timeout
- ACK removes processing + inflight records
- failure increments attempts and requeues
- failures at/over max attempts route to DLQ
- reclaim resurfaces expired inflight jobs to ready queue

### Consumer + processing

- Consumer loop: `shared/services/email/unifiedInboundEmailQueueConsumer.ts`
- Processor: `server/src/services/email/unifiedInboundEmailQueueJobProcessor.ts`
- Entrypoint: `server/src/bin/unifiedInboundEmailQueueConsumer.ts`

Processor behavior:

1. Resolve provider-specific pointer to full email payload at consume time.
2. Apply consume-time idempotency (`email_processed_messages` uniqueness guard).
3. Execute `processInboundEmailInApp`.
4. Return outcome (`processed` or deterministic `skipped`).

## Feature Flags and Controls

### Unified pointer queue enablement

- `UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_ENABLED`
- `UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_TENANT_IDS`
- `UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_PROVIDER_IDS`

### Queue tuning

- `UNIFIED_INBOUND_EMAIL_QUEUE_MAX_ATTEMPTS`
- `UNIFIED_INBOUND_EMAIL_QUEUE_CLAIM_TTL_MS`
- `UNIFIED_INBOUND_EMAIL_QUEUE_BLOCK_SECONDS`

### Legacy IMAP async disablement

- `IMAP_INBOUND_EMAIL_IN_APP_ASYNC_DISABLED`

When set, IMAP legacy in-memory async queue path is disabled even if legacy async enable flags are on.

## Local Validation Runbook

### 1) Enable unified queue mode for a targeted provider

Set one of:

- `UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_ENABLED=true`
- or tenant/provider-scoped enablement via the corresponding CSV env vars.

### 2) Start dependencies and app services

Ensure Redis and database are running. Start server and IMAP listener in local dev environment.

### 3) Start queue consumer

```bash
npm -w server run unified-inbound-email-consumer
```

### 4) Trigger ingress events

- Microsoft: send webhook callback payload with subscription/message pointer.
- Google: send Pub/Sub push payload with `historyId` pointer and JWT auth.
- IMAP: send listener webhook payload with `mailbox` + `uid` pointer.

### 5) Verify queue lifecycle

Observe logs for:

- `inbound_email_queue_enqueue`
- `inbound_email_queue_consume_start`
- `inbound_email_queue_ack`
- `inbound_email_queue_retry`
- `inbound_email_queue_dlq`
- `inbound_email_queue_skip`

### 6) Verify processing outcomes

Confirm expected ticket/comment/document outcomes in application flows and verify idempotency records in `email_processed_messages`.

### 7) Failure-path checks

- induce source unavailability and verify deterministic skip outcome (`source_unavailable:*`)
- induce processing failures and verify retries then DLQ behavior after max attempts

## Rollback Notes

To rollback callback/listener behavior, disable unified queue enablement flags. Legacy behavior remains available for controlled rollback.
