# Scratchpad — Board-Specific Ticket Statuses

- Plan slug: `board-specific-ticket-statuses`
- Created: `2026-03-14`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-14) Scope is ticket statuses only. Project, interaction, and project-task statuses stay unchanged in this phase.
- (2026-03-14) Ticket statuses will use separate board-owned records, not board-level overrides on top of tenant-global statuses.
- (2026-03-14) Keep the existing `statuses` table and add board ownership for ticket statuses instead of introducing a second ticket-status table.
- (2026-03-14) Migration must clone current tenant-wide ticket statuses onto every board and generate new board-owned `status_id` values.
- (2026-03-14) Saved ticket-status references should be automatically remapped where board context exists.
- (2026-03-14) Changing a ticket board must require explicit user status reselection. No runtime auto-remap.
- (2026-03-14) New board creation must let admins either copy statuses from an existing board or create statuses inline.
- (2026-03-14) Ticket board changes are now blocked in both backend update paths and the `TicketInfo` UI until the user explicitly selects a destination-board status, which prevents the old board's status from being silently retained.
- (2026-03-14) New board creation now has an explicit copy-source board picker; save passes `copy_ticket_statuses_from_board_id` into `createBoard`, and the action clones board-owned ticket statuses with fresh ids onto the new board.
- (2026-03-14) `F001`/`F002`: add `statuses.board_id` as nullable first, then enforce ticket ownership after clone/remap. Rationale: current tenant-global ticket rows must survive until the data migration rewrites them.
- (2026-03-14) `F003`/`F004`/`F005`: keep the legacy tenant-global ticket status rows in place for now and clone from them during migration, because later remap steps still need the old ids to rewrite inbound, billing, and workflow references before the global rows can be retired.
- (2026-03-14) `F006`/`F007`/`F008`: remap saved status references by joining legacy global ticket statuses to their board-owned clones via `tenant + board_id + status name`. Rationale: the old global status ids remain available during migration, so we can rewrite board-context tables without persisting a separate remap table.
- (2026-03-14) `T003`/`T004`/`T005`/`T006`: cover the clone/remap migration with a DB-backed integration fixture that seeds one tenant, two boards, two legacy ticket statuses, and board-specific tickets before invoking the migration directly.
- (2026-03-14) `F006`/`F007`/`F008`: remap inbound defaults, tenant billing renewal defaults, and contract renewal overrides by joining cloned ticket statuses back to the legacy status name within the saved board context.
- (2026-03-14) `T007`/`T008`/`T009`: cover board-context remaps with a DB-backed integration fixture that runs the clone migration first, then asserts each persisted configuration surface moves from the legacy global status id to the correct board-owned replacement.

## Discoveries / Constraints

- (2026-03-14) Current ticket status actions are tenant-global:
  - `packages/reference-data/src/actions/status-actions/statusActions.ts`
  - `packages/tickets/src/models/status.ts`
  - `server/src/app/api/v1/tickets/statuses/route.ts`
- (2026-03-14) Board management and ticket status management are currently split across:
  - `server/src/components/settings/general/BoardsSettings.tsx`
  - `server/src/components/settings/general/StatusSettings.tsx`
- (2026-03-14) Ticket default status helpers currently resolve tenant-wide ticket defaults with no board input:
  - `shared/models/ticketModel.ts`
  - `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`
- (2026-03-14) Workflow ticket operations and pickers persist raw ticket `status_id` values and currently validate only against tenant + status id:
  - `shared/workflow/runtime/actions/businessOperations/tickets.ts`
  - `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts`
  - `server/src/components/workflow-designer/WorkflowActionInputFixedPicker.tsx`
- (2026-03-14) Billing renewal defaults store both board and status ids already, which makes them a good candidate for automatic remap:
  - `packages/billing/src/actions/billingSettingsActions.ts`
  - `packages/billing/src/actions/renewalsQueueActions.ts`
  - `server/src/lib/jobs/handlers/processRenewalQueueHandler.ts`
- (2026-03-14) SLA, notifications, surveys, and client portal ticket flows all resolve ticket statuses directly by `status_id`, so they are migration-sensitive:
  - `packages/sla/src/services/slaPauseService.ts`
  - `server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts`
  - `server/src/lib/eventBus/subscribers/surveySubscriber.ts`
  - `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`
