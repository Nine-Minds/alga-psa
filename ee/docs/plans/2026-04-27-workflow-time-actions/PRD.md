# PRD — Workflow Time Actions

- Slug: `2026-04-27-workflow-time-actions`
- Date: `2026-04-27`
- Status: Draft

## Summary

Add workflow actions for Alga PSA's time module so MSPs can automate core time-entry operations, time-sheet approval flows, and billing-readiness checks from Workflow Designer. The implementation should replace the current direct-write `time.create_entry` behavior with workflow-safe domain helpers that preserve the same business rules and side effects used by the product's time-entry UI/API paths.

The first implementation scope is option B: core time entry actions, core time sheet actions, and readiness helpers. Timer/session automation, broad custom picker work, and non-core reporting are out of scope for the initial plan unless they are required to make the core actions usable.

## Problem

The workflow registry currently exposes only a minimal `time.create_entry` action. It inserts directly into `time_entries` and bypasses important time module behavior, including time-sheet association, service validation, user-timezone work-date calculation, default contract line resolution, bucket usage updates, project task actual-hours updates, resource assignment side effects, invoiced-entry guards, and change-request handling.

MSPs need workflows that can safely manipulate time records because time drives payroll review, client billing, contract bucket usage, invoice readiness, technician accountability, and approval workflows. A workflow action that bypasses canonical behavior risks inaccurate billing and inconsistent time-sheet state.

## Goals

- Provide workflow actions for creating, reading, finding, updating, deleting, and changing approval state for time entries.
- Provide workflow actions for finding/creating, reading, submitting, approving, requesting changes for, reopening, and commenting on time sheets.
- Provide readiness helper actions that summarize time and identify blockers before billing or recurring invoice approval.
- Extract or introduce workflow-safe time module helpers so workflow actions share canonical business behavior instead of performing ad hoc direct database writes.
- Add workflow schema metadata so high-value fields are usable in Workflow Designer with fixed values or dynamic references.
- Preserve tenant isolation, workflow actor permissions, auditability, and existing time module invariants.

## Non-goals

- No timer/session workflow actions in the initial scope (`start_timer`, `stop_timer`, active-session management). These can be phase 2.
- No new invoice-generation or invoice-approval behavior. Readiness helpers may report blockers but must not mutate invoices.
- No redesign of the time-entry UI, time-sheet UI, or billing engine.
- No rewrite of the authorization system.
- No broad reporting dashboard or analytics work.
- No client portal time-entry workflows unless they naturally work through existing tenant/permission boundaries.

## Users and Primary Flows

### MSP workflow builder

Builds automations in Workflow Designer using time actions, fixed pickers, and dynamic references.

Primary flows:

1. Create a billable time entry when a ticket/workflow event indicates completed work.
2. Update or reclassify time after an AI or rules-based validation step.
3. Find unsubmitted or unapproved time for a user, client, ticket, date range, service, or contract line.
4. Submit a technician's time sheet when readiness criteria pass.
5. Approve a time sheet or request changes based on workflow conditions.
6. Check billing readiness before recurring invoice approval and notify/escalate blockers.

### MSP technician / service manager

Benefits from consistent downstream behavior when automations create or update time: time sheets remain accurate, services and contract lines resolve correctly, and approval/change-request flows remain traceable.

### Billing/admin user

Uses readiness workflows to detect unapproved, unsubmitted, missing-service, missing-contract-line, or otherwise blocked time before billing.

## UX / UI Notes

- Time actions should appear under the existing Workflow Designer `Time` catalog group.
- Action labels should use clear MSP language, for example:
  - Create Time Entry
  - Find Time Entries
  - Update Time Entry
  - Delete Time Entry
  - Find or Create Time Sheet
  - Submit Time Sheet
  - Approve Time Sheet
  - Request Time Sheet Changes
  - Find Time Billing Blockers
  - Summarize Time Entries
- Inputs should support dynamic references by default where appropriate.
- Fixed picker support should be added only where it materially improves core use:
  - User fields should use the existing `user` picker.
  - Ticket fields should use the existing `ticket` picker.
  - Time entry / time sheet / time period / service / contract line fields should receive picker metadata and fixed picker support if practical in phase 1; otherwise they must have clear descriptions and examples for reference-based use.
- Long comments, notes, and change reasons should render as textareas.
- Destructive actions like delete or reopen should have clear descriptions and strong validation errors.

## Requirements

### Functional Requirements

#### Workflow-safe time domain helpers

