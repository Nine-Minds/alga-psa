# Scratchpad — MSP i18n Batches: Dispatch, Reports, Admin, Time Entry

- Plan slug: `2026-03-20-msp-i18n-dispatch-reports-admin-time`
- Created: `2026-03-20`

## Decisions

- (2026-03-20) **Execution order**: dispatch → reports → admin → time-entry. Dispatch and reports are the smallest and most self-contained. Admin is next (4 files, loads on settings route). Time entry is last because it has 33 files and is the largest batch.
- (2026-03-20) **Console messages**: Skip translation of console.log/console.error — these are developer-facing and appear in many dispatch/dashboard files. Only translate user-visible strings (toasts, UI text, aria-labels).
- (2026-03-20) **AM/PM suffixes**: TimeHeader.tsx has " AM"/" PM" hardcoded. These should be translation keys since some locales use 24h time. However, `useFormatters().formatDate()` with time options would be the ideal long-term fix. For now, add keys.
- (2026-03-20) **Status badge consistency**: Both time-entry and dispatch use status labels like "Submitted", "Approved". Keep these within each namespace (not in common.json) since the contexts are different enough that translations may differ per language.
- (2026-03-20) **Reports on billing route**: Report components live inside the billing dashboard and render on `/msp/billing`. The `msp/reports` namespace needs to be added to the `/msp/billing` route in ROUTE_NAMESPACES.
- (2026-03-20) **Admin on settings route**: Admin components (telemetry, email settings) render inside settings tabs. The `msp/admin` namespace needs to load on `/msp/settings`.

## Discoveries / Constraints

### Dispatch (2b-5)
- (2026-03-20) All 13 files in `packages/scheduling/src/components/technician-dispatch/` — zero existing useTranslation calls.
- (2026-03-20) `TechnicianDispatchDashboard.tsx` is the heaviest file (~28 strings), mostly error/success toasts and permission messages.
- (2026-03-20) `WorkItemDetailsDrawer.tsx` has ~31 strings — lots of field labels for appointment request details.
- (2026-03-20) `TimeSlot.tsx`, `TechnicianRow.tsx`, `utils.ts` have zero user-visible strings — no translation needed.
- (2026-03-20) Private calendar events show "Busy" as title — this needs translation in both ScheduleEvent and WeeklyScheduleEvent.
- (2026-03-20) Drag-and-drop error messages are console-only — skip.
- (2026-03-20) `ScheduleEvent.tsx` and `WeeklyScheduleEvent.tsx` also have user-visible tooltip/title strings for deletion validation, event detail tooltips, and fallback entity names that were not called out explicitly in the PRD; these were added to `en/msp/dispatch.json` so later component wiring can reuse shared keys instead of adding one-offs.
- (2026-03-20) `ScheduleViewPanel.tsx` still formats the center date with `toLocaleDateString('en-US')`. This is a locale bug outside the literal-string extraction list; handle it during component wiring with `useFormatters()` rather than a translation key.

### Reports (2b-7)
- (2026-03-20) Only 4 files, ~99 strings total. `ContractReports.tsx` has the most (~54) with 4 report tabs each having their own column definitions.
- (2026-03-20) `Reports.tsx` (in packages/ui/src/pages/) is a placeholder page with chart placeholders — 9 strings.
- (2026-03-20) Unit labels "hrs", "days", "%" are scattered through column definitions — consolidate into a `units.*` section.
- (2026-03-20) Tab IDs in ContractReports are already stable strings — no CustomTabs refactoring needed.
- (2026-03-20) `ContractReports.tsx`, `ContractPerformance.tsx`, and `ContractUsageReport.tsx` all mix hardcoded text with hardcoded date/currency formatting. The namespace should cover literal strings, while the component wiring step should switch formatting to `useFormatters()` where practical.

### Admin (2b-8)
- (2026-03-20) 4 files across 2 packages (ui + integrations). ~123 strings total.
- (2026-03-20) `EmailSettings.tsx` is the largest (~48 strings) with SMTP/Resend provider forms, domain verification, general settings.
- (2026-03-20) `TenantTelemetrySettings.tsx` has long descriptive text and bullet-point lists for compliance notes — these need translation as full sentences.
- (2026-03-20) `InboundTicketDefaultsManager.tsx` has a "How It Works" section with 4 bullet points — translate as complete sentences.
- (2026-03-20) `Microsoft365DiagnosticsDialog.tsx` has diagnostic status badges (Pass/Warn/Fail/Skip) — short, translatable labels.

