# Scratchpad: quote lifecycle events

Rolling notes. Newest decisions win; revise rather than append contradictions.

## Context

- Hosted-customer feature request (2026-10-22): quote lifecycle events in outbound webhooks and the workflow catalog. The customer currently polls `GET /api/v1/quotes?status=accepted`. The PSA ticket is linked on the XO card.
- Plan drafted against `origin/main` @ `44629a24f1` on branch `feature/quote-lifecycle-events-plan`.

## Discoveries (2026-10-27)

### Webhook registry

- **The registry already exists.** Commit `620c297ded` (2026-10-20) added `server/src/lib/webhooks/eventRegistry.ts`, the single source for:
  - the REST enum and OpenAPI
  - the admin listing
  - `SUPPORTED_WEBHOOK_EVENTS`
  - subscriber internal → public maps
- Client, contact and client_location use the generic `createEntityWebhookSubscriber` (`server/src/lib/eventBus/subscribers/entityWebhookSubscriber.ts`). Ticket and project keep their own subscribers because they hydrate from the DB.
- **Legacy names are inert.** time.entry.*, invoice.*, asset.*, system.*, workflow.* and custom.event no longer deliver: they are kept on old rows and rejected on new writes. The customer request assumed invoice/asset/system webhooks were delivered. They never were.
- **Entity payloads are deliberately thin** (`webhookEntityPayload.ts`): id, parent `client_id` and `changed_fields`, with no DB reads. The quote design keeps that rule and adds `carriedFields` so the domain event carries the small fields.
- **Dedupe friction.** Deliveries dedupe on `(eventId, webhookId)`, so one internal event that feeds two public names loses a delivery for a subscriber on both. See the LEVERAGE note in `eventRegistry.ts`. This is why each public quote event gets its own internal event, and why `quote.status_changed` is deferred.

### Workflow publishing

- One `publishWorkflowEvent` call feeds both the event bus (which webhook subscribers listen on) and the workflow runtime.
- Opportunity events (`packages/opportunities/src/lib/opportunityEvents.ts`) and client_location events (`packages/clients/src/lib/clientLocationEvents.ts`) both use `registerAfterCommit`, then publish. Copy that pattern.
- `packages/clients/src/lib/clientLocationWritePaths.contract.test.ts` is the write-path ledger pattern to copy.

### Quote status writers

- `Quote.update` already validates transitions (`canTransitionQuoteStatus`) and writes a `status_changed` activity. Most UI, REST and portal paths go through it.
- `crmWorkerDal.update` is a copy of `Quote.update` for the workflow worker; the `crm.*` quote actions transition through it.
- Direct writes that bypass the model:
  - expire-on-read and supersede (both in `models/quote.ts`)
  - the expiry job
  - conversion
  - `releaseQuoteConversionForDeletedInvoice` (converted → accepted, which is not in the transition table)
- `viewed` is not a status; `viewed_at` is set once on the first portal view.
- Opportunity link flows call `onQuoteSent`/`onQuoteAccepted` without any transition. They must not emit quote events.

## Decisions

- Use one internal event per public webhook name (dedupe friction above).
- Add `superseded`, `cancelled` and `conversion_reverted` beyond the request. Accepted and converted quotes can be revised, cancelled or un-converted, and consumers need those retractions.
- The idempotency key uses the `quote_activities` row id written in the same transaction, which gives one key per real transition, including repeated conversions.
- No feature flag; the change is additive.

## Open questions

See PRD §9.

## Commands

```bash
# Registry-driven webhook tests
npx vitest run server/src/lib/webhooks/__tests__/eventRegistry.contract.test.ts
npx vitest run server/src/lib/eventBus/subscribers/__tests__/entityWebhookSubscriber.test.ts

# Find every quotes.status writer (feed the ledger test)
git grep -n -E "status: '(sent|accepted|rejected|expired|converted|approved|pending_approval|cancelled|superseded)'" -- packages/billing/src packages/client-portal/src server/src/lib shared/workflow
```

## 2026-10-28 — design desk (XO, conn): plan adopted, drift checked, §9 resolved

Cherry-picked `21680b0c` (docs-only: PRD.md, features.json, tests.json, SCRATCHPAD.md) onto `origin/main` @ `44629a24f1` — applied cleanly, no conflicts.

