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
- (2026-05-05) PostgreSQL `UNIQUE (tenant, api_key_id)` would allow multiple
  `(tenant, NULL)` tenant-default rows. The migration needs a separate unique
  partial index on `tenant WHERE api_key_id IS NULL` to make the null fallback
  row actually unique.
- (2026-05-05) The current secret-provider API resolves tenant secrets by
  `(tenant, secretName)`, not by an arbitrary vault path. For webhook signing
  secrets, `signing_secret_vault_path` therefore acts as stored metadata; the
  DAL resolves the actual secret by taking the basename of the stored path and
  calling `getTenantSecret(tenant, basename(path))`.
- (2026-05-05) `undici` is already available in the server runtime, so the
  real webhook transport can use `undici.fetch` + `Agent` for the
  `verify_ssl=false` path without introducing a new dependency.
- (2026-05-05) Node's `net.BlockList` is sufficient for the required SSRF
  address classes. The helper now blocks RFC1918, loopback, link-local, and
  CGNAT IPv4 ranges plus `::1` and `fe80::/10`, and it short-circuits all of
  those checks when `WEBHOOK_SSRF_ALLOW_PRIVATE=true`.
- (2026-05-05) The repo still had an older generic webhook validator that
  expected `sha256=<hex>`. F030 replaces that with the PRD-specific outbound
  format `t=<unix>,v1=<hex>` and routes the leftover schema helper through the
  new shared implementation so future controller work doesn't split the
  signature recipe again.
- (2026-05-05) The ticket webhook surface now has a single canonical
  translation layer under `eventBus/subscribers/webhook/`; future subscriber
  fan-out code can map one internal event to one or more public webhook events
  without duplicating string switches.
- (2026-05-05) The placeholder retry math in `WebhookService` was still using
  generic exponential/linear config fields. F039 replaces that with the PRD's
  fixed retry cadence and exposes it as a shared helper for the future Redis
  queue worker.
- (2026-05-05) `initializeApp.ts` is a poor `tsx` smoke-import target in this
  repo because importing the full app graph pulls Next/UI assets like
  `react-day-picker/src/style.css`. For F031 validation, focused imports of the
  new rate-limit getter and the touched service file are the useful checks.
- (2026-05-05) `ApiBaseController.authenticate` is **not** the universal
  hook point — `withApiKeyAuth` and `withAuth` in `apiMiddleware.ts:144,201`
  are independent paths, and the NM Store branch in `withApiKeyAuth`
  produces a context with `apiKeyId === undefined`. Verified by reading
  service-types and test-auth routes.
- (2026-05-05) `/api/v1/test-auth` does not use the same `withApiKeyAuth`
  helper as `service-types`; it goes through the older
  `server/src/lib/api/middleware/apiAuthMiddleware.ts`. Rate-limit wiring has
  to cover that legacy wrapper too or the planned cross-surface test would
  split buckets by middleware implementation.
- (2026-05-05) Several `/api/v1` route families still bypassed the three
  shared auth surfaces even after F018: asset routes and contract-line routes
  were calling controllers that expect `req.context` but never authenticated,
  and a handful of direct route handlers (`tickets/priorities`,
  `tickets/statuses`, ticket comment reactions, storage routes, and several
  mobile moderation/push/account routes) were validating API keys inline
  without invoking the limiter.
- (2026-05-05) Internal event vocabulary is much larger than the v1 public
  surface. `TICKET_REOPENED`, `TICKET_ESCALATED`, `TICKET_PRIORITY_CHANGED`,
  `TICKET_UNASSIGNED`, `TICKET_QUEUE_CHANGED`, `TICKET_TAGS_CHANGED`,
  `TICKET_RESPONSE_STATE_CHANGED`, `TICKET_ADDITIONAL_AGENT_ASSIGNED` exist
  in `EVENT_TYPES` but are deferred to v2 (rolled into `ticket.updated`).
- (2026-05-05) `TICKET_COMMENT_ADDED` currently reaches subscribers through
  the legacy `TicketEventPayloadSchema` shape from `TicketService`: it
  includes `payload.comment.{content,author,isInternal}` but not a persisted
  comment timestamp. The webhook payload builder therefore uses
  `payload.occurredAt` / event timestamp for `comment.timestamp`.
