# Scratchpad — Client Portal Board Visibility Model Correction

- Plan slug: `client-portal-board-visibility-model-correction`
- Created: `2026-04-15`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

## Decisions

- (2026-04-15) Treat this work as an implementation correction, not a new feature or schema expansion.
- (2026-04-15) Boards are tenant-scoped for this feature; visibility groups are client-scoped.
- (2026-04-15) Board pickers should show all active tenant boards.
- (2026-04-15) Inactive boards stay in stored group membership but should be excluded from board pickers and new ticket creation choices.
- (2026-04-15) Keep visibility resolver board membership tenant-scoped without forcing active-only filtering so historical group membership data remains intact; enforce active-only for pickers and ticket creation paths.

## Discoveries / Constraints

- (2026-04-15) The original migration created `client_portal_visibility_groups(tenant, group_id, client_id, ...)` and `client_portal_visibility_group_boards(tenant, group_id, board_id)` but did not add `boards.client_id`.
- (2026-04-15) The live schema confirms `boards` has no `client_id` column.
- (2026-04-15) Current MSP and client-portal visibility-group actions query `boards.client_id`, causing intermittent 500s and false empty board states.
- (2026-04-15) The shared resolver in `packages/tickets/src/lib/clientPortalVisibility.ts` also filters on `b.client_id`, so the mismatch affects enforcement, not just UI loading.
- (2026-04-15) Candidate smoke client: Emerald City (`ea00c9e1-a294-40f8-84e7-f3e9bb9dd41c`) with active boards including General Support and Projects.
- (2026-04-15) `packages/clients` visibility-group tests currently pull a transitive dependency path that fails in this workspace (`@alga-psa/event-schemas` export resolution via `packages/workflow-streams`), so package-local execution for those tests remains environment-blocked.

## Commands / Runbooks

- (2026-04-15) Verify migration/schema:
  - `PGPASSWORD=postpass123 psql -h localhost -p 57433 -U postgres -d server -c "select to_regclass('public.client_portal_visibility_groups'), to_regclass('public.client_portal_visibility_group_boards');"`
- (2026-04-15) Inspect board schema:
  - `PGPASSWORD=postpass123 psql -h localhost -p 57433 -U postgres -d server -Atc "select column_name from information_schema.columns where table_schema='public' and table_name='boards';"`
- (2026-04-15) Verify candidate smoke client boards/tickets:
  - `PGPASSWORD=postpass123 psql -h localhost -p 57433 -U postgres -d server -F $'\t' -Atc "select b.board_id, b.board_name, count(*) from tickets t join boards b on b.board_id = t.board_id and b.tenant = t.tenant where t.client_id = 'ea00c9e1-a294-40f8-84e7-f3e9bb9dd41c' and t.is_closed = false group by b.board_id, b.board_name order by count(*) desc;"`
- (2026-04-15) Current live app / smoke context:
  - server URL `http://localhost:3784`
  - log pane `2c6e6434-e6bd-4f16-a306-4ddf10c5f3d5`
- (2026-04-15) Executed test commands:
  - `cd packages/client-portal && npx vitest run src/actions/client-portal-actions/visibilityGroupActions.test.ts`
  - `cd packages/tickets && npx vitest run src/lib/clientPortalVisibility.test.ts src/lib/clientPortalVisibility.userModelLifecycle.test.ts src/actions/ticketFormActions.clientPortalVisibility.test.ts`
  - `cd packages/client-portal && npx vitest run src/actions/client-portal-actions/client-tickets.visibility.test.ts -t "rejects inactive boards"`
  - `cd packages/clients && npx vitest run src/actions/contact-actions/visibilityGroupActions.integration.test.ts src/actions/contact-actions/visibilityGroupActions.permission.test.ts` (blocked by package export resolution issue described above)

## Links / References

- Original feature PRD: `ee/docs/plans/2026-03-15-client-portal-board-visibility-groups/PRD.md`
- Model-correction design: `docs/plans/2026-04-15-client-portal-board-visibility-model-correction-design.md`
- Migration: `server/migrations/20260315110000_create_client_portal_visibility_groups.cjs`
- MSP contact actions: `packages/clients/src/actions/contact-actions/contactActions.tsx`
- Client portal group actions: `packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.ts`
- Shared resolver: `packages/tickets/src/lib/clientPortalVisibility.ts`

## Open Questions

- Whether inactive boards should remain effective for historical ticket-detail visibility or be fully excluded from resolved board IDs as well as pickers/creation. Current default is to preserve historical membership and only exclude from pickers and creation choices.

## Implementation Log

- (2026-04-15) `F001`, `F013`: Updated MSP board picker action (`getClientPortalVisibilityBoardsByClient`) to load active boards by tenant only (`tenant + is_inactive=false`) without `boards.client_id`.
- (2026-04-15) `F003`, `F004`: Updated MSP create/update group validation to accept only board IDs that exist in-tenant and are active (`is_inactive=false`), rejecting missing/cross-tenant/inactive IDs with existing validation error.
- (2026-04-15) `F002`, `F013`: Updated client-portal admin board picker action (`getClientPortalVisibilityGroupBoards`) to load active tenant boards without `boards.client_id`.
- (2026-04-15) `F003`, `F004`: Replaced `ensureBoardsBelongToClient` with `ensureBoardsAreActiveInTenant` for client-portal admin create/update flows.
- (2026-04-15) `F007`, `F008`: Updated shared resolver (`getClientContactVisibilityContext`) to remove `b.client_id` filtering while preserving strict `group.client_id === contact.client_id` mismatch guard.
- (2026-04-15) `F011`, `F014`: Updated ticket creation board option loading (`getClientTicketFormData`) to exclude inactive boards for both unrestricted and restricted contacts.
- (2026-04-15) `F011`, `F014`: Updated client portal ticket submit flow (`createClientTicket`) to resolve boards only from active records (`is_inactive=false`) and fail closed when requested board is inactive/disallowed.
- (2026-04-15) `F016`: Updated model-facing docs (`context.md`) and added smoke runbook artifact (`SMOKE.md`) clarifying tenant-scoped boards vs client-scoped groups.
- (2026-04-15) `T001`: Added MSP board-loading integration test to assert tenant-only active-board query path (no `client_id` filter requirement).
- (2026-04-15) `T002`: Added client-portal admin board-loading test to assert active tenant board loading path.
- (2026-04-15) `T003`: Added explicit inactive-board rejection test for visibility-group creation.
- (2026-04-15) `T005`, `T011`: Updated resolver lifecycle/unit tests to remove `b.client_id` assumptions and added explicit empty-group behavior coverage.
- (2026-04-15) `T008`: Added ticket form and ticket creation tests to verify inactive boards are excluded/rejected under restricted visibility.
- (2026-04-15) `T012`: Added `SMOKE.md` runbook for Emerald City seeded-scenario validation across restricted/full/pre-invite flows.