Drift re-checked against `44629a24f1` (the base named in the PRD is still current):
- `packages/billing/src/models/quote.ts` — `canTransitionQuoteStatus` used at L302, `status_changed` activity at L313. PRD said "~L290"; behaviour matches, line drift only.
- `shared/workflow/runtime/actions/businessOperations/crmWorkerDal.ts` — present, still a duplicate of `Quote.update`.
- `packages/event-schemas/src/schemas/domain/` has no quote schema file; `shared/workflow/streams/domainEventBuilders/` has no quote builders. Both are correctly "to be created".
- `server/src/lib/webhooks/eventRegistry.ts` — `WebhookEntity = 'ticket' | 'project' | 'client' | 'contact' | 'client_location'` (5 entities, no `quote`). §6.4 widening is still needed as written.
- `server/migrations/20261016100000_seed_client_location_workflow_events.cjs` — present, still a valid seed model.
- `quote.ts` contains a comment describing `quote_activities` as Citus-local; that comment alone does not verify the current production distribution or transaction behavior.

Decisions: §9.1–9.4 adopt the PRD's own recommendations (no generic status_changed, IDs-only optional items, no approval events in v1, opportunity hooks as follow-up). §9.5 decided in favour of `shared/lib/quotes/quoteLifecycleEvents.ts` on the strength of the ticket precedent, which also supplies the contract-test pattern for §6.2's ledger test.

## Draft implementation verification (2026-10-28)

- The adopted plan commit `64d31f3d47` is present. The existing `package-lock.json` modification predates this work.
- The webhook registry still has no quote entity and no quote event schemas or builders exist.
- The workflow worker DAL has its own expire-on-read writer and a direct combined contract/invoice conversion writer, in addition to its update method. Both require coverage in §6.2. The expiry job also uses raw `knex.transaction`, which does not flush `registerAfterCommit`; it must use a transaction owner that flushes hooks. The model accepts root Knex connections as well as transactions, so its callers need the same audit.
- Both expire-on-read implementations and the expiry job currently update by quote ID without a status guard. Their activities can be recorded even after another writer changes the status.
- The configured development database has no Citus extension. Production distribution of `quote_activities` and atomic activity writes remain unverified; do not rely on the earlier Citus-local assertion as proof.
- A pure status classifier and behavioral tests have been added as an initial building block. It is not connected to any writer, publisher, workflow catalog, or webhook. All feature flags remain false until complete; the classifier test alone does not fulfill T001's full contract. No event delivery is implemented or verified.
- Validation for this partial foundation: `cd server && npx vitest run ../shared/lib/quotes/quoteLifecycleEvents.test.ts` passed (2 tests); `npm run typecheck -w @alga-psa/shared` and `npm run build:shared` passed. Full application build/typecheck and delivery, commit/rollback, deduplication, tenant isolation, and write-site integration tests have not been run. The app server was not started.

## Follow-up implementation

- Added schemas, workflow event metadata, builders, a catalog seed, correlation defaults, and registry-driven webhook projection for the ten event names. The after-commit queue has no write-site connections; the UI and APIs consequently list events that no quote transition emits yet. Do not ship this draft in its current state.
- Both billing and worker expire-on-read now update only a sent quote inside `withTransaction` and write an activity only when the update succeeds. The scheduled job also guards the update and uses `withTransaction`. Events are not yet emitted, and the race needs a DB-backed behavioral test.
- Builder/schema tests passed for ten event shapes, including an accepted payload with IDs; the subscriber test passed for field projection and client filtering. Signed delivery and event publication are untested. Locale keys currently use English fallback text in every locale and need translation and pseudo-locale generation.
- Citus distribution remains unverified. UUID activity IDs have a tenant-scoped primary key in the table creation migration, but schema evidence alone does not establish current distribution or cross-table transactional guarantees in production.
- The after-commit quote queue requires an activity ID for transitions and uses a quote-scoped first-view key. It has no callers and has not been validated against real DB commit/rollback behavior; F008 remains incomplete.
- The creation migration makes `quote_activities` tenant-keyed with a generated UUID activity ID. No migration naming that table distributes it, but the connected database has no Citus extension, so actual distribution is unverified. This uncertainty does not by itself block implementation.
- The original billing/server typecheck attempts exhausted the Node heap. A billing retry with an 8 GiB heap passed. The shared build, workflow-worker build, and event-schemas and shared typechecks passed; the four focused suites passed 59 tests. Full application build and server typecheck results are recorded below when available.
- The queue has unit coverage using a simulated owning Knex transaction: hooks run after commit, rollback suppresses publication, and view/conversion idempotency keys have the intended shape. This does not replace real DB transaction, duplicate-delivery, or write-site coverage. The four focused suites now pass 61 tests.
- `npm run build:ce` completed successfully, as did the workflow worker and shared builds. Server typecheck exhausted an 8 GiB Node heap and is being retried with a larger heap.
- Server typecheck passed with `NODE_OPTIONS=--max-old-space-size=16384`; the earlier default and 8 GiB attempts failed from Node heap exhaustion. Shared typecheck also passed after the queue and tests were added.

