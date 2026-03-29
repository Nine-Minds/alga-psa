# PRD — MSP i18n Batches: Dispatch, Reports, Admin, Time Entry

- Slug: `2026-03-20-msp-i18n-dispatch-reports-admin-time`
- Date: `2026-03-20`
- Status: Draft

## Summary

Translate four MSP feature areas in priority order:

| Batch | Namespace | Strings | Files | Location |
|-------|-----------|---------|-------|----------|
| 2b-5 | `msp/dispatch` | ~120 | 13 | `packages/scheduling/src/components/technician-dispatch/` |
| 2b-7 | `msp/reports` | ~99 | 4 | `packages/billing/src/components/billing-dashboard/reports/` + `packages/ui/src/pages/Reports.tsx` |
| 2b-8 | `msp/admin` | ~123 | 4 | `packages/ui/src/components/settings/admin/` + `packages/integrations/src/components/email/admin/` |
| 2b-3 | `msp/time-entry` | ~161 | 33 | `packages/scheduling/src/components/time-management/` |

**Total: ~503 strings across 54 files, creating 4 new namespaces.**

Each batch: extract hardcoded strings → create English namespace JSON → wire `useTranslation()` → generate 6 non-English translations + 2 pseudo-locales → update `ROUTE_NAMESPACES` → visual QA.

## Problem

These four MSP feature areas display hundreds of hardcoded English strings. Users with non-English locale preferences see translated shell/dashboard/settings chrome but English content on these pages. Dispatch, reports, admin, and time entry are all high-traffic pages for MSP operators.

## Goals

1. Create 4 new namespace files: `msp/dispatch.json`, `msp/reports.json`, `msp/admin.json`, `msp/time-entry.json`
2. Wire all ~54 component files to consume translations via `useTranslation()`
3. Generate translations for all 7 production languages + 2 pseudo-locales (9 locale files per namespace = 36 new files)
4. Register all 4 namespaces in `ROUTE_NAMESPACES`
5. Zero regressions with `msp-i18n-enabled` flag OFF

## Non-goals

- Translating strings in components outside the 4 listed areas
- Translating console.log/console.error messages (developer-facing, not user-facing)
- Changing component behavior or refactoring
- Adding new languages

## Users and Primary Flows

**Primary user**: MSP portal operators using non-English locales.

**Flows**:
- Technician dispatch: scheduling technicians, viewing/filtering work items, drag-and-drop scheduling
- Reports: viewing contract revenue, expiration, bucket hours, profitability reports
- Admin: configuring telemetry settings, email providers, inbound ticket defaults, M365 diagnostics
- Time entry: logging time, managing timesheets, submitting for approval, approval workflow

## UX / UI Notes

- No visual changes — translated text appears in same locations
- German/Dutch text 30-50% longer — verify no overflow in: dispatch filter dropdowns, report table columns, admin form labels, timesheet column headers
- Status badges (Submitted, Approved, Changes Requested, etc.) appear in multiple components — use shared keys within each namespace to avoid inconsistency
- Time units ("h", "m", "hrs") need locale-appropriate formatting
- Pagination strings ("Page X of Y", "Showing X of Y items") need interpolation

## Requirements

### Batch 2b-5: msp/dispatch (~120 strings, 13 files)

#### D-FR1: WorkItemListPanel.tsx (11 strings)
| String | Key |
|--------|-----|
| "Work Items" | `workItems.title` |
| "Search work items..." | `workItems.searchPlaceholder` |
| "Filter by status..." | `workItems.filterPlaceholder` |
| "Unscheduled" | `workItems.status.unscheduled` |
| "Scheduled" | `workItems.status.scheduled` |
| "Previous" / "Next" | `workItems.pagination.previous` / `.next` |
| "Page {{current}} of {{total}}" | `workItems.pagination.pageInfo` |
| "Showing {{count}} of {{total}} items" | `workItems.pagination.showing` |

#### D-FR2: ScheduleViewPanel.tsx (11 strings)
| String | Key |
|--------|-----|
| "Technician Dispatch" | `page.title` |
| "Show Inactive Users" | `schedule.showInactive` |
| "< Prev" / "Next >" | `schedule.prev` / `.next` |
| "Today" | `schedule.today` |
| "Day" / "Week" | `schedule.viewDay` / `.viewWeek` |
| "Previous {{mode}}" / "Next {{mode}}" (aria) | `schedule.prevAria` / `.nextAria` |

#### D-FR3: WorkItemDetailsDrawer.tsx (~31 strings)
All field labels (Service, Status, Client, Contact, etc.), section headings (Appointment Request Details, Approval Information), error toasts, and fallback text ("N/A", "Error loading content").

