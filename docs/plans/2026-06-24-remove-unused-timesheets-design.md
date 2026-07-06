# Remove unused timesheets & periods — design

Date: 2026-06-24
Branch: `chore/remove-timesheets`

## Goal

Let users remove unused/unneeded timesheets — and, for managers, the unused pay periods
themselves — directly from the Time Entry period list, when it is safe to do so. "Safe"
means nothing of value is ever destroyed (only empty drafts and periods nobody has logged
against).

Removal is **selection-driven**: row checkboxes + a floating bulk-action bar (mirroring the
tickets screen). There is no per-row delete button.

## Surface

Screen: `TimePeriodList` (rendered by `TimeTracking.tsx`) — a `DataTable` where every row is a
pay **period** showing the current user's timesheet status / hours for it.

The list mixes two objects, so "Remove" resolves per row to a single, possibly composite,
operation `{ deleteTimeSheetId?, deletePeriod }`:

- **Empty draft timesheet** — the user's `DRAFT`/`CHANGES_REQUESTED` timesheet with zero
  entries → delete the timesheet (user-scoped, safe).
- **Unused period** — a period with no timesheets for anyone (⇒ no entries) and not the
  current period → delete the period (tenant-wide; **managers only**).
- **One action clears the row**: removing the user's empty draft on an otherwise-unused
  period deletes the draft *and* the period together, so the row disappears in a single
  action (no two-step). On a *shared* period only the draft is removed (the period stays).

Rows that are submitted/approved, have entries, or (for periods) the current period or other
users' timesheets, expose no removal.

## Changes

1. **Types** — `ITimePeriodWithStatusView` gains `timeSheetId`, `entryCount`, and
   `periodTimesheetCount` (lets a row tell "only my draft" = 1 from "shared" > 1 or "unused" = 0).
2. **`fetchTimePeriods`** (`timeSheetOperations.ts`) — also selects the timesheet `id`, a true
   per-timesheet entry count, and a per-period timesheet count across all users.
3. **`deleteTimeSheets(ids)`** (`timeSheetOperations.ts`) — security boundary for timesheet
   removal: per id, authorize via `assertCanActOnBehalf`, require empty draft, clean up
   comments, delete. Returns `{ deletedIds, failed[] }`.
4. **`deleteTimePeriods(ids)`** (`timePeriodsActions.ts`) — manager-gated (direct `teams`
   manager check), per id re-validates `isEditable` (no timesheets anywhere) and refuses the
   current period, then deletes. Returns `{ deletedIds, failed[] }`.
5. **`TimePeriodList`** — checkbox selection keyed by `period_id`, `getRowRemoval` composite,
   `BulkActionBar`, adaptive confirmation copy. On confirm, deletes timesheets first, then
   periods (so the period is editable by the time it is removed).
6. **`TimeTracking`** — passes `canManagePeriods={isManager}`, wires `onDeleteTimeSheets` /
   `onDeletePeriods` with toasts + reload.

## Authorization

- Timesheet removal: the owner (or valid delegate), mirroring `submitTimeSheet`.
- Period removal: team managers only (period deletion is tenant-wide), enforced in the UI
  (`canManagePeriods`) and re-enforced in `deleteTimePeriods`.

## Out of scope

Deleting non-empty / submitted / approved timesheets; soft-delete/restore; changes to the
REST `/api/v1/time-sheets/[id]` delete endpoint.

## Verification

Static tests in `server/src/test/unit/scheduling/deleteTimeSheetBehavior.test.ts` lock the
safety invariants. Manually smoke-tested in a live dev environment (browser + DB): per-kind
gating, single & bulk removal, the one-action composite (draft + unused period together),
manager gating, and that periods/entries that should be protected are untouched.
