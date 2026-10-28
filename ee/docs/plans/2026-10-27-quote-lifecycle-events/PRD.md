# Quote lifecycle events: outbound webhooks and the workflow event catalog

- Status: Implemented draft; pending human review
- Date: 2026-10-27
- Author: Robert Isaacs (drafted with Claude)
- Base: `origin/main` @ `44629a24f1`
- Origin: hosted-customer feature request (2026-10-22). Reference: PSA ticket `alga-2026-0002897`.

## 1. Problem

Quotes are invisible to the event system. Tickets, projects, clients, contacts and client locations publish domain events that feed both outbound webhooks and native workflow triggers. Quotes publish nothing, even though the quote status machine (`QUOTE_ALLOWED_STATUS_TRANSITIONS` in `packages/billing/src/schemas/quoteSchemas.ts`) already defines every transition, and every transition already writes a `quote_activities` row.

As a result:

- An external system that automates the handoff from sales to delivery (onboarding project, document handling, notifications) has to poll `GET /api/v1/quotes?status=accepted`.
- A native workflow cannot trigger on quote acceptance. The only signal is a side effect: `OPPORTUNITY_STAGE_CHANGED` when the quote is linked to an opportunity, or a contract event after manual activation.

Quote acceptance is the most important commercial handoff in the product. It should be a first-class automation trigger, like ticket and invoice events already are.

## 2. Goals

1. Publish one domain event per meaningful quote lifecycle transition, after commit, from every write path that performs that transition.
2. Add those events to the workflow event catalog so workflows can trigger on them.
3. Deliver them as outbound webhooks through the existing registry-driven entity webhook layer (`server/src/lib/webhooks/eventRegistry.ts` plus `createEntityWebhookSubscriber`), with a `payload_fields` allowlist entry for a new `quote` entity.
4. Make the quote write paths structurally unable to skip emission:
   - billing-side status changes go through one transition seam;
   - write paths that cannot use the seam (the workflow-worker DAL) call the same emitter;
   - a write-path ledger test fails when someone adds a new writer without choosing.

## 3. Non-goals

- Events for draft edits, item edits, `pending_approval` submission, or approval changes requested. The design makes these cheap to add later; they are not requested.
- Full quote bodies (line items, terms, pricing) in webhook payloads. Consumers fetch the record over REST, which is the registry's existing rule.
- Webhooks for invoices, time entries or assets. Those names are inert legacy and stay that way here.
- Moving the opportunity lifecycle hooks (`onQuoteSent` / `onQuoteAccepted`) into the transition seam. See Open Questions.
- Changing who may perform any transition, or the transition table itself, except the one system-only transition in §6.3.

## 4. Users and flows

- **MSP integrator (external automation):** subscribes a webhook to `quote.accepted` and `quote.converted`. On acceptance it receives `quote_id`, `quote_number`, `client_id`, previous/new status and who accepted. It then fetches the quote over REST for line items and starts onboarding.
- **MSP admin (native workflows):** builds a workflow triggered on `QUOTE_ACCEPTED` that creates an onboarding project and notifies the account manager.
- **Webhook admin (settings UI):** sees the quote events in the event picker and a "Quote" payload-fields group for trimming the payload.

## 5. Event set

Internal (catalog) names are on the left; public webhook names are on the right. There is one internal event per public name, because the registry dedupes deliveries on `(eventId, webhookId)` (see the `LEVERAGE: friction webhook-one-internal-event-one-public-name` note in `eventRegistry.ts`).

| Internal event | Public webhook | Fires when |
|---|---|---|
| `QUOTE_SENT` | `quote.sent` | status becomes `sent` (send, resend does NOT re-fire) |
| `QUOTE_VIEWED` | `quote.viewed` | first client-portal view sets `viewed_at` (once per quote) |
| `QUOTE_APPROVED` | `quote.approved` | internal approval: `pending_approval` → `approved` |
| `QUOTE_ACCEPTED` | `quote.accepted` | status becomes `accepted` from `sent` (portal, MSP on-behalf, REST, workflow) |
| `QUOTE_REJECTED` | `quote.rejected` | status becomes `rejected` |
| `QUOTE_EXPIRED` | `quote.expired` | status becomes `expired` (expiry job or expire-on-read) |
| `QUOTE_CONVERTED` | `quote.converted` | status becomes `converted` |
| `QUOTE_CONVERSION_REVERTED` | `quote.conversion_reverted` | system revert `converted` → `accepted` when the only converted invoice (draft) is deleted |
| `QUOTE_SUPERSEDED` | `quote.superseded` | a revision supersedes this version |
| `QUOTE_CANCELLED` | `quote.cancelled` | status becomes `cancelled` |

