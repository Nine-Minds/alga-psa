# PRD — API Rate Limiting and Outbound Ticket Webhooks

- Slug: `api-rate-limiting-and-ticket-webhooks`
- Date: `2026-05-05`
- Status: Draft
- Source plans:
  - `/Users/natalliabukhtsik/Desktop/projects/alga-psa/.ai/api-rate-limiting-plan.md`
  - `/Users/natalliabukhtsik/Desktop/projects/alga-psa/.ai/ticket-webhooks-plan.md`

## Summary

Two complementary protections against "noisy poller" pressure on the public
REST API and the underlying Citus cluster:

1. **API rate limiting** (guardrail) — a per-`(tenant, api_key_id)` token-bucket
   rate limit on every authenticated `/api/v1/*` request, fail-open on Redis
   outage, configurable per tenant.
2. **Outbound ticket webhooks** (cure) — finish the partially-scaffolded webhook
   delivery pipeline so well-behaved customers can subscribe to ticket events
   instead of polling. Includes signed HTTP delivery, retries with backoff, a
   minimal admin UI, and a curated payload shape.

The two ship as one plan because they share infrastructure (the
`TokenBucketRateLimiter` namespace work is required by both — the rate limiter
uses namespace `'api'`, the webhook delivery worker uses namespace
`'webhook-out'` for per-webhook outbound caps).

## Problem