- (2026-05-05) `TICKET_STATUS_CHANGED` payloads may arrive in either the new
  domain shape (`previousStatusId`) or an older `changes.status_id.from`
  style. The webhook payload builder now accepts both so subscriber output
  stays stable across publishers while the event vocabulary converges.
- (2026-05-05) `webhookSubscriber.ts` needs a queue boundary before the full
  poller lands. I added `WebhookDeliveryQueue.enqueue()` as the initial Redis
  storage contract now, and the later F037 work will extend that same class
  with claim/process/retry behavior instead of swapping subscriber behavior.
- (2026-05-05) Importing `server/src/lib/eventBus/subscribers/index.ts`
  through `tsx` drags a large app/UI graph and currently trips the same
  unrelated `react-day-picker/src/style.css` loader issue seen with broad
  `initializeApp` smoke imports. The narrower `webhookSubscriber.ts` module
  import remains the useful compile smoke for webhook subscriber changes.
- (2026-05-05) `ApiWebhookController.ts` imports can hit that same broad
  `.css` loader issue under `tsx`. For controller TODO replacements, the
  narrower DAL/helper module smokes plus `git diff --check` are the reliable
  local validation path unless we run the full server test suite.
- (2026-05-05) The webhook signature-verify route now supports both the plan's
  direct `secret_vault_path` input and a safer `webhook_id` lookup. Both
  paths resolve to the same tenant secret provider and use the shared
  `verifyWebhookSignature()` helper after normalizing the header format.
- (2026-05-05) The remaining read-side webhook controller stubs can stay thin:
  delivery details come straight from `webhook_deliveries`, health derives
  from the webhook stats columns already maintained by the delivery processor,
  subscriptions are just `webhook.event_types`, and available events come
  from `webhookEventTypeSchema.options`.
- (2026-05-05) Deferred webhook TODOs are now route-level cleanup, not
  controller cleanup. The implemented surface keeps nested delivery/health/
  subscriptions reads plus create/list/test/verify, and drops the transform,
  filter, validate, bulk, search, export, trigger, and system-health routes
  so they naturally 404 instead of advertising dead handlers.
- (2026-05-05) The nested webhook test route now diverges from the older
  generic `/api/v1/webhooks/test` helper: `/[id]/test` always uses the stored
  webhook URL + live signing secret, emits `event_type='webhook.test'`,
  records `is_test=true`, and intentionally skips outbound bucket
  consumption.
- (2026-05-05) Broad imports through `server/src/lib/jobs/index.ts` also hit
  the same unrelated `react-day-picker` CSS loader issue under `tsx`, so the
  cleanup-job service module is the reliable smoke target for scheduled-job
  additions in this environment.
- (2026-05-05) I could not find a dedicated operational metrics client/facade
  in this repo. For the v1 observability items, the fallback is structured log
  emission with stable metric names/labels rather than a Prometheus/StatsD
  sink.
- (2026-05-05) Webhook observability follows that same fallback pattern:
  queue depth is emitted from the Redis ZSET wrapper, delivery totals and
  durations from the delivery processor, and auto-disable counts from the
  state transition helper.
- (2026-05-05) `WebhookDeliveryQueue` now owns the retry loop contract:
  processors now return explicit `delivered` / `retry` / `abandoned`
  outcomes. The queue handles atomic `zRem` claims, caps active work at 50
  in-process jobs, and re-enqueues attempts 2..5 with
  `computeBackoff(attempt)`.
- (2026-05-05) Auto-disable must follow a continuous failure streak, not just
  "some failures in the last day." `maybeAutoDisable()` therefore keys off
  the first non-delivered attempt since `last_success_at` and disables only
  once that streak has remained all-failure for 24 hours.
- (2026-05-05) Added feature `F052` after discovering a plan/code mismatch:
  `webhookSchemas.ts` already exposed `event_filter.entity_ids`, but the
  `webhooks` table migration and `webhookModel` never persisted `event_filter`
  at all. The subscriber-side entity filter needs that durable field first.
- (2026-05-05) The v1 subscriber filter stops at `event_filter.entity_ids`.
  Generic `conditions`, `tags`, and `entity_types` remain schema-only for now
  per the PRD; the enqueue path simply treats an empty/missing `entity_ids`
  list as "match all."

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
- (2026-05-05) Run the API response-header unit test:
  `cd server && npx vitest run --coverage.enabled=false src/test/unit/api/apiMiddleware.responseHeaders.test.ts`
