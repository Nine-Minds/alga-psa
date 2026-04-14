# PRD — Timesheet Grid Multi-Entry Focus Filter

- Slug: `timesheet-grid-multi-entry-focus-filter`
- Date: `2026-04-12`
- Status: Draft

## Summary
When a user clicks a timesheet grid cell that represents multiple time entries, do not open a multi-entry editor dialog. Instead, switch to list view, temporarily filter the list to the exact entries from that grid cell, and let the user pick a single entry to edit using the existing single-entry editing screen. Simplify the time-entry dialog so it always edits exactly one entry and no longer supports multi-entry editing or in-dialog entry creation.

## Problem
The current timesheet entry flow allows a grid cell with multiple entries to open a dialog that contains:

- a list of entries inside the dialog
- per-entry save behavior
- a second footer save button
- an in-dialog `Add Entry` path

This creates an unclear editing model. Users do not know whether they are editing one entry or several, whether they should click the row-level save or the footer save, or what the footer save actually commits.

The core product problem is not that users need a stronger batch editor. It is that the grid compresses multiple entries into a single cell, and the UI does not give them a clear disambiguation step before editing.

## Goals
- Remove the confusing multi-entry editing experience from the time-entry dialog.
- Reuse the existing timesheet list view as the disambiguation surface for grid cells containing multiple entries.
- Let a grid click on a multi-entry cell land the user on a focused list containing only the exact matching entries.
- Provide a visible filtered-state UI so users understand why only a subset of entries is shown.
- Keep the time-entry dialog as a single-entry editor with one clear save action.

## Non-goals
- Redesign the overall timesheet grid or list layouts.
- Introduce batch edit or bulk-save behavior for multiple entries.
- Add inline editing to the list view.
- Change approval, billing, or time-entry permission rules.
- Add analytics, observability, or rollout-flag scope beyond this UX change.

## Users and Primary Flows
Primary users:

- Employees editing their own time sheets
- Delegated editors editing an authorized subject user’s time sheet

Primary flows:

1. User views a timesheet in grid mode.
2. User clicks an empty cell and creates a single new entry as they do today.
3. User clicks a cell with exactly one entry and edits that entry directly as they do today.
4. User clicks a cell with multiple entries.
5. The UI switches to list view and shows only the entries from that exact work item/date cell.
6. A banner explains that the list is filtered and offers `Clear filter` and `Back to grid`.
7. User clicks one filtered list row.
8. The existing time-entry dialog opens for that single entry only.
9. User saves or deletes the entry and returns to the focused list context.
10. User can clear the filter to stay in list view or explicitly return to the grid.

## UX / UI Notes
### Grid behavior
- Empty grid cell: preserve current create-entry behavior.
- Single-entry grid cell: preserve current direct-open edit behavior.
- Multi-entry grid cell: do not open the dialog directly; switch to list view with a temporary focus filter.

### List view filtered mode
- When a multi-entry grid cell is clicked, list view should show only the entries that belong to:
  - the clicked work item
  - the clicked date
  - the clicked entry ids
- All unrelated day groups and unrelated rows should be hidden entirely.
- The relevant day section should be expanded automatically.
- Existing row click behavior should remain unchanged: clicking a row opens the single-entry editor dialog.

### Filter banner
- Show a prominent, dismissible filtered-state banner above the list.
- The banner should describe what is being shown, for example:
  - `Showing 3 entries for Missing White Rabbit on Apr 12`
- The banner should provide:
  - `Clear filter` — removes the filter and keeps the user in list view
  - `Back to grid` — clears the filter and returns the user to grid view

### Dialog behavior
- The time-entry dialog should always represent exactly one entry.
- The dialog should no longer render:
  - an internal list of entries
  - per-entry save actions
  - a second dialog-level save competing with row-level save
  - an in-dialog `Add Entry` action
- Existing-entry editing should still support delete when permitted.
- New-entry creation should still be supported, but only for one entry at a time.

## Requirements

