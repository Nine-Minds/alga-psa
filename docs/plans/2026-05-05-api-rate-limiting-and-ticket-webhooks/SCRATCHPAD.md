# Scratchpad — API Rate Limiting and Outbound Ticket Webhooks

- Plan slug: `api-rate-limiting-and-ticket-webhooks`
- Created: `2026-05-05`
- Source plans (kept for diff/history; this folder is canonical going forward):
  - `/Users/natalliabukhtsik/Desktop/projects/alga-psa/.ai/api-rate-limiting-plan.md`
  - `/Users/natalliabukhtsik/Desktop/projects/alga-psa/.ai/ticket-webhooks-plan.md`

## What This Is

Rolling notes for the combined effort. Append decisions and discoveries as
implementation progresses; update earlier entries when something changes.

## Decisions

- (2026-05-05) **Combined into one plan.** The two source plans share
  infrastructure (`TokenBucketRateLimiter` namespace work — features F001–F005
  — must land before either feature can use namespaced buckets). Splitting the
  features into one plan avoids re-stating the foundation.
- (2026-05-05) **Queue: Redis ZSET, not BullMQ or Temporal.** BullMQ is not a
  current dependency; adding it would introduce a third queue paradigm.
  Temporal is in use for `workflow-worker` but webhook delivery is "POST +
  retry," not multi-step. The `DelayedEmailQueue` ZSET pattern
  (`packages/email/src/DelayedEmailQueue.ts`) is the closest analog and
  reuses the existing Redis client. User confirmed this on 2026-05-05.
- (2026-05-05) **Signing secret stored via secret provider, not hashed.**
  HMAC requires the plaintext on every delivery — hashing breaks signing.
  Mirror the Stripe integration (`webhook_secret_vault_path` column,
  resolved through `getSecretProviderInstance()`). Fixed during plan review.
- (2026-05-05) **Reuse `TooManyRequestsError`, don't add a parallel
  `RateLimitError`.** It already exists at `apiMiddleware.ts:101-111` with
  the right shape. Plumb headers through `ApiError.headers` instead.
- (2026-05-05) **Subscribe to `TICKET_STATUS_CHANGED` directly.** It's a
  first-class internal event (`eventBusSchema.ts:170`) — don't synthesize it
  from `TICKET_UPDATED.changes.status_id`.
- (2026-05-05) **Three auth surfaces, one helper.**
  `enforceApiRateLimit(req, ctx)` is called from `ApiBaseController.authenticate`,
  `withApiKeyAuth` (both branches), and `withAuth`. NM Store path uses
  sentinel subjectId `'nm_store'` since it has no `apiKeyId`.
- (2026-05-05) **Defer to v2 by removing routes, not by leaving 501s.**
  Discovered 14+ TODO stubs in `ApiWebhookController`. The deferred ones
  (transformations, bulk ops, templates marketplace, etc.) get their route
  files deleted so OpenAPI doesn't advertise them.
- (2026-05-05) **Rate-limiter and webhooks share the
  `TokenBucketRateLimiter` namespace work.** The webhook per-webhook outbound
  cap (namespace `'webhook-out'`) depends on F001–F005 being merged first.

## Discoveries / Constraints

- (2026-05-05) `TokenBucketRateLimiter` is at
  `packages/email/src/TokenBucketRateLimiter.ts`. Bucket key prefix is
  `alga-psa:ratelimit:bucket:` and TTL is 3600s. The `BucketConfigGetter`
  signature is `(tenantId) => BucketConfig` — must widen to
  `(tenantId, subjectId?) => BucketConfig` for per-key/per-webhook overrides.
- (2026-05-05) Existing email rate-limit defaults are `maxTokens=60,
  refillRate=1`. New API defaults are deliberately higher (`120, 1`) — API
  bursts are expected to be larger than email bursts.
- (2026-05-05) `WebhookService.checkRateLimit` (line 1056) queries
  `webhook_deliveries`, which doesn't exist yet — it would throw if called.
  Latent bug: nothing currently calls into the delivery path.
- (2026-05-05) `WebhookService.performWebhookDelivery` (line 950) is mocked
  — sleeps 100 ms and returns `{ success: true, status_code: 200 }`. No real
  HTTP request happens today.
- (2026-05-05) `webhookEventTypeSchema` lacks `ticket.comment.added`. F023
  must extend the enum or webhook creation requests for that event type
  fail validation.
- (2026-05-05) Existing distribution pattern for tenant-scoped tables:
  `notification_settings` is in `20250805000019_distribute_final_tables.cjs`.
  Migration extension is `.cjs`, not `.ts`. Citus distribution lives in
  `ee/server/migrations/citus/`, separate from the create migration in
  `server/migrations/`.
- (2026-05-05) `ApiBaseController.authenticate` is **not** the universal
  hook point — `withApiKeyAuth` and `withAuth` in `apiMiddleware.ts:144,201`
  are independent paths, and the NM Store branch in `withApiKeyAuth`
  produces a context with `apiKeyId === undefined`. Verified by reading
  service-types and test-auth routes.
- (2026-05-05) Internal event vocabulary is much larger than the v1 public
  surface. `TICKET_REOPENED`, `TICKET_ESCALATED`, `TICKET_PRIORITY_CHANGED`,
  `TICKET_UNASSIGNED`, `TICKET_QUEUE_CHANGED`, `TICKET_TAGS_CHANGED`,
  `TICKET_RESPONSE_STATE_CHANGED`, `TICKET_ADDITIONAL_AGENT_ASSIGNED` exist
  in `EVENT_TYPES` but are deferred to v2 (rolled into `ticket.updated`).

