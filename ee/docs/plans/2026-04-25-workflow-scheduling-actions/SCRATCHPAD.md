# SCRATCHPAD: Workflow Scheduling Actions

## 2026-04-25 — Plan Created

### Worktree / Branch

- Worktree: `/Users/roberisaacs/alga-psa.worktrees/feature/workflows-scheduling-actions`
- Current git status before plan edits: `package-lock.json` already modified. This plan did not intentionally touch it.
- Plan folder: `ee/docs/plans/2026-04-25-workflow-scheduling-actions/`

### User Request Summary

Add richer workflow scheduling actions so workflow authors can express dispatcher language directly:

- `scheduling.reschedule`
- `scheduling.reassign`
- `scheduling.cancel`
- `scheduling.complete`

Also keep/add the read side:

- `scheduling.find_entry`
- `scheduling.search_entries`

Target lifecycle event alignment:

- `APPOINTMENT_CREATED`
- `APPOINTMENT_RESCHEDULED`
- `APPOINTMENT_ASSIGNED`
- `APPOINTMENT_CANCELED`
- `APPOINTMENT_COMPLETED`
- `APPOINTMENT_NO_SHOW`

This pass plans the four requested lifecycle write actions plus read actions. `NO_SHOW` is not included unless scope changes.

### Source Investigation Notes

#### Workflow action architecture

- Action file to change: `shared/workflow/runtime/actions/businessOperations/scheduling.ts`
- Registration is already wired through `registerSchedulingActions()`.
- Business operation registration flows through `shared/workflow/runtime/actions/registerBusinessOperationsActions.ts` and `shared/workflow/runtime/init.ts`.
- Designer grouping is prefix-based. `scheduling.*` maps to the built-in Scheduling group in `shared/workflow/runtime/designer/actionCatalog.ts`.

#### Current scheduling workflow action state

- `shared/workflow/runtime/actions/businessOperations/scheduling.ts` currently only registers `scheduling.assign_user`.
- `scheduling.assign_user`:
  - Validates user exists.
  - Requires the assigned user to have a role named `Technician`.
  - Validates linked ticket/project task exists.
  - Handles conflict modes `fail`, `shift`, `override`.
  - Inserts `schedule_entries` and `schedule_entry_assignees` directly.
  - Inserts unresolved `schedule_conflicts` rows on override.
  - Writes workflow run audit via `writeRunAudit()`.
  - Does **not** currently publish `APPOINTMENT_CREATED` or `APPOINTMENT_ASSIGNED` workflow events.

#### Shared workflow helper state

- `shared/workflow/runtime/actions/businessOperations/shared.ts` contains useful helpers:
  - `withTenantTransaction()`
  - `requirePermission()`
  - `writeRunAudit()`
  - `throwActionError()`
  - `uuidSchema`
  - `isoDateTimeSchema`
- `withTenantTransaction()` resolves the workflow actor user from workflow run/definition metadata and sets tenant RLS with `set_config('app.current_tenant', ...)`.

#### Existing scheduling model/actions

- `packages/scheduling/src/models/scheduleEntry.ts` is the tenant-explicit model for schedule entries.
  - Supports `create()`, `update()`, `delete()`, `get()`, `getAll()`, recurrence handling, and assignee helper methods.
  - `update()` supports recurrence scopes using `IEditScope`: `single`, `future`, `all`.
  - Virtual recurring ids use an underscore pattern: `<masterEntryId>_<timestamp>`.
  - File currently has `// @ts-nocheck`; implementation should be covered by DB-backed tests if imported/used.
- `packages/scheduling/src/actions/scheduleActions.ts` is the UI/server action layer.
  - Uses `withAuth`, `hasPermission`, `createTenantKnex`, and `withTransaction`.
  - Publishes legacy event-bus events: `SCHEDULE_ENTRY_CREATED`, `SCHEDULE_ENTRY_UPDATED`, `SCHEDULE_ENTRY_DELETED`.
  - Publishes workflow domain events using `publishWorkflowEvent`:
    - `APPOINTMENT_CREATED`
    - `APPOINTMENT_RESCHEDULED`
    - `APPOINTMENT_ASSIGNED`
    - `APPOINTMENT_CANCELED`
    - `APPOINTMENT_COMPLETED`
    - `APPOINTMENT_NO_SHOW`
    - schedule block and technician dispatch events.
  - Because of `withAuth`, these server actions are not a clean direct dependency for workflow runtime action handlers.

#### Existing event builders/schemas

