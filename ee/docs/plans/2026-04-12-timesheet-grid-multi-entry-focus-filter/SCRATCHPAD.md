# Scratchpad — Timesheet Grid Multi-Entry Focus Filter

- Plan slug: `timesheet-grid-multi-entry-focus-filter`
- Created: `2026-04-12`

## Decisions

- (2026-04-12) For grid cells containing multiple entries, the UI should switch to list view rather than opening a multi-entry dialog.
- (2026-04-12) The list view should enter a temporary focus-filter mode that shows only the exact matching entries from the clicked grid cell.
- (2026-04-12) The filtered-state UI should include `Clear filter` and `Back to grid` actions.
- (2026-04-12) `Clear filter` should keep the user in list view; `Back to grid` should explicitly return them to grid mode.
- (2026-04-12) The time-entry dialog should be simplified to a single-entry editor only.
- (2026-04-12) The dialog should no longer support in-dialog multi-entry navigation, multiple save actions, or in-dialog `Add Entry`.

## Discoveries / Constraints

- (2026-04-12) `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheet.tsx` already owns both `viewMode` and the `selectedCell` dialog-opening flow, which makes it the natural place to own a temporary focus filter.
- (2026-04-12) `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetListView.tsx` already supports clicking a row to open the existing entry editor flow via `onCellClick`.
- (2026-04-12) `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx` currently renders a multi-entry editing experience with per-entry save affordances plus a footer save button, which is the source of the user confusion.
- (2026-04-12) `packages/scheduling/src/components/time-management/time-entry/TimeEntryList.tsx` and `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryEditForm.tsx` currently encode the multi-entry dialog behavior, including per-entry save and in-dialog add-entry controls.
- (2026-04-12) `packages/ui/src/components/ViewSwitcher.tsx` auto-generates `#grid-view-btn` and `#list-view-btn`, so the list-mode switch already has stable automation hooks.

## Browser Validation

- (2026-04-12) Verified with Alga Dev on `http://localhost:3300/msp/time-entry/timesheet/2641bbde-b74b-45ed-bbe2-929b511e2660` that `#list-view-btn` switches successfully into list view.
- (2026-04-12) Verified that `#timesheet-list-view` renders after the switch and that clicking an existing list row opens the current time-entry dialog.
- (2026-04-12) Verified no failed network requests and no browser console errors on the happy-path grid/list navigation; only non-blocking UI reflection unregister warnings were observed after dialog transitions.
- (2026-04-12) Post-implementation browser recheck on `localhost:3300` confirmed the list/grid view switch still works. The pane intermittently re-posted the page during HMR-driven refreshes, so the focused multi-entry cell drill-in could not be fully replayed end-to-end in-browser from that pane after the code change; automated component/contract coverage was added for the new filtered-list path.

## Completed Work

- (2026-04-12) Implemented `F001`-`F018`:
  - Added exact-match multi-entry focus filtering in `TimeSheet.tsx` and `TimeSheetListView.tsx`.
  - Multi-entry grid cell clicks now switch to list view with a visible filter banner instead of opening the dialog directly.
  - Added `Clear filter` and `Back to grid` controls in list view.
  - Simplified `TimeEntryDialog.tsx` to a single-entry editor and removed in-dialog multi-entry/add-entry behavior.
  - Updated timesheet selection plumbing to keep empty-cell create and single-entry edit flows intact.
- (2026-04-12) Added focused automated coverage:
  - `packages/scheduling/tests/timeSheetListView.focusFilter.test.tsx`
  - `packages/scheduling/tests/timeEntryDialog.singleEntry.contract.test.ts`
  - `packages/scheduling/tests/timeSheet.multiEntryFilter.contract.test.ts`
  - Re-ran related contracts/feedback tests for list/table/dialog validation.
- (2026-04-12) Fixed the timesheet render/fetch loop by keeping initial page data on the server side:
  - `server/src/app/msp/time-entry/timesheet/[id]/page.tsx` now preloads entries, work items, and comments via server actions.
  - `TimeSheetClient.tsx` / `TimeSheet.tsx` now consume that initial data instead of issuing mount-time server-action fetches from the client.
  - `TimeSheetTable.tsx` now uses a stable `work_item_id` row key instead of `Math.random()`, removing unnecessary remount churn.
- (2026-04-12) Fixed the follow-up click storm on multi-entry grid cells by removing duplicate UI-reflection container registrations from the timesheet main/list/table surfaces while preserving DOM automation IDs.
  - The old pattern registered `timesheet-main`, `timesheet-table`, and `timesheet-list-view` twice (via both `ReflectionContainer` and `useAutomationIdAndRegister`).
  - After the cleanup, Alga Dev repro on `#timesheet-table > div > table > tbody > tr > td:nth-child(2) > div` switched to filtered list view without the previous `Rendered more hooks than during the previous render` error, and network activity settled after the initial transition.
