# SCRATCHPAD — RMM default notification contact (alga0001998)

## Source
- Ticket alga0001998 (Shift Left Security / Erwin Geirnaert), MCP id `35ce8564-02dd-4b39-afa1-aafd8be499fa`.
- Pairs with alga0001997 (ticket-numbering) — already fixed (`5846314 fix: use tenant ticket numbering for integrations`).

## Key decisions
- **Contact source:** per-mapping `default_contact_id` + fallback to client's primary/default contact. (user-confirmed)
- **Scope:** fix in the **shared RMM layer** so all providers benefit (Huntress + NinjaOne + Tactical RMM + Level + Tanium). (user-confirmed)
- **UI:** only Huntress + NinjaOne have an `OrganizationMappingManager.tsx`; only those get the picker. Tactical/Level/Tanium have generic settings panels only — they rely on the client-default fallback + event emission.
- **Event:** publish the standard `TICKET_CREATED` (not a narrow notification) — fires the tenant's full configured ticket-created flow. Accepted behavior change.

## Root cause (confirmed in code)
Two independent gaps in the integration create paths:
1. `contact_name_id` is never set on the inserted ticket.
2. No `TICKET_CREATED` event is published, so `ticketEmailSubscriber.handleTicketCreated` never runs. Shared pipeline only publishes `RMM_ALERT_TRIGGERED` / `RMM_ALERT_RESOLVED` (workflow events).

## Architecture map
- **Huntress = bespoke path:**
  - `ee/server/src/lib/integrations/huntress/incidents/incidentProcessor.ts` — `processIncident()` runs inside `withTransaction(knex, ...)` (line ~150); has the full `mapping` row already (`.first()`, so `mapping.default_contact_id` available); calls `createHuntressTicket` (line ~172).
  - `ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts` — `createHuntressTicket()` inserts into `tickets` (line ~61); `CreateHuntressTicketParams` (line ~11) has no contact field.
- **NinjaOne/Tactical/Level/Tanium = shared pipeline:**
  - `shared/rmm/alerts/ticketCreator.ts` — `createTicketForAlert()` inserts into `tickets` (line ~68); `CreateAlertTicketParams` (line ~17).
  - `shared/rmm/alerts/processRmmAlertEvent.ts` — main webhook path; `knex.transaction(...)` (line ~103); calls `createTicketForAlert` (line ~248). Publishes RMM_ALERT_* via `publishSafely` (line ~423), NOT TICKET_CREATED.
  - `shared/rmm/alerts/createTicketForAlertId.ts` — manual/workflow path; `knex.transaction(...)` (line ~87); already reads `orgMapping` (selects client_id, external_organization_name at line ~60) — add `default_contact_id` to that select.
  - Entry points: `ee/.../ninjaone/webhooks/webhookHandler.ts`, `ee/.../ninjaoneActions.ts`, `server/src/app/api/webhooks/tacticalrmm/route.ts`, `ee/server/src/app/api/webhooks/levelio/route.ts`, `ee/packages/workflows/src/runtime/actions/registerRmmAlertWorkflowActions.ts`.

## Data model
- Table `rmm_organization_mappings` created in `server/migrations/20251124000001_create_rmm_integration_tables.cjs` (CE migrations dir). Existing FK pattern: `table.foreign(['tenant','client_id']).references(['tenant','client_id']).inTable('clients').onDelete('SET NULL')` (line 56).
- Contacts table is `contacts`, PK `contact_name_id` (`202409071803_initial_schema.cjs:87`). `tickets` references it via `(tenant, contact_name_id) -> contacts` (`202409071803_initial_schema.cjs:272`). Mirror this for `default_contact_id`.
- Client default contact lives in `clients.properties.primary_contact_id` (JSON). Validated by `findValidClientPrimaryContactId(clientId, tenant)` in `shared/workflow/actions/emailWorkflowActions.ts:440` — but it opens its own `withAdminTransaction`; for the create path write a trx-based resolver instead (reuse its validation shape).

## Event plumbing
- Publisher: `packages/tickets/src/lib/adapters/TicketModelEventPublisher.ts`. `new TicketModelEventPublisher(trx)` defers publish via `registerAfterCommit` (`packages/db/src/lib/afterCommit.ts`) — **but that only flushes inside a `withTransaction`/`withAdminTransaction` frame**, not a raw `knex.transaction`.
- Therefore: Huntress (`withTransaction`) can use the trx-bound publisher; shared paths use raw `knex.transaction`, so publish AFTER the transaction resolves with the no-trx `new TicketModelEventPublisher().publishTicketCreated(...)` (immediate + error-swallowing). Use the post-commit pattern uniformly to keep it simple.
- Notification gate to satisfy: `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts → handleTicketCreated` (~line 845) sends `ticket-created-client` to `contact_email || client_email`; contactId populated only when `contact_email` + `contact_name_id` present.

