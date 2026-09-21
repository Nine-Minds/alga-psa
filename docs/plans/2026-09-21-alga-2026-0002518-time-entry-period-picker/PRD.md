# Choose a time period when adding time from a work item

Ticket: **alga-2026-0002518**
Status: draft implemented locally; validation details and limitations in SCRATCHPAD.md
Code baseline: `2dc8454a4ccf4b701ba0b6c1e66c12a6f75f6b04`

## Problem and outcome

An MSP technician adding time from a ticket can currently choose dates only within today's time period. Earlier work requires opening the earlier sheet from Time Entry. The launcher should let the technician choose an existing period, default to the current one, and add time only to an editable sheet belonging to that user.

Periods are configured date ranges, not necessarily seven days. Keep the existing date restrictions inside the chosen period.

## Current behavior and evidence

| Path / symbol | Current behavior and design consequence |
| --- | --- |
| `packages/scheduling/src/lib/timeEntryLauncher.tsx:86–140` | Resolves today's period, fetches or creates its sheet, and passes `isEditable=true`. This is the main change site. |
| `packages/scheduling/src/actions/timePeriodsActions.ts::getCurrentTimePeriod` | Resolves today in the authenticated user's timezone. Reuse it for the default; do not derive a week in the browser. |
| `packages/scheduling/src/actions/timeSheetOperations.ts::fetchTimePeriods` | Lists tenant periods with the requested user's sheet ID and `timeSheetStatus`, including periods without sheets. Reuse for picker data. |
| `packages/scheduling/src/actions/timeSheetOperations.ts::fetchOrCreateTimeSheet` | Resolves a selected user/period pair, creates DRAFT if missing, and returns actual status and period. Call after Continue. |
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryEditForm.tsx:132–138` | Date picker accepts period start through end minus one day. Keep this half-open interval contract. |
| `packages/scheduling/src/actions/timeEntryCrudActions.ts::saveTimeEntry` | Checks owner and both endpoint work dates against the sheet's period; no sheet-status guard appears in the inspected save path. |
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheet.tsx:879` | Editable sheet statuses are DRAFT and CHANGES_REQUESTED. Use the same rule. |
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx` | A fulfilled save callback shows success and closes. Launcher failures must reject to retain the form. |
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryProvider.tsx::initializeEntries` | Explicit time defaults override base date. Selected-period initialization must account for these defaults. |

## User flow and layout

1. From a ticket, choose Add time. Open the existing 900px drawer with the work-item title and a compact **Time period** selection stage using the existing UI components and content width.
2. Load `getCurrentTimePeriod()` and `fetchTimePeriods(user.user_id)`. Preselect the returned current period ID. Options show a localized date range including year and sheet status, newest first. Display the inclusive final day, derived from exclusive `end_date`.
3. Show existing SUBMITTED and APPROVED sheets with their statuses. If selected, explain: “This time sheet is {{status}}. Choose a draft sheet or a sheet with changes requested.” Disable Continue. Treat unknown statuses as noneditable too. Never silently select an earlier sheet when the current one is locked.
4. Continue is enabled only for an editable selection. Resolve that selection with `fetchOrCreateTimeSheet`. Disable repeated submission while loading; inspect the returned status again. If it changed, retain the picker and refresh the status with an explanation.
5. Mount the existing entry dialog with the resolved sheet ID and its returned `time_period`. Show the selected period as context. The date field remains bounded to that period. Save creates the entry on that sheet, then closes and refreshes the caller once.
6. Cancel closes either stage. To choose another period after starting the form, cancel and relaunch. This design intentionally adds a Continue click for current-period entries; it keeps period selection separate from unsaved entry state. Changing a draft's period inside the editor is outside this change.

The picker is a shared launcher feature, so ticket and project-task callers receive the same behavior. Preserve work-item identity, ticket bundle context, project labels, service defaults, and completion callbacks. No ticket-specific fork or new route is needed.

### Empty and error states

- No current period, but catalog contains other periods: open the picker with no selection and “Choose a time period.” Do not block valid historical entry because today is unconfigured.
- Empty catalog: show the existing long-lived, deduplicated blocked-launch feedback with copy about creating time periods under Settings → Time Entry. Update the old “covers today” expectation.
- User, permission, period-list, or sheet-resolution failures: show the returned message; never proceed with a partial or stale selection. Sheet-resolution failure stays in the picker and can be retried.
- Closing while a request is pending must prevent that response from advancing or reopening the drawer. Do not load or create a sheet for every option.

Use labelled controls, keyboard access, unique kebab-case IDs such as `time-entry-period-select` and `time-entry-period-continue`, theme tokens, and localized strings in `msp/time-entry`. Ensure that namespace loads on ticket/project launch surfaces. Modal rendering uses the shared Dialog footer convention; the drawer follows the existing drawer action layout.

## Date and existing-entry rules

For new entries, retain explicit/context/timer timestamps when both endpoint work dates fit the selected period. Otherwise initialize to the selected period's first day, using the existing 08:00–09:00 defaults, and explain that the supplied times were outside the selected period. Do not silently move a timer's recorded timestamps or truncate its duration. The user can enter the actual historical date and duration before saving.