- (2026-05-05) Run the API rate-limit config getter unit tests:
  `cd server && npx vitest run --coverage.enabled=false src/lib/api/rateLimit/__tests__/configGetter.cache.test.ts src/lib/api/rateLimit/__tests__/configGetter.invalidate.test.ts src/lib/api/rateLimit/__tests__/configGetter.fallback.test.ts`
- (2026-05-05) Run the API rate-limit enforcement helper tests:
  `cd server && npx vitest run --coverage.enabled=false src/lib/api/rateLimit/__tests__/enforce.test.ts src/test/unit/api/apiMiddleware.responseHeaders.test.ts`
- (2026-05-05) Smoke-load the webhook payload builder:
  `cd server && npx tsx -e "import('./src/lib/eventBus/subscribers/webhook/webhookTicketPayload.ts').then(() => console.log('payload-ok'))"`
- (2026-05-05) Smoke-load the webhook subscriber + queue storage layer:
  `cd server && npx tsx -e "import('./src/lib/webhooks/processWebhookDeliveryJob.ts').then(() => console.log('processor-ok'))"`
  `cd server && npx tsx -e "import('./src/lib/webhooks/autoDisable.ts').then(() => console.log('auto-disable-ok'))"`
  `cd server && npx tsx -e "import('./src/lib/webhooks/WebhookDeliveryQueue.ts').then(() => console.log('queue-ok'))"`
  `cd server && npx tsx -e "import('./src/lib/eventBus/subscribers/webhookSubscriber.ts').then(() => console.log('subscriber-ok'))"`
- (2026-05-05) `cd server && npx tsc --noEmit --pretty false` currently OOMs
  in this repo, and even targeted `tsc` entrypoint checks surface existing
  package-resolution / JSX-config errors unrelated to this feature slice, so
  compile verification here is limited to focused runtime/unit checks plus
  manual review.
- (2026-05-05) Smoke-import the webhook DAL after edits:
  `cd server && npx tsx -e "import('./src/lib/webhooks/webhookModel.ts').then(() => console.log('ok'))"`
- (2026-05-05) Smoke-import the webhook delivery transport after edits:
  `cd server && npx tsx -e "import('./src/lib/webhooks/delivery.ts').then(() => console.log('delivery-ok'))"`
- (2026-05-05) Quick SSRF helper smoke:
  `cd server && npx tsx -e "import('./src/lib/webhooks/ssrf.ts').then(async ({ assertSafeWebhookTarget }) => { await assertSafeWebhookTarget('https://example.com'); console.log('public-ok'); try { await assertSafeWebhookTarget('http://127.0.0.1'); process.exit(1); } catch (error) { console.log((error && error.name) || 'error'); } })"`
- (2026-05-05) Quick signing helper smoke:
  `cd server && npx tsx -e "import('./src/lib/webhooks/sign.ts').then(({ signRequest, verifyWebhookSignature }) => { const header = signRequest('shh', '{\\\"a\\\":1}', 1700000000); console.log(header); console.log(verifyWebhookSignature(header, '{\\\"a\\\":1}', 'shh')); })"`
- (2026-05-05) Quick event-map smoke:
  `cd server && npx tsx -e "import('./src/lib/eventBus/subscribers/webhook/webhookEventMap.ts').then(({ publicEventsFor }) => { console.log(publicEventsFor('TICKET_ASSIGNED').join(',')); console.log(publicEventsFor('NOPE').length); })"`
- (2026-05-05) Quick backoff helper smoke:
  `cd server && npx tsx -e "import('./src/lib/webhooks/backoff.ts').then(({ computeBackoff }) => { console.log([1,2,3,4,5].map(computeBackoff).join(',')); })"`