- Create shared workflow-safe helpers for time-entry and time-sheet mutations.
- Helpers must be usable from workflow actions without relying on Next.js server-action wrappers.
- Helpers must accept an explicit tenant, actor user, transaction/knex context, and validated input.
- Helpers must preserve or intentionally mirror canonical behavior from the current scheduling/API implementation.
- Helpers must throw structured, actionable errors that workflow runtime can surface as `ValidationError`, `ActionError`, or `TransientError`.

#### Time entry actions

- `time.create_entry`
  - Create a time entry for a user and work item.
  - Require service information when canonical time-entry rules require it.
  - Support billable and non-billable entries.
  - Support start/end or start/duration input shape if the final design keeps compatibility with existing workflows.
  - Compute `work_date` and `work_timezone` from the entry user's timezone.
  - Attach to the correct time sheet or find/create it based on work date when requested/defaulted.
  - Resolve default contract line when not explicitly provided and when canonical rules can determine it.
  - Preserve canonical side effects: bucket usage, project task actual hours, and ticket/task resource updates.
  - Return the created entry summary with IDs, duration, billable duration, work date, service, contract line, and approval status.

- `time.get_entry`
  - Load a single time entry by ID.
  - Return normalized details needed for downstream workflow conditions.

- `time.find_entries`
  - Query time entries by practical workflow filters: user, work item, client, ticket, project task, time sheet, service, contract line, approval status, billable flag, work date/date range, start/end range, invoiced flag, and limit.
  - Return a bounded list and aggregate counts/minutes.

- `time.update_entry`
  - Update allowed fields on non-invoiced time entries.
  - Recompute dependent fields and side effects when start/end, billable duration, service, contract line, work item, or approval-relevant data changes.
  - Preserve canonical restrictions for approved/invoiced entries.

- `time.delete_entry`
  - Delete a non-invoiced time entry.
  - Preserve bucket usage decrement and project task actual-hours recalculation.
  - Return deletion confirmation and selected deleted-entry summary.

- `time.set_entry_approval_status`
  - Set an entry approval status where allowed by permissions and state.
  - Support `DRAFT`, `SUBMITTED`, `APPROVED`, and `CHANGES_REQUESTED`.
  - Support change-request comment when moving to `CHANGES_REQUESTED`.

- `time.request_entry_changes`
  - Convenience action for requesting changes on one or more submitted entries, including change-request comments.

#### Time sheet actions

- `time.find_or_create_timesheet`
  - Find or create a time sheet for a user and time period or work date.
  - Return time sheet, period, status, and summary fields.

- `time.get_timesheet`
  - Return a time sheet, period, comments, and summary counts/minutes.

- `time.find_timesheets`
  - Query time sheets by user(s), period/date range, status, and approval scope.
  - Return bounded list and summary counts.

- `time.submit_timesheet`
  - Submit a draft or changes-requested time sheet using canonical submit behavior.
  - Update associated time entries to `SUBMITTED`.

- `time.approve_timesheet`
  - Approve a submitted time sheet using canonical approval behavior.
  - Update associated time entries to `APPROVED`.
  - Record approver metadata/comment behavior consistent with the product.

- `time.request_timesheet_changes`
  - Move a time sheet to `CHANGES_REQUESTED` with an approver comment/reason.

- `time.reverse_timesheet_approval`
  - Reopen an approved time sheet where allowed.
  - Block reopening when any associated entries are invoiced.

- `time.add_timesheet_comment`
  - Add a user or approver comment to a time sheet.

#### Readiness helper actions

- `time.summarize_entries`
  - Summarize time entries by filters and grouping options such as user, client, work item, service, contract line, status, billable flag, and date.
  - Return totals for entry count, total minutes, billable minutes, non-billable minutes, approved/submitted/draft/change-requested counts, and invoiced counts.

- `time.find_billing_blockers`
  - Identify time-entry blockers for billing readiness over a client/date/service/contract-line scope.
  - At minimum detect unapproved/submitted/draft/change-requested entries, missing service, missing contract line where required, invalid/zero duration, missing work item where required, and entries not attached to an expected time sheet when applicable.
  - Return blocker categories, counts, matching entry IDs, and human-readable explanations suitable for notifications.
  - Must not mutate invoices or billing documents.

- `time.validate_entries`
  - Validate a bounded set or query of entries against readiness rules and return pass/fail with details.
  - Useful as a lightweight condition step before submit/approve/billing workflows.

### Non-functional Requirements

