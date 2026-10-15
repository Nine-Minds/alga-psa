# Add time from a work item on the day the work happened

Ticket: **alga-2026-0002518**
Status: date-first revision implemented locally (2026-09-28), replacing the original period-picker stage; validation details and limitations in SCRATCHPAD.md
Code baseline: `2dc8454a4ccf4b701ba0b6c1e66c12a6f75f6b04`

## Problem and outcome

An MSP technician adding time from a ticket can currently choose dates only within today's time period. Earlier work requires opening the earlier sheet from Time Entry. The launcher should let the technician pick the actual date of the work, file it on that day's sheet, and add time only to an editable sheet belonging to that user.

Periods are configured date ranges, not necessarily seven days. The period is a consequence of the date, not a separate choice.

## Current behavior and evidence

| Path / symbol | Current behavior and design consequence |
| --- | --- |
| `packages/scheduling/src/lib/timeEntryLauncher.tsx:86–140` | Resolves today's period, fetches or creates its sheet, and passes `isEditable=true`. This is the main change site. |
| `packages/scheduling/src/actions/timePeriodsActions.ts::getCurrentTimePeriod` | Resolves today in the authenticated user's timezone. Reuse it for the default; do not derive a week in the browser. |
| `packages/scheduling/src/actions/timeSheetOperations.ts::fetchTimePeriods` | Lists tenant periods with the requested user's sheet ID and `timeSheetStatus`, including periods without sheets. Reuse for the date field's catalog. |
| `packages/scheduling/src/actions/timeSheetOperations.ts::fetchOrCreateTimeSheet` | Resolves a selected user/period pair, creates DRAFT if missing, and returns actual status and period. Call at Save for the entry's work date. |
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryEditForm.tsx:132–138` | Date picker accepts period start through end minus one day. Keep this half-open interval contract. |
| `packages/scheduling/src/actions/timeEntryCrudActions.ts::saveTimeEntry` | Checks owner and both endpoint work dates against the sheet's period; no sheet-status guard appears in the inspected save path. |
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheet.tsx:879` | Editable sheet statuses are DRAFT and CHANGES_REQUESTED. Use the same rule. |
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx` | A fulfilled save callback shows success and closes. Launcher failures must reject to retain the form. |
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryProvider.tsx::initializeEntries` | Explicit time defaults override base date. Selected-period initialization must account for these defaults. |

## User flow and layout

**Revision 2026-09-28 (captain review):** the first build asked for a period in a separate picker stage before the form. That made every entry pay an extra step for a rare need, forced Cancel-and-relaunch to change week, rebased timer times off the chosen period, and created an empty sheet on Continue. The period is fully determined by the date, so the stage was removed.