#### D-FR4: TechnicianDispatchDashboard.tsx (~28 strings)
Error/success toasts, permission denied messages, filter options ("All Open", "All Closed"), private event title ("Busy"), access denied message.

#### D-FR5: ScheduleEvent.tsx + WeeklyScheduleEvent.tsx (~15 strings)
"View Details", "Delete", "Delete schedule entry", "Busy", "Unknown", "Unassigned", "Untitled" fallbacks.

#### D-FR6: WeeklyTechnicianScheduleGrid.tsx (~8 strings)
"Compare All", "Clear All", "Compare", "Stop Comparing", "View Week" tooltips and aria-labels.

#### D-FR7: WorkItemCard.tsx (2 strings)
"Needs dispatch for: {{agents}}", "Needs Dispatch" badge.

#### D-FR8: TimeHeader.tsx (2 strings)
" AM" / " PM" time suffixes.

#### D-FR9: ROUTE_NAMESPACES update
```
'/msp/technician-dispatch': ['common', 'msp/core', 'msp/dispatch']
```

---

### Batch 2b-7: msp/reports (~99 strings, 4 files)

#### R-FR1: ContractReports.tsx (~54 strings)
Tab labels ("Contract Revenue", "Expiration", "Bucket Hours", "Profitability"), tab descriptions, summary cards ("Total MRR", "YTD Revenue", "Active Contracts"), all column headers for 4 report tables, empty state messages, unit labels ("hrs", "days", "%").

#### R-FR2: ContractPerformance.tsx (~19 strings)
Metric labels ("Total Clients", "Active Clients", "Total Plans", "Avg. Plans Per Client", "Total Revenue"), table headers, empty states, "Select contract..." placeholder.

#### R-FR3: ContractUsageReport.tsx (~17 strings)
"Contract Usage Report" heading, column headers, "Summary" section, metric labels, status labels, empty states.

#### R-FR4: Reports.tsx (~9 strings)
"Reports" heading, 4 card titles ("Time Utilization", "Project Progress", "Revenue by Client", "Team Performance"), placeholder texts.

