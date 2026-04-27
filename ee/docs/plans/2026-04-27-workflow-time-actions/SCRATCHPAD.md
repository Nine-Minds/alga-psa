# Scratchpad — Workflow Time Actions

- Plan slug: `2026-04-27-workflow-time-actions`
- Created: `2026-04-27`

## What This Is

Rolling notes for adding workflow-safe time-entry, time-sheet, and billing-readiness actions to the workflow action registry.

## Decisions

- (2026-04-27) Scope option selected: core time entry actions, core time sheet actions, and readiness helpers. Timers and broad picker expansion can be deferred unless required by core flows.
- (2026-04-27) Implementation approach selected: create workflow-safe helpers/services that preserve canonical time module behavior, then build workflow actions on top of those helpers. Do not continue direct DB writes that bypass time-entry business logic.
- (2026-04-27) Existing `time.create_entry` should be treated as incomplete/prototype behavior and brought onto the canonical helper path rather than expanded as-is.

## Discoveries / Constraints

- (2026-04-27) Current workflow action file: `shared/workflow/runtime/actions/businessOperations/time.ts`.
- (2026-04-27) Existing `time.create_entry` directly inserts into `time_entries`, uses `billing_plan_id`, computes `work_date` from UTC, and does not attach to a time sheet or resolve `service_id`/`contract_line_id` behavior.
- (2026-04-27) Canonical scheduling behavior lives primarily in `packages/scheduling/src/actions/timeEntryCrudActions.ts`, `timeSheetOperations.ts`, and `timeSheetActions.ts`.
- (2026-04-27) Important canonical side effects include `service_id` validation, user timezone work-date computation, time-sheet period validation, default contract line resolution, bucket usage updates, project-task actual-hours updates, ticket/task resource updates, invoiced-entry guards, and change-request handling.
- (2026-04-27) API time-entry service exists at `server/src/lib/api/services/TimeEntryService.ts`, but it has its own behavior and should not be blindly treated as the canonical source without reconciliation.
- (2026-04-27) Workflow fixed pickers currently support board, client, contact, user, user-or-team, ticket, ticket-status, ticket-priority, ticket-category, ticket-subcategory, and client-location. They do not currently support service catalog, contract line, time entry, time sheet, time period, project task, interaction, or non-billable category resources.
- (2026-04-27) Event schemas for `TIME_ENTRY_SUBMITTED` and `TIME_ENTRY_APPROVED` exist in `shared/workflow/runtime/schemas/timeEventSchemas.ts`, but current workflow-trigger publication appears limited; ticket time entry added publication is handled by `server/src/lib/api/services/timeEntryWorkflowEvents.ts`.
- (2026-04-27) `packages/scheduling/src/services/bucketUsageService.ts` requires tenant inference via `createTenantKnex()` when transaction config does not carry tenant metadata; workflow runtime already has explicit tenant context, so directly calling that service from workflow helper would be fragile in shared Vitest DB tests.

## Commands / Runbooks

- (2026-04-27) Initial investigation used `rg` across `server`, `shared`, `packages`, and `ee` for `time_entries`, `time_sheets`, `time.create_entry`, and workflow picker support.
- (2026-04-27) Validate plan JSON after edits: `python scripts/validate_plan.py ee/docs/plans/2026-04-27-workflow-time-actions` if the validator supports folder input; otherwise run project JSON validation or `python -m json.tool` on each JSON file.

## Links / References

- `shared/workflow/runtime/actions/businessOperations/time.ts`
- `shared/workflow/runtime/actions/registerBusinessOperationsActions.ts`
- `shared/workflow/runtime/designer/actionCatalog.ts`
- `shared/workflow/runtime/jsonSchemaMetadata.ts`
- `packages/scheduling/src/actions/timeEntryCrudActions.ts`
- `packages/scheduling/src/actions/timeSheetOperations.ts`
- `packages/scheduling/src/actions/timeSheetActions.ts`
- `packages/scheduling/src/actions/timeEntryServices.ts`
- `packages/scheduling/src/actions/timeEntryHelpers.ts`
- `server/src/lib/api/services/TimeEntryService.ts`
- `server/src/lib/api/schemas/timeEntry.ts`
- `server/src/lib/api/services/timeEntryWorkflowEvents.ts`
- `shared/workflow/runtime/schemas/timeEventSchemas.ts`
- `ee/server/src/components/workflow-designer/WorkflowActionInputFixedPicker.tsx`

## Open Questions

