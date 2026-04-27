# PRD: Workflow Scheduling Actions

## Status

Draft created 2026-04-25 after source investigation. Scope needs product confirmation before implementation.

## Problem Statement

Workflow v2 currently exposes only one scheduling write action, `scheduling.assign_user`, and it is a create-oriented helper. Dispatchers and workflow authors need first-party actions that match the scheduling lifecycle language they use every day: find an appointment, reschedule it, reassign it, cancel it, or complete it.

Without these actions, workflow builders either cannot automate common dispatcher outcomes or must rely on generic table patches that bypass conflict handling, technician eligibility checks, recurrence semantics, audit records, and workflow event emission.

## User Value

- Dispatchers can automate appointment lifecycle changes using action names that match their operating model.
- Workflow builders get safe, typed scheduling actions in the designer catalog instead of generic DB mutation workarounds.
- Downstream workflows can react to canonical `APPOINTMENT_*` events after schedule changes.
- Engineers can keep scheduling mutation behavior centralized around existing schedule tables, recurrence helpers, and event schemas.

## Goals

1. Add first-party workflow actions under `shared/workflow/runtime/actions/businessOperations/scheduling.ts`:
   - `scheduling.find_entry` (read)
   - `scheduling.search_entries` (read)
   - `scheduling.reschedule` (write)
   - `scheduling.reassign` (write)
   - `scheduling.cancel` (write)
   - `scheduling.complete` (write)
2. Preserve existing `scheduling.assign_user` behavior unless a bug is directly blocking this scope.
3. Reuse the existing workflow action registration/catalog pipeline; no new designer grouping work should be required because the `scheduling.*` prefix already maps to the Scheduling group.
4. Use existing schedule persistence concepts:
   - `schedule_entries`
   - `schedule_entry_assignees`
   - `schedule_conflicts`
   - `IEditScope` recurrence scopes: `single`, `future`, `all`
5. Emit canonical workflow domain events for appointment lifecycle changes:
   - `APPOINTMENT_RESCHEDULED`
   - `APPOINTMENT_ASSIGNED`
   - `APPOINTMENT_CANCELED`
   - `APPOINTMENT_COMPLETED`
6. Enforce tenant scoping and existing MSP schedule permissions through the workflow action actor model.
7. Provide typed action outputs that can be saved with `saveAs` and consumed by downstream workflow steps.

## Non-Goals

- Do not redesign the schedule entry schema or recurrence model.
- Do not replace the existing Scheduling UI/server actions.
- Do not add a new generic patch action for schedule entries.
- Do not implement `APPOINTMENT_NO_SHOW` action in this pass unless explicitly added to scope.
- Do not introduce a new workflow catalog group or designer component beyond existing schema-driven forms.
- Do not add notification/email template behavior beyond workflow event emission.
- Do not implement broad observability/metrics/feature flags unless a test or runtime dependency requires it.

## Target Users / Personas

- MSP dispatchers who want workflow automations to move, assign, cancel, or complete appointments.
- Workflow builders/admins configuring business-process automation in the workflow designer.
- Technicians and service managers affected by schedule changes.
- Engineers maintaining workflow action contracts and scheduling integrations.

## Primary Flows

### Flow 1 — Find then reschedule an appointment

1. A workflow trigger provides an appointment/schedule entry reference, or a workflow searches by ticket/time window.
2. The workflow calls `scheduling.find_entry` or `scheduling.search_entries`.
3. The workflow calls `scheduling.reschedule` with a new time window and conflict mode.
4. The action validates permissions, loads the entry, checks conflicts, applies recurrence scope, updates the schedule entry, audits the workflow mutation, emits `APPOINTMENT_RESCHEDULED`, and returns the updated entry summary.

### Flow 2 — Reassign technician(s)

1. A workflow receives a condition such as preferred technician unavailable or escalation required.
2. The workflow calls `scheduling.reassign` with one or more new technician user ids.
3. The action validates technician eligibility, checks assignment no-op behavior, updates `schedule_entry_assignees`, audits the mutation, emits `APPOINTMENT_ASSIGNED` for newly assigned technician(s), and returns previous/new assignees.