- Appointment event builders: `shared/workflow/streams/domainEventBuilders/appointmentEventBuilders.ts`
  - `shouldEmitAppointmentEvents(entry)` returns true for `work_item_type === 'appointment_request' || 'ticket'`.
  - `getTicketIdFromScheduleEntry(entry)` maps ticket-linked entries.
  - Status helpers accept tolerant canceled/completed/no-show spellings.
  - Builders include `buildAppointmentRescheduledPayload`, `buildAppointmentAssignedPayload`, `buildAppointmentCanceledPayload`, `buildAppointmentCompletedPayload`.
- Workflow runtime event payload schemas: `shared/workflow/runtime/schemas/schedulingEventSchemas.ts`
- Event package schemas: `packages/event-schemas/src/schemas/domain/schedulingEventSchemas.ts`
- Existing `APPOINTMENT_ASSIGNED` schema is single-assignee shaped: `previousAssigneeId?`, `previousAssigneeType?`, `newAssigneeId`, `newAssigneeType`.

#### Schedule persistence tables

- Initial `schedule_entries` table in `server/migrations/202409071803_initial_schema.cjs`.
- `schedule_entry_assignees` created in `server/migrations/20241227233407_create_schedule_entry_assignees.cjs`.
- `user_id` removed from `schedule_entries` in `server/migrations/20241228003050_remove_user_id_from_schedule_entries.cjs`.
- Recurrence columns added in `server/migrations/20241227234500_add_original_entry_id_to_schedule_entries.cjs`:
  - `original_entry_id`
  - `is_recurring`
- Ad hoc schedule entries made possible by `server/migrations/20250103172553_add_adhoc_schedule_entries.cjs`.
- `is_private` added in `server/migrations/20250515104157_add_private_flag_to_schedule_entries.cjs`.
- `interaction` work item type added in `server/migrations/20250602153500_add_interaction_work_item_type.cjs`.
- `appointment_request` work item type added in `server/migrations/20251111190000_add_appointment_request_work_item_type.cjs`.

#### Permissions

- Current `scheduling.assign_user` requires `user_schedule:create`.
- Existing role/permission migrations define `user_schedule:create`, `read`, `update`, `delete`.
- UI/server scheduling actions generally use:
  - `user_schedule:read` for reads.
  - `user_schedule:update` for broad edits/assignments.
  - Delete action has custom validation but should map to product decision for workflow cancel semantics.

### Approach Options Considered

1. **Extend `scheduling.ts` with local helpers** — recommended for this pass.
   - Smallest change in workflow action layer.
   - Avoids `withAuth` server action coupling.
   - Some duplication with Scheduling server action event logic.
2. **Extract scheduling domain service** — best long-term architecture.
   - More reusable.
   - Larger refactor and not needed to create first safe workflow action surface.
3. **Call existing Scheduling server actions** — not recommended.
   - They are session/auth-bound and not designed for workflow runtime's explicit tenant/run actor context.

### Decisions Made in Draft PRD

- Plan includes both read side and write side actions.
- Do not include `scheduling.no_show` unless explicitly added to scope.
- Prefer no DB migration for v1; store reason/note/outcome in notes and/or audit details.
- Use existing designer grouping by `scheduling.*` prefix.
- Treat recurring scopes as `single | future | all` following `IEditScope`.

### Decisions Confirmed Before Implementation

Confirmed by user on 2026-04-25:

1. `scheduling.reassign` v1 supports multiple technicians and emits one `APPOINTMENT_ASSIGNED` per newly assigned user.
2. `scheduling.cancel` requires `user_schedule:update` because it marks status canceled rather than deleting rows.
3. Workflow action event publishing follows the existing Scheduling action pattern: fail-soft/log rather than rollback/fail the workflow action.
4. Private entries are redacted unless the actor is assigned or has `user_schedule:update`.
5. Leave `scheduling.assign_user` event emission unchanged in this pass unless implementation discovers it blocks consistency.

### Commands Run

```bash
pwd && git status --short && find ee/docs/plans -maxdepth 2 -type f | sed 's#^#/#' | head -80
rg -n "registerSchedulingActions|APPOINTMENT_|schedule|schedule_entries|schedule_entry|reschedule|NO_SHOW|appointment" shared ee server packages -g '!node_modules' -g '!**/.next/**'
find shared/workflow/runtime/actions/businessOperations -maxdepth 1 -type f -print
rg -n "publishWorkflowEvent|eventBus|createWorkflowEvent|SCHEDULE_ENTRY_|APPOINTMENT_CREATED|APPOINTMENT_RESCHEDULED|APPOINTMENT_ASSIGNED|APPOINTMENT_CANCELED|APPOINTMENT_COMPLETED|schedule_entries|schedule_entry_assignees|schedule_conflicts|recurr" shared server packages ee/server -g '!node_modules' -g '!**/.next/**'
rg -n "class ScheduleEntry|ScheduleEntry|scheduleEntry|schedule_entries|schedule_entry_assignees" server packages/scheduling shared -g '!node_modules' -g '!**/.next/**'
rg -n "scheduling\.assign_user|registerSchedulingActions|businessOperations" shared server ee packages -g '*test*' -g '!node_modules'
python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Workflow Scheduling Actions" --slug workflow-scheduling-actions
```