- Should time actions keep `time.create_entry` at version 1 with corrected semantics, add version 2, or add a new action id and deprecate the current action?
- Should phase 1 include new fixed pickers for service, contract line, time entry, time sheet, and time period, or should these fields remain reference/manual UUID inputs initially?
- Should this plan include publishing/trigger improvements for time-sheet submitted/approved and time-entry approval events, or remain action-only except for using existing events?

## Progress Log

- (2026-04-27) Implemented workflow-safe create-entry domain boundary in `shared/workflow/runtime/actions/businessOperations/timeDomain.ts`.
  - New helper signature is explicit: `{ trx, tenantId, actorUserId, input }`.
  - Helper performs service/work-item existence checks, computes user-timezone work-date fields, resolves/creates time sheets by work date, and applies ticket/task side effects.
  - Output is normalized summary payload intended for workflow runtime consumers.
- (2026-04-27) Replaced direct-write `time.create_entry` handler logic in `shared/workflow/runtime/actions/businessOperations/time.ts` to call `createWorkflowTimeEntry(...)`.
  - Decision: keep `time.create_entry@v1` and migrate semantics in place; retain `billing_plan_id` as a compatibility alias to `contract_line_id`.
  - Added structured domain error mapping via `WorkflowTimeDomainError` -> runtime `throwActionError` categories.
  - Added normalized output schema: `time_entry` object with ids, duration/billable minutes, work date/timezone, sheet/service/contract references, and status fields.
- (2026-04-27) Added DB-backed runtime action test: `shared/workflow/runtime/actions/__tests__/businessOperations.time.db.test.ts` covering T001 scenario.
  - Test validates service requirement, user timezone work-date calculation (`America/Los_Angeles`), automatic time-sheet association, and normalized output/row persistence.
- (2026-04-27) Implemented `F006` bucket usage side effects in workflow create-entry path in `shared/workflow/runtime/actions/businessOperations/timeDomain.ts`.
  - Added explicit-tenant bucket period resolution (`client_billing_cycles` first, then contract-line anchored frequency period).
  - Added bucket usage record upsert for `(tenant, client, contract_line, service, period)` and minutes/overage delta updates gated by `Bucket` overlay configuration.
  - Hooked create-entry to apply delta from `billable_duration` after entry insert.
- (2026-04-27) Added DB-backed runtime test case for `T002` in `shared/workflow/runtime/actions/__tests__/businessOperations.time.db.test.ts`.
  - Uses billing fixtures (`createFixedPlanAssignment`, `createBucketOverlayForPlan`) to seed a bucket-backed contract line.
  - Verifies default contract-line selection and `bucket_usage.minutes_used` increment from workflow `time.create_entry`.
- (2026-04-27) Implemented workflow `time.update_entry` and `time.delete_entry` actions in `shared/workflow/runtime/actions/businessOperations/time.ts` backed by new domain helpers.
  - New domain helpers: `updateWorkflowTimeEntry(...)` and `deleteWorkflowTimeEntry(...)` in `shared/workflow/runtime/actions/businessOperations/timeDomain.ts`.
  - Update behavior includes invoiced guard, recomputation of work-date/timezone + billable minutes, timesheet re-association, bucket usage rebalance (`-old +new`), project-task actual-hours recalc (old/new task), and ticket/project-task assignment side effects.
  - Delete behavior includes invoiced guard, bucket usage decrement, and project-task actual-hours recalc.
- (2026-04-27) Added DB-backed runtime test case for `T003` in `shared/workflow/runtime/actions/__tests__/businessOperations.time.db.test.ts`.
  - Creates a project-task-linked entry, updates duration via workflow action, and deletes via workflow action.
  - Asserts `project_tasks.actual_hours` transitions `30 -> 90 -> 0`.
- (2026-04-27) Implemented `time.get_entry` (`F009`) and `time.find_entries` (`F010`) in workflow runtime.
  - Added domain helpers `getWorkflowTimeEntry(...)` and `findWorkflowTimeEntries(...)`.
  - `find_entries` supports bounded filters across user/work-item/client/service/contract/status/date/time/invoiced scopes and returns aggregate summary totals.
  - Registered new actions in `shared/workflow/runtime/actions/businessOperations/time.ts` with read permissions and normalized output schemas.
- (2026-04-27) Added DB-backed runtime test case for `T005` in `shared/workflow/runtime/actions/__tests__/businessOperations.time.db.test.ts`.
  - Verifies `time.get_entry` normalized response shape.
  - Verifies `time.find_entries` filtered list + aggregate totals.
  - Verifies tenant-scoped isolation by asserting cross-tenant entry lookup returns `NOT_FOUND`.