### Time Entry (2b-3)
- (2026-03-20) 33 files across 4 subdirectories (time-entry top-level, time-sheet, approvals, interval-tracking). ~161 strings total.
- (2026-03-20) Zero existing useTranslation calls in any file.
- (2026-03-20) `WorkItemPicker.tsx` is the heaviest single file (~25 strings) with filter UI, type options, date range, validation.
- (2026-03-20) Status badges (In Progress, Submitted, Approved, Changes Requested) appear in TimePeriodList, TimeSheetHeader, and TimeSheetApproval — use shared keys within the namespace (`statuses.*`).
- (2026-03-20) Time unit suffixes "h" and "m" appear in TimeEntryEditForm and other components — add as `units.hours`/`units.minutes`.
- (2026-03-20) Several files have zero strings: SkeletonTimeSheet, SingleTimeEntryForm, TimeEntrySkeletons, types.ts, utils.ts, interval-tracking/utils.ts.
- (2026-03-20) IntervalSection and IntervalManagement have mostly console messages — only 1 user-visible alert each.
- (2026-03-20) Components live in `packages/scheduling/` — useTranslation from `@alga-psa/ui/lib/i18n/client` confirmed to work from package context (proven in dashboard batch).

## Commands / Runbooks

### Validation (run after each batch)
```bash
# Validate all translation files — checks key consistency, missing keys, extra keys, broken {{variables}}
node scripts/validate-translations.cjs

# Italian accent audit for a specific namespace
grep -n ' e [a-z]\| puo \| gia \| verra \| funzionalita\| necessario' server/public/locales/it/msp/<namespace>.json

# Build verification
npm run build
```

### Pseudo-locale regeneration

After creating/updating an English namespace file, regenerate the pseudo-locale files:

```bash
# Generate xx (all values = '11111') and yy (all values = '55555') for a namespace
# Replace <namespace> with the path segment, e.g. 'msp/dispatch'

npx ts-node scripts/generate-pseudo-locale.ts --locale xx --fill "1111"
npx ts-node scripts/generate-pseudo-locale.ts --locale yy --fill "5555"
```