### Functional Requirements
1. Clicking a grid cell with multiple entries must switch the timesheet to list view instead of opening the multi-entry dialog.
2. The list view must support a temporary focus filter that narrows visible rows to the exact entries represented by the clicked grid cell.
3. The filtered list view must hide unrelated entries and unrelated day groups entirely.
4. The filtered list must display a visible banner describing the active filter state.
5. The filtered-state banner must include a `Clear filter` action that removes the filter while leaving the user in list view.
6. The filtered-state banner must include a `Back to grid` action that clears the filter and returns the user to grid view.
7. Clicking a row in the filtered list must open the existing time-entry editor for that single entry.
8. Empty-cell and single-entry grid interactions must continue to behave as they do today.
9. Manual switching to grid view while a focus filter is active must clear the filter.
10. The time-entry dialog must be refactored to edit exactly one entry at a time.
11. The time-entry dialog must no longer expose multiple save actions for multiple entries.
12. The time-entry dialog must no longer allow creating additional entries from inside the dialog.
13. Saving or deleting a single entry from filtered mode must return the user to a coherent list state.
14. If a filtered entry set becomes empty after edit/delete, the UI must clear the filter and leave the user in an understandable destination state.

### Non-functional Requirements
- The new flow must reuse the existing list-view and dialog interaction model wherever possible.
- Filter state should be owned in one place so grid/list/dialog transitions remain predictable.
- The UI must make the filtered state obvious enough that users do not mistake it for missing data.
- Existing timesheet edit permissions and delegated-edit rules must remain unchanged.

## Data / API / Integrations
- No new backend API or schema changes are expected.
- This should be a client-side orchestration change using data already loaded into the timesheet screen.
- Recommended state ownership:
  - `TimeSheet.tsx` owns `viewMode` and the new temporary focus filter state.
  - `TimeSheetTable.tsx` emits enough click context to distinguish empty, single-entry, and multi-entry cells.
  - `TimeSheetListView.tsx` accepts an optional focus filter and renders the filtered-state UI.
  - `TimeEntryDialog.tsx` is simplified to a single-entry form surface.

Approach options considered:

1. Switch to list view with a temporary focus filter and clear banner.
   - Recommended because it reuses the current list row → dialog flow and removes the ambiguous multi-entry dialog path.
2. Switch to list view with highlighted matching rows but still show the full day list.
   - Better than today, but still leaves extra visual noise and ambiguity.
3. Keep the dialog hybrid and rename buttons (`Save This Entry`, `Save All Changes`).
   - Lowest code churn, but preserves the confusing “one dialog, many editing models” problem.

## Security / Permissions
- Existing editability rules for timesheets and time entries remain the source of truth.
- Delegated editing behavior must remain unchanged.
- The filtered list view must not surface actions the user could not already take in the unfiltered list or single-entry dialog.

## Rollout / Migration
- No data migration required.
- Existing timesheets should continue to work with current data.
- The main risk is UI regression around grid/list/dialog transitions, not stored data.

## Open Questions
- After save/delete within filtered mode, the intended default is to keep the user in list context unless the filtered set is empty.
- If implementation reveals other callers depend on multi-entry `TimeEntryDialog` behavior, they should be migrated to single-entry flows rather than preserving hybrid dialog support.

## Acceptance Criteria (Definition of Done)
- Clicking a multi-entry grid cell switches to list view and shows only the entries from that exact cell.
- The filtered list shows a visible banner with `Clear filter` and `Back to grid` actions.
- `Clear filter` returns the user to the full list while staying in list view.
- `Back to grid` clears the filter and returns the user to grid view.
- Clicking a filtered row opens a single-entry editor dialog.
- The time-entry dialog contains only one save action for one entry.
- The time-entry dialog no longer supports editing multiple entries at once.
- The time-entry dialog no longer offers in-dialog `Add Entry` behavior.
- Empty-cell and single-entry grid interactions still behave correctly.
- Browser navigation from grid → filtered list → single-entry dialog works without console errors or failed requests in the normal happy path.