- (2026-05-05) Quick webhook rate-limit getter smoke:
  `cd server && npx tsx -e "import('./src/lib/webhooks/rateLimitConfig.ts').then(({ DEFAULT_WEBHOOK_RATE_LIMIT_PER_MIN }) => console.log(DEFAULT_WEBHOOK_RATE_LIMIT_PER_MIN))"`

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
  - `server/src/lib/webhooks/webhookModel.ts` — tenant-scoped webhook DAL and
    signing-secret resolution helpers.
  - `server/src/lib/webhooks/delivery.ts` — shared outbound HTTP transport
    for webhook delivery with timeout/TLS/error classification.
  - `server/src/lib/webhooks/ssrf.ts` — outbound target validation for
    webhook delivery and test-send flows.
  - `server/src/lib/webhooks/sign.ts` — outbound request signing and
    signature verification helper for webhook deliveries.
  - `server/src/lib/eventBus/subscribers/webhook/webhookEventMap.ts` —
    canonical mapping from internal ticket events to public webhook events.
  - `server/src/lib/webhooks/backoff.ts` — shared retry schedule helper for
    the outbound webhook queue.
  - `server/src/lib/webhooks/rateLimitConfig.ts` — shared token-bucket config
    getter for the `webhook-out` namespace.

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
- (2026-05-05) **F006 complete.** `ApiError` now supports optional response
  headers and `handleApiError()` forwards them into `NextResponse.json()`,
  which lets later rate-limit errors attach `Retry-After` and
  `X-RateLimit-*` metadata without a parallel error class.
- (2026-05-05) **F007 complete.** `createSuccessResponse()` and
  `createPaginatedResponse()` now accept optional `extraHeaders` as a final
  parameter, preserving existing controller call sites while opening a clean
  path for rate-limit headers on successful responses.
- (2026-05-05) **F008 complete.** Added
  `server/migrations/20260505123000_create_api_rate_limit_settings.cjs` with
  tenant-scoped rate-limit columns plus separate unique indexes for per-key
  rows and the `(tenant, NULL)` tenant default row.
- (2026-05-05) **F009 complete.** Added
  `ee/server/migrations/citus/20260505123100_distribute_api_rate_limit_settings.cjs`
  so the new settings table is distributed on `tenant` when Citus is present.
- (2026-05-05) **F010 complete.** Added
  `server/src/lib/api/rateLimit/apiRateLimitSettingsModel.ts` with exact-row
  reads/writes plus a fallback resolver that checks `(tenant, apiKeyId)`,
  then `(tenant, NULL)`, then the hard defaults `{ maxTokens: 120, refillRate: 1 }`.
- (2026-05-05) **F011 complete.** Added
  `server/src/lib/api/rateLimit/apiRateLimitConfigGetter.ts` with a 1000-entry,
  30-second TTL cache, exact-entry invalidation, tenant-prefix invalidation,
  and `initializeApp()` now uses it for the `api` namespace.
- (2026-05-05) **T004 complete.** Added
  `server/src/lib/api/rateLimit/__tests__/configGetter.cache.test.ts` to
  verify identical cached lookups hit the settings resolver once.
- (2026-05-05) **T005 complete.** Added
  `server/src/lib/api/rateLimit/__tests__/configGetter.invalidate.test.ts`
  to prove tenant-wide invalidation clears only that tenant and single-key
  invalidation clears only the targeted key.
- (2026-05-05) **T006 complete.** Added
  `server/src/lib/api/rateLimit/__tests__/configGetter.fallback.test.ts`
  to verify the resolver order is per-key override, then tenant default, then
  the hard-coded API defaults.
- (2026-05-05) **F012 complete.** Added
  `server/src/lib/api/rateLimit/enforce.ts` as the shared API limiter entry
  point. It resolves the `api` namespace bucket, skips configured bypass
  paths, computes rate-limit header values, and either throws
  `TooManyRequestsError` or returns a `RateLimitDecision`.
- (2026-05-05) **F013 complete.** `enforceApiRateLimit()` now treats
  `RATE_LIMIT_ENFORCE=false` as observation mode: it logs the throttle with
  tenant/api-key/retry metadata and returns a decision instead of throwing.
- (2026-05-05) **F014 complete.** The NM Store branch in
  `apiMiddleware.withApiKeyAuth()` now stamps `rateLimitSubjectId='nm_store'`
  before calling the limiter so all global-key traffic shares one tenant
  bucket instead of bypassing per-subject accounting.
- (2026-05-05) **F015 complete.** `shouldBypassRateLimit()` now centralizes
  the bypass prefixes for health endpoints, mobile auth, and runner-internal
  endpoints so future auth wrappers reuse one rate-limit allowlist.
- (2026-05-05) **F016 complete.** Rate-limit denials now throw the existing
  `TooManyRequestsError` with `details.retry_after_ms`, `details.remaining`,
  and the full header set attached on `error.headers`.
