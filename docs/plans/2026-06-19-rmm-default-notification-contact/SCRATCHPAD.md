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
- `event-emission` group: added `shared/rmm/alerts/ticketCreatedEvent.ts` and wired `TICKET_CREATED` publishing into Huntress, `processRmmAlertEvent`, and `createTicketForAlertId`.
  - Shared raw-transaction paths publish after `knex.transaction(...)` resolves using no-trx `TicketModelEventPublisher`, so publisher failures are swallowed.
  - Huntress uses the trx-bound publisher inside `withTransaction`, so the event is queued via `registerAfterCommit`.
  - Append-note / occurrence-appended / status-update paths do not call the ticket-created helper.
  - Added `packages/tickets/src/lib/adapters/TicketModelEventPublisher.test.ts` for after-commit payload and failure-swallow behavior.
  - Added `shared/rmm/alerts/__tests__/ticketCreatedEventUsage.contract.test.ts` guarding create-path event usage and non-create path exclusions.
  - Verification: `npx vitest run src/lib/adapters/TicketModelEventPublisher.test.ts` from `packages/tickets` passed.
  - Verification: `npx vitest run rmm/alerts/__tests__/ticketCreatedEventUsage.contract.test.ts` from `shared` passed.
  - Verification: `npm -w @alga-psa/shared run typecheck` passed.
  - Full DB/email integration verification remains blocked by the local Postgres auth issue noted above.
- `types-actions` group: updated `RmmOrganizationMapping` with `default_contact_id?: string | null`.
  - Huntress and NinjaOne mapping reads already select `rom.*`; update actions now accept and persist `default_contact_id`, including `null` clears.
  - Existing Huntress `requireSettingsUpdatePermission` and NinjaOne `hasPermission(...settings...)` gating remains in place.
  - Added `ee/server/src/__tests__/unit/integrations/rmmDefaultContactActions.contract.test.ts` covering T030-T035.
  - Verification: `npx vitest run src/__tests__/unit/integrations/rmmDefaultContactActions.contract.test.ts` from `ee/server` passed.
- `settings-ui` group: updated Huntress and NinjaOne `OrganizationMappingManager.tsx`.
  - Both managers load active contacts with `getAllContacts('active')`, render a `Default Contact` column with `ContactPicker`, pass `clientId` for client-scoped filtering, and disable the picker when no client is mapped.
  - Selecting a contact sends `default_contact_id`; clearing sends `null`. Changing the mapped client also clears `default_contact_id` to avoid stale cross-client selections.
  - Huntress reloads rows after save; NinjaOne updates local row state. Both bind picker value to `mapping.default_contact_id`, so saved values show after reload.
  - Added `ee/server/src/__tests__/unit/integrations/rmmDefaultContactUi.contract.test.ts` covering T036-T042.
  - Verification: `npx vitest run src/__tests__/unit/integrations/rmmDefaultContactUi.contract.test.ts` from `ee/server` passed.

## 2026-06-23 review + simplification
- Rebased branch `contact_mapping_ability` onto origin/main (was 58 behind / 8 ahead). Clean replay, no source conflicts (only package-lock.json overlapped and auto-merged). `git range-diff` shows all 8 commits content-identical. Pre-rebase tip backed up at branch `backup/contact_mapping_ability_prerebase`.
- **Simplified the migration** to the established knex pattern (per analog `20241225162023_add_notes_document_id_to_companies.cjs` + the sibling `(tenant, client_id)` FK/index already on this table). Removed: `transaction:false`, raw `ADD CONSTRAINT ... ON DELETE SET NULL (col)`, `hasColumn`/`IF NOT EXISTS`/`pg_constraint` guards, and the try/catch FK fallback. Now plain `alterTable`: nullable column + `foreign(['tenant','default_contact_id']).references(['tenant','contact_name_id']).inTable('contacts').onDelete('SET NULL')` + index; `down` drops FK→index→column.
  - Tradeoff: composite-FK `SET NULL` nulls only `default_contact_id` here because PG sets all FK columns — wait, plain SET NULL would target both (tenant, default_contact_id). This matches the sibling `client_id` FK exactly (established pattern). Contacts are soft-deleted via `is_inactive` in practice, and the runtime resolver re-validates ownership + active, so referential edge cases are covered in code. Confirmed live: confdeltype='n' (SET NULL).
  - Updated the contract test to assert the knex-builder calls (dropped obsolete T005 source-grep; T005 now = live apply/revert).