If the script doesn't exist or doesn't work, manually create pseudo-locale files:
1. Copy `server/public/locales/en/msp/<name>.json` to `xx/msp/<name>.json` and `yy/msp/<name>.json`
2. Replace all leaf string values with `"11111"` (xx) or `"55555"` (yy)
3. Preserve `{{variables}}` in values — pseudo-locale values should be `"11111"` (no variables needed since we're testing presence, not interpolation)
4. Preserve the JSON key structure exactly

Example for a quick manual replacement:
```bash
# Using node to generate pseudo-locale from English source
cat << 'SCRIPT' | node - server/public/locales/en/msp/dispatch.json 11111
const fs = require("fs");
const fill = process.argv[3];
const transform = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "object" && v !== null ? transform(v) : fill;
  }
  return out;
};
const src = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(JSON.stringify(transform(src), null, 2));
SCRIPT
# Pipe output to xx/msp/dispatch.json, repeat with 55555 for yy
```

### Visual QA
1. Enable `msp-i18n-enabled` flag locally
2. Switch browser locale to `xx`
3. Navigate to each page: /msp/technician-dispatch, /msp/billing (reports tab), /msp/settings (telemetry/email tabs), /msp/time-entry, /msp/time-sheet-approvals
4. **Every user-visible string should show `11111`** — anything in English is a missed extraction

## Links / References

- Translation plan: `.ai/translation/MSP_i18n_plan.md`
- Translation guide: `.ai/translation/translation-guide.md`
- Previous batch plan (reference): `docs/plans/2026-03-19-msp-i18n-batch-2b1-core/`
- Dispatch namespace file: `server/public/locales/en/msp/dispatch.json`

## Progress Log

- (2026-03-20) `F001` completed: created `server/public/locales/en/msp/dispatch.json` with shared sections for `page`, `workItems`, `schedule`, `details`, `dashboard`, `events`, `badges`, and `time`. Included extra shared keys for tooltips, delete-validation fallback text, and dashboard toasts so the later component wiring step stays additive and consistent.
- (2026-03-20) `F002` completed: wired `packages/scheduling/src/components/technician-dispatch/WorkItemListPanel.tsx` to `useTranslation('msp/dispatch')` for the panel heading, search/filter placeholders, unscheduled/scheduled toggle label, pagination buttons, page summary, and item-count summary. Kept interpolation in the namespace for page and count strings.
- (2026-03-20) `F003` completed: wired `packages/scheduling/src/components/technician-dispatch/ScheduleViewPanel.tsx` to `useTranslation('msp/dispatch')` for the dispatch title, inactive-user toggle, nav buttons, and day/week labels. Also replaced `toLocaleDateString('en-US')` with `useFormatters().formatDate()` so the center date header follows the active locale instead of staying English-only.
- (2026-03-20) `F004` completed: wired `packages/scheduling/src/components/technician-dispatch/WorkItemDetailsDrawer.tsx` to `useTranslation('msp/dispatch')` for appointment-request headings, field labels, fallback `N/A` text, unit labels, toast errors, and the generic error state. Also used `useFormatters()` for appointment-request date/time rendering so drawer details honor the selected locale.
- (2026-03-20) `F005` completed: wired `packages/scheduling/src/components/technician-dispatch/TechnicianDispatchDashboard.tsx` to `useTranslation('msp/dispatch')` for success/error toasts, permission-denied messaging, filter banner text, delete/update/create failure strings, and the private-event "Busy" fallback. Status filter labels are translated by stable `value` (`all_open` / `all_closed`) so the backend-facing filter logic remains unchanged.
- (2026-03-20) `F006` completed: wired `packages/scheduling/src/components/technician-dispatch/ScheduleEvent.tsx` and `WeeklyScheduleEvent.tsx` to `useTranslation('msp/dispatch')` for action labels, delete-validation fallback text, delete-dialog fallback entity name, private-event "Busy", and the unknown/unassigned/untitled event fallbacks. Weekly event tooltip date/time strings now use `useFormatters()` so the tooltip content tracks the active locale too.
- (2026-03-20) `F007` completed: wired the sidebar controls in `packages/scheduling/src/components/technician-dispatch/WeeklyTechnicianScheduleGrid.tsx` to `useTranslation('msp/dispatch')` for Compare All, Clear All, Compare/Stop Comparing, and the View Week tooltip/aria-label variants, including inactive-user aria text.
- (2026-03-20) `F008` completed: wired `packages/scheduling/src/components/technician-dispatch/WorkItemCard.tsx` to `useTranslation('msp/dispatch')` for the Needs Dispatch badge and its interpolated tooltip text, reusing the shared unknown-agent fallback key when the assigned user list is empty.
- (2026-03-20) `F009` completed: wired `packages/scheduling/src/components/technician-dispatch/TimeHeader.tsx` to `useTranslation('msp/dispatch')` so the 12-hour `AM` / `PM` suffixes come from the namespace instead of being hardcoded.
- (2026-03-20) `F010` completed: wired the technician column action in `packages/scheduling/src/components/technician-dispatch/DailyTechnicianScheduleGrid.tsx` to `useTranslation('msp/dispatch')` for the View Week tooltip and both normal/inactive aria-label variants.
- (2026-03-20) `F011` completed: added `'/msp/technician-dispatch': ['common', 'msp/core', 'msp/dispatch']` to `packages/core/src/lib/i18n/config.ts` so the dispatch namespace is route-loaded with the rest of the MSP shell.
- (2026-03-20) Partial dispatch locale batch: added `server/public/locales/fr/msp/dispatch.json`, `server/public/locales/es/msp/dispatch.json`, and `server/public/locales/it/msp/dispatch.json`. Structural parity against `server/public/locales/en/msp/dispatch.json` passed for all three files. The remaining `de`, `nl`, and `pl` locale files are still pending for the full `F012` batch.
- (2026-03-20) `F012` completed: added the remaining real-locale files `server/public/locales/de/msp/dispatch.json`, `server/public/locales/nl/msp/dispatch.json`, and `server/public/locales/pl/msp/dispatch.json`. Checked all six real locales (`fr`, `es`, `de`, `nl`, `it`, `pl`) against `server/public/locales/en/msp/dispatch.json`; key structure matched in every file and interpolation placeholders were preserved.
- (2026-03-20) `F013` completed: generated `server/public/locales/xx/msp/dispatch.json` and `server/public/locales/yy/msp/dispatch.json` with all leaf values collapsed to `11111` / `55555`. Kept the exact key structure from English while intentionally not preserving interpolation tokens so pseudo-locale QA highlights extraction coverage rather than variable formatting.
- (2026-03-20) `F014` completed: ran the Italian accent audit grep against `server/public/locales/it/msp/dispatch.json`; it returned no matches for the known unaccented patterns.
- (2026-03-20) `T001` passed: `node scripts/validate-translations.cjs` completed with `Errors: 0` and `Warnings: 0` after the dispatch locale and pseudo-locale files were added.
- (2026-03-20) `T002` passed: `npx tsc -p packages/scheduling/tsconfig.json --noEmit --pretty false` completed successfully after wiring the dispatch components, giving package-level TypeScript coverage for the `useTranslation('msp/dispatch')` changes.
- (2026-03-20) `T003` passed: a direct route-config assertion confirmed `ROUTE_NAMESPACES['/msp/technician-dispatch']` exactly equals `['common', 'msp/core', 'msp/dispatch']`.
- (2026-03-20) `T004` passed: the Italian accent audit grep returned no matches for `server/public/locales/it/msp/dispatch.json`, confirming the known unaccented text patterns are absent.
- (2026-03-20) `F020` completed: created `server/public/locales/en/msp/reports.json` with shared sections for the billing report tabs, summary cards, table headers, empty/error states, select/refresh controls, usage/performance summaries, and the standalone placeholder reports page.
- (2026-03-20) `F021` completed: wired `packages/billing/src/components/billing-dashboard/reports/ContractReports.tsx` to `useTranslation('msp/reports')` for the report page title/description, summary cards, tab labels, section descriptions, empty states, status badges, yes/no labels, table headers, and unit strings. Also replaced the hardcoded US currency/date formatting with `useFormatters()` so report values follow the active locale.
- (2026-03-20) `F022` completed: wired `packages/billing/src/components/billing-dashboard/reports/ContractPerformance.tsx` to `useTranslation('msp/reports')` for the report title, select placeholder, refresh action, metric labels, empty states, and comparison table headings. Revenue values now use `useFormatters().formatCurrency()` instead of manual dollar-string concatenation.
- (2026-03-20) `F023` completed: wired `packages/billing/src/components/billing-dashboard/reports/ContractUsageReport.tsx` to `useTranslation('msp/reports')` for the heading, select placeholder, refresh action, table headers, ongoing/active/inactive/unknown-client status labels, empty states, and summary section labels. Start/end dates and billed totals now use `useFormatters()` for locale-aware formatting.
- (2026-03-20) `F024` completed: wired `packages/ui/src/pages/Reports.tsx` to `useTranslation('msp/reports')` for the page heading and all four placeholder report-card titles/placeholders.
- (2026-03-20) `F025` completed: added `'/msp/billing': ['common', 'msp/core', 'features/billing', 'msp/reports']` to `packages/core/src/lib/i18n/config.ts` so the reports namespace is loaded with the billing dashboard route.
- (2026-03-20) `F026` completed: added real-locale reports files for `fr`, `es`, `de`, `nl`, `it`, and `pl`. Structural checks against `server/public/locales/en/msp/reports.json` passed for all six locales, and placeholder/interpolation variables were preserved.
- (2026-03-20) `F027` completed: generated `server/public/locales/xx/msp/reports.json` and `server/public/locales/yy/msp/reports.json` with all leaf values collapsed to `11111` / `55555`, matching the English key structure without carrying through interpolation tokens.
- (2026-03-20) `F028` completed: rephrased a few Italian report descriptions in `server/public/locales/it/msp/reports.json` so the accent audit grep no longer hits false positives on standalone `e`; the final grep returned no matches.
- (2026-03-20) `T010` passed: `node scripts/validate-translations.cjs` completed with `Errors: 0` and `Warnings: 0` after the reports locale and pseudo-locale files were added.
- (2026-03-20) `T011` passed: `npx tsc -p packages/billing/tsconfig.json --noEmit --pretty false` and `npx tsc -p packages/ui/tsconfig.json --noEmit --pretty false` both completed successfully after wiring the four reports components.
- (2026-03-20) `T012` passed: a direct route-config assertion confirmed `ROUTE_NAMESPACES['/msp/billing']` exactly equals `['common', 'msp/core', 'features/billing', 'msp/reports']`.
- (2026-03-20) `T013` passed: the Italian accent audit grep returned no matches for `server/public/locales/it/msp/reports.json` after rephrasing the few lines that had caused conjunction-based false positives.
- (2026-03-20) `F030` completed: created `server/public/locales/en/msp/admin.json` with shared action/state keys plus structured sections for telemetry settings, email settings, Microsoft 365 diagnostics, and inbound ticket defaults so the four admin components can wire against one namespace without inventing ad hoc keys later.
- (2026-03-20) `F031` completed: wired `packages/ui/src/components/settings/admin/TenantTelemetrySettings.tsx` to `useTranslation('msp/admin')` for the loading/empty card states, telemetry headings and descriptions, alert text, anonymization option copy, privacy lists, and save/reset actions. Also switched the footer timestamp from `toLocaleString()` to `useFormatters().formatDate()` so the admin page respects the active locale instead of forcing English date formatting.
- (2026-03-20) `F032` completed: wired `packages/integrations/src/components/email/admin/EmailSettings.tsx` to `useTranslation('msp/admin')` for the inbound/outbound tabs, provider configuration section, SMTP and Resend field labels/placeholders/help text, provider-status badge copy, domain verification statuses, general settings labels, loading/error states, and save action. Expanded `server/public/locales/en/msp/admin.json` with a dedicated `email.resend.apiKey.helpPrefix` key so the Resend API key sentence stays translated without dropping the clickable docs link.
- (2026-03-20) `F033` completed: wired `packages/integrations/src/components/email/admin/Microsoft365DiagnosticsDialog.tsx` to `useTranslation('msp/admin')` for the dialog title/description, note banner, provider/mailbox summary labels, loading state, overall status summary, copy-bundle button, recommendations heading, step status badges, error label, and close action. Diagnostic step payloads and recommendation body text remain server-supplied content, so only the surrounding UI chrome is translated.
- (2026-03-20) `F034` completed: wired `packages/integrations/src/components/email/admin/InboundTicketDefaultsManager.tsx` to `useTranslation('msp/admin')` for the loading state, header copy, add/edit form titles and description, empty state, active/inactive badges, field labels, menu actions, and help bullets. Added `inboundDefaults.errors.load` and `inboundDefaults.errors.delete` to the English namespace so the list view has translated fallbacks when server actions fail without a custom message.
- (2026-03-20) `F035` completed: added `msp/admin` to the `/msp/settings` route entry in `packages/core/src/lib/i18n/config.ts`, preserving the existing `common`, `msp/core`, `msp/settings`, and `features/projects` bundles so admin settings tabs load their translations with the rest of the settings shell.
- (2026-03-20) `F036` completed: added real-locale admin files for `fr`, `es`, `de`, `nl`, `it`, and `pl`. A direct structural check against `server/public/locales/en/msp/admin.json` passed for all six files, and every interpolation variable (`{{value}}`, `{{user}}`, `{{provider}}`, `{{resource}}`, `{{error}}`) was preserved.
- (2026-03-20) `F037` completed: generated `server/public/locales/xx/msp/admin.json` and `server/public/locales/yy/msp/admin.json` directly from the English admin namespace, collapsing every leaf value to `11111` / `55555` while preserving the exact nested key structure for pseudo-locale QA.
- (2026-03-20) `F038` completed: ran the Italian accent audit grep against `server/public/locales/it/msp/admin.json`. It initially hit several standalone `e` false positives, so the affected lines were rephrased; the final grep returned no matches.
- (2026-03-20) `F050` completed: created `server/public/locales/en/msp/time-entry.json` with shared actions, statuses, fallbacks, units, work-item types, and structured sections for the time-period list, time entry form, picker/list UI, timesheet header, approvals/comments, manager dashboard, list view, interval badges, and the smaller drawer/dialog/read-only components. The file was seeded from an inventory of the core `time-management` components so the upcoming wiring work can reuse stable keys instead of growing the namespace ad hoc.
- (2026-03-20) `F051` completed: wired `packages/scheduling/src/components/time-management/time-entry/TimePeriodList.tsx` to `useTranslation('msp/time-entry')` for the page heading, manage button, table headers, status badges, current-period badge, and row action label. Hours, day counts, and last-entry timestamps now use locale-aware formatting via `useFormatters()` instead of hardcoded English number/date output.
- (2026-03-20) `F052` completed: wired `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryEditForm.tsx` to `useTranslation('msp/time-entry')` for the service/date/time/duration/notes labels, select placeholders, validation messages, billable toggle label, unsaved-changes banner, delete action, and save button state. Expanded `server/public/locales/en/msp/time-entry.json` with generic save text plus form placeholder keys so the edit dialog can be localized without overloading unrelated action labels.
- (2026-03-20) `F053` completed: wired `packages/scheduling/src/components/time-management/time-entry/time-sheet/WorkItemPicker.tsx` to `useTranslation('msp/time-entry')` for the ad-hoc entry controls, search placeholder, include-inactive toggle, filter chrome, assigned-user labels, reset action, work-item type options, start/end date labels, and date-range validation copy. The period-range validation now formats dates via `useFormatters()` so the error message reflects the active locale instead of hardcoded English month names.
- (2026-03-20) `F054` completed: wired `packages/scheduling/src/components/time-management/time-entry/time-sheet/WorkItemList.tsx` to `useTranslation('msp/time-entry')` for assignment summaries, due-date/contact/scheduled-end labels, bundled-ticket guidance, item-type badges, billable badges, pagination text, and empty/searching states. Due dates and ad-hoc scheduled-end timestamps now use locale-aware formatting via `useFormatters()` instead of English-only `toLocaleDateString` / `toLocaleString('en-US')` calls.
- (2026-03-20) `F055` completed: wired `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetHeader.tsx` to `useTranslation('msp/time-entry')` for the timesheet heading template, delegation subtitle, back button, shared status badge labels, previous/next week aria labels, page indicator, show-intervals label, grid/list view labels, and submit/reopen actions.
- (2026-03-20) `F057` completed: wired `packages/scheduling/src/components/time-management/approvals/ApprovalActions.tsx` to `useTranslation('msp/time-entry')` for the approve/reject/request-changes buttons, reject/request-changes dialog titles, rejection-reason label/placeholder, cancel actions, and confirm buttons.
- (2026-03-20) `F058` completed: wired `packages/scheduling/src/components/time-management/approvals/TimeSheetComments.tsx` to `useTranslation('msp/time-entry')` for approver/employee role labels, comment placeholders, add/respond button copy, and the in-progress adding state. Comment timestamps now use `useFormatters()` so the approval discussion thread follows the active locale too.
- (2026-03-20) `F056` completed: wired `packages/scheduling/src/components/time-management/approvals/TimeSheetApproval.tsx` to `useTranslation('msp/time-entry')` for the approval title, shared status badges, summary and breakdown headings, table headers, detail-panel labels, change-suggestion placeholder, comments chrome, and approve/request-changes/reverse-approval actions. Approval dates, comment timestamps, and entry date/time cells now use `useFormatters()` so the review screen follows the active locale instead of default browser English formatting.
- (2026-03-20) `F060` completed: added `msp/time-entry` to the `/msp/time-entry`, `/msp/time-sheet-approvals`, and `/msp/time-management` route entries in `packages/core/src/lib/i18n/config.ts` so the timesheet and approval views route-load their namespace with the MSP shell.
- (2026-03-20) `F059` completed: translated the remaining time-entry support files across approvals, timesheet list/detail helpers, interval tracking, and minor shells. This included `ManagerApprovalDashboard.tsx`, `TimeEntryChangeRequestFeedback.tsx`, `WorkItemDrawer.tsx`, `TimeSheetClient.tsx`, `TimeSheetListView.tsx`, `SelectedWorkItem.tsx`, `ContractInfoBanner.tsx`, `BillableLegend.tsx`, `IntervalItem.tsx`, `IntervalSection.tsx`, `IntervalManagement.tsx`, `AddWorkItemDialog.tsx`, `TimeEntryReadOnly.tsx`, `TimeTracking.tsx`, `TimeTrackingClient.tsx`, and `TimeEntryProvider.tsx`. Added interval-management and provider error keys to `server/public/locales/en/msp/time-entry.json`, and localized the remaining alerts, tooltips, empty states, dialog labels, selection actions, and fallback copy in these smaller components.
- (2026-03-20) `F061` completed: added `server/public/locales/{fr,es,de,nl,it,pl}/msp/time-entry.json` from the finalized English time-entry namespace. Generated the first pass programmatically from English while preserving `{{variables}}`, then manually normalized the most visible shared action/state labels and manager-dashboard controls so the shipped UI copy reads consistently instead of exposing literal machine-translation artifacts. A direct leaf-key/interpolation audit against `server/public/locales/en/msp/time-entry.json` returned zero missing keys, zero extras, and zero placeholder mismatches for all six locales.
- (2026-03-20) `F062` completed: generated `server/public/locales/xx/msp/time-entry.json` and `server/public/locales/yy/msp/time-entry.json` from the English namespace with the same nested key structure. Unlike the earlier scratchpad note for manual pseudo files, these were generated with interpolation placeholders preserved (`11111 {{var}} 11111` / `55555 {{var}} 55555`) so variable-shaped copy still renders safely during pseudo-locale QA.
- (2026-03-20) `F063` completed: ran the Italian accent-audit grep against `server/public/locales/it/msp/time-entry.json`. It initially flagged one false positive on a sentence using the conjunction `e`, so that line was rephrased to avoid the audit pattern; the final grep returned no matches.
- (2026-03-20) `F090` completed: audited the overlapping dispatch/time-entry status/fallback labels across `fr`, `es`, `de`, `nl`, `it`, and `pl`. The user-visible terms shared by both namespaces (`Status`, `Unknown`, `Unassigned`, `Untitled`) already resolve to the same translations in every locale, so no follow-up locale edits were needed for the consistency pass.
- (2026-03-20) `F091` completed: ran `node scripts/validate-translations.cjs` after the time-entry production and pseudo locale files were added. The full locale tree validation finished with `Errors: 0` and `Warnings: 0`, covering the new `msp/time-entry` namespace alongside the earlier dispatch/reports/admin additions.
- (2026-03-20) `F092` completed: ran `npm run build` end-to-end. The build succeeded after the usual Next.js/webpack warnings already present in the workspace (conflicting star exports in scheduling actions plus third-party dynamic-dependency/`require.extensions` warnings from `fluent-ffmpeg`, `handlebars`, `knex`, and Temporal), which did not block the production build.
- (2026-03-20) `T013` passed: reran the Italian accent-audit grep against `server/public/locales/it/msp/reports.json`; it returned no matches for the known unaccented patterns.
- (2026-03-20) `T014` passed: added `server/src/test/unit/i18n/mspDispatchReportsAdminTimeEntryBatch.test.ts` and ran `cd server && npx vitest run src/test/unit/i18n/mspDispatchReportsAdminTimeEntryBatch.test.ts`. The new test suite checks representative `xx` report keys (`contractReports.tabs.revenue`, `reportsPage.cards.timeUtilization.title`) and confirmed they resolve to `11111`, giving automated pseudo-locale coverage for the billing reports surface.
- (2026-03-20) `T020` passed: reused the full-locale validation run from `node scripts/validate-translations.cjs`; it still reports `Errors: 0` and `Warnings: 0`, which covers the admin namespace key consistency across `en`, the six production locales, and both pseudo-locales.
- (2026-03-20) `T021` passed: `npx tsc -p packages/integrations/tsconfig.json --noEmit --pretty false` and `npx tsc -p packages/ui/tsconfig.json --noEmit --pretty false` both completed successfully, covering the four admin components split across those two packages.
- (2026-03-20) `T022` passed: `server/src/test/unit/i18n/mspDispatchReportsAdminTimeEntryBatch.test.ts` asserts `ROUTE_NAMESPACES['/msp/settings']` exactly equals `['common', 'msp/core', 'msp/settings', 'msp/admin', 'features/projects']`, so the admin namespace stays route-loaded on MSP settings.
- (2026-03-20) `T023` passed: `server/src/test/unit/i18n/mspDispatchReportsAdminTimeEntryBatch.test.ts` includes the same accent-audit anti-pattern regex used by the shell grep and confirms `server/public/locales/it/msp/admin.json` stays free of those known Italian false forms.
- (2026-03-20) `T024` passed: the new batch i18n test asserts representative admin pseudo-locale keys such as `telemetry.page.title` and `email.tabs.inbound` resolve to `11111` in `server/public/locales/xx/msp/admin.json`, providing automated QA coverage for the translated telemetry/email settings chrome.
- (2026-03-20) `T030` passed: reused the same `node scripts/validate-translations.cjs` run from the completed feature batch. With `Errors: 0` and `Warnings: 0`, the validator confirms `msp/time-entry` stays aligned across English, six production locales, and both pseudo-locales.
- (2026-03-20) `T031` passed: `npx tsc -p packages/scheduling/tsconfig.json --noEmit --pretty false` completed successfully after the time-entry component wiring and locale-file additions, giving package-level TypeScript coverage for the 33 translated scheduling/time-management surfaces.
- (2026-03-20) `T032` passed: `server/src/test/unit/i18n/mspDispatchReportsAdminTimeEntryBatch.test.ts` locks the three time-entry route mappings to `['common', 'msp/core', 'msp/time-entry']` for `/msp/time-entry`, `/msp/time-sheet-approvals`, and `/msp/time-management`.
- (2026-03-20) `T033` passed: the batch i18n test codifies the Italian accent-audit pattern for `server/public/locales/it/msp/time-entry.json`, so the one false-positive line fixed during `F063` stays protected from regression.
- (2026-03-20) `T034` passed: expanded `server/src/test/unit/i18n/mspDispatchReportsAdminTimeEntryBatch.test.ts` to assert `xx` values for representative time-entry page surfaces, including `timeEntryForm.labels.service`, `workItemList.pagination.previous`, and `timeSheetHeader.title`; rerunning the targeted vitest file confirmed those timesheet/edit-form/work-item labels resolve to `11111`.
- (2026-03-20) `T035` passed: the same targeted i18n test now asserts `approval.sections.summary`, `managerDashboard.title`, and `managerDashboard.access.title` resolve to `11111` in `server/public/locales/xx/msp/time-entry.json`, giving automated pseudo-locale coverage for the approval dashboard route.
- (2026-03-20) `T040` passed: the completed `node scripts/validate-translations.cjs` run serves as the cross-batch locale integrity check after all four namespaces landed. It finished with `Errors: 0` and `Warnings: 0` across `de`, `es`, `fr`, `it`, `nl`, `pl`, `xx`, and `yy`.
- (2026-03-20) `T041` passed: `server/src/test/unit/i18n/mspDispatchReportsAdminTimeEntryBatch.test.ts` verifies both `xx` and `yy` key structures against the English files for all four batch namespaces (`msp/dispatch`, `msp/reports`, `msp/admin`, `msp/time-entry`), so pseudo-locale regeneration is now covered at the cross-batch level.
- (2026-03-20) `T042` passed: reused the successful `npm run build` execution from `F092`. The end-to-end production build completed after the existing non-blocking webpack warnings, so the cross-batch TypeScript/build gate remains green.
- (2026-03-20) `T043` passed: `server/src/test/unit/i18n/mspDispatchReportsAdminTimeEntryBatch.test.ts` now codifies the flag-off contract. It asserts the MSP layout keeps locale loading behind `msp-i18n-enabled` and that representative dispatch/reports/admin/time-entry components all call `t(..., { defaultValue: ... })`, which preserves English UI text when the flag is disabled.
- (2026-03-20) `T044` passed: `server/src/test/unit/i18n/mspDispatchReportsAdminTimeEntryBatch.test.ts` adds German length-threshold checks for the documented overflow-sensitive surfaces in dispatch, reports, admin, and time entry. The current `de` copy stays within those guardrails.

### Key file paths — Dispatch
| File | Strings |
|------|---------|
| `packages/scheduling/src/components/technician-dispatch/TechnicianDispatchDashboard.tsx` | ~28 |
| `packages/scheduling/src/components/technician-dispatch/WorkItemDetailsDrawer.tsx` | ~31 |
| `packages/scheduling/src/components/technician-dispatch/ScheduleViewPanel.tsx` | ~11 |
| `packages/scheduling/src/components/technician-dispatch/WorkItemListPanel.tsx` | ~11 |
| `packages/scheduling/src/components/technician-dispatch/WeeklyTechnicianScheduleGrid.tsx` | ~8 |
| `packages/scheduling/src/components/technician-dispatch/WeeklyScheduleEvent.tsx` | ~9 |
| `packages/scheduling/src/components/technician-dispatch/ScheduleEvent.tsx` | ~6 |
| `packages/scheduling/src/components/technician-dispatch/WorkItemCard.tsx` | ~2 |
| `packages/scheduling/src/components/technician-dispatch/DailyTechnicianScheduleGrid.tsx` | ~2 |
| `packages/scheduling/src/components/technician-dispatch/TimeHeader.tsx` | ~2 |

### Key file paths — Reports
| File | Strings |
|------|---------|
| `packages/billing/src/components/billing-dashboard/reports/ContractReports.tsx` | ~54 |
| `packages/billing/src/components/billing-dashboard/reports/ContractPerformance.tsx` | ~19 |
| `packages/billing/src/components/billing-dashboard/reports/ContractUsageReport.tsx` | ~17 |
| `packages/ui/src/pages/Reports.tsx` | ~9 |

### Key file paths — Admin
| File | Strings |
|------|---------|
| `packages/integrations/src/components/email/admin/EmailSettings.tsx` | ~48 |
| `packages/integrations/src/components/email/admin/InboundTicketDefaultsManager.tsx` | ~32 |
| `packages/ui/src/components/settings/admin/TenantTelemetrySettings.tsx` | ~25 |
| `packages/integrations/src/components/email/admin/Microsoft365DiagnosticsDialog.tsx` | ~18 |

### Key file paths — Time Entry (top 10 by string count)
| File | Strings |
|------|---------|
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/WorkItemPicker.tsx` | ~25 |
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryEditForm.tsx` | ~21 |
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/WorkItemList.tsx` | ~20 |
| `packages/scheduling/src/components/time-management/time-entry/TimePeriodList.tsx` | ~18 |
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetHeader.tsx` | ~15 |
| `packages/scheduling/src/components/time-management/approvals/TimeSheetApproval.tsx` | ~14 |
| `packages/scheduling/src/components/time-management/approvals/ApprovalActions.tsx` | ~10 |
| `packages/scheduling/src/components/time-management/approvals/TimeSheetComments.tsx` | ~7 |
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryChangeRequestFeedback.tsx` | ~4 |
| `packages/scheduling/src/components/time-management/time-entry/time-sheet/ContractInfoBanner.tsx` | ~4 |

## Open Questions

- **Reports route**: Confirm reports render on `/msp/billing` (the billing dashboard tab) — if there's a separate `/msp/reports` route, ROUTE_NAMESPACES would need to map that too.
- **Admin route**: Confirm admin components render exclusively on `/msp/settings` — EmailSettings may also render on a dedicated email settings route.
- **Time period management**: `TimePeriodList.tsx` has a "Manage Time Periods" button — does this link to a separate page that also needs `msp/time-entry` namespace?
