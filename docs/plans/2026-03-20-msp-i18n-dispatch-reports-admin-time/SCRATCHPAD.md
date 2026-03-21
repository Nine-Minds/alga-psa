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