### Flow 3 — Cancel a recurring appointment occurrence or series

1. A workflow identifies an appointment that should be canceled.
2. The workflow calls `scheduling.cancel` with `recurrence_scope` (`single`, `future`, or `all`) plus optional reason/note.
3. The action marks the relevant occurrence/scope as canceled rather than deleting it, audits the mutation, emits `APPOINTMENT_CANCELED`, and returns the canceled entry summary.

### Flow 4 — Complete appointment

1. A workflow determines work is complete.
2. The workflow calls `scheduling.complete` with optional outcome notes.
3. The action sets completed status, audits the mutation, emits `APPOINTMENT_COMPLETED`, and returns completion metadata.

## UX / UI Notes

- The existing designer catalog groups actions by module prefix. New `scheduling.*` action ids should automatically appear under the existing Scheduling group in `shared/workflow/runtime/designer/actionCatalog.ts`.
- Input schemas should use descriptive Zod `.describe()` strings because the workflow designer derives action forms from JSON Schema.
- Schemas should mirror the newer Client action patterns: use `withWorkflowJsonSchemaMetadata` picker hints where existing picker kinds are available, and add metadata/catalog tests that convert Zod schemas through `zodToWorkflowJsonSchema`.
- Use user picker metadata for technician/user id fields. There is not currently a known schedule-entry picker kind, so schedule-entry reference fields should ship as text/UUID-like fields with descriptions; picker support can be a follow-up.
- Output schemas should expose stable fields for downstream step pickers: entry id, assigned user ids, previous/new time, status, conflict metadata, recurrence scope, and emitted event type.

## Data Model / API / Integration Notes

### Current source baseline

- Current workflow action file: `shared/workflow/runtime/actions/businessOperations/scheduling.ts`
  - Only registers `scheduling.assign_user`.
  - Creates rows directly in `schedule_entries`, `schedule_entry_assignees`, and optionally `schedule_conflicts`.
  - Performs permission checks via `requirePermission(ctx, tx, { resource: 'user_schedule', action: ... })`.
  - Resolves workflow actor from `workflow_runs` / workflow definition metadata in `withTenantTransaction()`.
- Existing Scheduling server actions live in `packages/scheduling/src/actions/scheduleActions.ts`.
  - They publish `SCHEDULE_ENTRY_*` event-bus events and `APPOINTMENT_*` workflow events.
  - They depend on `withAuth`/current session and are not directly suitable for workflow runtime handlers.
- Existing schedule model: `packages/scheduling/src/models/scheduleEntry.ts`.
  - Supports create/update/delete with recurrence scope behavior.
  - `update()` can extract a single recurring virtual instance, split future series, or update all occurrences.
- Existing event builders: `shared/workflow/streams/domainEventBuilders/appointmentEventBuilders.ts`.
  - Provides `buildAppointmentRescheduledPayload`, `buildAppointmentAssignedPayload`, `buildAppointmentCanceledPayload`, `buildAppointmentCompletedPayload`, plus status helpers.
- Newer Client workflow actions added a useful runtime-action pattern in `shared/workflow/runtime/actions/businessOperations/clients.ts`:
  - action-local picker metadata helper;
  - DB-backed direct action tests under `shared/workflow/runtime/actions/__tests__/`;
  - runtime catalog grouping tests under `shared/workflow/runtime/__tests__/`;
  - best-effort lazy `publishWorkflowEvent` import helper so shared-root tests do not require event-bus module resolution.
  Scheduling actions should follow these patterns unless a scheduling-specific reason says otherwise.
- Main now tenant-scopes `workflow_definitions` through `tenant_id` (`server/migrations/20260425200000_add_tenant_id_to_workflow_definitions.cjs`). The shared workflow action helper `resolveRunActorUserId()` should be reviewed/updated during implementation so actor resolution joins `workflow_definitions` by both `workflow_id` and the run tenant, not only by `workflow_id`.
- Existing event schemas: `shared/workflow/runtime/schemas/schedulingEventSchemas.ts` and `packages/event-schemas/src/schemas/domain/schedulingEventSchemas.ts`.
  - Already define the six appointment event payloads referenced in the request.