- (2026-05-05) **F017 complete.** `ApiBaseController.authenticate()` now
  enforces the API bucket immediately after building request context and stores
  the resulting decision on `apiRequest.context.rateLimit`.
- (2026-05-05) **F018 complete.** The middleware auth wrappers now call
  `enforceApiRateLimit()` as soon as context is available. I also wired the
  legacy `apiAuthMiddleware.ts` path so `/api/v1/test-auth` stays in the same
  bucket family as the newer wrappers.
- (2026-05-05) **F019 complete.** `createSuccessResponse()` and
  `createPaginatedResponse()` now emit `X-RateLimit-Limit` and
  `X-RateLimit-Remaining` automatically when the passed request carries
  `context.rateLimit`, and the generic `ApiBaseController` create/update
  paths now pass `apiRequest` through to the helper.
- (2026-05-05) **F020 complete.** Added reusable legacy auth helpers:
  `authenticateApiKeyRequest()` for inline API-key handlers,
  `withApiKeyRouteAuth()` for route files that need `req.context`, and
  `appendRateLimitHeaders()` for direct `NextResponse` routes. Wrapped the
  entire asset and contract-line `/api/v1` route families so they now
  authenticate through the shared legacy middleware and emit rate-limit
  headers. I also migrated the remaining direct `/api/v1` handlers that were
  doing inline API-key validation (ticket priorities/statuses/reactions,
  storage routes, and the non-mobile-auth mobile moderation/push/account
  routes) onto the shared helper so they consume the same `api` bucket.
- (2026-05-05) **F021 complete.** Added tenant-admin server actions in
  `packages/auth/src/actions/apiKeyRateLimitActions.ts`:
  `getApiRateLimitForKey`, `setApiRateLimitForKey`,
  `setTenantDefaultApiRateLimit`, and `clearApiRateLimitForKey`. They verify
  admin access, scope API key IDs to the current tenant, use the
  `api_rate_limit_settings` model for reads/writes, and invalidate the
  in-process API rate-limit config cache immediately after every write so UI
  updates do not wait on the 30s TTL.
- (2026-05-05) **F022 complete.** `AdminApiKeysSetup` now loads each key's
  effective API rate-limit settings plus live bucket state and renders a new
  "Rate Limit" column with inline override editing and reset. The column
  shows the effective burst / refill values, the config source
  (per-key override vs tenant default vs hard default), and the current
  remaining tokens from `TokenBucketRateLimiter.getState('api', tenant,
  apiKeyId)`.
- (2026-05-05) **F023 complete.** The public webhook event enum now includes
  `ticket.comment.added`, so webhook create/update validation no longer
  rejects the v1 ticket-comment subscription event.
- (2026-05-05) **T018 complete.** Added
  `server/src/lib/api/schemas/__tests__/webhookSchemas.test.ts` to lock in
  acceptance of the new `ticket.comment.added` enum member.
- (2026-05-05) **F024 complete.** Added
  `server/migrations/20260505140000_create_webhook_tables.cjs` with the base
  `webhooks` subscription table: tenant-scoped primary key, event list,
  signing-secret vault path, retry/rate-limit config, activation flag, rolling
  delivery stats, auto-disable timestamp, and creator/audit timestamps.
- (2026-05-05) **F025 complete.** Expanded the same webhook migration to add
  `webhook_deliveries` with tenant/webhook foreign key wiring, request +
  response capture columns, retry scheduling fields, `is_test`, and the three
  queue-oriented indexes required by the PRD (`webhook+attempted_at`,
  `event_id`, and partial pending/retrying `next_retry_at`).
- (2026-05-05) **F026 complete.** Added
  `ee/server/migrations/citus/20260505140100_distribute_webhook_tables.cjs`
  to distribute both `webhooks` and `webhook_deliveries` on `tenant`, with
  the same Citus-enabled / already-distributed guards used by the earlier
  rate-limit distribution migration.
- (2026-05-05) **F027 complete.** Added
  `server/src/lib/webhooks/webhookModel.ts` as the first non-mock webhook
  foundation: public reads omit `signing_secret_vault_path`, inserts persist
  signing secrets via `getSecretProviderInstance()`, delivery attempts write
  to `webhook_deliveries`, stats updates increment the rolling counters on
  `webhooks`, and `getSigningSecret()` resolves the stored path-style
  reference back to the tenant secret name.