- **Verified the migration against a real Postgres** (`bigmac_postgres`, host port 5433, db `server`): ran `up()` then `down()` in isolation (no ledger writes). up → column+FK+index present, FK→contacts, ON DELETE SET NULL; down → all removed; ledger untouched. RESULT: OK.
- Re-ran all non-DB tests on the rebased base: shared 11, tickets 2, ee/server contract 4, server migration-contract 4 — all green.
- Still NOT run: the two DB-backed integration suites (`rmmAlertPipeline`, `huntressIncidentProcessor`) — need the worktree DB migrated + the `.env.localtest` stale-admin-password workaround.

## 2026-06-23 (cont.) — Citus FK rework, full-provider parity, add-new-contact, UI fixes
- **Migration → no FK (Citus).** Citus rejects `ON DELETE SET NULL` on a tenant-scoped composite FK (would null the distribution column `tenant`). Dropped the FK entirely; migration is now plain `alterTable`: nullable column + index only. Deletion handled in the backend instead.
  - Backend unlink added to `packages/clients/src/actions/contact-actions/contactActions.tsx` `deleteContact` (nulls `rmm_organization_mappings.default_contact_id` for the deleted contact, in the same delete txn). Resolver already validates on read, so dangling refs are harmless. `deleteEntityWithValidation` is config-driven (`packages/core/src/config/deletion/index.ts`), not live-FK-driven, so removing the FK doesn't affect the delete pre-check; `contacts` config blocks on tickets/interactions/etc. but NOT rmm mappings (so a mapping default never blocks contact deletion — correct, we want unlink not block).
  - Migration verified up()/down() against real Postgres (bigmac_postgres:5433) — column+index created then dropped; no ledger writes.
- **Full-provider parity (the PRD was wrong).** ALL FIVE RMM providers have org→client mapping UIs — Huntress/NinjaOne via `OrganizationMappingManager.tsx`; **Tactical** (`TacticalRmmIntegrationSettings.tsx`), **Level** (`LevelIoIntegrationSettings.tsx`), **Tanium** (`TaniumIntegrationSettings.tsx`) build theirs inline. The original exploration only matched files named `OrganizationMappingManager.tsx`, so the plan wrongly excluded the latter three. Added the picker + action default_contact_id support to all three.
  - Tactical is in `packages/integrations`, which does NOT depend on `@alga-psa/clients` — so it can't use `getAllContacts`. Added a package-local `getIntegrationContacts` in `packages/integrations/src/actions/clientLookupActions.ts` (mirrors `getIntegrationClients`).
  - Level/Tanium `clients` state is a light `ClientRow` ({client_id, client_name}); passed to `renderQuickAddContact` as `clients as unknown as IClient[]` (dialog only reads client_id/client_name). Minor; could widen the type later.
- **Add-new-contact on all 5 pickers.** Wired `ContactPicker.onAddNew` → global Quick Add Contact dialog via `useQuickAddClient().renderQuickAddContact` (`@alga-psa/ui/context`; provider mounted in `server/src/components/layout/DefaultLayout.tsx`). Per-row tracking state `quickAddContactFor:{mappingId,clientId}`; on add, contact is upserted into the list and auto-selected as that mapping's default. Same pattern as `QuickAddTicket.tsx`.
- **UI fixes found during manual testing** (all in `RmmAlertAutomationSettings.tsx` / Tactical settings):
  - Add Alert Rule dialog was unscrollable → removed `allowOverflow` (Dialog body uses `overflow-visible` when set; CustomSelect portals so it never needed it).
  - Checkboxes → custom `Checkbox` component; passed `containerClassName=""` to kill its default `mb-4` (was causing uneven gaps).
  - Tactical contact picker vertical misalignment → removed the stacked "Default Contact" label so it sits inline like the client picker.
- **Typechecks:** `@alga-psa/integrations` clean; `@alga-psa/clients` clean; `ee/server` tsc has only the 14 pre-existing unrelated errors (chat-registry/agent-tooling/user-activities), none referencing our files.
- **Rebase:** branch rebased onto origin/main (was 58 behind); range-diff clean; backup at `backup/contact_mapping_ability_prerebase`.
- **Open / test debt:** T043-T048 are NOT yet automated (backend unlink, 3-provider parity UI, add-new-contact, dialog scroll/checkbox) — verified by typecheck + manual only. Also still open: Tactical E2E run; reconcile the stale local-DB FK (the SET NULL FK from the earlier migration version is still on bigmac_postgres since the ledger recorded that run — drop it so local matches the no-FK migration).
