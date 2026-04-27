# Scratchpad — CRM Workflow Actions

- Plan slug: `workflow-crm-actions`
- Created: `2026-04-25`

## What This Is

Rolling notes for expanding Workflow Runtime V2 CRM actions beyond `crm.create_activity_note`.

## Decisions

- (2026-04-25) First implementation pass is scoped to `crm.find_activities`, `crm.update_activity`, `crm.schedule_activity`, and `crm.send_quote`. Rationale: these match the user's recommended high-value first pass and unlock CRM lookup/update/follow-up/quote-send workflows without committing to the entire roadmap at once.
- (2026-04-25) Keep all first-pass actions under `crm.*` so existing designer catalog grouping places them under the built-in CRM group.
- (2026-04-25) Do not call `withAuth` Next.js server action wrappers directly from `shared/workflow/runtime`. Reuse underlying models/services only when package-boundary safe, or extract shared-safe helpers first.
- (2026-04-25) Mirror latest Client workflow action patterns: picker metadata via `withWorkflowJsonSchemaMetadata`, lazy event-bus imports, deterministic event idempotency keys, and DB-backed shared-root tests.
- (2026-04-25) Treat `crm.create_client_note` as roadmap-only until we decide whether newly merged `clients.add_note` already satisfies the intended user need.

## Discoveries / Constraints

- (2026-04-25) Current CRM workflow action file is `shared/workflow/runtime/actions/businessOperations/crm.ts` and only registers `crm.create_activity_note`.
- (2026-04-25) Latest main added substantial Client workflow action coverage in `shared/workflow/runtime/actions/businessOperations/clients.ts`, including `clients.add_note` and `clients.add_interaction`; CRM plan must avoid duplicating those module-specific semantics by accident.
- (2026-04-25) Client workflow actions introduced a local `withWorkflowPicker` helper using `withWorkflowJsonSchemaMetadata` and `x-workflow-picker-kind`; CRM should use the same convention for supported fields.
- (2026-04-25) Client workflow actions publish events using a lazy dynamic import helper (`publishWorkflowDomainEvent`) so shared-root tests do not fail when `@alga-psa/event-bus` is not resolvable. CRM should copy that pattern.
- (2026-04-25) Existing interaction server actions are in `packages/clients/src/actions/interactionActions.ts`: `addInteraction`, `getInteractionsForEntity`, `getRecentInteractions`, `updateInteraction`, `getInteractionStatuses`, and `deleteInteraction`.
- (2026-04-25) Existing interaction model is in `packages/clients/src/models/interactions.ts` and supports `getForEntity`, `getRecentInteractions`, `addInteraction`, `updateInteraction`, and `getById`, but those model methods call `createTenantKnex` internally; direct use from a workflow transaction may require careful adaptation or local query implementation.
- (2026-04-25) Existing interaction type server action is `createInteractionType` in `packages/clients/src/actions/interactionTypeActions.ts` and writes to `interaction_types` with `created_by`.
- (2026-04-25) Existing quote server actions are in `packages/billing/src/actions/quoteActions.ts`: `createQuote`, `sendQuote`, `submitQuoteForApproval`, conversion wrappers, and related helpers. These are `withAuth` server actions and should not be imported directly into shared runtime handlers.
- (2026-04-25) Existing quote model in `packages/billing/src/models/quote.ts` supports `getById`, `getByNumber`, `listByTenant`, `listByClient`, `create`, and update/status transition behavior.
- (2026-04-25) Quote conversion services in `packages/billing/src/services/quoteConversionService.ts` expose `convertQuoteToDraftContract`, `convertQuoteToDraftInvoice`, and `convertQuoteToDraftContractAndInvoice` for later roadmap actions.
- (2026-04-25) CRM event schemas/builders currently include `INTERACTION_LOGGED`, `NOTE_CREATED`, `TAG_DEFINITION_CREATED`, `TAG_APPLIED`, and `TAG_REMOVED`; no obvious `INTERACTION_UPDATED` event was found in initial search.
- (2026-04-25) Tag event builders exist in `shared/workflow/streams/domainEventBuilders/tagEventBuilders.ts`; tag action implementation can follow ticket/client tag patterns later.

## Commands / Runbooks

- (2026-04-25) Initial discovery commands:
  - `rg -n "export async function (updateInteraction|getRecentInteractions|getInteractionsForEntity|createInteractionType)|function (updateInteraction|getRecentInteractions|getInteractionsForEntity|createInteractionType)|createInteractionType|updateInteraction|getRecentInteractions|getInteractionsForEntity" packages server shared ee -g'*.ts' | head -160`
  - `rg -n "createQuote|sendQuote|convertQuoteToDraft|submit.*approval|find.*Quote|Quote" packages/billing server/src ee packages -g'*.ts' | head -220`
  - `rg -n "TAG_APPLIED|TAG_REMOVED|TAG_DEFINITION_CREATED|buildNoteCreatedPayload|buildInteractionLoggedPayload|NOTE_CREATED|INTERACTION_LOGGED" shared packages server ee -g'*.ts' | head -180`
  - `rg -n "export (async function|const) (createQuote|sendQuote|submitQuote|.*approval|find|getQuote|updateQuote|convertQuote)|function (createQuote|sendQuote|submitQuote)|const (createQuote|sendQuote|submitQuote)" packages/billing/src/actions/quoteActions.ts server/src -g'*.ts' | head -160`
  - `rg -n "list\\(|QuoteListOptions|getAll|page|filters|status|client_id" packages/billing/src/models/quote.ts | head -180`

## Links / References