Production telemetry on 2026-05-04 traced intermittent Citus
"`remaining connection slots are reserved for non-replication superuser
connections`" errors to a single external integration polling
`GET /api/v1/tickets/<id>` for 6 specific ticket IDs once per minute from
`52.53.71.0`. When the 6-call burst lands at a minute boundary alongside other
work, ~18% of the calls fail with HTTP 500.

Today there is **no rate limit** on the public REST API and **no working
outbound webhooks** (the system is scaffolded but the delivery method is
mocked and the data tables don't exist), so:

- Customers have no choice but to poll if they need near-real-time data.
- A single key can pressure the cluster regardless of other work.

## Goals

- Stop a single tenant or API key from monopolizing Citus worker connections
  via runaway polling.
- Give well-behaved customers a way to subscribe to ticket lifecycle events
  (`ticket.created`, `ticket.updated`, `ticket.assigned`,
  `ticket.status_changed`, `ticket.closed`, `ticket.comment.added`) and
  receive signed HTTP POSTs instead of polling.
- Migrate the noisy customer to webhooks once shipped.
- Ship the rate-limit guardrail first (smaller, unblocks the immediate
  problem); ship webhook delivery next (larger, removes the cause).

## Non-goals

- Not implementing custom payload templates / Handlebars rendering for
  webhooks in v1.
- Not implementing webhook subscriptions for non-ticket entities in v1
  (projects / clients / contacts / invoices come later — pattern is the same).
- Not changing internal email/notification subscribers — webhooks are an
  additional output, not a replacement.
- Not changing UI / Server-Action traffic — rate limiting only protects the
  external API surface (`x-api-key`-authenticated endpoints).
- Not building a customer-facing "webhook explorer" UI in v1; admin can manage
  via API and a basic settings page.
- Not changing Citus connection-pool config (separate but complementary work).
- Not introducing new queue/runtime dependencies — reuse the existing Redis
  client and the `DelayedEmailQueue` ZSET pattern; do not add BullMQ.

## Users and Primary Flows

**Tenant administrator** (target persona)

1. *Set or override an API rate limit:*
   Settings → API Keys → "Rate Limit" → set per-key `max_tokens` and
   `refill_per_min`, or set a tenant-wide default.
2. *Create a webhook subscription:*
   Settings → Webhooks → "New Webhook" → name, URL, event types
   (multi-select), custom headers, retry config → save → copy plaintext
   signing secret (shown once).
3. *Verify a webhook:* "Send Test" delivers a synthetic payload to the
   configured URL using the live signing secret; result shown inline.
4. *Inspect deliveries:* Webhook detail → paginated history with status,
   response body, retry button.
5. *Rotate signing secret:* one click → new plaintext returned once.

**External integration** (consumer of webhooks and rate limits)

1. *Hit a 429:* receives `Retry-After` and `X-RateLimit-*` headers; backs
   off and retries.
2. *Receive webhook:* HTTP POST with `X-Alga-Signature: t=<ts>,v1=<hex>`;
   verifies HMAC; idempotently processes by `event_id`.

**Internal noisy poller** (the `52.53.71.0` integration)

- Continues working under sane defaults (6 calls/min is well under the limit).
- Receives a heads-up + migration guide pointing at the new webhook flow.

## UX / UI Notes

- **API Keys settings:** add a "Rate Limit" column to the existing
  `AdminApiKeysSetup` table, plus an inline edit form. Surface the current
  remaining tokens (read via `getState`).
- **Webhooks settings:** new section under Settings, modeled on
  `AdminApiKeysSetup`. Must include create form, list view (status, last
  delivery, success rate), delivery history, secret reveal/rotate, pause/resume.
- Neither feature requires a new top-level navigation entry — both live under
  Settings → Security or Settings → Integrations (TBD with design; tracked in
  Open Questions).

## Requirements

### Functional Requirements

**API rate limiting**

- Every authenticated `/api/v1/*` request consumes 1 token from the
  `(tenant, api_key_id)` bucket in namespace `'api'`.
- 429 response on denial includes `Retry-After`, `X-RateLimit-Limit`,
  `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- Successful responses include `X-RateLimit-Limit` and `X-RateLimit-Remaining`.
- Defaults: `max_tokens = 120`, `refill_per_min = 60` (1 RPS sustained, 120
  burst).
- Per-`(tenant, api_key_id)` overrides via `api_rate_limit_settings`. Falls
  back to `(tenant, NULL)`, then to hard-coded defaults.
- Bypass list: health/version endpoints, internal-runner endpoints, mobile
  auth.
- NM Store global-key path uses sentinel subjectId `'nm_store'` so its
  traffic shares one tenant-scoped bucket.
- Observation mode: `RATE_LIMIT_ENFORCE=false` logs denials instead of
  throwing. Default `false` until Stage 3 of rollout.
- Fail-open if Redis is unavailable.

**Outbound webhooks**

- Tenant admins create webhook subscriptions for ticket lifecycle events.
- Internal events publish via the existing event bus
  (`publishEvent({ eventType: 'TICKET_*', payload })`); a new subscriber
  fans out to active webhooks.
- Delivery is queued, not inline (Redis ZSET, mirrored on `DelayedEmailQueue`).
- Each delivery is HMAC-SHA256 signed:
  `X-Alga-Signature: t=<unix>,v1=<hex>` over `t + "." + body`.
- Per-webhook rate limit using the `TokenBucketRateLimiter` namespace
  `'webhook-out'`, dimension `(tenant, webhookId)`. Default
  `rate_limit_per_min = 100`.
- Retry policy: 1m → 5m → 30m → 2h → 12h, then abandon. 5 attempts total.
  Configurable per webhook via `retry_config`.
- Auto-disable a webhook after 24h of all-failure deliveries; email the
  owning user.
- Curated payload shape (see source plan §3.3) — stable subset of ticket
  fields plus `changes` diff for `ticket.updated` events. Comments include
  text/author/timestamp/internal flag, never attachments.
- `POST /api/v1/webhooks/[id]/test` sends a synthetic `webhook.test`
  payload, recorded with `is_test = true`.
- SSRF guard rejects RFC1918, loopback, link-local, CGNAT, and non-`http(s)`
  schemes before delivery (real and test).
- Signing secret stored via the existing secret provider; column holds
  `signing_secret_vault_path`, never plaintext or hash.

### Non-functional Requirements

- Rate limiter adds ≤2 ms p99 to authenticated API requests when Redis is
  healthy.
- Webhook delivery latency floor ~2 s (ZSET poll interval); acceptable.
- At-least-once delivery semantics; idempotency key is `event_id`.
- Tenant isolation is preserved end-to-end (subscriber filters by `tenant`,
  payload builder uses tenant-scoped `getConnection`).

## Data / API / Integrations

### New tables

- `api_rate_limit_settings` (tenant-distributed):
  `(tenant, api_key_id NULL, max_tokens, refill_per_min)` with
  `UNIQUE (tenant, api_key_id)`.
- `webhooks` (tenant-distributed): subscription rows with
  `signing_secret_vault_path`, `event_types text[]`, retry/rate-limit config,
  rolling stats columns, `auto_disabled_at`.
- `webhook_deliveries` (tenant-distributed): one row per attempt;
  `is_test boolean`, `next_retry_at`, response capture.

### New / modified APIs

- `TokenBucketRateLimiter`: signature change — namespace as required first
  parameter on `tryConsume` / `getState` / `getBucketKey` / `getBucketConfig`.
  `BucketConfigGetter` widened to `(tenantId, subjectId?) => BucketConfig`.
  `initialize()` accepts `Record<namespace, BucketConfigGetter>`.
- `ApiError` interface: optional `headers?: Record<string, string>`;
  `handleApiError` merges them into the `NextResponse`.
- `createSuccessResponse` / `createPaginatedResponse`: optional
  `extraHeaders` parameter.
- New helper `enforceApiRateLimit(req, context)` called from
  `ApiBaseController.authenticate`, `withApiKeyAuth`, and `withAuth`.
- `webhookEventTypeSchema` extended with `'ticket.comment.added'`.
- Webhook controller stubs implemented (or removed): `getDeliveryDetails`,
  `getWebhookHealth`, `getWebhookSubscriptions` (read-only), `rotateWebhookSecret`,
  `verifyWebhookSignature`, `listAvailableEvents`. Deferred stubs (bulk,
  templates, transformations, etc.) have their routes deleted, not left as 501s.

### Reused infrastructure (no new dependency)

- `getRedisClient` for both buckets and the webhook ZSET.
- `DelayedEmailQueue` pattern for the webhook poller class.
- `getSecretProviderInstance` for signing-secret storage.
- Existing event bus (`publishEvent` / `getEventBus().subscribe`) and the
  `TICKET_*` schemas in `packages/event-schemas`.

## Security / Permissions

- Webhook signing secrets never leave the secret provider once written;
  GET responses for webhook rows must omit the column entirely (covered by
  an integration assertion).
- SSRF protection enforced server-side in both real and test delivery, with
  an env-var escape hatch (`WEBHOOK_SSRF_ALLOW_PRIVATE`) for staging/local
  only.
- Rate-limit configuration writes scoped to tenant admins (RBAC: existing
  `api_keys.update` permission applies; webhook CRUD uses `webhook.*` —
  added if not present).
- `signing_secret_vault_path` column never exposed in the API response shape.

## Observability

- Rate-limit metrics: `api_rate_limit_consumed_total{tenant,api_key_id,outcome}`,
  `api_rate_limit_remaining{tenant,api_key_id}`,
  `api_rate_limit_redis_unavailable_total`.
- Webhook metrics:
  `webhook_deliveries_total{tenant,webhook_id,outcome}`,
  `webhook_delivery_duration_ms` histogram, `webhook_queue_depth` gauge,
  `webhook_auto_disabled_total{tenant,webhook_id}`.
- Structured WARN log on every throttle and on every Redis fail-open.
- Grafana panel: top throttled `(tenant, api_key_id)` and top failing
  webhooks.

## Rollout / Migration

1. **Citus worker `max_connections` bump** — out of band, ~1 hour, eliminates
   the immediate 500s. Not part of this plan.
2. **Rate limiter MVP** — Stages 1–3:
   - *Stage 1 (observation):* `RATE_LIMIT_ENFORCE=false`. Measure for one
     week.
   - *Stage 2 (notify outliers):* email tenants whose keys would have been
     throttled.
   - *Stage 3 (enforce):* flip `RATE_LIMIT_ENFORCE=true`.
   - *Stage 4:* remove the env-var bypass after ~2 weeks stable.
3. **Webhook MVP** — Stages 1–4:
   - *Stage 1 (dark launch):* ship behind a feature flag; internal testing
     against `webhook.site`.
   - *Stage 2 (invite-only beta):* enable for a handful of API-heavy
     tenants, including the noisy poller.
   - *Stage 3 (GA):* open to all tenants; publish docs.
   - *Stage 4:* tighten polled REST rate limits once webhook adoption is
     healthy.
4. The noisy poller (`52.53.71.0`) gets a personal note + migration guide.

## Open Questions

1. Should we expose `ticket.deleted`? Internal `TICKET_DELETED` exists.
   Defer to v2 unless the noisy poller specifically asks.
2. Per-tenant webhook count limit? Cap at 50 per tenant default.
3. Should `ticket.status_changed` include `previous_status_id`/
   `previous_status_name`? **Yes** — captured as a feature.
4. Webhook-side filtering by `entity_ids`? **Implement in v1** — directly
   addresses the noisy poller's "tell me about these 6 tickets" pattern.
5. IA placement of the new settings UI sections — Settings → Security or
   Settings → Integrations? Confirm with design.
6. Per-tenant rate-limit cap on top of per-key buckets? Defer until data
   shows we need it.
7. Per-endpoint cost weights (`/search` costs more than `/get`)? Defer until
   observation data shows pressure differences.

## Acceptance Criteria (Definition of Done)

**Rate limiter**

- A test API key making 121 requests in 60 seconds receives 429 on the 121st
  with the documented headers, and a different key in the same tenant is
  unaffected.
- The email path's existing rate-limit behavior is unchanged on a baseline
  `notification_settings.rate_limit_per_minute` value.
- `RATE_LIMIT_ENFORCE=false` lets denials through but emits the same
  metrics and headers as enforce mode.
- An `api_rate_limit_settings` row with `(tenant, api_key_id)` overrides
  the tenant default; `clearForKey` returns to the tenant default within
  the cache TTL.

**Webhooks**

- `TICKET_ASSIGNED` published in tenant A enqueues a delivery job for an
  active webhook in tenant A subscribed to `ticket.assigned`, and does
  **not** enqueue a job for any webhook in tenant B.
- The `WebhookDeliveryQueue` poller successfully delivers to a stubbed
  HTTP server, persists a row in `webhook_deliveries`, and updates webhook
  stats columns.
- A webhook URL pointing at `127.0.0.1` or `10.0.0.5` is rejected before
  delivery (production mode), and accepted with
  `WEBHOOK_SSRF_ALLOW_PRIVATE=true`.
- HMAC verification with the documented recipe matches the server signature
  byte-for-byte.
- Signing secret never appears in any GET webhook response body.
- 5 failed attempts mark the delivery `abandoned`; 24h of all-failure
  deliveries auto-disable the webhook.
- Webhooks settings UI: an admin can create, view deliveries, send a test,
  rotate the secret, and pause/resume a webhook.