- (2026-04-27) Added DB-backed runtime test case for `T004` in `shared/workflow/runtime/actions/__tests__/businessOperations.time.db.test.ts`.
  - Marks a project-task time entry as invoiced, then verifies `time.update_entry` and `time.delete_entry` reject with validation errors.
  - Verifies project-task actual-hours and bucket-usage totals remain unchanged after rejected mutations.
- (2026-04-27) Implemented entry approval actions in workflow runtime:
  - `time.set_entry_approval_status` for `DRAFT`/`SUBMITTED`/`APPROVED`/`CHANGES_REQUESTED` transitions.
  - `time.request_entry_changes` convenience bulk action.
  - Domain helpers added in `timeDomain.ts`: `setWorkflowTimeEntryApprovalStatus(...)` and `requestWorkflowTimeEntryChanges(...)`, including `time_entry_change_requests` creation when change-request comments are supplied.
- (2026-04-27) Added DB-backed runtime test case for `T006` in `shared/workflow/runtime/actions/__tests__/businessOperations.time.db.test.ts`.
  - Verifies state transitions through submitted/approved/changes-requested and confirms change-request row creation (single + bulk convenience action).

## Commands / Verification (This Pass)

- Ran: `npx vitest run --config shared/vitest.config.ts workflow/runtime/__tests__/workflowDesignerActionCatalog.test.ts` (pass)
- Attempted: `npx vitest run --config shared/vitest.config.ts workflow/runtime/actions/__tests__/businessOperations.time.db.test.ts`
  - Blocked locally due DB connection refusal at `127.0.0.1:57432` / `::1:57432`.
  - Test file compiles/loads, but DB-backed execution requires local test Postgres availability.
- Attempted after F006/T002 changes: `npx vitest run --config shared/vitest.config.ts workflow/runtime/actions/__tests__/businessOperations.time.db.test.ts`
  - Still blocked locally by the same test DB connection refusal (`127.0.0.1:57432`).
- Attempted after update/delete action + T003 changes: `npx vitest run --config shared/vitest.config.ts workflow/runtime/actions/__tests__/businessOperations.time.db.test.ts`
  - Compile/import succeeds, but DB-backed execution remains blocked by local connection refusal (`127.0.0.1:57432`).
- Attempted after get/find actions + T005 changes: `npx vitest run --config shared/vitest.config.ts workflow/runtime/actions/__tests__/businessOperations.time.db.test.ts`
  - Compile/import succeeds, but DB-backed execution remains blocked by the same local connection refusal (`127.0.0.1:57432`).
- Attempted after T004 additions: `npx vitest run --config shared/vitest.config.ts workflow/runtime/actions/__tests__/businessOperations.time.db.test.ts`
  - Compile/import succeeds, but DB-backed execution remains blocked by the same local connection refusal (`127.0.0.1:57432`).
- Attempted after approval-action + T006 additions: `npx vitest run --config shared/vitest.config.ts workflow/runtime/actions/__tests__/businessOperations.time.db.test.ts`
  - Compile/import succeeds, but DB-backed execution remains blocked by the same local connection refusal (`127.0.0.1:57432`).
- Attempted: `npx tsc -p shared/tsconfig.json --noEmit`
  - Fails due pre-existing workspace TS config/module issues outside this feature area (`@alga-psa/sla/types`, alias `@/lib/*`, and existing `server/test-utils/dbReset.ts` declaration-order error).
- Ran: `npx vitest run --config shared/vitest.config.ts workflow/runtime/__tests__/workflowDesignerActionCatalog.test.ts` (pass after each action-registration expansion).

## Gotchas

- `@alga-psa/billing` subpath imports used in server packages are not exported for this shared Vite test runtime. To keep workflow-runtime tests executable, contract-line defaulting and bucket-usage linkage were intentionally deferred to subsequent features (`F005`/`F006`) rather than forcing brittle deep imports.
- (2026-04-27) Implemented default contract-line resolution in workflow helper (`F005`) without depending on non-exported billing package subpaths.
  - Added tenant-scoped eligible-contract query with effective-date filtering and deterministic selection fallback (single eligible line, or single bucket-overlay candidate).
  - `time.create_entry` now assigns `contract_line_id` automatically when omitted and client/service context can resolve a default.
- (2026-04-27) Bucket usage side-effect implementation in workflow helper intentionally keeps explicit tenant-scoped SQL in `timeDomain.ts` instead of importing `@alga-psa/billing`/`@alga-psa/scheduling` internals to avoid export-boundary and tenant-resolution brittleness in shared runtime tests.