- (2026-05-05) **F028 complete.** Added
  `server/src/lib/webhooks/delivery.ts` and rewired
  `WebhookService.performWebhookDelivery()` to use it. Deliveries now perform
  a real `undici.fetch` call with a 10s timeout, preserve response status and
  headers, truncate stored response bodies to 8 KB, classify DNS/connect/TLS/
  timeout failures, and disable certificate verification only when
  `verify_ssl=false`.
- (2026-05-05) **F029 complete.** Added
  `server/src/lib/webhooks/ssrf.ts` and enforced it in the shared delivery
  transport before any outbound fetch. Targets must now use `http(s)`,
  reject `localhost`/loopback/private/link-local/CGNAT destinations after DNS
  resolution, and only bypass those checks when
  `WEBHOOK_SSRF_ALLOW_PRIVATE=true`.
- (2026-05-05) **F030 complete.** Added
  `server/src/lib/webhooks/sign.ts` with the PRD's `X-Alga-Signature`
  contract: `t=<timestamp>,v1=<sha256 hex>` over `${timestamp}.${body}`.
  `webhookSchemas.validateWebhookSignature()` now delegates to the same helper
  instead of preserving the old `sha256=<hex>` comparison logic.
- (2026-05-05) **F032 complete.** Added
  `server/src/lib/eventBus/subscribers/webhook/webhookEventMap.ts` with the
  v1 ticket-event translation table and a `publicEventsFor()` helper that
  returns a fresh array for each lookup, making the mapping ready for the
  upcoming event-bus subscriber.
- (2026-05-05) **F039 complete.** Added
  `server/src/lib/webhooks/backoff.ts` with the PRD retry schedule
  (1m, 5m, 30m, 2h, 12h) and pointed the scaffolded
  `WebhookService.calculateNextRetryTime()` method at that helper so old
  placeholder retry math no longer diverges from the intended queue behavior.
- (2026-05-05) **F031 complete.** Added
  `server/src/lib/webhooks/rateLimitConfig.ts`, registered the new
  `'webhook-out'` namespace in `initializeApp()`, and replaced the stale
  delivery-count query in `WebhookService.checkRateLimit()` with
  `TokenBucketRateLimiter.tryConsume('webhook-out', tenant, webhookId)`.
  The delivery path now applies the shared per-webhook bucket instead of the
  mocked `webhook.rate_limit.enabled` branch.
- (2026-05-05) **F033 complete.** Added
  `server/src/lib/eventBus/subscribers/webhook/webhookTicketPayload.ts`,
  which builds the PRD's curated ticket snapshot for webhook fan-out,
  normalizes `ticket.updated` change diffs, includes
  `ticket.comment.added` comment metadata without attachments, resolves tags
  from `tag_mappings`, and caches the base `(tenant,ticket_id)` snapshot for
  60 seconds so a multi-subscriber fan-out does not repeat the same joins.
- (2026-05-05) **F034 complete.** `ticket.status_changed` payloads from
  `webhookTicketPayload.ts` now include `previous_status_id` plus a
  tenant-scoped lookup of `previous_status_name`, using either
  `payload.previousStatusId` or the older `payload.changes.status_id.from`
  compatible shape when deriving the prior status.
- (2026-05-05) **F035 complete.** Added
  `server/src/lib/eventBus/subscribers/webhookSubscriber.ts`, which
  subscribes to the six v1 ticket events, builds the curated webhook payload
  once per internal event, filters subscribers by `(tenant, public event
  type)`, and enqueues one delivery job per matching active webhook. I also
  introduced the initial `server/src/lib/webhooks/WebhookDeliveryQueue.ts`
  storage contract so the subscriber already targets the eventual Redis ZSET
  queue instead of a temporary inline-delivery path.
- (2026-05-05) **F036 complete.** Registered the webhook subscriber in
  `server/src/lib/eventBus/subscribers/index.ts` so the existing
  register-all / unregister-all lifecycle now includes webhook ticket events
  alongside the other subscriber families.
- (2026-05-05) **F037 complete.** Expanded
  `server/src/lib/webhooks/WebhookDeliveryQueue.ts` from storage-only enqueue
  support into the actual Redis ZSET poller: `initialize(getRedisClient,
  processFn)` now starts a 2s processing loop, claims ready jobs via
  `zRangeByScore` + `zRem`, limits active processor promises to 50, retries
  failed jobs up to five total attempts using the shared backoff helper, and
  drains in-flight work for up to 30 seconds on shutdown / `SIGTERM`.