## Commands / Runbooks

- (2026-05-05) Run a single integration test:
  `cd server && npx vitest run src/test/integration/apiRateLimit.headers.test.ts`
- (2026-05-05) Run all webhook integration tests:
  `cd server && npx vitest run src/test/integration/webhook*`
- (2026-05-05) Run unit tests for the rate limiter package:
  `cd packages/email && npx vitest run src/__tests__/TokenBucketRateLimiter*`
- (2026-05-05) Apply migrations against a local dev database — see existing
  migrate flow in `server/package.json` (knex CLI driven by `migrations/`
  and `ee/server/migrations/citus/`).
- (2026-05-05) Toggle observation mode locally: `RATE_LIMIT_ENFORCE=false`
  in `server/.env`. Toggle SSRF bypass for staging:
  `WEBHOOK_SSRF_ALLOW_PRIVATE=true`.
- (2026-05-05) Tail Redis bucket state during integration tests:
  `redis-cli --scan --pattern 'alga-psa:ratelimit:bucket:*' | xargs -L1 redis-cli get`
- (2026-05-05) Run the namespace foundation unit suite without coverage noise:
  `cd server && npx vitest run --coverage.enabled=false src/test/unit/notifications/tokenBucketRateLimiter.test.ts ../packages/email/src/__tests__/TokenBucketRateLimiter.namespaces.test.ts ../packages/email/src/__tests__/TokenBucketRateLimiter.subjectId.test.ts ../packages/email/src/__tests__/TokenBucketRateLimiter.email-regression.test.ts`

## Links / References

- Source plans:
  - `.ai/api-rate-limiting-plan.md`
  - `.ai/ticket-webhooks-plan.md`
- Key files:
  - `packages/email/src/TokenBucketRateLimiter.ts` — bucket implementation.
  - `packages/email/src/DelayedEmailQueue.ts` — pattern for
    `WebhookDeliveryQueue`.
  - `server/src/lib/initializeApp.ts:144-168` — singleton init site.
  - `server/src/lib/api/controllers/ApiBaseController.ts:44-87` — auth surface 1.
  - `server/src/lib/api/middleware/apiMiddleware.ts:101-111` —
    `TooManyRequestsError`; lines 144 & 201 — auth surfaces 2 & 3.
  - `server/src/lib/api/services/WebhookService.ts:950, 1056` — mock + broken
    rate limit.
  - `server/src/lib/api/controllers/ApiWebhookController.ts` — 14+ TODOs.
  - `packages/event-schemas/src/schemas/eventBusSchema.ts:157-184` — internal
    `EVENT_TYPES`.
  - `server/src/lib/api/schemas/webhookSchemas.ts:21-60` — public enum to
    extend.
  - `ee/server/migrations/20251014120000_create_stripe_integration_tables.cjs:28`
    — `webhook_secret_vault_path` precedent.

## Open Questions

- (2026-05-05) IA placement of the new admin UIs — Settings → Security or
  Settings → Integrations? Confirm with design before F022/F047 lands.
- (2026-05-05) Per-tenant cap on top of per-key buckets? Defer until
  Stage 1 observation data justifies it.
- (2026-05-05) Per-endpoint cost weights (search costs more than get)?
  Defer until observation data shows pressure differences.
- (2026-05-05) Expose `ticket.deleted` in v1? Decision: defer unless the
  noisy poller specifically asks during migration.
- (2026-05-05) Per-tenant webhook count cap — proposed 50; confirm before
  F047 lands.

## Progress Log

- (2026-05-05) **F001 complete.** `TokenBucketRateLimiter` now requires an
  explicit `namespace` on `tryConsume`, `getState`, `getBucketKey`, and
  `getBucketConfig`. Redis keys now include the namespace segment
  (`alga-psa:ratelimit:bucket:{namespace}:{tenant}[:{subject}]`) so future
  API/webhook buckets cannot collide with the existing email path.
- (2026-05-05) **F002 complete.** `BucketConfigGetter` now receives
  `(tenantId, subjectId?)`, which lets the limiter surface per-key and
  per-webhook configuration decisions without additional key parsing.
- (2026-05-05) **F003 complete.** `TokenBucketRateLimiter.initialize()`
  now accepts a namespace-to-getter map, and lookup/fail-open behavior stays
  centralized inside the shared limiter instead of spreading per-namespace
  branching to callers.
- (2026-05-05) **F004 complete.** `initializeApp()` now registers the
  existing email tenant-config getter under namespace `email` and a temporary
  hard-coded API getter under namespace `api`, so startup is already wired
  for the upcoming API limiter without altering email defaults.
- (2026-05-05) **F005 complete.** `TenantEmailService.checkRateLimits()`
  now consumes tokens from namespace `email`, preserving the pre-existing
  per-tenant/per-user email semantics after the limiter API change.
- (2026-05-05) **T001 complete.** Added
  `packages/email/src/__tests__/TokenBucketRateLimiter.namespaces.test.ts`
  to prove the same tenant/subject can exhaust `email` without consuming the
  `api` bucket.
- (2026-05-05) **T002 complete.** Added
  `packages/email/src/__tests__/TokenBucketRateLimiter.subjectId.test.ts`
  to verify namespace getters receive `subjectId` and that API-key buckets
  are keyed as `...:api:{tenant}:{subject}`.
- (2026-05-05) **T003 complete.** Added
  `packages/email/src/__tests__/TokenBucketRateLimiter.email-regression.test.ts`
  with fake time pinned to confirm the email namespace preserves the legacy
  60-token burst / 1-token-per-second refill behavior at calls 1, 30, 60,
  and 61.