## UI
- `ee/server/src/components/settings/integrations/huntress/OrganizationMappingManager.tsx` and `.../ninjaone/OrganizationMappingManager.tsx` — table with ClientPicker + Create Tickets toggle. Add a Default Contact column using `packages/ui/src/components/ContactPicker.tsx` (props: `contacts`, `value`, `onValueChange`, `clientId`, `disabled`). Load contacts via existing contacts fetch action (mirror current `getAllClients(false)` usage).
- Actions: `ee/.../huntressActions.ts` (`getHuntressOrganizationMappings` ~330, `updateHuntressOrganizationMapping` ~352) and `ee/.../ninjaoneActions.ts` (`getNinjaOneOrganizationMappings` ~527, `updateNinjaOneOrganizationMapping` ~573). Add `default_contact_id` to select + update payload.
- Type: `ee/server/src/interfaces/rmm.interfaces.ts` `RmmOrganizationMapping` (~line 72).

## Commit groups
`migration` → `contact-resolver` → `shared-pipeline-contact` → `huntress-contact` → `event-emission` → `types-actions` → `settings-ui`. (Tests share their feature's group.)

## Gotchas
- Migration is CE (`server/migrations`), single ALTER. Citus: nullable ADD COLUMN safe; colocated FK should work (table already has a tenant-composite FK). If FK rejected on Citus, drop to column + index only (resolver validates anyway).
- Don't emit TICKET_CREATED on the append-note/close path — create only.
- Resolver must guard cross-client + inactive contacts (stale `primary_contact_id`, re-mapped client) to avoid wrong recipients.

## Verify
- Build/typecheck: shared, ee/server, packages/ui, packages/tickets.
- Tests: extend `ee/server/src/__tests__/integration/rmmAlertPipeline.integration.test.ts`; add resolver unit tests; Huntress incident test.
- E2E local: set default contact on a mapping; drive a Tactical RMM alert (`~/tactical-rmm`) or Huntress incident; confirm ticket `contact_name_id` set + Email Notification Logs shows "Ticket Created Client".
- MCP spot-check: `mcp__alga-psa__call_api_endpoint` `get-_api_v1_tickets_id` → confirm `contact_name`/`contact_name_id` populated.
- Per user policy: no git staging/commit/push without explicit request.

## 2026-06-19 progress
- `migration` group: added `server/migrations/20260619120000_add_default_contact_to_rmm_org_mappings.cjs`.
  - Adds nullable `default_contact_id`, partial lookup index `(tenant, default_contact_id)`, and tenant-scoped FK to `contacts(tenant, contact_name_id)`.
  - Used raw SQL for `ON DELETE SET NULL (default_contact_id)` so deleting a contact cannot null the mapping tenant.
  - Set migration `transaction: false` and catches FK creation failure so Citus deployments can continue with column+index while runtime validation enforces correctness.
  - Down migration drops FK, index, and column with existence checks.
- Added `server/src/test/unit/migrations/rmmOrganizationMappingDefaultContactMigration.test.ts` covering T001-T005 as a migration contract.
- `contact-resolver` group: added `shared/rmm/alerts/resolveContact.ts` and exported it from `shared/rmm/alerts/index.ts`.
  - Resolver validates mapping and fallback contacts with `tenant`, `client_id`, `contact_name_id`, and `is_inactive: false`.
  - Invalid mapping contacts fall back to the client's `properties.primary_contact_id`; invalid/absent fallback returns `null`.
  - It accepts only a caller-provided `trx` and does not import/use `withAdminTransaction`, so create paths see rows in their current transaction.
  - Added `shared/rmm/alerts/__tests__/resolveContact.test.ts` covering T006-T012.
- `shared-pipeline-contact` group: threaded `mappingDefaultContactId` through `shared/rmm/alerts/ticketCreator.ts`, `processRmmAlertEvent.ts`, and `createTicketForAlertId.ts`.
  - `createTicketForAlert` now resolves `contact_name_id` inside the ticket insert transaction using `resolveRmmTicketContactId`.
  - `processRmmAlertEvent` and `createTicketForAlertId` select `default_contact_id` from `rmm_organization_mappings` and pass it into the shared creator.
  - Added integration coverage in `ee/server/src/__tests__/integration/rmmAlertPipeline.integration.test.ts` for mapping default, client-default fallback, no-contact behavior, automatic pipeline threading, manual `createTicketForAlertId`, and numbering preservation.
  - Verification: `npm -w @alga-psa/shared run typecheck` passed.
  - Verification blocked: `npx vitest run src/__tests__/integration/rmmAlertPipeline.integration.test.ts` from `ee/server` could not connect to local Postgres (`password authentication failed for user "postgres"`).
- `huntress-contact` group: updated `ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts` and `incidentProcessor.ts`.
  - `CreateHuntressTicketParams` now accepts `defaultContactId`; `createHuntressTicket` resolves it with `resolveRmmTicketContactId` and inserts `tickets.contact_name_id`.
  - `incidentProcessor` passes `mapping.default_contact_id` for mapped tickets and `null` for unmapped fallback routing.
  - Added Huntress integration coverage for direct default contact, client primary fallback, mapped incident default, and unmapped fallback/no-contact behavior.
  - Verification blocked: `npm -w sebastian-ee run typecheck` fails on unrelated generated registry/package exports (`@alga-psa/agent-tooling`, `@alga-psa/user-activities`).
  - Verification blocked: `npx vitest run src/__tests__/integration/huntressIncidentProcessor.integration.test.ts` from `ee/server` could not connect to local Postgres (`password authentication failed for user "postgres"`).