#### R-FR5: ROUTE_NAMESPACES update
```
'/msp/billing': ['common', 'msp/core', 'features/billing', 'msp/reports']
```
(Reports load on the billing route since they're in the billing dashboard)

---

### Batch 2b-8: msp/admin (~123 strings, 4 files)

#### A-FR1: TenantTelemetrySettings.tsx (~25 strings)
Section headings, toggle labels ("Enable Telemetry", "Allow User Opt-Out"), descriptions, anonymization options ("No Anonymization", "Partial", "Full"), compliance notes, "What We Collect" / "What We DON'T Collect" lists, buttons.

#### A-FR2: EmailSettings.tsx (~48 strings)
Tab labels ("Inbound Email", "Outbound Email"), provider options ("SMTP", "Resend"), form labels (Host, Port, Username, Password, From Address), placeholders, domain verification statuses ("Verified", "Failed", "Pending"), general settings labels, error messages.

#### A-FR3: Microsoft365DiagnosticsDialog.tsx (~18 strings)
Dialog title/description, diagnostic status badges ("Pass", "Warn", "Fail", "Skip"), "Running diagnostics...", "Copy Support Bundle", "Recommendations", notes/warnings.

#### A-FR4: InboundTicketDefaultsManager.tsx (~32 strings)
Section heading, field labels ("Board:", "Status:", "Priority:", "Entered By:"), badges ("Active", "Inactive"), empty states, "How It Works" section with bullet points, dialog titles, action buttons.

#### A-FR5: ROUTE_NAMESPACES update
Admin components load on settings routes:
```
'/msp/settings': ['common', 'msp/core', 'msp/settings', 'msp/admin', 'features/projects']
```

---

### Batch 2b-3: msp/time-entry (~161 strings, 33 files)

#### T-FR1: TimePeriodList.tsx (~18 strings)
"Select a Time Period", "Manage Time Periods", column headers (Period, Status, Hours Entered, Days Logged, Last Entry, Actions), status badges (In Progress, Submitted, Approved, Changes Requested, Current).

#### T-FR2: TimeEntryEditForm.tsx (~21 strings)
Form labels (Service, Date, Start Time, End Time, Duration, Billable, Notes), placeholders, validation messages ("Start time must be earlier than end time", "Duration must be at least 1 minute", "Service is required"), "Unsaved changes", "Delete Time Entry".

#### T-FR3: WorkItemPicker.tsx (~25 strings)
"Create Ad-hoc Entry", search placeholder, filter labels ("Assigned to", "Assigned to me", "All Types"), type options (Tickets, Project Tasks, Interactions, Ad-hoc Entries), date range labels, validation, empty/loading states, bundled ticket info.

#### T-FR4: WorkItemList.tsx (~20 strings)
Assignment text ("Unassigned", "1 user assigned", "{{count}} users assigned"), contact/due date labels, type badges (Ticket, Billable, Project Task, Ad-hoc Entry, Interaction), pagination, empty state.

#### T-FR5: TimeSheetHeader.tsx (~15 strings)
Status badges (reuse from T-FR1), heading template ("Time Sheet for {{name}}"), navigation aria-labels, "Show intervals", "Submit Time Sheet", "Reopen for edits", pagination.

#### T-FR6: TimeSheetApproval.tsx (~14 strings)
"Time Entry Details", field labels (Work Item, Duration, Billable, Notes), "Entry Change Suggestion", placeholder, "Approve" / "Request Changes" buttons.

#### T-FR7: ApprovalActions.tsx (~10 strings)
"Approve", "Reject", "Request Changes" buttons, dialog titles, "Rejection Reason" label, confirm buttons.

#### T-FR8: TimeSheetComments.tsx (~7 strings)
"Approver" / "Employee" labels, comment placeholders, "Respond to Changes" / "Add Comment" buttons.

#### T-FR9: Remaining files (~31 strings across ~20 files)
- `ManagerApprovalDashboard.tsx` (3): team lead access message
- `TimeEntryChangeRequestFeedback.tsx` (4): feedback states
- `WorkItemDrawer.tsx` (3): error states
- `TimeSheetClient.tsx` (2): delegation disabled, reopen toast
- `TimeSheetListView.tsx` (2): loading/empty states
- `SelectedWorkItem.tsx` (3): ad-hoc entry text, buttons
- `ContractInfoBanner.tsx` (4): contract line info messages
- `BillableLegend.tsx` (3): legend heading/description
- `IntervalItem.tsx` (3): "Now", "Auto-closed", "Active"
- `AddWorkItemDialog.tsx` (2): dialog title/description
- `TimeEntryReadOnly.tsx` (3): fallback texts
- Other files (minimal): TimeEntryProvider, IntervalSection, IntervalManagement

#### T-FR10: ROUTE_NAMESPACES update
```
'/msp/time-entry': ['common', 'msp/core', 'msp/time-entry']
'/msp/time-sheet-approvals': ['common', 'msp/core', 'msp/time-entry']
'/msp/time-management': ['common', 'msp/core', 'msp/time-entry']
```

### Non-functional Requirements

- Follow established key naming convention (page/sections/fields/actions/table/dialogs/errors/validation/messages)
- All `t()` calls use `{ defaultValue: '...' }` for English fallback
- Console.log/console.error messages stay in English (developer-facing)
- Feature flag `msp-i18n-enabled` OFF = forced English

## Rollout / Migration

- Behind existing `msp-i18n-enabled` feature flag
- No database changes
- Purely additive: new JSON files + component wiring

## Open Questions

1. **Time units**: Should "h"/"m"/"hrs" be translation keys, or handled by `useFormatters()` duration formatting? (Recommendation: translation keys for now — duration formatters can be added later.)
2. **Shared status badges**: Time entry uses status badges (Submitted, Approved, etc.) in multiple components. Should these be in `common.json` or `msp/time-entry.json`? (Recommendation: `msp/time-entry.json` with a shared `statuses.*` section within the namespace.)
3. **Reports namespace loading**: Reports are within the billing page. Should `msp/reports` load on `/msp/billing` alongside other billing namespaces? (Recommendation: yes, add to the billing route.)
4. **Admin namespace loading**: Admin components render inside settings tabs. Should `msp/admin` load on `/msp/settings`? (Recommendation: yes.)

## Acceptance Criteria (Definition of Done)

### Per batch
- [ ] English namespace JSON created with all keys
- [ ] All component files wired with `useTranslation('<namespace>')`
- [ ] `ROUTE_NAMESPACES` updated
- [ ] All 7 production locale files created with translations
- [ ] Pseudo-locale files created (xx, yy)
- [ ] Italian accent audit passes
- [ ] `msp-i18n-enabled` OFF: English text, no regressions
- [ ] `msp-i18n-enabled` ON + locale `xx`: all strings show `11111`

### Cross-cutting
- [ ] All 36 new locale files are valid JSON
- [ ] All `{{variables}}` preserved across all languages
- [ ] German translations don't overflow in tables, dropdowns, form labels
- [ ] Build passes with no TypeScript errors
