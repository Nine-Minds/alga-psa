# Scratchpad — Timesheet Entry Change Feedback

- Plan slug: `timesheet-entry-change-feedback`
- Created: `2026-03-14`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-14) Per-entry approval feedback should use a dedicated record/model rather than overloading `time_sheet_comments` or `time_entries.notes`, because the UI needs latest prominent feedback, expandable history, and handled/unhandled state.
- (2026-03-14) The employee-facing editor should show the most recent feedback prominently and expose the full conversation/history in an expandable section.
- (2026-03-14) Entry feedback auto-marks as handled when the employee edits and saves the entry during the `CHANGES_REQUESTED` flow.
- (2026-03-14) List/grid indicators are passive status markers only; they should not introduce a second interaction model.
- (2026-03-14) PRD scope approved by user before feature/test breakdown.
- (2026-03-14) The feedback source of truth should live on each loaded `ITimeEntry` as `change_requests`, `latest_change_request`, and `change_request_state`, so the editor, list view, and grid view can all render from one server-loaded shape instead of parallel client caches.
- (2026-03-14) The grid view should treat any unresolved entry feedback in a cell as higher priority than handled feedback when deciding whether to show `X` or `check`, because the cell aggregates multiple entries into one passive marker.

## Discoveries / Constraints

- (2026-03-14) `TimeSheetApproval.tsx` currently supports per-entry approval status updates but only timesheet-level comments; there is no entry-specific feedback field in the approval drawer.
- (2026-03-14) `TimeSheet.tsx` already renders `TimeSheetComments` for sheet-level discussion when the timesheet is `CHANGES_REQUESTED`, so entry-level feedback must be modeled separately to avoid mixing concerns.
- (2026-03-14) `TimeSheetListView.tsx` and `TimeSheetTable.tsx` currently have no concept of entry-level feedback state beyond `approval_status`.
- (2026-03-14) `TimeEntryDialog.tsx` resets saved entries back to `DRAFT` on edit/save, so handled-state transitions must be coordinated carefully with the approval feedback model.
- (2026-03-14) The scheduling package’s default typecheck is currently blocked by a pre-existing unrelated error in `packages/scheduling/src/components/time-management/time-entry/time-sheet/WorkItemDrawer.tsx` (`ScheduleUpdateData.notes` vs optional `notes`); targeted feedback tests pass independently of that issue.
- (2026-03-14) The approval drawer already imported direct server actions, so keeping entry-level request-changes logic in the drawer component fit the existing architecture better than threading a second callback shape through `ManagerApprovalDashboard`.

## Completed Work

- (2026-03-14) Completed `F001`-`F005`:
  - Added `server/migrations/20260314120000_create_time_entry_change_requests.cjs` for the dedicated feedback store, with tenant/time-sheet/time-entry indexes and Citus distribution.
  - Added `ITimeEntryChangeRequest`, `change_requests`, `latest_change_request`, and `change_request_state` to [`packages/types/src/interfaces/timeEntry.interfaces.ts`](../../../../packages/types/src/interfaces/timeEntry.interfaces.ts).
  - Added `packages/scheduling/src/actions/timeEntryChangeRequestActions.ts` plus shared selectors in `packages/scheduling/src/lib/timeEntryChangeRequests.ts`.
  - Updated `updateTimeEntryApprovalStatus` to accept an optional `changeRequestComment`, require approval permission, persist entry-level feedback separately, and preserve multiple review cycles.

- (2026-03-14) Completed `F006`-`F016`:
  - Added `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryChangeRequestFeedback.tsx` for the inline banner/history and reusable status indicator.
  - Wired the editor (`TimeEntryEditForm.tsx`, `TimeEntryReadOnly.tsx`) to show prominent latest feedback plus expandable history.
  - Wired `fetchTimeEntriesForTimeSheet` to hydrate per-entry feedback for employee views and `saveTimeEntry` to auto-handle only the edited entry during `CHANGES_REQUESTED`.
  - Added list/grid passive markers in `TimeSheetListView.tsx` and `TimeSheetTable.tsx`, keeping existing row/cell interactions unchanged.

- (2026-03-14) Completed `F017`-`F020`:
  - Kept timesheet-level comments in their existing `TimeSheetComments` flow and left entry feedback on a separate data path.
  - Restricted feedback creation to approval-authorized users and feedback reads to existing timesheet access paths.
  - Kept no-feedback employee surfaces quiet by rendering no banner/icon/marker when `change_requests` is empty.

- (2026-03-14) Completed `T001`-`T034` with focused Vitest coverage:
  - `packages/scheduling/tests/timeSheetApproval.test.ts`
  - `packages/scheduling/tests/timeEntryChangeRequests.test.ts`
  - `packages/scheduling/tests/timeEntryChangeRequestFeedback.test.ts`
  - `packages/scheduling/tests/timeSheetListView.feedback.test.ts`
  - `packages/scheduling/tests/timeSheetTable.feedback.test.ts`
  - `packages/scheduling/tests/timeEntryCrud.changeRequests.test.ts`
  - `packages/scheduling/tests/timeEntryChangeRequestActions.test.ts`
  - `packages/scheduling/tests/timeSheetComments.feedback.contract.test.ts`

## Commands / Runbooks

- (2026-03-14) Inspect approval drawer: `packages/scheduling/src/components/time-management/approvals/TimeSheetApproval.tsx`
- (2026-03-14) Inspect employee timesheet shell: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheet.tsx`
- (2026-03-14) Inspect list view: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetListView.tsx`
- (2026-03-14) Inspect grid view: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetTable.tsx`
- (2026-03-14) Inspect entry editor: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx`
- (2026-03-14) Targeted feedback suite: `npm -w packages/scheduling exec vitest run tests/timeSheetApproval.test.ts tests/timeEntryChangeRequests.test.ts tests/timeEntryChangeRequestFeedback.test.ts tests/timeSheetListView.feedback.test.ts tests/timeSheetTable.feedback.test.ts tests/timeEntryCrud.changeRequests.test.ts tests/timeEntryChangeRequestActions.test.ts tests/timeSheetComments.feedback.contract.test.ts`
- (2026-03-14) Scheduling package typecheck (fails due unrelated pre-existing issue): `npm -w packages/scheduling run typecheck`

## Links / References

- Plan folder: `ee/docs/plans/2026-03-14-timesheet-entry-change-feedback/`
- Current approval dashboard entry point: `packages/scheduling/src/components/time-management/approvals/ManagerApprovalDashboard.tsx`
- Types: `packages/types/src/interfaces/timeEntry.interfaces.ts`
- Scheduling actions: `packages/scheduling/src/actions/timeSheetActions.ts`, `packages/scheduling/src/actions/timeEntryCrudActions.ts`
- (2026-03-14) New feedback action helpers: `packages/scheduling/src/actions/timeEntryChangeRequestActions.ts`
- (2026-03-14) New shared feedback selectors: `packages/scheduling/src/lib/timeEntryChangeRequests.ts`
- (2026-03-14) New UI feedback component: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryChangeRequestFeedback.tsx`

## Open Questions

- None currently blocking the plan.