- Actions must be tenant-scoped and fail fast if tenant context is missing.
- Actions must be idempotency-aware where side-effectful operations can be retried by the workflow engine.
- Queries must use bounded limits to avoid unbounded workflow payloads.
- Error messages must be actionable for workflow builders.
- Helper behavior must be deterministic enough for DB-backed tests.

## Data / API / Integrations

### Existing data model touched

- `time_entries`
- `time_sheets`
- `time_periods`
- `time_sheet_comments`
- `time_entry_change_requests`
- `tickets`, `ticket_resources`
- `project_tasks`, `task_resources`, `project_phases`, `projects`
- `service_catalog`
- `contract_lines` / client contract line linkage as used by existing default contract-line resolution
- bucket usage tables/services used by current time-entry save/delete behavior
- `audit_logs`

### Helper/service placement

The implementation should introduce helpers in a runtime-safe location that can be imported by `shared/workflow/runtime/actions/businessOperations/time.ts` without pulling in Next.js server-action wrappers. Candidate locations should be selected during implementation after checking package boundaries. The design intent is:

- shared helper functions for canonical time-entry create/update/delete/read/query behavior;
- shared helper functions for canonical time-sheet submit/approve/request-changes/reverse/comment behavior;
- small workflow action handlers that validate input schemas, call helpers, write workflow audit records, and return normalized outputs.

### Workflow registry integration

- Register all new actions from `registerTimeActions()` in `shared/workflow/runtime/actions/businessOperations/time.ts` or adjacent files.
- Keep the designer catalog `Time` group intact.
- Add schema descriptions and `x-workflow-editor` / picker metadata through `withWorkflowJsonSchemaMetadata` where useful.

### Versioning / compatibility

The existing `time.create_entry` action must not silently keep unsafe behavior. The implementation should decide whether to:

1. preserve action id/version and fix semantics, or
2. add a new version/action id and migrate/deprecate the old behavior.

This remains an open decision because it depends on whether existing workflows may already rely on the current action shape.

## Security / Permissions

- Use workflow actor permissions via the same role/permission model as existing workflow business-operation actions.
- Time entry actions should require the relevant `timeentry` permissions (`create`, `read`, `update`, `delete`) and timesheet actions should require relevant `timesheet` permissions (`read`, `submit`, `approve`, `reverse`, `comment`/equivalent).
- Acting on behalf of another user must preserve the current delegation/manager semantics where practical.
- Approving time must enforce the existing approval constraints and must not permit self-approval if current product rules prevent it.
- Readiness helpers should require read permissions and must not expose records outside the workflow actor's permitted scope.
- All mutations must be tenant-scoped.

## Observability / Auditability

- Mutating workflow actions should write workflow run audit records consistent with existing business-operation actions.
- Returned outputs should include enough IDs and status fields to support downstream workflow audit trails.
- No new metrics dashboard is required for this plan.

## Rollout / Migration

- Implement actions behind normal workflow registry availability; no database migration is expected unless helper extraction requires schema support or new picker APIs require endpoints.
- Existing direct-write `time.create_entry` behavior should be replaced or versioned carefully.
- If service/contract/time pickers are added, ship them as additive Workflow Designer support.
- Document any behavior changes to `time.create_entry`, especially service requirement and time-sheet/contract-line side effects.

## Open Questions

1. Should `time.create_entry` remain version 1 with fixed semantics, or should a version 2/new action id be introduced for compatibility?
2. Should phase 1 include fixed picker UI support for service, contract line, time entry, time sheet, and time period, or should those start as reference/manual UUID fields?
3. Should this plan include publishing/trigger improvements for time-entry submitted/approved and time-sheet submitted/approved events, or remain action-only?
4. Should bulk actions be first-class in phase 1, or should `find_entries` + workflow loops handle multi-entry operations?

## Acceptance Criteria (Definition of Done)

- Workflow Designer exposes time actions for core time-entry, time-sheet, and readiness operations under the Time group.
- Creating/updating/deleting time through workflows uses workflow-safe helpers and preserves canonical time module behavior.
- Time-sheet submit/approve/request-changes/reverse/comment actions enforce permissions and state guards.
- Readiness helpers can identify billing blockers without mutating invoices.
- Input schemas include useful descriptions and editor metadata for fixed/reference modes.
- DB-backed tests cover representative happy paths, permission/state guards, and high-risk billing/time-sheet side effects.
- Existing tests for time entry, time sheet, billing blockers, and workflow registry continue to pass.