- (2026-03-14) `packages/tickets/src/components/ticket/TicketInfo.tsx` already carries pending board/category state locally, so `F014` could be implemented by clearing `pendingChanges.status_id` on board change and disabling save until the new board gets a status.
- (2026-03-14) `packages/tickets/src/actions/board-actions/boardActions.ts` can own status seeding for board create because it already centralizes transactional board creation and ITIL setup.
- (2026-03-14) Current schema still enforced tenant-global ticket status uniqueness before this batch:
  - `server/migrations/202409101116_add_status_constraints.cjs`
  - `packages/types/src/interfaces/status.interface.ts`
- (2026-03-14) Ticket board-change UX still remains incomplete after the shared update-path validation fix:
  - `shared/models/ticketModel.ts`
  - `packages/tickets/src/actions/ticketActions.ts`
  - `packages/tickets/src/actions/optimizedTicketActions.ts`
  - `server/src/lib/api/services/TicketService.ts`
- (2026-03-14) Board settings and board actions do not yet seed or manage board-local ticket statuses:
  - `packages/tickets/src/actions/board-actions/boardActions.ts`
  - `server/src/components/settings/general/BoardsSettings.tsx`
- (2026-03-14) Saved config with explicit board context now has a direct migration path:
  - `inbound_ticket_defaults.board_id + status_id`
  - `default_billing_settings.renewal_ticket_board_id + renewal_ticket_status_id`
  - `client_contracts.renewal_ticket_board_id + renewal_ticket_status_id`
- (2026-03-14) Postgres migration gotcha: in `UPDATE ... FROM`, the target table alias cannot be referenced inside the joined table `ON` clause the way a regular join can. The board-column predicate for the board-context remap migration needs to live in the outer `WHERE` clause instead.
- (2026-03-14) `F009`/`F010` are the first non-tabular migration slice:
  - workflow ticket board/status references live inside `workflow_definitions.draft_definition` and `workflow_definition_versions.definition_json`
  - ticket board/status values can appear as fixed literals or dynamic `inputMapping` expressions in action configs, so safe remap/surfacing needs JSON traversal and explicit unresolved detection rather than a single SQL join
- (2026-03-14) Completed `F009` with a workflow JSON remap migration:
  - `server/migrations/20260314130000_remap_workflow_ticket_status_references.cjs` traverses workflow v2 `steps` recursively and rewrites fixed literal `status_id` values only when a fixed literal `board_id` is present in the same saved payload.
  - The remap runs against both `workflow_definitions.draft_definition` and `workflow_definition_versions.definition_json`.
  - Because workflow tables do not carry `tenant`, the migration derives the legacy-to-board-owned mapping from `statuses` rows using `tenant + name` and applies it via saved `board_id + status_id` pairs.
- (2026-03-14) Completed `T010` with DB-backed coverage in `server/src/test/integration/boardSpecificTicketStatusesMigration.integration.test.ts`:
  - verifies `tickets.create`, `create_ticket_from_email`, and nested `ticketDefaults.status_id` inside `create_ticket_with_initial_comment` all remap in both workflow drafts and published versions
  - reran with `cd server && npx vitest run --coverage.enabled false src/test/integration/boardSpecificTicketStatusesMigration.integration.test.ts`; the suite now passes with 9 migration tests after the later `T011` guard was added
- (2026-03-14) Completed `F010` with an explicit unresolved-reference guard:
  - `server/migrations/20260314133000_surface_unresolved_ticket_status_references.cjs` scans workflow drafts and published versions for fixed legacy ticket `status_id` values that still lack literal board context.
  - The guard throws a migration error containing the workflow id, table, step path, action id, and input path so unresolved references are surfaced before release instead of guessed.
- (2026-03-14) Completed `T011` in `server/src/test/integration/boardSpecificTicketStatusesMigration.integration.test.ts`:
  - seeds a workflow `tickets.update_fields` step with fixed legacy `patch.status_id` and no board context
  - verifies the guard migration rejects with a concrete unresolved-reference message and leaves the stored status id unchanged
  - reran with `cd server && npx vitest run --coverage.enabled false src/test/integration/boardSpecificTicketStatusesMigration.integration.test.ts` and confirmed all 9 migration tests pass
- (2026-03-14) Completed `F011` by making ticket default resolution board-aware in shared ticket creation paths:
  - `shared/models/ticketModel.ts` now resolves a default ticket status only for the selected `board_id` and no longer falls back to tenant-global ticket statuses.
  - `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts` now asks `TicketModel.getDefaultStatusId(...)` for the default status tied to the client portal's default board instead of querying tenant-global ticket defaults directly.