### Proposed action contracts

#### `scheduling.find_entry` v1

Read side action that loads one schedule entry by `entry_id` in the current tenant.

Inputs:
- `entry_id`: non-empty schedule entry reference string. It may be a concrete UUID or an existing virtual recurring occurrence id of the form `<masterEntryId>_<timestamp>`.
- `include_private_details`: optional boolean, default false; if false and the actor is not assigned, private entries are redacted.

Outputs:
- `found`: boolean
- `entry`: normalized schedule-entry object or null

#### `scheduling.search_entries` v1

Read side action for workflow lookups.

Inputs:
- `window.start` / `window.end`: optional ISO datetimes, at least one search criterion required.
- `assigned_user_ids`: optional UUID array.
- `work_item`: optional `{ type, id }` for ticket/project task/appointment request/ad hoc filters.
- `status`: optional status filter array.
- `query`: optional title/notes search text.
- `limit`: bounded integer defaulting to a safe value.

Outputs:
- `entries`: normalized entry summaries.
- `count`: number returned.

#### `scheduling.reschedule` v1

Write action that changes an entry's start/end time.

Inputs:
- `entry_id`: non-empty schedule entry reference string. It may be a concrete UUID or an existing virtual recurring occurrence id of the form `<masterEntryId>_<timestamp>`.
- `window.start`, `window.end`, optional `timezone`.
- `conflict_mode`: `fail | shift | override`, default `fail`.
- `recurrence_scope`: `single | future | all`, default `single`.
- optional `reason`, `note`.

Behavior:
- Requires `user_schedule:update`.
- Validates `start < end`.
- Loads the entry and current assignees.
- Detects conflicts for assigned users excluding the target entry/series and ignoring canceled/completed/no-show entries.
- `fail`: reject with `CONFLICT`.
- `shift`: move the requested window to the earliest non-conflicting slot after detected conflicts, preserving duration.
- `override`: update anyway and record unresolved `schedule_conflicts` rows.
- Applies recurrence scope using existing recurrence semantics where possible.
- Emits `APPOINTMENT_RESCHEDULED` when the entry is an appointment-like entry (`ticket` or `appointment_request`).

Outputs:
- `entry_id`, `updated_entry_id`, `previous_start`, `previous_end`, `new_start`, `new_end`, `assigned_user_ids`, `conflict_mode`, `conflicts_detected`, `recurrence_scope`, `event_type`.

#### `scheduling.reassign` v1

Write action that replaces or adds assigned technicians.

Inputs:
- `entry_id`: non-empty schedule entry reference string. It may be a concrete UUID or an existing virtual recurring occurrence id of the form `<masterEntryId>_<timestamp>`.
- `assigned_user_ids`: non-empty unique UUID array.
- `mode`: `replace | add`, default `replace`.
- `recurrence_scope`: `single | future | all`, default `single`.
- `no_op_if_already_assigned`: boolean default true.
- optional `reason`, `comment`.

Behavior:
- Requires `user_schedule:update`.
- Validates each target user exists, is active/internal where applicable, and is eligible for technician scheduling. Current `assign_user` checks the `Technician` role; use the same rule for v1 unless product chooses a different eligibility model.
- If no-op is enabled and the computed assignment set matches current assignment, return success with `changed: false` and do not emit `APPOINTMENT_ASSIGNED`.
- Updates `schedule_entry_assignees` through recurrence-aware update behavior.
- Emits `APPOINTMENT_ASSIGNED` once for a one-to-one replacement, or once per newly assigned user for multi-assignee changes because the existing event schema has a single `newAssigneeId`.

Outputs:
- `entry_id`, `updated_entry_id`, `previous_assigned_user_ids`, `assigned_user_ids`, `changed`, `recurrence_scope`, `events_emitted`.