### Validation Commands for Plan

```bash
python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-04-25-workflow-scheduling-actions
```

### Likely Implementation Test Commands

Exact commands may change after implementation, but likely starting points are:

```bash
npm --prefix shared test -- workflow
npm --prefix server run test:integration -- scheduling
cd server && npx vitest run src/test/integration/scheduling/scheduleEntryRecurrence.integration.test.ts --coverage=false
```

Check package scripts before running broad test commands.

## 2026-04-25 — Post-main-merge Review

### Merge State Observed

- Current branch `feature/workflows-scheduling-actions` is at `1f44bf1b05`, same as `origin/main` after PR #2400 (`feature/workflow-clients-actions`) was merged.
- Our scheduling plan remains untracked in `ee/docs/plans/2026-04-25-workflow-scheduling-actions/`.
- No scheduling implementation files have been changed yet in this branch.

### Relevant New Main Additions Reviewed

- `shared/workflow/runtime/actions/businessOperations/clients.ts` now contains a much richer client action implementation.
- New client action tests provide useful patterns for scheduling:
  - `shared/workflow/runtime/actions/__tests__/registerClientActionsMetadata.test.ts`
  - `shared/workflow/runtime/__tests__/workflowDesignerClientCatalogRuntime.test.ts`
  - `shared/workflow/runtime/actions/__tests__/businessOperations.clients.db.test.ts`
  - `shared/workflow/runtime/nodes/__tests__/actionCallClientSaveAsRuntime.test.ts`
- Client actions added a local `publishWorkflowDomainEvent()` helper that uses best-effort lazy import of `@alga-psa/event-bus/publishers`. This keeps shared-root tests stable while preserving runtime event publication behavior.
- Main also added tenant-owned workflow definitions via `server/migrations/20260425200000_add_tenant_id_to_workflow_definitions.cjs` and updated `shared/workflow/persistence/workflowDefinitionModelV2.ts` to require tenant id for definition access.

### Adjustments Made to This Scheduling Plan

- Updated PRD to follow the Client action implementation/testing patterns:
  - picker metadata conversion tests via `zodToWorkflowJsonSchema`;
  - runtime catalog grouping tests from real registrations;
  - direct DB-backed action handler tests under the shared workflow runtime test tree;
  - runtime `action.call` + `saveAs` smoke coverage;
  - fail-soft lazy event publisher helper for `APPOINTMENT_*` events.
- Updated PRD action contracts so `entry_id` inputs are non-empty strings rather than strict UUIDs. Rationale: existing recurrence virtual ids use `<masterEntryId>_<timestamp>`, so strict UUID schemas would block the requested recurrence-scope behavior.
- Added `F031`/`T017` for shared actor-resolution hardening against tenant-owned `workflow_definitions`. Current `resolveRunActorUserId()` joins `workflow_definitions` by workflow id only; implementation should join by run tenant as well before relying on schedule permission checks.
- Added `F032`/`T016` to explicitly align scheduling action tests with the new Client action/runtime patterns.
- Updated `T002` to reject blank entry refs but allow virtual recurring entry refs.

### New Implementation Watch-outs

- Do not copy `clients.ts` wholesale; use its patterns, not its domain assumptions.
- Keep `scheduling.assign_user` unchanged per confirmed scope, but account for the fact that Client actions now have event-publication parity and scheduling lifecycle actions should too.
- If adding a shared publisher helper to `shared.ts`, check whether moving the Client local helper is worth the extra scope. Current plan assumes a scheduling-local helper to avoid touching the merged Client action surface.
- Add tests defensively: action registry is a singleton, so follow the Client tests' guard pattern (`if (!registry.get(...)) register...`) to avoid duplicate registration failures.

## 2026-04-26 — Implementation Completed

### Skills Used / Coordination

- Reviewed `brainstorming` skill requirements and intentionally skipped full brainstorm gate because this turn already provided a completed PRD + feature/test implementation checklist and explicitly requested autonomous execution of that plan.
- Followed existing Client workflow action patterns for registration metadata, fail-soft event publishing, runtime catalog checks, and node smoke tests.