`superseded`, `cancelled` and `conversion_reverted` were not in the original request. They are included because accepted and converted quotes can be revised, cancelled or un-converted. An automation that acted on `quote.accepted` or `quote.converted` needs to learn that the fact no longer holds.

## 6. Design

### 6.1 Domain events and catalog (workflow side)

- New payload schemas in `packages/event-schemas/src/schemas/domain/quoteEventSchemas.ts`. Register them in `eventBusSchema.ts` (`EventType` list and payload map) and `workflowEventPayloadSchemas.ts`, and add `QUOTE_*` entries to `packages/event-schemas/src/workflowEventCatalog.ts` (`payload.QuoteAccepted.v1`, …).
- Builders in `shared/workflow/streams/domainEventBuilders/quoteEventBuilders.ts`, re-exported the same way `packages/opportunities/src/lib/opportunityEventBuilders.ts` does (shared subpath, not the package root barrel).
- A catalog seed migration modelled on `server/migrations/20261016100000_seed_client_location_workflow_events.cjs`. It must be Citus-safe.
- Correlation defaults: add `QUOTE_*` → `['quoteId', 'clientId']` in `shared/workflow/runtime/correlationDefaults.ts`.

**Common payload (camelCase on the bus):**

- `quoteId`, `quoteNumber` (nullable for legacy records), `version`
- `clientId` (nullable for legacy unassigned quotes), `contactId?`, `opportunityId?`
- `previousStatus`, `newStatus`, `currencyCode`, `totalAmount` (minor units, as stored)
- actor: `{ actorType: 'USER' | 'CONTACT' | 'SYSTEM', actorUserId? , actorContactId? }`, carried in the publish `ctx` as the client-location events do, and mirrored into the payload as `performedByType` / `performedById`
- the event's timestamp (`acceptedAt`, `sentAt`, …)

**Per-event extras:**

- **accepted:** `acceptedByName`, `acceptedOnBehalf` (MSP marked it accepted for the client), `selectedOptionalItemIds` (IDs only; see Open Questions)
- **rejected:** `rejectionReason`
- **converted:** `conversionTargets` (`contract` | `invoice` | `sales_order`, one or more), `contractId?`, `invoiceId?`, `salesOrderId?`. The converted contract may still be a draft; say so in the docs.
- **conversion_reverted:** `releasedInvoiceId`
- **superseded:** `supersededByQuoteId`, `nextVersion`
- **cancelled / expired / sent / viewed / approved:** common fields only

**Idempotency key:** `quote_<event>:<quoteId>:<quoteActivityId>`. Each transition writes its `quote_activities` row in the same transaction, which gives a unique per-transition key, so accepted → converted → reverted → converted publishes twice, correctly. Exception: `quote_viewed:<quoteId>`, which fires only once.

### 6.2 Emission seam

Today's status writers on `origin/main`:

1. `Quote.update` (`packages/billing/src/models/quote.ts`, ~L290). It validates with `canTransitionQuoteStatus` and writes a `status_changed` activity. It is already used by:
   - `quoteActions.ts`: submit, approve, request changes, `markQuoteAccepted`, `sendQuote`, generic `updateQuote` (incl. cancel)
   - `QuoteService.ts` (REST): same set
   - `client-billing.ts`: client-portal accept and reject
2. `crmWorkerDal.update` (`shared/workflow/runtime/actions/businessOperations/crmWorkerDal.ts:885`). It is a copy of `Quote.update` for the workflow worker, used by the `crm.*` quote actions (submit for approval, convert). The separate `crm.send_quote` handler previously wrote status directly in `crm.ts`; it now delegates to this model. The worker DAL also has independent expire-on-read and combined contract/invoice conversion writes; both must emit via the same seam.
3. Direct writes outside the model:
   - expire-on-read (`models/quote.ts:52`)
   - supersede on revision (`models/quote.ts:~456`)
   - expiry job (`server/src/lib/jobs/handlers/expireQuotesHandler.ts:132`)
   - conversion (`packages/billing/src/services/quoteConversionService.ts:1331`)
   - conversion release on invoice delete (`releaseQuoteConversionForDeletedInvoice` in `packages/billing/src/actions/invoiceModification.ts`)
