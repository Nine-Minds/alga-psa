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
