# Scratchpad — Time Entry Delegation

## Decisions (confirmed)
- Billing/system admins should be able to **enter time + approve/reopen** as needed (RBAC-driven).
- Managers should be limited to **team membership** (only users in teams they manage).
- Do **not** allow adding/editing time for **already invoiced** periods/entries.

## Current-State Findings (key file paths)
- Time entry type shape:
  - `server/src/interfaces/timeEntry.interfaces.ts`
  - `packages/scheduling/src/schemas/timeSheet.schemas.ts` (`timeEntrySchema`)
- Time entry CRUD server actions (Next.js server actions used by UI):
  - `packages/scheduling/src/actions/timeEntryCrudActions.ts`
  - Notable issue: `saveTimeEntry` currently forces `user_id` to the actor, preventing on-behalf and risking ownership corruption on update.
- Time sheet / period actions:
  - `packages/scheduling/src/actions/timeSheetOperations.ts` (`fetchTimePeriods`, `fetchOrCreateTimeSheet`)
  - These take a `userId` param and do not currently enforce “self vs delegate” rules.
- Timesheet approvals:
  - `packages/scheduling/src/actions/timeSheetActions.ts`
  - Notable issue: `reverseTimeSheetApproval` currently sets status to `SUBMITTED`, but the UI is editable only for `DRAFT`/`CHANGES_REQUESTED`.