## Review follow-up

- Registered real builder probes for all ten quote events in the workflow emitter contract harness. They remain explicitly marked `no-product-emitter` until write paths are connected. The full emitter-contract suite passes, and `node scripts/check-workflow-event-emit-sites.mjs` passes.
- The quote queue now supplies a deterministic UUIDv5 event ID derived from the tenant and event-specific idempotency key. Unit tests check stability across repeated publication, tenant separation, and distinct activity IDs. This does not establish durable delivery deduplication: event-bus processed sets have a TTL, and webhook jobs are removed on claim. A durable delivery or publication ledger and end-to-end tests remain necessary.
- No quote write site has been wired to the queue. Portal acceptance and first view, all automatic and worker transitions, reversal/reconversion, actual signed delivery, translated locale labels, and the webhook guide remain incomplete. The registry still advertises non-emitting events; do not ship this draft.


## Takeover implementation (2026-10-28)

- Completed all production writers: billing model updates and revisions, both expiry readers, scheduled expiry, portal first view/accept/reject, invoice deletion, billing/worker conversion wrappers, and the worker send handler in `crm.ts`. AST inventory discovered that last direct writer beyond the earlier DAL audit; it now delegates to `Quote.update`.
- Shared status transitions are pure in `quoteStatusTransitions.ts`; the persisted event engine remains at the decided `quoteLifecycleEvents.ts` path. Root updates/revisions/conversions own `withTransaction`; UI raw transaction owners were migrated, and Opportunity win/API owners were verified to already flush after-commit hooks.
- Single-target conversion previously left status accepted. Public wrappers now compose record creation and finish exactly one conversion, including both targets for combined conversion. Real invoice deletion/reconversion and worker combined-conversion rollback were tested.
- Portal mutation locks precede selection writes and status validation. Competing acceptance cannot overwrite the selections captured by the winning event. Payloads are captured after financial recalculation and validated before commit. Legacy nullable quote numbers/client references are represented as null.
- Deterministic tenant/activity event IDs now reach the bus. The shared delivery processor uses durable tenant/webhook/event receipts with five-minute leases (HTTP timeout is ten seconds), releasing failures and retaining success. It does not hold a database transaction during HTTP. This suppresses successful-event replay beyond Redis retention; network consumers still need idempotency when a receiver processes a request but its response is lost.
- All locale field labels were translated; xx/yy use the existing pseudoString generator on the quote subtree only. A rendered component test checks selection changes, and locale data coverage checks every registered field. The webhook guide documents the ten events, sources, optional-item IDs, conversion targets, and retractions.
- Database validation uses isolated `test_quote_lifecycle_2897` on localhost:5472, plus a local HTTP sink. The app server stays stopped. The bus fan-out and queue are in-process stand-ins; schema validation, real quote writes/transactions, delivery receipts, outbound HTTP and HMAC signing are exercised. Transport/backoff tests exercise the real Redis queue interface with its in-memory Redis fixture separately.
- The configured PostgreSQL has no Citus extension. Citus distribution/runtime behavior remains unverified; migration SQL follows the repository's distribution utility and parameterized timestamp patterns. No production database was queried.
- Existing package-lock.json edits were preserved and will be excluded from the implementation commit. Nothing is pushed or published.


### Verification results

- Final combined run: 13 suites, 537 tests passed, including 19 operational PostgreSQL/HTTP cases, 433 emitter contracts, UI rendering/locales, writer inventory, portal behavior, registry/subscriber contracts, and transport/rate-limit/retry behavior.
- Existing entity webhook sink regression suite: 14 tests passed. Full workflow CRM database suite: 13 tests passed, including actual `crm.send_quote` publication and no-op suppression.
- Workflow emit-site guard passed with all quote builders registered as covered. Community application build, shared build, workflow-worker build/runtime import checks, and shared/billing typechecks passed. Final server typecheck passed with a 16 GiB Node heap. Both community build commands and the final worker build exited successfully.
- No browser smoke was run because the application server was intentionally stopped. The UI was rendered in jsdom, and the signed endpoint was a test-owned HTTP sink that was closed after the suite.

- Final totals: 564 passing tests across 15 suites. All 32 feature items and 16 planned test items are implemented; the only environment limitation is the unexercised Citus runtime.
