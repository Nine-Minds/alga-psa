# PRD — Bulk move tickets to a new board

- Slug: `bulk-move-tickets-to-new-board`
- Date: `2026-03-15`
- Status: Draft

## Summary

Add a new bulk action on the MSP ticket dashboard that lets a user move multiple selected tickets to a destination board. The bulk move flow must use the board-scoped ticket status model from `feature/board-specific-statuses`, preselect the destination board's default status, allow an optional valid status override, clear category and subcategory on move, and report partial success the same way bulk delete does today.

## Problem

The ticket dashboard already supports bulk selection and bulk delete, but it does not support bulk moving tickets between boards. Users who need to re-route many tickets must open tickets individually, change the board one at a time, reselect a valid status, and manually clear any board-specific category state. That is slow and error-prone, especially now that ticket statuses are scoped to boards.

## Goals

- Let users move multiple selected tickets from the ticket dashboard in one action.
- Require the destination status to be valid for the selected destination board.
- Preselect the destination board's default status while still allowing the user to choose a different valid destination status.
- Clear `category_id` and `subcategory_id` when a ticket moves to a different board, matching single-ticket board-change behavior.
- Match bulk delete's partial-success model so one invalid ticket does not block the rest of the batch.

## Non-goals

- Changing how ticket selection works on the dashboard beyond reusing the existing selected-ticket behavior.
- Adding a new generic bulk ticket action framework.
- Changing the single-ticket move flow outside of whatever shared validation this feature reuses.
- Updating unrelated ticket fields such as assignee, priority, SLA, or tags during the move.
- Adding feature flags, new telemetry pipelines, or rollout controls for this feature.

## Users and Primary Flows

- Dispatcher / technician / coordinator with permission to update tickets:
  Select multiple tickets from the ticket dashboard, click `Move to Board`, choose a destination board, review the preselected default status, optionally choose another valid status for that board, and confirm the move.
- Dispatcher / technician / coordinator handling mixed results:
  Submit a bulk move, see some tickets succeed and some fail, review per-ticket failure messages in the dialog, and keep the failed tickets selected for a retry or follow-up.

## UX / UI Notes

- The new bulk action lives in the same header action area in `packages/tickets/src/components/TicketingDashboard.tsx` that currently shows `Delete Selected` and `Bundle Tickets`.
- The action is available only when at least one ticket is selected and the user can update tickets.
- The dialog should follow the same visual pattern as the existing bulk delete dialog:
  selected ticket summary, confirm/cancel footer, inline error alert for partial failures.
- The dialog contains:
  - A destination board picker.
  - A status picker filtered to statuses valid for the chosen board.
  - Selected ticket summary list.
- When the destination board changes:
  - Reload valid statuses for that board.
  - Preselect that board's default status.
  - Disable confirmation if no valid statuses exist for that board.
- The user may override the preselected status, but only with another status valid for the chosen board.
- Existing page-selection semantics stay unchanged. This feature acts on the tickets currently selected by the dashboard.

## Requirements

### Functional Requirements

- The ticket dashboard must expose a `Move to Board` bulk action when one or more tickets are selected and the user has update permission.
- Invoking the action must open a confirmation dialog that lists the selected tickets and asks for a destination board.
- After a destination board is selected, the dialog must show only statuses valid for that board.
- The dialog must automatically preselect the destination board's default ticket status.
- The user may optionally change the status to another valid status for the selected destination board before confirming.
- The dialog must not allow confirmation when no destination board is selected, when no valid destination status exists, or while the move is actively processing.
- Confirming the move must process tickets individually, not all-or-nothing.
- For each successful move, the system must update:
  - `board_id` to the chosen destination board.
  - `status_id` to the chosen or default destination status.
  - `category_id` to `null`.
  - `subcategory_id` to `null`.
- The server-side move path must enforce ticket update permissions and validate that the chosen status belongs to the chosen destination board.
- When some tickets fail and others succeed, the response must include both moved ticket ids and per-ticket failures so the UI can mirror bulk delete behavior.
- On full success, the dialog must close and clear the current selection.
- On partial success, the dialog must remain open, show per-ticket failures, and keep only failed tickets selected.
- After successful moves, the dashboard must refresh or update so tickets no longer matching the current filters disappear from the visible list.

### Non-functional Requirements

- The implementation should reuse existing ticket update semantics where practical, especially around board/status validation introduced by the merged board-specific status work.
- The bulk move action should keep error messaging specific enough for users to identify which tickets failed and why.
- The implementation should avoid introducing a separate divergent validation path for board-scoped ticket statuses if shared validation already exists in the merged branch.

## Data / API / Integrations

- The feature will operate on the existing ticket records using `board_id`, `status_id`, `category_id`, and `subcategory_id`.
- The feature depends on the board-scoped status data model merged from `feature/board-specific-statuses`, including destination-board status lookup and default-status resolution.
- The most likely implementation path is a new server action in the tickets package that returns a result shaped similarly to bulk delete, for example:
  - `movedIds: string[]`
  - `failed: Array<{ ticketId: string; message: string }>`
- The UI will continue to use server actions rather than introducing a new dedicated REST bulk route unless implementation work reveals a strong reason to do so.

## Security / Permissions

- The bulk action must only be available to users who can update tickets.
- Server-side permission checks remain authoritative. A hidden or disabled client control is not sufficient.
- If a user lacks permission for one or more tickets at execution time, those tickets must fail individually and be reported through partial-success results.

## Observability

- No new custom observability work is in scope for this feature.
- Existing toast notifications, inline dialog error reporting, and test coverage are sufficient for the planned change.

## Rollout / Migration

- This feature depends on the merged `feature/board-specific-statuses` branch and assumes that board-owned ticket status validation is already part of the branch baseline.
- No additional user-facing rollout controls or data migrations are required specifically for the bulk move feature.

## Open Questions

- None currently. Current scope assumptions are:
  - Bulk move reuses the dashboard's existing selected-ticket model.
  - Partial success should match bulk delete behavior.
  - Category and subcategory must be cleared on move.

## Acceptance Criteria (Definition of Done)

- A user with ticket update permission can select multiple tickets in the dashboard and see a `Move to Board` bulk action.
- Opening the action shows a dialog with the selected tickets, a destination board picker, and a status picker limited to statuses valid for the chosen board.
- Selecting a destination board automatically preselects that board's default status.
- The user can optionally choose another valid status for that board before confirming.
- Confirming the action moves each ticket individually, updates the board and status, clears category and subcategory, and preserves partial-success reporting.
- When some tickets fail, successful tickets are moved, failed tickets remain selected, and the dialog shows per-ticket failure details.
- When all tickets succeed, the selection is cleared and the dashboard reflects the moved state.
- Automated coverage includes DB-backed integration tests for server-side move behavior and UI coverage for the dialog and partial-success flow.