- Time Entry UI:
  - `/msp/time-entry` list: `packages/scheduling/src/components/time-management/time-entry/TimeTracking.tsx`
  - Time period table: `packages/scheduling/src/components/time-management/time-entry/TimePeriodList.tsx`
  - Timesheet UI: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheet.tsx` (+ `TimeSheetHeader.tsx`)
- Billing usage of time entries (approved + not invoiced):
  - `server/src/lib/billing/billingEngine.ts`

## Notes / Risks
- There appear to be parallel implementations for some timesheet flows:
  - Next.js server actions in `packages/scheduling/src/actions/**`
  - Service layer in `server/src/lib/api/services/TimeSheetService.ts`
  - Plan: implement delegation in the server actions used by the UI first; avoid accidental divergence where possible.
- Manager approval dashboard currently accepts `teamIds` from the client; for manager-scoped access we must validate scope server-side (do not trust user-supplied team ids).

## Commands
- Validate plan folder JSON shape:
  - `python3 scripts/validate_plan.py ee/docs/plans/2026-01-31-edit-other-users-time-entries`

## Implementation sketch (high level)
- Add audit columns to `time_entries` (`created_by`, `updated_by`) + types/schema updates.
- Add a centralized authorization helper for “actor can access/modify subject’s time”.
- Harden all time entry/time sheet server actions to enforce owner-or-delegate and invoiced constraints.
- Add a subject user selector UI on `/msp/time-entry` backed by a server action returning eligible subject users.
- Add “Reopen for edits” for approved, non-invoiced timesheets and make it transition to an editable status.

## Progress log
- 2026-01-31: F001 — Added `time_entries.created_by` + `time_entries.updated_by` columns via migration `server/migrations/20260131120000_add_time_entries_actor_audit_columns.cjs` (FK constraints added in F002).
- 2026-01-31: F002 — Added tenant-scoped FK constraints for `time_entries.(created_by,updated_by)` → `users(user_id)` via migration `server/migrations/20260131120500_add_time_entries_actor_audit_fks.cjs`.
- 2026-01-31: F003 — Extended `ITimeEntry` types to include optional `created_by`/`updated_by` in `server/src/interfaces/timeEntry.interfaces.ts` and `packages/types/src/interfaces/timeEntry.interfaces.ts`.
- 2026-01-31: F004 — Extended `timeEntrySchema` to include optional `created_by`/`updated_by` in `packages/scheduling/src/schemas/timeSheet.schemas.ts`.
- 2026-01-31: F005 — Added shared delegation helper `packages/scheduling/src/actions/timeEntryDelegationAuth.ts` (`assertCanActOnBehalf`) to authorize self vs tenant-wide vs manager-of-subject access.
- 2026-01-31: F006 — Implemented server-side manager-of-subject check via `teams.manager_id` + `team_members` join (exported `isManagerOfSubject`).
- 2026-01-31: F007 — Encoded delegation policy in `assertCanActOnBehalf` (self OR `approve` + (`read_all` OR manager-of-subject)).
- 2026-01-31: F008 — Added server action `fetchEligibleTimeEntrySubjects` in `packages/scheduling/src/actions/timeEntryDelegationActions.ts` (self-only unless delegate; team-scoped for managers; tenant-wide for `read_all`).
- 2026-01-31: F009 — Hardened `fetchTimePeriods(userId)` in `packages/scheduling/src/actions/timeSheetOperations.ts` to enforce delegation policy via `assertCanActOnBehalf`.
- 2026-01-31: F010 — Hardened `fetchOrCreateTimeSheet(userId, periodId)` in `packages/scheduling/src/actions/timeSheetOperations.ts` to enforce delegation policy via `assertCanActOnBehalf`.
- 2026-01-31: F011 — Hardened `fetchTimeSheet(timeSheetId)` in `packages/scheduling/src/actions/timeSheetActions.ts` by enforcing owner-or-delegate access via `assertCanActOnBehalf` (prevents ID-guessing).
- 2026-01-31: F012 — Hardened `fetchTimeEntriesForTimeSheet(timeSheetId)` in `packages/scheduling/src/actions/timeSheetActions.ts` by resolving the timesheet owner and enforcing `assertCanActOnBehalf`.
- 2026-01-31: F013 — Hardened `fetchWorkItemsForTimeSheet(timeSheetId)` in `packages/scheduling/src/actions/timeEntryWorkItemActions.ts` by enforcing owner-or-delegate via `assertCanActOnBehalf`.
- 2026-01-31: F014 — Updated `saveTimeEntry` in `packages/scheduling/src/actions/timeEntryCrudActions.ts` to persist `time_entries.user_id` from the requested subject (no longer forced to actor).
- 2026-01-31: F015 — Prevented `saveTimeEntry` updates from changing `time_entries.user_id` ownership (canonical owner comes from existing row; `user_id` is removed from UPDATE payload).
- 2026-01-31: F016 — Enforced delegation policy in `saveTimeEntry` via `assertCanActOnBehalf` (blocks creating/updating entries for unauthorized subjects).
- 2026-01-31: F017 — `saveTimeEntry` now computes `work_date`/`work_timezone` using the subject user’s timezone (`resolveUserTimeZone(..., timeEntryUserId)`).
- 2026-01-31: F018 — `saveTimeEntry` now writes audit columns (`updated_by` on every save; `created_by` on insert) to capture the actor.
- 2026-01-31: F019 — Added server-side time period boundary validation in `saveTimeEntry` (requires entry start/end to fall within the associated timesheet’s time period; also enforces timesheet owner matches entry user).
- 2026-01-31: F020 — Blocked updates to invoiced time entries in `saveTimeEntry` (throws a clear error when `time_entries.invoiced = true`). Deletes enforced in `deleteTimeEntry` (F022).
- 2026-01-31: F021 — Reopen/reverse approval is blocked when any related `time_entries.invoiced = true` (see `reverseTimeSheetApproval` in `packages/scheduling/src/actions/timeSheetActions.ts`).
- 2026-01-31: F022 — Hardened `deleteTimeEntry(entryId)` in `packages/scheduling/src/actions/timeEntryCrudActions.ts` (enforces delegation via `assertCanActOnBehalf` and blocks deletes when `invoiced=true`).
- 2026-01-31: F023 — Hardened `submitTimeSheet(timeSheetId)` in `packages/scheduling/src/actions/timeSheetOperations.ts` (requires `timesheet:submit` and enforces delegation via `assertCanActOnBehalf` before submitting + updating entry statuses).
- 2026-01-31: F024 — Hardened approval operations in `packages/scheduling/src/actions/timeSheetActions.ts`: approvals now enforce delegation scope via `assertCanActOnBehalf` (tenant-wide admins vs managers), and reject spoofed `approverId/managerId` params.
- 2026-01-31: F025 — Updated “reopen/reverse approval” (`reverseTimeSheetApproval`) to set the timesheet + entries to `CHANGES_REQUESTED` so the UI becomes editable.
- 2026-01-31: F026 — `reverseTimeSheetApproval` now enforces delegation authorization via `assertCanActOnBehalf` (and rejects spoofed `approverId`).
- 2026-01-31: F027 — Added subject user selector to `/msp/time-entry` (implemented in `packages/scheduling/src/components/time-management/time-entry/TimeTracking.tsx`; defaults to self and only renders when multiple eligible subjects exist).
- 2026-01-31: F028 — Switched subject selector to use `UserPicker` and populate from `fetchEligibleTimeEntrySubjects`.
- 2026-01-31: F029 — Time period list now reloads from `fetchTimePeriods(subjectUserId)` when the selected subject changes.
- 2026-01-31: F030 — Timesheet page refresh after saving entries now re-fetches via the timesheet owner (`fetchOrCreateTimeSheet(timeSheet.user_id, ...)`) so subject context is derived from the timesheet itself.
- 2026-01-31: F031 — Timesheet header now shows “Time Sheet for {Subject}” and (when delegated) “Edited by {Actor}” via new props plumbed through `TimeSheetClient` → `TimeSheet` → `TimeSheetHeader`.
- 2026-01-31: F032 — Added “Reopen for edits” button to `TimeSheetHeader` for APPROVED, non-invoiced timesheets when server precomputes `canReopenForEdits` (see `server/src/app/msp/time-entry/timesheet/[id]/page.tsx`).
- 2026-01-31: F033 — Reopen flow now uses `ConfirmationDialog` and shows toast success/error (including invoiced-block errors) in `TimeSheetClient`.
- 2026-01-31: F034 — Timesheet client now forces `timeEntry.user_id = timeSheet.user_id` when saving so delegated entry create/edit targets the subject reliably.
- 2026-01-31: F035 — Improved client error handling so server-side “not editable” / “invoiced” constraints surface as user-visible toast messages (see `TimeEntryDialog.tsx`).
- 2026-01-31: F036 — Removed client-supplied team scoping from `fetchTimeSheetsForApproval`; server now computes manager scope via joins (updated `ManagerApprovalDashboard` call signature).
- 2026-01-31: F037 — Hardened remaining time entry reads to prevent ID-guessing: `fetchTimeEntriesForTimeSheet` and `getTimeEntryById` now enforce owner-or-delegate via `assertCanActOnBehalf` in `packages/scheduling/src/actions/timeEntryCrudActions.ts`.

## Test log
- 2026-01-31: T001 — `python3 scripts/validate_plan.py ee/docs/plans/2026-01-31-edit-other-users-time-entries` ✅
- 2026-01-31: T010 — Added unit test `server/src/test/unit/migrations/timeEntriesAuditColumns.test.ts` verifying migration adds `created_by` + `updated_by` columns.
- 2026-01-31: T011 — Extended audit migration unit test to verify tenant-scoped FK constraints for `created_by`/`updated_by`.
- 2026-01-31: T020 — Added type-level unit test `server/src/test/unit/types/timeEntryAuditFields.test.ts` to assert `ITimeEntry` exposes optional `created_by`/`updated_by`.
- 2026-01-31: T021 — Added schema unit test `server/src/test/unit/validation/timeEntrySchemaAuditFields.test.ts` to ensure `timeEntrySchema` accepts audit fields (present or omitted).
- 2026-01-31: T030 — Added unit test `server/src/test/unit/scheduling/delegationAuth.test.ts` covering self access for delegation auth.
- 2026-01-31: T031 — Extended delegation auth unit test to cover tenant-wide admin access (`approve` + `read_all`).
- 2026-01-31: T032 — Extended delegation auth unit test to cover manager-of-subject access (managed team membership).
- 2026-01-31: T033 — Extended delegation auth unit test to ensure managers cannot access users outside their managed teams.
- 2026-01-31: T034 — Extended delegation auth unit test to ensure non-delegates are blocked from accessing other users.
- 2026-01-31: T040 — Added unit test `server/src/test/unit/scheduling/eligibleSubjects.test.ts` verifying eligible-subjects returns self-only for non-delegates.
- 2026-01-31: T041 — Extended eligible-subjects unit test to cover manager-scoped subject lists (reports in managed teams + self).
- 2026-01-31: T042 — Extended eligible-subjects unit test to cover tenant-wide admin subject lists (all internal users).
- 2026-01-31: T050 — Added static guard-wiring test `server/src/test/unit/scheduling/actionGuardWiring.test.ts` asserting `fetchTimePeriods` calls `assertCanActOnBehalf`.
