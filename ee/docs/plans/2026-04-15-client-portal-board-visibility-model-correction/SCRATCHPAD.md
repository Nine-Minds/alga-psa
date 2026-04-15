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

## Discoveries / Constraints

- (2026-04-15) The original migration created `client_portal_visibility_groups(tenant, group_id, client_id, ...)` and `client_portal_visibility_group_boards(tenant, group_id, board_id)` but did not add `boards.client_id`.
- (2026-04-15) The live schema confirms `boards` has no `client_id` column.
- (2026-04-15) Current MSP and client-portal visibility-group actions query `boards.client_id`, causing intermittent 500s and false empty board states.
- (2026-04-15) The shared resolver in `packages/tickets/src/lib/clientPortalVisibility.ts` also filters on `b.client_id`, so the mismatch affects enforcement, not just UI loading.
- (2026-04-15) Candidate smoke client: Emerald City (`ea00c9e1-a294-40f8-84e7-f3e9bb9dd41c`) with active boards including General Support and Projects.

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

## Links / References

- Original feature PRD: `ee/docs/plans/2026-03-15-client-portal-board-visibility-groups/PRD.md`
- Model-correction design: `docs/plans/2026-04-15-client-portal-board-visibility-model-correction-design.md`
- Migration: `server/migrations/20260315110000_create_client_portal_visibility_groups.cjs`
- MSP contact actions: `packages/clients/src/actions/contact-actions/contactActions.tsx`
- Client portal group actions: `packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.ts`
- Shared resolver: `packages/tickets/src/lib/clientPortalVisibility.ts`

## Open Questions

- Whether inactive boards should remain effective for historical ticket-detail visibility or be fully excluded from resolved board IDs as well as pickers/creation. Current default is to preserve historical membership and only exclude from pickers and creation choices.