- (2026-03-14) Completed `F012` by enforcing board/status compatibility on ticket creation:
  - `shared/models/ticketModel.ts` now validates that a provided ticket `status_id` belongs to the selected `board_id` before insert.
  - `TicketModel.createTicket(...)` now auto-fills the selected board's default status when callers omit `status_id`, and rejects create attempts when no board-local default exists.
- (2026-03-14) Completed `T012` and `T013` with shared unit coverage in `shared/models/__tests__/ticketModel.boardStatusValidation.test.ts`:
  - `T012` proves `getDefaultStatusId` returns the selected board's default instead of a legacy tenant-global default.
  - `T013` proves create-time business rule validation rejects a status from a different board.
  - verified with `cd shared && npx vitest run models/__tests__/ticketModel.boardStatusValidation.test.ts --config vitest.config.ts`.
- (2026-03-14) Completed `T014` with DB-backed create-path coverage in `server/src/test/integration/ticketCreateBoardStatusValidation.integration.test.ts`:
  - seeds two boards with distinct board-owned ticket statuses and proves `TicketModel.createTicket(...)` inserts only for the matching board/status pair
  - verifies the cross-board create attempt throws and leaves only the valid ticket row persisted
  - verified with `cd server && npx vitest run --coverage.enabled false src/test/integration/ticketCreateBoardStatusValidation.integration.test.ts`.
- (2026-03-14) Completed `F013` by enforcing board/status compatibility on ticket update paths:
  - `shared/models/ticketModel.ts` now validates update-time `status_id` changes against the effective board for the ticket.
  - `packages/tickets/src/actions/ticketActions.ts`, `packages/tickets/src/actions/optimizedTicketActions.ts`, and `server/src/lib/api/services/TicketService.ts` now all reject cross-board ticket status updates instead of validating ticket statuses at tenant scope only.
- (2026-03-14) Completed `T015` in `shared/models/__tests__/ticketModel.boardStatusValidation.test.ts`:
  - proves `TicketModel.updateTicket(...)` rejects a status-only update when the new status belongs to a different board
  - verified with `cd shared && npx vitest run models/__tests__/ticketModel.boardStatusValidation.test.ts --config vitest.config.ts`.
- (2026-03-14) Completed `T016` with DB-backed update coverage in `server/src/test/integration/ticketCreateBoardStatusValidation.integration.test.ts`:
  - proves `TicketModel.updateTicket(...)` rejects a cross-board status id and leaves the persisted ticket's prior status untouched
  - verified with `cd server && npx vitest run --coverage.enabled false src/test/integration/ticketCreateBoardStatusValidation.integration.test.ts`.

## Commands / Runbooks

- (2026-03-14) Audit ticket status references:
  - `rg -n "status_id|statusIds|ticket-status|renewal_ticket_status_id|inbound.*status_id" server shared ee packages -g '!**/node_modules/**'`
- (2026-03-14) Inspect current board + ticket status settings surfaces:
  - `sed -n '1,260p' server/src/components/settings/general/BoardsSettings.tsx`
  - `sed -n '1,260p' server/src/components/settings/general/StatusSettings.tsx`
- (2026-03-14) Inspect current status actions and APIs:
  - `sed -n '1,260p' packages/reference-data/src/actions/status-actions/statusActions.ts`
  - `sed -n '1,220p' server/src/app/api/v1/tickets/statuses/route.ts`
  - `sed -n '1,240p' server/src/app/api/v1/statuses/route.ts`
- (2026-03-14) Inspect ticket default resolution:
  - `sed -n '1165,1260p' shared/models/ticketModel.ts`