- (2026-05-05) **F038 complete.** `initializeApp()` now boots the webhook
  delivery queue with `getRedisClient` plus a real
  `processWebhookDeliveryJob()` callback, and the existing SIGTERM/SIGINT
  cleanup path now shuts the queue down alongside the email retry queues.
- (2026-05-05) **F040 complete.** Added
  `server/src/lib/webhooks/autoDisable.ts` and wired it into
  `processWebhookDeliveryJob()`. Failed deliveries now advance the webhook's
  rolling stats, and once the first failure since the last success has aged
  past 24 hours the webhook is auto-disabled exactly once and the owning user
  receives a direct notification email via the system email service.
- (2026-05-05) **F052 complete.** Updated the base webhook migration plus
  `server/src/lib/webhooks/webhookModel.ts` so webhook rows now persist and
  return `event_filter` JSON. That closes the storage gap under
  `event_filter.entity_ids` before the subscriber starts enforcing it.
- (2026-05-05) **F041 complete.** `webhookSubscriber.ts` now enforces
  `event_filter.entity_ids` before enqueueing jobs: when a webhook row carries
  a non-empty allowlist, only matching ticket IDs are queued. Missing/empty
  allowlists still receive all matching event types.
- (2026-05-05) **F042 complete.** `ApiWebhookController.rotateSecret()` now
  performs a real secret rotation: it generates a 32-byte base64url secret,
  updates the webhook through `webhookModel.update(..., { signingSecret })`,
  and returns the plaintext once in the response instead of the old timestamp
  stub.
- (2026-05-05) **F043 complete.** `ApiWebhookController.verifySignature()`
  now resolves the signing secret from either `webhook_id` or
  `secret_vault_path`, normalizes split signature inputs into the
  `t=...,v1=...` header format when needed, and returns the real HMAC match
  result instead of the old always-true stub.
- (2026-05-05) **F044 complete.** Replaced four controller TODOs:
  `getDelivery()` now loads a concrete `webhook_deliveries` row via
  `webhookModel.getDeliveryById()`, `getHealth()` derives a stable health
  summary from the webhook stats columns, `getSubscriptions()` returns the
  stored `event_types` for the webhook, and `listEvents()` returns the public
  enum from `webhookEventTypeSchema`.
- (2026-05-05) **F045 complete.** Deleted the deferred webhook route handlers
  for transform/filter validation, system health, global/nested subscription
  creation, bulk/search/export, and manual event triggering. The nested
  `[id]/subscriptions` route now exposes only `GET`, and the removed paths
  will 404 instead of surfacing TODO-backed handlers.
- (2026-05-05) **F046 complete.** `ApiWebhookController.testById()` now sends
  a real signed `webhook.test` request to the configured webhook URL, records
  the attempt in `webhook_deliveries` with `is_test=true`, and returns the
  observed transport result. It reuses the live signing/header and SSRF-guard
  path but skips the outbound rate-limit bucket and does not mutate webhook
  delivery stats.
- (2026-05-05) **F048 complete.** Added
  `server/src/services/cleanupWebhookDeliveriesJob.ts` plus scheduler wiring
  in `server/src/lib/jobs/index.ts` and
  `server/src/lib/jobs/initializeScheduledJobs.ts`. The new system-wide job
  runs every 15 minutes and deletes `webhook_deliveries` rows older than
  30 days in batches of 10,000 until the backlog is gone.
- (2026-05-05) **F049 complete.** `enforceApiRateLimit()` now emits
  structured fallback metric logs for
  `api_rate_limit_consumed_total`, `api_rate_limit_remaining`, and
  `api_rate_limit_redis_unavailable_total`, using stable label fields
  (`tenant`, `api_key_id`, `outcome`) alongside the existing throttle WARN.
- (2026-05-05) **F050 complete.** Added
  `server/src/lib/webhooks/metrics.ts` and wired structured fallback metric
  logs into `WebhookDeliveryQueue`, `processWebhookDeliveryJob()`, and
  `maybeAutoDisable()`. That now emits
  `webhook_queue_depth`, `webhook_deliveries_total`,
  `webhook_delivery_duration_ms`, and
  `webhook_auto_disabled_total`.