- `shared/workflow/runtime/actions/businessOperations/crm.ts`
- `shared/workflow/runtime/actions/businessOperations/clients.ts`
- `shared/workflow/runtime/actions/businessOperations/tickets.ts`
- `shared/workflow/runtime/actions/businessOperations/shared.ts`
- `shared/workflow/runtime/actions/registerBusinessOperationsActions.ts`
- `shared/workflow/runtime/designer/actionCatalog.ts`
- `shared/workflow/runtime/jsonSchemaMetadata.ts`
- `packages/clients/src/actions/interactionActions.ts`
- `packages/clients/src/models/interactions.ts`
- `packages/clients/src/actions/interactionTypeActions.ts`
- `packages/billing/src/actions/quoteActions.ts`
- `packages/billing/src/models/quote.ts`
- `packages/billing/src/services/quoteConversionService.ts`
- `shared/workflow/streams/domainEventBuilders/crmInteractionNoteEventBuilders.ts`
- `shared/workflow/streams/domainEventBuilders/tagEventBuilders.ts`
- `shared/workflow/runtime/schemas/crmEventSchemas.ts`

## Open Questions

- What permission resource/action should govern CRM interaction reads and mutations? Candidate mappings are `client`, `contact`, or an existing CRM/activity-specific permission if present.
- Should `crm.update_activity` emit any workflow event, or should it only audit because there is no current `INTERACTION_UPDATED` schema?
- Should `crm.schedule_activity` emit `INTERACTION_LOGGED` even though it creates a future-dated interaction/follow-up?
- What is the safest package boundary for quote send logic from shared workflow runtime? Can we extract reusable quote send logic from `packages/billing/src/actions/quoteActions.ts`, or should workflow runtime implement an equivalent helper locally?
- Should `crm.send_quote` no-op on already sent quotes when `no_op_if_already_sent` is true, or should resend be explicitly out of scope until a `crm.resend_quote` action exists?
- Should `crm.create_client_note` remain on the CRM roadmap now that `clients.add_note` exists?

## Implementation Log (2026-04-26)

- Implemented all first-pass CRM runtime actions in `shared/workflow/runtime/actions/businessOperations/crm.ts`:
  - `crm.find_activities`
  - `crm.update_activity`
  - `crm.schedule_activity`
  - `crm.send_quote`
- Preserved existing `crm.create_activity_note` behavior and registration.
- Added shared CRM runtime helper patterns to match current V2 conventions:
  - `withWorkflowPicker` + `withWorkflowJsonSchemaMetadata`
  - lazy event publication helper for workflow domain events
  - tenant-scoped detail joins and summary normalization for interactions
  - standardized validation + `throwActionError`/`rethrowAsStandardError` error mapping

## Open Question Resolutions (2026-04-26)

- Permission mapping for CRM interactions:
  - `crm.find_activities` now requires `client:read`, and additionally requires `contact:read` / `ticket:read` when those filters are supplied.
  - `crm.update_activity` and `crm.schedule_activity` require `client:update`; `crm.schedule_activity` additionally requires `ticket:read` when `ticket_id` is provided.
  - Rationale: interactions are CRM records anchored to client relationships; supplemental resource permissions are enforced when filters/links depend on those resources.
- `crm.update_activity` event emission:
  - Decision: do not emit a CRM update domain event in v1; rely on run audit + returned before/after diff.
  - Rationale: no `INTERACTION_UPDATED` schema currently exists; avoided introducing new event schema in first pass.
- Future-dated schedule event semantics:
  - Decision: `crm.schedule_activity` emits `INTERACTION_LOGGED` with scheduled `interaction_date` and deterministic idempotency key.
  - Rationale: creation of the interaction record is the durable event; consumers can branch on time fields.
- Quote helper boundary:
  - Decision: `crm.send_quote` uses shared-runtime-safe DB/model helpers and best-effort internal helpers; it does not import `withAuth` server action wrappers.
  - Rationale: satisfies shared runtime boundary and keeps quote send semantics in workflow runtime.
- Already-sent quote behavior:
  - Decision: `crm.send_quote` no-ops by default when quote is already `sent` (`no_op_if_already_sent=true`), and returns metadata with `no_op=true`.
  - Decision: if `no_op_if_already_sent=false`, action raises validation error (resend out of scope for v1 action).
- `crm.create_client_note` roadmap decision:
  - Decision: remains roadmap-only; no implementation added in this pass.
  - Rationale: overlaps with existing `clients.add_note` behavior.

## Test Coverage Added (2026-04-26)

- Added runtime/unit tests:
  - `shared/workflow/runtime/actions/__tests__/registerCrmActionsMetadata.test.ts`
  - `shared/workflow/runtime/__tests__/workflowDesignerCrmCatalogRuntime.test.ts`
  - `shared/workflow/runtime/nodes/__tests__/actionCallCrmSaveAsRuntime.test.ts`
- Added DB-backed action tests:
  - `shared/workflow/runtime/actions/__tests__/businessOperations.crm.db.test.ts`
  - Covers: find/update/schedule/send success, guard/failure paths, permission denials, `INTERACTION_LOGGED` publish path, and `crm.create_activity_note` regression.

## Commands / Runbooks (2026-04-26)

- Runtime/unit tests:
  - `cd shared && npx vitest workflow/runtime/actions/__tests__/registerCrmActionsMetadata.test.ts workflow/runtime/__tests__/workflowDesignerCrmCatalogRuntime.test.ts workflow/runtime/nodes/__tests__/actionCallCrmSaveAsRuntime.test.ts --run`
- DB-backed CRM tests:
  - `cd shared && npx vitest workflow/runtime/actions/__tests__/businessOperations.crm.db.test.ts --run`

