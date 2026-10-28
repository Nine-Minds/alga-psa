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
- `quote_activities` is written through `QuoteActivity` (FK CASCADE does not reach it under Citus; `quote.ts:345` deletes explicitly), so the per-transition idempotency key in §6.1 holds.

Decisions: §9.1–9.4 adopt the PRD's own recommendations (no generic status_changed, IDs-only optional items, no approval events in v1, opportunity hooks as follow-up). §9.5 decided in favour of `shared/lib/quotes/quoteLifecycleEvents.ts` on the strength of the ticket precedent, which also supplies the contract-test pattern for §6.2's ledger test.