4. Not a status write: first view sets `viewed_at` (`client-billing.ts:~542`).
5. Not transitions and must NOT emit: opportunity link flows that call `onQuoteSent`/`onQuoteAccepted` (`opportunityActions.ts:~306`, `OpportunityService.ts:~637`).

**Design:**

- **Pure mapper:** `quoteLifecycleEventFor(before, after, details)` maps a status pair (plus details) to an event descriptor or `null`. It is driven by a table keyed on the target status (with the `converted → accepted` special case), so adding an event later is one table row.
- **Emitter:** `queueQuoteLifecycleEvent(trx, tenant, descriptor, ctx)`. It calls `registerAfterCommit` and then `publishWorkflowEvent`, so a rollback never emits. Lives at `shared/lib/quotes/quoteLifecycleEvents.ts` (see §9.5 — decided; mirrors `shared/lib/tickets/ticketLifecycleEvents.ts`).
- **Billing transition seam:** `Quote.update` calls the mapper and emitter whenever status changes. The direct writers in item 3 are moved onto a `Quote.transitionStatus(trx, tenant, quoteId, to, { actor, reason, details, system? })` seam where possible. Where a direct write stays (for performance or row-lock shape), it calls the emitter itself and gets a ledger entry.
- **Worker path:** `crmWorkerDal.update` calls the same mapper and emitter. Add a `// LEVERAGE: pattern quote-update-dal` marker; the worker DAL duplicating `Quote.update` is the missing layer.
- **Transaction ownership:** wrap root Knex callers in an owning `withTransaction` frame, audit callers passing raw transactions, and replace the expiry job raw transaction with an owning frame that flushes after-commit hooks. Keep transition and activity writes atomic.
- **First view race:** set `viewed_at` conditionally and emit only when the update changed a row.
- **Expiry race:** both expire-on-read implementations and the job must use a conditional update (`where status = 'sent'`) and emit only when a row actually changed. The idempotency key backs this up.
- **Ledger test:** `quoteStatusWritePaths.contract.test.ts`, modelled on `packages/clients/src/lib/clientLocationWritePaths.contract.test.ts`. Every file that writes `quotes.status` either emits (or delegates to the seam) or is listed as intentionally silent with a reason.

**Conversion drift:** single-target conversion on the base only linked destination records; only combined conversion set `converted`. The public conversion functions now own a transaction and quote lock, compose destination-record creators, and complete one transition through the shared seam. Combined conversion captures both targets in one event. Single invoice conversion now becomes `converted`, as required by T005; deleting that draft can then retract the conversion. Opportunity-win conversion already uses an after-commit-aware transaction owner.

**Payload capture:** financial recalculation precedes capture. The shared emitter validates the completed payload inside the transaction before registering its after-commit hook. Portal mutations lock the quote before validating its status or writing selections, so competing acceptance cannot alter the first event's selected options. The canonical status table is in the lightweight `shared/lib/quotes/quoteStatusTransitions.ts`; frontend schemas import this pure module without database dependencies.

### 6.3 One system-only transition

`converted → accepted` is not in `QUOTE_ALLOWED_STATUS_TRANSITIONS` (`converted: []`). Today it is performed by a direct write in `releaseQuoteConversionForDeletedInvoice`. Keep it out of the user-facing table: the seam accepts it only with `system: true` and a reason, and it emits `QUOTE_CONVERSION_REVERTED`.

### 6.4 Outbound webhooks

All of this goes through the registry; no new subscriber code paths.

**Replay suppression:** quote event IDs are UUIDv5 values derived from tenant and activity-scoped idempotency keys. The common delivery processor leases a `(tenant, webhook_id, event_id)` receipt before HTTP, without holding a transaction during the request. Failed attempts release the lease; successful receipts persist independently of Redis TTLs and queue removal. Migration `20261028020000_create_webhook_event_receipts.cjs` creates this tenant-scoped ledger and colocates it with distributed webhooks when Citus is available. Network delivery remains at least once: consumers must handle a response lost after processing.

- `eventRegistry.ts`:
  - add `'quote'` to `WebhookEntity`
  - add 10 entries with `entity: 'quote'`, `sourceEvents: ['QUOTE_…']`, `entityIdKeys: ['quote_id', 'client_id']`
- `payloadFields.ts`:
  - add `WEBHOOK_QUOTE_PAYLOAD_FIELDS`
  - `ALWAYS_INCLUDED_KEYS_BY_ENTITY.quote = ['quote_id']`