- (2026-04-12) Broadened the timesheet interaction-state cleanup to avoid further whack-a-mole render loops:
  - `TimeSheet.tsx` now owns a single interaction state for dialog/list-focus/quick-add rather than separate transient grid states.
  - `TimeSheetTable.tsx` no longer mounts hook-heavy quick-add controls on hover; hover shows a lightweight affordance, and the HH:MM editor only appears in an explicit active quick-add state with deterministic per-cell IDs.
  - Hidden confirmation/add-work-item dialogs in the timesheet surfaces are now conditionally rendered only when open, reducing background dialog registration churn.
  - Added focused regression coverage in `packages/scheduling/tests/timeSheetTable.quickAddInteraction.test.ts`.
- (2026-04-12) Fixed the remaining time-entry dialog max-depth loop by stabilizing dialog initialization and removing another unrelated always-mounted generic dialog source:
  - `TimeEntryProvider.tsx` now memoizes `initializeEntries`, `updateEntry`, `setEditingIndex`, `updateTimeInputs`, and the provider value, preventing `TimeEntryDialog.tsx` from re-initializing entries on every provider rerender.
  - This stopped the repeated `Creating new time entry with defaults` loop and removed the reproduced `Maximum update depth exceeded` path when opening the full time-entry dialog from quick-add margin clicks.
  - The generic `dialog-dialog` UI-state registration came from the layout-level AI interrupt `ConfirmationDialog` in `server/src/components/layout/DefaultLayout.tsx`, which was always mounted without an ID; it is now conditionally rendered only when open and uses an explicit ID.
  - After these changes, Alga Dev no longer showed `dialog-dialog`, `Rendered more hooks than during the previous render`, or `Maximum update depth exceeded` during the quick-add → full-dialog repro.
- (2026-04-12) Investigated the remaining low-rate POST noise after the timesheet interaction fixes.
  - The surviving background POSTs are not coming from timesheet grid/list/dialog state anymore.
  - They come from layout-level polling server actions that post back to the current App Router route:
    - `server/src/components/layout/Header.tsx` → `JobActivityIndicator` calls `getQueueMetricsAction()` every 15 seconds.
    - `packages/notifications/src/components/NotificationBell.tsx` → `useInternalNotifications({ enablePolling: true })` falls back to polling `getNotificationsAction()` every 30 seconds when no `NEXT_PUBLIC_HOCUSPOCUS_URL` is configured on localhost.
  - In the local wired env, `server/.env.local` sets `HOCUSPOCUS_URL`, but the notification hook specifically checks `NEXT_PUBLIC_HOCUSPOCUS_URL`, so localhost remains on polling fallback.
  - Observed network cadence matches this: one POST roughly every 15 seconds, with an extra near-simultaneous POST every ~30 seconds.
  - Conclusion: the remaining POSTs are expected background layout activity, not another timesheet-specific render loop.

## Commands / Runbooks

- Inspect timesheet shell: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheet.tsx`
- Inspect grid view: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetTable.tsx`
- Inspect list view: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetListView.tsx`
- Inspect dialog: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx`
- Inspect multi-entry list wrapper: `packages/scheduling/src/components/time-management/time-entry/TimeEntryList.tsx`
- Inspect row editor form: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryEditForm.tsx`
- Inspect generated view switch ids: `packages/ui/src/components/ViewSwitcher.tsx`
- Browser sanity flow:
  - `alga-dev browser-get-dom --paneId=<pane> --query='#list-view-btn' --pretty`
  - `alga-dev browser-click --paneId=<pane> --selector='#list-view-btn'`
  - `alga-dev browser-wait-for --paneId=<pane> --selector='#timesheet-list-view' --state=visible --timeoutMs=10000`
  - `alga-dev browser-click --paneId=<pane> --selector='[data-automation-id^="time-entry-row-"]'`

## Open Questions

- If save/delete empties the filtered result set, final implementation should decide whether to remain in list view unfiltered or to return to grid view; current recommendation is to clear the filter and remain in list view unless user explicitly chooses `Back to grid`.

## Links / References

- Plan folder: `ee/docs/plans/2026-04-12-timesheet-grid-multi-entry-focus-filter/`
- Browser screenshot after row click: `/var/folders/8g/3xyjqdpd4hx2h39h4qb2lyvm0000gn/T/ghostty-pane-ide/screenshots/timesheet-after-row-click.png`