- (2026-03-14) Validate plan artifacts:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-14-board-specific-ticket-statuses`
- (2026-03-14) Validate board-change status reselection:
  - `cd packages/tickets && npx vitest run src/components/ticket/__tests__/TicketInfo.boardChangeStatusReselection.test.tsx --config vitest.config.ts`
  - `cd shared && npx vitest run models/__tests__/ticketModel.boardStatusValidation.test.ts --config vitest.config.ts`
  - `cd server && npx vitest run --coverage.enabled false src/test/integration/ticketCreateBoardStatusValidation.integration.test.ts --config vitest.config.ts`
- (2026-03-14) Validate board status copy-on-create:
  - `cd server && npx vitest run --coverage.enabled false src/components/settings/general/BoardsSettings.copyStatuses.test.tsx --config vitest.config.ts`
  - `cd server && npx vitest run --coverage.enabled false src/test/integration/boardCopyTicketStatuses.integration.test.ts --config vitest.config.ts`
- (2026-03-14) Run the board-status migration schema tests directly from the server package:
  - `cd server && npx vitest run src/test/unit/migrations/boardSpecificTicketStatusesMigration.test.ts`
- (2026-03-14) Repo-level `npm run test:local -- ...` is currently not usable in this shell because the installed `dotenv` CLI rejects `-e ../.env.localtest` as non-boolean.
- (2026-03-14) Attempt the DB-backed clone/remap migration suite:
  - `cd server && npx vitest run --coverage.enabled false src/test/integration/boardSpecificTicketStatusesMigration.integration.test.ts`
- (2026-03-14) Attempt the board-context status-reference remap suite:
  - `cd server && npx vitest run src/test/integration/boardContextTicketStatusReferenceRemap.integration.test.ts --coverage=false`
  - Run it after the clone/remap suite or against a schema that already includes `20260314113000_clone_global_ticket_statuses_to_boards.cjs`.
- (2026-03-14) Run the shared board-status helper tests:
  - `cd shared && npx vitest run models/__tests__/ticketModel.boardStatusValidation.test.ts --config vitest.config.ts`
- (2026-03-14) Run the DB-backed ticket create board/status validation test:
  - `cd server && npx vitest run --coverage.enabled false src/test/integration/ticketCreateBoardStatusValidation.integration.test.ts`

## Links / References

- Design summary: `ee/docs/plans/2026-03-14-board-specific-ticket-statuses-design.md`
- Plan folder: `ee/docs/plans/2026-03-14-board-specific-ticket-statuses`
- Board settings UI: `server/src/components/settings/general/BoardsSettings.tsx`
- Central ticket status settings UI: `server/src/components/settings/general/StatusSettings.tsx`
- Ticket status actions: `packages/reference-data/src/actions/status-actions/statusActions.ts`
- Ticket status model: `packages/tickets/src/models/status.ts`
- Board actions: `packages/tickets/src/actions/board-actions/boardActions.ts`
- Board create copy-source test: `server/src/components/settings/general/BoardsSettings.copyStatuses.test.tsx`
- Board status copy integration: `server/src/test/integration/boardCopyTicketStatuses.integration.test.ts`
- Ticket model default status helper: `shared/models/ticketModel.ts`
- Ticket create board/status validation integration: `server/src/test/integration/ticketCreateBoardStatusValidation.integration.test.ts`
- Ticket API service: `server/src/lib/api/services/TicketService.ts`
- Ticket edit UI: `packages/tickets/src/components/ticket/TicketInfo.tsx`
- Ticket edit reselection test: `packages/tickets/src/components/ticket/__tests__/TicketInfo.boardChangeStatusReselection.test.tsx`
- Ticket statuses API route: `server/src/app/api/v1/tickets/statuses/route.ts`
- Workflow ticket actions: `shared/workflow/runtime/actions/businessOperations/tickets.ts`
- Billing renewal defaults: `packages/billing/src/actions/billingSettingsActions.ts`
- Client portal ticket actions: `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`
- New status schema migration: `server/migrations/20260314100000_add_board_ownership_to_ticket_statuses.cjs`
- Migration schema coverage: `server/src/test/unit/migrations/boardSpecificTicketStatusesMigration.test.ts`
- Clone/remap migration: `server/migrations/20260314113000_clone_global_ticket_statuses_to_boards.cjs`
- Clone/remap DB integration coverage: `server/src/test/integration/boardSpecificTicketStatusesMigration.integration.test.ts`
- Board-context status-reference remap migration: `server/migrations/20260314120000_remap_board_context_ticket_status_references.cjs`
- Board-context status-reference integration coverage: `server/src/test/integration/boardContextTicketStatusReferenceRemap.integration.test.ts`
- Workflow status-reference remap migration: `server/migrations/20260314130000_remap_workflow_ticket_status_references.cjs`
- Workflow unresolved-reference guard migration: `server/migrations/20260314133000_surface_unresolved_ticket_status_references.cjs`

## Open Questions

- (2026-03-14) Which persisted ticket-status references do not currently carry enough board context for a guaranteed automatic remap?