### Implemented Code

- Updated workflow actor resolution join to tenant-scope workflow definitions:
  - `shared/workflow/runtime/actions/businessOperations/shared.ts`
  - `resolveRunActorUserId()` now joins `workflow_definitions` on both `workflow_id` and `wr.tenant_id = wd.tenant_id`.
- Replaced scheduling action runtime implementation with full lifecycle + read surface:
  - `shared/workflow/runtime/actions/businessOperations/scheduling.ts`
  - Added `scheduling.find_entry`, `scheduling.search_entries`, `scheduling.reschedule`, `scheduling.reassign`, `scheduling.cancel`, `scheduling.complete`.
  - Kept existing `scheduling.assign_user` behavior as-is.
  - Added private-entry redaction policy (redact unless actor assigned or has `user_schedule:update`; `include_private_details` controls full visibility return for `find_entry`).
  - Added read/write permission checks (`user_schedule:read` for read actions, `user_schedule:update` for lifecycle write actions).
  - Added recurrence-scope handling through `ScheduleEntry.update(...)` with virtual-occurrence anchor patches for `single` on virtual ids.
  - Added conflict detection helper for reschedule that excludes target series and ignores canceled/completed/no-show statuses.
  - Implemented `conflict_mode` behavior:
    - `fail` throws `CONFLICT`.
    - `shift` shifts to earliest non-conflicting slot preserving duration.
    - `override` persists and writes unresolved `schedule_conflicts` rows.
  - Added technician-role eligibility validation for reassignment.
  - Added no-op reassignment behavior with `changed=false` + event suppression.
  - Added write audits for all new mutating actions.
  - Added best-effort lazy `publishWorkflowEvent` helper and emitted:
    - `APPOINTMENT_RESCHEDULED`
    - `APPOINTMENT_ASSIGNED` (one per newly assigned user)
    - `APPOINTMENT_CANCELED`
    - `APPOINTMENT_COMPLETED`

### Added Tests

- Metadata/schema tests:
  - `shared/workflow/runtime/actions/__tests__/registerSchedulingActionsMetadata.test.ts`
- Runtime designer grouping test:
  - `shared/workflow/runtime/__tests__/workflowDesignerSchedulingCatalogRuntime.test.ts`
- Runtime node smoke (`action.call` + `saveAs`):
  - `shared/workflow/runtime/nodes/__tests__/actionCallSchedulingSaveAsRuntime.test.ts`
- DB-backed scheduling action tests:
  - `shared/workflow/runtime/actions/__tests__/businessOperations.scheduling.db.test.ts`
- Shared helper guard test for actor resolution:
  - `shared/workflow/runtime/actions/__tests__/businessOperations.shared.actorResolution.db.test.ts`
- Shared DB test utility for runtime action DB suites:
  - `shared/workflow/runtime/actions/__tests__/_dbTestUtils.ts`

### Final Decisions Confirmed in Implementation (F030)

- Multi-assignee reassignment emits one `APPOINTMENT_ASSIGNED` per newly assigned user.
- Cancel action permission uses `user_schedule:update` (status mutation, no row deletion).
- Workflow event publishing is fail-soft and does not roll back successful table writes/audit writes.
- Private entries are redacted unless actor is assigned or has `user_schedule:update`.
- `scheduling.assign_user` event behavior remains unchanged in this pass.

### Validation Commands Run

```bash
cd shared && npx vitest run --coverage.enabled=false \
  workflow/runtime/actions/__tests__/registerSchedulingActionsMetadata.test.ts \
  workflow/runtime/__tests__/workflowDesignerSchedulingCatalogRuntime.test.ts \
  workflow/runtime/nodes/__tests__/actionCallSchedulingSaveAsRuntime.test.ts \
  workflow/runtime/actions/__tests__/businessOperations.scheduling.db.test.ts

cd shared && npx vitest run --coverage.enabled=false \
  workflow/runtime/actions/__tests__/businessOperations.shared.actorResolution.db.test.ts

cd server && npx vitest run --coverage.enabled=false \
  src/test/integration/scheduling/scheduleEntryRecurrence.integration.test.ts
```

### Gotchas / Notes

- `@alga-psa/scheduling/models/scheduleEntry` was not export-resolvable under shared Vitest import-analysis; switched to direct monorepo source import path for runtime/test code in this branch.
- Vitest coverage config mismatch in this environment required explicit `--coverage.enabled=false`.
- DB-backed runtime tests are intentionally using mocked `withTenantTransaction`/`requirePermission` wrappers for deterministic actor + permission simulation while still exercising real table mutations.