#### `scheduling.cancel` v1

Write action that marks an entry canceled.

Inputs:
- `entry_id`: non-empty schedule entry reference string. It may be a concrete UUID or an existing virtual recurring occurrence id of the form `<masterEntryId>_<timestamp>`.
- `recurrence_scope`: `single | future | all`, default `single`.
- optional `reason`, `note`.

Behavior:
- Requires `user_schedule:update` or `user_schedule:delete` (open question: choose one).
- Updates status to the canonical canceled spelling used by appointment event helpers (`cancelled` or `canceled`; current helper accepts both).
- Preserves the row/series rather than deleting it.
- Appends reason/note to existing notes or stores in audit details, without requiring a schema migration.
- Emits `APPOINTMENT_CANCELED` for appointment-like entries.

Outputs:
- `entry_id`, `updated_entry_id`, `status`, `recurrence_scope`, `reason`, `event_type`.

#### `scheduling.complete` v1

Write action that marks an entry completed.

Inputs:
- `entry_id`: non-empty schedule entry reference string. It may be a concrete UUID or an existing virtual recurring occurrence id of the form `<masterEntryId>_<timestamp>`.
- optional `recurrence_scope`, default `single` for recurring compatibility.
- optional `outcome`, `note`.

Behavior:
- Requires `user_schedule:update`.
- Updates status to `completed`.
- Stores outcome/note in schedule notes or audit details.
- Emits `APPOINTMENT_COMPLETED` for appointment-like entries.

Outputs:
- `entry_id`, `updated_entry_id`, `status`, `completed_at`, `outcome`, `event_type`.

## Recommended Technical Approach

### Option A — Extend workflow scheduling action file with local helpers (recommended)

Implement all new action definitions in `shared/workflow/runtime/actions/businessOperations/scheduling.ts`, adding private helpers for entry loading, conflict detection, technician eligibility, recurrence updates, audit, output normalization, and event publishing.

Pros:
- Keeps the workflow action catalog simple and colocated with existing business-operation actions.
- Avoids calling `withAuth` server actions from workflow runtime.
- Minimizes package-boundary changes.

Cons:
- Duplicates some logic currently present in `packages/scheduling/src/actions/scheduleActions.ts`.

### Option B — Extract package-level scheduling domain service, then call it from UI/server actions and workflow actions

Move shared mutation/event logic into a reusable scheduling service package function that accepts tenant/user/transaction context.

Pros:
- Best long-term reuse and consistency.
- Reduces drift between UI mutations and workflow mutations.

Cons:
- Larger refactor and higher risk for this focused action-library improvement.
- More package dependency and test updates.

### Option C — Call existing Scheduling server actions from workflow action handlers

Use `addScheduleEntry`/`updateScheduleEntry`/`deleteScheduleEntry` from `packages/scheduling/src/actions/scheduleActions.ts` directly.

Pros:
- Reuses existing event emission.

Cons:
- Not appropriate because those actions are `withAuth`/session-oriented and workflow runtime uses a run actor, tenant id, and explicit knex context.

Recommendation: use Option A for this pass, while shaping helpers so they can be extracted into Option B later if scheduling action surface continues to grow.

## Permissions / Security

- Read actions require `user_schedule:read`.
- Write actions require `user_schedule:update`, except `cancel` may require `user_schedule:delete` if product wants cancellation to be treated as destructive. This is an open question.
- All queries must use the current workflow tenant from `ActionContext.tenantId` and set tenant RLS through `withTenantTransaction()`.
- Private schedule entry behavior should match existing Scheduling UI semantics: assigned users can see details; unassigned actors get redacted details unless they have update-level scheduling permission and product confirms full visibility.
- Workflow actor is resolved from run/workflow metadata by existing `withTenantTransaction()` helper; no end-user session should be required.

## Error Handling