- `webhookEntityPayload.ts`:
  - widen `EntityWebhookEntity`
  - generalise `EntityPayloadSpec` with `carriedFields`: domain-event keys copied (snake-cased) into `data` when present. Quote uses it for the payload fields in 6.1. This keeps the builder pure, with no DB hydration, as the registry doc requires; client events can adopt it later.
- `entityWebhookSubscribers.ts`:
  - add `quoteWebhookSubscriber = createEntityWebhookSubscriber('quote', 'QuoteWebhookSubscriber')`
  - add it to `ENTITY_WEBHOOK_SUBSCRIBERS`
- Settings UI (`AdminWebhooksSetup.tsx`): the quote events and a Quote payload-fields group appear through the registry. Add field labels to every `server/public/locales/*/msp/profile.json` (including the `xx`/`yy` pseudo-locales).
- Regenerate OpenAPI (`sdk/docs/openapi/*`) and the MCP/chat registries with the repo generators. Update `docs/api/api-rate-limiting-and-webhooks.md` (events table and "fires when / sources" table).

**Webhook payload (`data`):**

- `quote_id` (always included)
- `client_id`, `quote_number`, `version`, `previous_status`, `new_status`
- `performed_by_type`, `performed_by_id`
- the event timestamp
- the per-event extras from 6.1, snake-cased

Line items are fetched with `GET /api/v1/quotes/{id}`.

## 7. Risks

- **A missed write path** means a silent gap. Mitigation: the seam plus the ledger test.
- **Workflow loops:** a workflow triggered on `QUOTE_SENT` that runs `crm.send_quote` would trigger itself. The existing workflow loop guards apply; verify that once in the smoke test.
- **Payload sensitivity:** quote totals go to webhook endpoints the admin configured. That is acceptable and trimmable through `payload_fields`; no line-item pricing is sent.
- **Revert semantics:** consumers must treat `quote.conversion_reverted` and `quote.superseded` as retractions. Document it.

## 8. Rollout

- Additive: new event types, a catalog seed migration and registry entries. No feature flag.
- Existing webhooks are unaffected until an admin subscribes.
- Ships in CE and EE: webhooks are CE, and the workflow catalog is used by EE workflows.

## 9. Open questions — RESOLVED 2026-10-28 (XO design desk, conn)

1. **Generic `quote.status_changed`: NO for v1.** It collides with `(eventId, webhookId)` dedupe when one internal event feeds two public names, and consumers who want the firehose can subscribe to the ten specific events. Adding it later is one registry row plus one catalog entry, not a seam change.
2. **`selectedOptionalItemIds`: IDs only, in the `accepted` payload.** Consumers should not have to re-fetch to answer "which options did they take"; full item bodies stay out so the payload does not version with pricing edits.
3. **`pending_approval` / `approval_changes_requested`: NOT in v1.** Both are approval-workflow states, not customer-facing lifecycle. The mapper table makes each one row when a customer asks.
4. **Opportunity hooks: follow-up, not this card.** `onQuoteSent` / `onQuoteAccepted` also run on link flows that are not transitions, so moving them into the seam would change behaviour on paths this card does not test.
5. **Emitter/mapper location — DECIDED: `shared/lib/quotes/quoteLifecycleEvents.ts`.** Mirrors the established ticket engine (`shared/lib/tickets/ticketLifecycleEvents.ts`), which already solves this exact problem: `registerAfterCommit` + `tenantDb` from `@alga-psa/db`, `WorkflowEventPublishContext` from `@alga-psa/event-bus/publishers`, and a write-site contract test (`ticketStatusWriteSites.contract.test.ts`) that fails when a new write site skips the publisher. `packages/billing` already depends on `@alga-psa/shared`, so `Quote.update` imports `queueQuoteLifecycleEvent` by subpath with no cycle; the workflow worker DAL imports the same module. Builders stay in `shared/workflow/streams/domainEventBuilders/quoteEventBuilders.ts` and are re-exported through `packages/workflow-streams/src/streams/index.ts` exactly as `opportunityEventBuilders` is today.


## 10. Acceptance criteria

- Each event in §5 publishes exactly once per real transition, after commit, from every write path in §6.2. A rollback publishes nothing.
- `QUOTE_*` events are selectable as workflow triggers. Their payloads validate against the catalog schemas.
- A webhook subscribed to `quote.accepted` receives a signed delivery whose `data` matches §6.4. `payload_fields.quote` trims it, `quote_id` survives, and `event_filter.entity_ids` matches on `quote_id` or `client_id`.
- REST, OpenAPI, the settings UI and docs list the quote events from the registry.
- The write-path ledger test fails if a new `quotes.status` writer is added without a decision.