1. From a ticket, choose Add time. The existing 900px drawer opens straight on the entry form. The launcher loads `fetchTimePeriods(user.user_id)` (periods with this user's sheet status; missing sheets read as DRAFT) and the subject timezone.
2. The Date field spans every editable period: its range runs from the first to the last day on a DRAFT or CHANGES_REQUESTED sheet, and a per-day rule disables days on SUBMITTED/APPROVED/unknown sheets and days no period covers. Clicks, typed dates, and the Today shortcut all respect the rule (a typed ruled-out day is kept out with “That day can’t be chosen — kept …”). This needed a small engine change: `DatePicker`/`DateTimeField` gained `isDateDisabled`.
3. Under the date, a line names the sheet the chosen day lands on: “Time sheet: {{range}} · {{status}}”. It follows every date change.
4. Defaults: supplied context/timer times are kept when both endpoints fall on the same editable period; otherwise the entry starts at 08:00–09:00 (subject timezone) today, or on the nearest editable day when today cannot take time (latest editable day before today, else earliest after). When the default moves, a notice above the form says why (today's sheet is {{status}} / no period covers today / the timer's times fall on a day that can't take time).
5. Save resolves the sheet from the entry's work date (subject timezone, same as the server's `work_date`), fetching or creating it only then, rechecks its status, and saves against it. A rejection (locked sheet, no period, server lock) keeps the drawer and typed values and shows its own reason; unexpected failures keep the generic copy. The server's transactional status guard remains the final authority.
6. Opening and cancelling the form creates nothing. Changing week is just changing the date.

The launcher is shared, so ticket, project-task and interaction callers receive the same behavior. Preserve work-item identity, ticket bundle context, project labels, service defaults, and completion callbacks.

### Empty and error states

- No period covers today, or today's sheet is locked, but another day is editable: open the form on the nearest editable day with an explanatory notice.
- Empty catalog: the existing long-lived, deduplicated blocked-launch toast with copy about creating time periods under Settings → Time Entry.
- Periods exist but none accept time: a blocked-launch toast explaining that every sheet is submitted or approved and who can fix it.
- User, permission, or period-list failures: show the returned message; do not open the form.

Localized strings live in `msp/time-entry` under `workItemEntry.*` and `launch.*`; IDs stay kebab-case (`time-entry-dialog-sheet-hint`, `time-entry-dialog-notice`).

## Date and existing-entry rules

For new entries, retain explicit/context/timer timestamps when both endpoint work dates fit the selected period. Otherwise initialize to the selected period's first day, using the existing 08:00–09:00 defaults, and explain that the supplied times were outside the selected period. Do not silently move a timer's recorded timestamps or truncate its duration. The user can enter the actual historical date and duration before saving.

Compute membership with the subject user's timezone and existing date utilities; parse date-only boundaries without UTC-to-local day shifts. Add a small authenticated `getTimeEntryUserTimeZone` action alongside the period actions, delegating to `resolveUserTimeZone(knex, tenant, user.user_id)` just as `getCurrentTimePeriod` does. Load it with the period catalog and use the shared timezone/date conversion utilities; do not assume browser timezone equals user timezone. If supplied times do not fit one editable period, replace both endpoints together with an 08:00 default on the nearest editable day. Ensure schedule/ad-hoc defaults cannot override this decision back onto a locked or uncovered day. Keep both endpoint validations and the existing same-day duration rule.

For `existingEntryId`, load the entry's existing sheet through `fetchTimeSheet` and use that sheet's period and status. Bypass the catalog-wide date field. Do not fetch or create today's sheet, move the existing entry between sheets, or require a current period to view an older entry. A missing saved sheet is an actionable error. Existing ownership/delegation and invoice restrictions remain authoritative.

## Implementation by file

1. **`packages/scheduling/src/lib/timeEntryLauncher.tsx`**: retain authenticated-user/work-item setup; split new-entry period selection from existing-entry resolution. Open a stateful launcher component. Remove current-period coupling from existing edits. Make its save callback reject action-error results and exceptions; leave success toast/close in the dialog and invoke caller completion exactly once on persistence success.
2. **New `packages/scheduling/src/components/time-management/time-entry/time-sheet/NewWorkItemTimeEntry.tsx`** (replaces the first build's `TimeEntryPeriodLauncher.tsx`): mounts the entry dialog against the whole period catalog with resolved defaults and any moved-default notice; its save handler resolves the sheet from the work date via `createCatalogSheetResolver` in `lib/timeEntrySaveAdapter.ts`. Catalog helpers (`periodForWorkDate`, `isEditableWorkDate`, `editableDateRange`, `nearestEditableWorkDate`, `resolveEntryDefaults`) live in `lib/timeEntryPeriodSelection.ts`. The shared `DatePicker`/`DateTimeField` gained `isDateDisabled`; `TimeEntryEditForm` uses it plus a sheet line when given `periodCatalog`.
3. **`TimeEntryDialog.tsx`**: only a small optional selected-period context display if the wrapper cannot place it coherently. Preserve its error-catching save contract and fixed-sheet consumers. `TimeEntryEditForm.tsx` date bounds should need no behavioral change.
4. **`packages/scheduling/src/actions/timeEntryCrudActions.ts`**: inside the existing save transaction, read and lock the tenant-scoped target sheet and reject mutations unless its status is DRAFT or CHANGES_REQUESTED, before entry or billing/bucket writes. For updates, also guard the original attached sheet so supplying another sheet cannot bypass a locked original. Preserve permission, delegation, invoiced-entry, owner, and period checks. This is a shared save-path guard, not a launcher-only trust check.
5. **`packages/scheduling/src/actions/timeSheetActionErrors.ts`** and **`server/public/locales/*/msp/time-entry.json`**: map locked-sheet failures to actionable localized feedback and add date-first entry copy (`workItemEntry.*`, `launch.noEditablePeriods`) using repository locale conventions.
6. **Tests**: adapt existing launcher suites in `packages/scheduling/tests/`, add rendered new-entry coverage (`newWorkItemTimeEntry.test.tsx`), shared date-field rule coverage, and add a DB-backed integration suite under `server/src/test/integration/`. Reuse existing date-boundary tests under `server/src/test/unit/timeEntryEditFormDateField.test.tsx`.

No new table, migration, REST endpoint, or period-generation change is needed. Reuse the existing period/sheet actions and add only the authenticated timezone accessor described above in `timePeriodsActions.ts`. Keep `fetchOrCreateTimeSheet` usable for other consumers that can read locked sheets; enforce editability in the launcher and save action.

## Acceptance and validation

- Current period defaults correctly; prior DRAFT and CHANGES_REQUESTED periods are selectable and accept persisted ticket time.
- A prior period without a sheet gets its sheet created only when an entry is saved on one of its days; opening, browsing and cancelling create none.
- Locked periods remain visible and cannot open an editable form; status changes after selection are rejected on save without success feedback or loss of entered values.
- Date picker and server agree on `[start_date, end_date)` for nonweekly periods and timezone boundaries. No entry is initialized on a locked or uncovered day.
- Existing entries retain their saved sheet and period, including historical entries when no period covers today.
- Save failure retains the form; success closes and refreshes once. Ticket and project context remain intact.
- Run the focused launcher/component suites, DB-backed happy-path and guard cases, scheduling typecheck, and translation validation. Manually verify the ticket flow at `/msp/tickets`, then confirm the saved entry on `/msp/time-entry/timesheet/[id]`, including light/dark themes and keyboard selection. Tests are specified in `tests.json`; none are claimed as executed during design.

## Scope boundaries

No reopening/submission/approval workflow, editing another user's sheets from this launcher, arbitrary date outside a period, automatic historical-period creation, moving saved entries between sheets, timer splitting, billing recalculation policy change, Time Entry page redesign, period-catalog pagination project, REST time-entry overhaul, telemetry, or feature flag. Existing API paths outside `saveTimeEntry` are not redesigned here.

## Risks and rollout

- The shared launcher reaches more than tickets. Representative project/timer and existing-entry tests are required.
- Status enforcement closes an existing save-action gap and may expose callers that wrongly save to submitted sheets. Check affected tests and fix callers; do not weaken the rule to preserve that behavior.
- Row locking in save serializes writes with sheet status updates, but submission also updates entry statuses. Review its lock ordering during implementation and exercise stale-status behavior; avoid introducing an inconsistent lock order or claiming that an untested concurrent submission is safe.
- User timezone and browser timezone can differ. Current-period selection uses the server's user timezone; defaults must be evaluated consistently.
- `fetchTimePeriods` computes summaries the date field does not need. Reuse the existing query initially; a dedicated lightweight catalog is a separate measured optimization.
- A save that the server rejects after the sheet was created can leave an empty DRAFT sheet. Do not add automatic deletion.
- The worktree filesystem recently returned ENOSPC. Check space before installation/build work; no host storage changes are part of this feature.

Deploy through the normal application release after implementation and validation. No data backfill or migration is planned. Product decisions are recorded above; there are no blocking product questions for this implementation plan.