- Invalid inputs return standard workflow action errors through `throwActionError()`.
- Missing entry/user/work item returns `NOT_FOUND`.
- Invalid time windows return `VALIDATION_ERROR`.
- Insufficient permissions return `PERMISSION_DENIED`.
- Conflict fail mode returns `CONFLICT` with conflict details safe for workflow display.
- Event publishing behavior is confirmed fail-soft/logged. Mirror the Client workflow action pattern by using a best-effort lazy import helper for `publishWorkflowEvent`; action persistence/audit remains the source of truth if event publication is unavailable or fails.

## Risks and Constraints

- Existing `scheduling.assign_user` writes directly to schedule tables and only emits audit, not `APPOINTMENT_CREATED`; adding lifecycle event emission may create asymmetry unless separately addressed.
- Existing schedule recurrence update logic lives in `packages/scheduling/src/models/scheduleEntry.ts` and is marked `// @ts-nocheck`; use it carefully and cover with DB-backed tests.
- Existing appointment event schema supports single assignee ids. Multi-technician reassignment must emit multiple `APPOINTMENT_ASSIGNED` events or limit v1 to one technician.
- `schedule_entries.status` is free text and existing code accepts multiple spellings/cases for canceled/completed/no-show. The actions should choose canonical lowercase statuses and rely on event helpers' tolerant readers.
- Conflict detection must exclude the target entry and should ignore canceled/completed entries to avoid false positives.
- Virtual recurring entry ids use an underscore suffix in the existing model. Action schemas for entry references must therefore accept non-empty strings rather than strict UUIDs, while output fields for concrete `updated_entry_id` can remain UUID-validated when applicable.
- `package-lock.json` is already modified in this worktree and was not changed by this plan.

## Rollout / Migration Notes

- No database migration is expected for the first implementation pass.
- The actions register through `registerSchedulingActions()` and should appear automatically in the designer catalog after runtime initialization.
- If picker metadata for schedule entries is missing, the first rollout can use described text input for entry references and add picker support later.
- Because main now includes tenant-owned workflow definitions, implementation should include a small shared-helper guard/update for workflow action actor resolution before relying on schedule write permission checks.
- Existing workflows are unaffected because no existing action ids are removed or versioned.

## Acceptance Criteria / Definition of Done

1. `scheduling.find_entry` and `scheduling.search_entries` are registered as non-side-effectful v1 actions and appear in the designer Scheduling group.
2. `scheduling.reschedule`, `scheduling.reassign`, `scheduling.cancel`, and `scheduling.complete` are registered as side-effectful v1 actions and appear in the designer Scheduling group.
3. Each action has Zod input/output schemas with useful descriptions and stable downstream output fields.
4. Read actions are tenant-scoped, permission-checked, and return normalized schedule entry data with assigned user ids.
5. Reschedule validates windows, handles conflict modes, supports recurrence scope, writes audit, and emits `APPOINTMENT_RESCHEDULED` for appointment-like entries.
6. Reassign validates technician eligibility, supports no-op behavior, updates assignees, writes audit, and emits `APPOINTMENT_ASSIGNED` according to the confirmed multi-assignee policy.
7. Cancel marks the selected scope canceled, preserves rows, writes audit, and emits `APPOINTMENT_CANCELED`.
8. Complete marks the selected scope completed, writes audit, and emits `APPOINTMENT_COMPLETED`.
9. DB-backed integration tests cover at least one happy path and one guard/failure path for scheduling writes.
10. Action registry/designer catalog tests confirm all new action ids are present and grouped under Scheduling.
11. Existing scheduling recurrence integration tests remain passing.

## Confirmed Scope Decisions

Confirmed by user on 2026-04-25:

1. `scheduling.reassign` v1 supports multiple technicians and emits one `APPOINTMENT_ASSIGNED` per newly assigned user.
2. `scheduling.cancel` requires `user_schedule:update` because it marks status canceled rather than deleting rows.
3. Workflow action event publishing follows the existing Scheduling action pattern: fail-soft/log rather than rollback/fail the workflow action.
4. Private entries are redacted unless the actor is assigned or has `user_schedule:update`.
5. Leave `scheduling.assign_user` event emission unchanged in this pass unless implementation discovers it blocks consistency.