Compute membership with the subject user's timezone and existing date utilities; parse date-only boundaries without UTC-to-local day shifts. Add a small authenticated `getTimeEntryUserTimeZone` action alongside the period actions, delegating to `resolveUserTimeZone(knex, tenant, user.user_id)` just as `getCurrentTimePeriod` does. Load it with the picker data and use the shared timezone/date conversion utilities; do not assume browser timezone equals user timezone. If a default does not fit, clear explicit start/end overrides together so the provider uses the chosen date. Ensure schedule/ad-hoc defaults cannot override this decision back to an out-of-period date. Keep both endpoint validations and the existing same-day duration rule.

For `existingEntryId`, load the entry's existing sheet through `fetchTimeSheet` and use that sheet's period and status. Bypass the new picker. Do not fetch or create today's sheet, move the existing entry between sheets, or require a current period to view an older entry. A missing saved sheet is an actionable error. Existing ownership/delegation and invoice restrictions remain authoritative.

## Implementation by file

1. **`packages/scheduling/src/lib/timeEntryLauncher.tsx`**: retain authenticated-user/work-item setup; split new-entry period selection from existing-entry resolution. Open a stateful launcher component. Remove current-period coupling from existing edits. Make its save callback reject action-error results and exceptions; leave success toast/close in the dialog and invoke caller completion exactly once on persistence success.
2. **New `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryPeriodLauncher.tsx`**: own loading, selection, Continue, cancellation, sheet resolution, status checks, and final dialog mounting. Reuse `fetchTimePeriods`, `getCurrentTimePeriod`, and `fetchOrCreateTimeSheet`. Keep immutable resolved sheet/period together. Normalize defaults before mounting the provider. Avoid a new general picker framework.
3. **`TimeEntryDialog.tsx`**: only a small optional selected-period context display if the wrapper cannot place it coherently. Preserve its error-catching save contract and fixed-sheet consumers. `TimeEntryEditForm.tsx` date bounds should need no behavioral change.
4. **`packages/scheduling/src/actions/timeEntryCrudActions.ts`**: inside the existing save transaction, read and lock the tenant-scoped target sheet and reject mutations unless its status is DRAFT or CHANGES_REQUESTED, before entry or billing/bucket writes. For updates, also guard the original attached sheet so supplying another sheet cannot bypass a locked original. Preserve permission, delegation, invoiced-entry, owner, and period checks. This is a shared save-path guard, not a launcher-only trust check.
5. **`packages/scheduling/src/actions/timeSheetActionErrors.ts`** and **`server/public/locales/*/msp/time-entry.json`**: map locked-sheet failures to actionable localized feedback and add picker copy using repository locale conventions.
6. **Tests**: adapt existing launcher suites in `packages/scheduling/tests/`, add rendered picker behavior coverage, and add a DB-backed integration suite under `server/src/test/integration/`. Reuse existing date-boundary tests under `server/src/test/unit/timeEntryEditFormDateField.test.tsx`.

No new table, migration, REST endpoint, or period-generation change is needed. Reuse the existing period/sheet actions and add only the authenticated timezone accessor described above in `timePeriodsActions.ts`. Keep `fetchOrCreateTimeSheet` usable for other consumers that can read locked sheets; enforce editability in the launcher and save action.

## Acceptance and validation

- Current period defaults correctly; prior DRAFT and CHANGES_REQUESTED periods are selectable and accept persisted ticket time.
- A prior period without a sheet creates only its selected sheet on Continue; browsing creates none.
- Locked periods remain visible and cannot open an editable form; status changes after selection are rejected on save without success feedback or loss of entered values.
- Date picker and server agree on `[start_date, end_date)` for nonweekly periods and timezone boundaries. No entry is initialized outside its chosen period.
- Existing entries retain their saved sheet and period, including historical entries when no period covers today.
- Save failure retains the form; success closes and refreshes once. Ticket and project context remain intact.
- Run the focused launcher/component suites, DB-backed happy-path and guard cases, scheduling typecheck, and translation validation. Manually verify the ticket flow at `/msp/tickets`, then confirm the saved entry on `/msp/time-entry/timesheet/[id]`, including light/dark themes and keyboard selection. Tests are specified in `tests.json`; none are claimed as executed during design.

## Scope boundaries

No reopening/submission/approval workflow, editing another user's sheet picker, arbitrary date outside a period, automatic historical-period creation, moving saved entries between sheets, timer splitting, billing recalculation policy change, Time Entry page redesign, period-catalog pagination project, REST time-entry overhaul, telemetry, or feature flag. Existing API paths outside `saveTimeEntry` are not redesigned here.

## Risks and rollout

- The shared launcher reaches more than tickets. Representative project/timer and existing-entry tests are required.
- Status enforcement closes an existing save-action gap and may expose callers that wrongly save to submitted sheets. Check affected tests and fix callers; do not weaken the rule to preserve that behavior.
- Row locking in save serializes writes with sheet status updates, but submission also updates entry statuses. Review its lock ordering during implementation and exercise stale-status behavior; avoid introducing an inconsistent lock order or claiming that an untested concurrent submission is safe.
- User timezone and browser timezone can differ. Current-period selection uses the server's user timezone; defaults must be evaluated consistently.
- `fetchTimePeriods` computes summaries the picker does not need. Reuse the existing query initially; a dedicated lightweight catalog is a separate measured optimization.
- Cancel after Continue can leave an empty DRAFT sheet, as today's launcher already can. Do not add automatic deletion.
- The worktree filesystem recently returned ENOSPC. Check space before installation/build work; no host storage changes are part of this feature.

Deploy through the normal application release after implementation and validation. No data backfill or migration is planned. Product decisions are recorded above; there are no blocking product questions for this implementation plan.
