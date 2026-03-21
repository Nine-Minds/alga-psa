# Scratchpad — MSP i18n Remaining Batches

- Plan slug: `2026-03-20-msp-i18n-remaining`
- Created: `2026-03-20`

## Decisions

- (2026-03-20) **Combined all remaining batches into one plan**: 7 batches (2b-13 through 2b-20) in one plan since they're all small-to-medium and independent.
- (2026-03-20) **2b-20 is empty**: Extensions and licensing components have zero user-visible strings. Close as "no work needed."
- (2026-03-20) **Email split from admin**: Email provider forms (Microsoft, Gmail, IMAP) are in 2b-18 (msp/email-providers). Email admin settings (EmailSettings, InboundTicketDefaultsManager, M365Diagnostics) are in 2b-8 (msp/admin). Different namespaces, same settings route.
- (2026-03-20) **Profile namespace is small**: Only ~64 strings across 8 files. Combines user profile, password change, security session management, role assignment, and platform updates.

## Discoveries / Constraints

### Surveys (2b-13)
- (2026-03-20) 26 files in `packages/surveys/src/components/`, well-organized in subdirectories: triggers/, templates/, responses/, dashboard/, analytics/, shared/, public/
- (2026-03-20) `SurveyResponsePage.tsx` is PUBLIC-FACING — rendered for end users taking surveys. Locale resolution may differ from MSP portal (no auth session). Needs investigation.
- (2026-03-20) `useTriggerReferenceData.ts` (80 LOC) — hook with no strings, skip
- (2026-03-21) Survey components were already partially keyed under `surveys.*` while still using `useTranslation('common')`; this batch should normalize those keys into the dedicated `msp/surveys` namespace rather than copy them into `common`.

### Schedule (2b-14)
- (2026-03-20) 11 files in `packages/scheduling/src/components/schedule/`
- (2026-03-20) `EntryPopup.tsx` (1,287 LOC, ~68 strings) is the densest — schedule entry create/edit popup
- (2026-03-20) `AvailabilitySettings.tsx` (1,215 LOC, ~64 strings) — availability window management
- (2026-03-20) 3 files have zero strings (TechnicianSidebar, AgentScheduleDrawerStyles, DynamicBigCalendar) — skip
- (2026-03-21) Re-inventory showed the PRD undercounted the “zero-string” files: `TechnicianSidebar.tsx` has compare/reset button labels and tooltips, and `WeeklyScheduleEvent.tsx` has delete/continuation tooltip copy. Keep them in scope for `F012`.

### Knowledge Base (2b-15)
- (2026-03-20) 10 files in `packages/documents/src/components/kb/`
- (2026-03-20) Well-structured: editor, list, page, import, publishing, review, filters, categories, staleness badge
- (2026-03-20) KB article content comes from database (Hocuspocus/ProseMirror) — NOT in translation scope. Only KB UI chrome is translated.

### Jobs (2b-17)
- (2026-03-20) Smallest batch — 7 files, ~29 strings total
- (2026-03-20) All in `packages/jobs/src/components/monitoring/`
- (2026-03-20) `JobStepHistory.tsx` has zero visible strings — skip
- (2026-03-21) `JobStepHistory.tsx` does have visible copy (`Job Steps`, `Processed`, `Retries`) in addition to status labels. The batch is still small, but the PRD count underestimates it slightly.

### Email Providers (2b-18)
- (2026-03-20) 10 files with strings in `packages/integrations/src/components/email/`
- (2026-03-20) 13 files with zero strings (selectors, lists, wrappers, OAuth hooks, schemas, index files) — skip
- (2026-03-20) Admin files (EmailSettings, InboundTicketDefaultsManager, M365Diagnostics) already in 2b-8 — DO NOT duplicate

### Profile (2b-19)
- (2026-03-20) Spans 3 packages: `packages/users/`, `server/src/components/settings/profile/`, `server/src/components/settings/security/`, `server/src/components/platform-updates/`
- (2026-03-20) `SecuritySettingsPage.tsx` tab labels likely already covered by `msp/settings` namespace — only page-level strings are new
- (2026-03-20) Extensions (`DynamicNavigationSlot.tsx`) and licensing (`ReduceLicensesModal.tsx`, `LicensePurchaseForm.tsx`) — all zero strings

## Commands / Runbooks

### Validation
```bash
node scripts/validate-translations.cjs
npm run build
node -e "JSON.parse(require('fs').readFileSync('server/public/locales/en/msp/surveys.json','utf8'))"
npx eslint packages/surveys/src/components/templates/TemplateList.tsx packages/surveys/src/components/templates/TemplateForm.tsx packages/surveys/src/components/triggers/TriggerList.tsx packages/surveys/src/components/triggers/TriggerForm.tsx
npx tsc -p packages/surveys/tsconfig.json --noEmit
```

### Pseudo-locale generation
```bash
cat << 'SCRIPT' | node - server/public/locales/en/msp/<name>.json 11111
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
```

### Italian accent audit
```bash
for ns in surveys schedule knowledge-base jobs email-providers profile; do
  echo "=== $ns ===";
  grep -n ' e [a-z]\| puo \| gia \| verra \| funzionalita\| necessario' server/public/locales/it/msp/$ns.json 2>/dev/null || echo "(not yet created)";
done
```

## Links / References

- Translation plan: `.ai/translation/MSP_i18n_plan.md`
- Translation guide: `.ai/translation/translation-guide.md`
- All previous plans:
  - `docs/plans/2026-03-19-msp-i18n-batch-2b1-core/` (complete)
  - `docs/plans/2026-03-20-msp-i18n-dispatch-reports-admin-time/`
  - `docs/plans/2026-03-20-msp-i18n-clients-assets-onboarding/`
  - `docs/plans/2026-03-20-msp-i18n-contracts-billing/`
  - `docs/plans/2026-03-20-msp-i18n-workflows/`

### Key directories
| Directory | Files | Strings | Batch |
|-----------|-------|---------|-------|
| `packages/surveys/src/components/` | 26 | ~217 | 2b-13 |
| `packages/scheduling/src/components/schedule/` | 11 | ~211 | 2b-14 |
| `packages/documents/src/components/kb/` | 10 | ~189 | 2b-15 |
| `packages/jobs/src/components/monitoring/` | 7 | ~29 | 2b-17 |
| `packages/integrations/src/components/email/` (providers only) | 10 | ~136 | 2b-18 |
| `packages/users/` + `server/src/components/settings/` + `server/src/components/platform-updates/` | 8 | ~64 | 2b-19 |

### Recommended execution order
1. **2b-17 (jobs)** — 29 strings, trivial
2. **2b-19 (profile)** — 64 strings, small
3. **2b-18 (email-providers)** — 136 strings, moderate
4. **2b-15 (knowledge-base)** — 189 strings, moderate
5. **2b-14 (schedule)** — 211 strings, moderate
6. **2b-13 (surveys)** — 217 strings, moderate
7. **2b-20 (close)** — 0 strings, just mark done

## Progress Log

- (2026-03-21) Completed `F001`: added [server/public/locales/en/msp/surveys.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/public/locales/en/msp/surveys.json) as the English source of truth for surveys. Keys were normalized into feature-specific groups (`moduleFrame`, `settings`, `response`, `rating`, `responses`, `dashboard`, `analytics`, `clientSummary`, `ticketSummary`) so later component rewrites can move off `common` cleanly.
- (2026-03-21) Validation for `F001`: parsed the new JSON successfully with `node -e "JSON.parse(...)"`.
- (2026-03-21) Completed `F002`: rewired the survey settings surface to `useTranslation('msp/surveys')` in `TriggerForm.tsx`, `TriggerList.tsx`, `TemplateForm.tsx`, and `TemplateList.tsx`. Shared verbs stayed in `common`, while survey-specific copy moved to the new namespace root with `{ defaultValue }` options.
- (2026-03-21) Validation for `F002`: targeted `eslint` passed cleanly for the four edited survey settings files, and `npx tsc -p packages/surveys/tsconfig.json --noEmit` passed after the settings rewrite.
- (2026-03-21) Completed `F003`: moved `SurveySettings.tsx`, `SurveyResponsePage.tsx`, `RatingDisplay.tsx`, `ResponseFilters.tsx`, `SurveyResponsesView.tsx`, and `ResponseDetailModal.tsx` onto `msp/surveys`. Response detail timestamps now use `useFormatters()`, and `TemplateForm` now requests translated default rating labels from the shared rating helper.
- (2026-03-21) Validation for `F003`: `npx tsc -p packages/surveys/tsconfig.json --noEmit` still passed after the response-flow and shared helper rewrites.
- (2026-03-21) Completed `F004`: localized the remaining survey chrome and insights surface: dashboard widgets, analytics widgets/pages, `SurveyModuleFrame`, `ClientSurveySummaryCard`, and `TicketSurveySummaryCard`. Server components `SurveyDashboard.tsx` and `SurveyAnalyticsPage.tsx` now use `getServerTranslation('msp/surveys')`, and client summary/dashboard lists use `useFormatters()` for locale-aware timestamps.
- (2026-03-21) Validation for `F004`: `npx tsc -p packages/surveys/tsconfig.json --noEmit` passed after the dashboard, analytics, and survey chrome rewrites.
- (2026-03-21) Follow-up survey cleanup before locale generation: kept `RatingDisplay.tsx` on the survey namespace for the rating-button aria label with text, and corrected `TriggerForm.tsx` to reuse `common.messages.required` instead of a missing `common.errors.required` key. Re-ran `npx tsc -p packages/surveys/tsconfig.json --noEmit` to confirm the worktree was clean before starting translated survey locale files.
- (2026-03-21) Completed `F005`: added survey namespace files for `de`, `es`, `fr`, `it`, `nl`, and `pl`, then generated `xx` and `yy` from the English source. The survey locale set now exists in all 9 required locales under `server/public/locales/*/msp/surveys.json`.
- (2026-03-21) Validation for `F005`: parsed the 6 translated JSON files with Node, ran `node scripts/generate-pseudo-locales.cjs`, restored unrelated pre-existing pseudo-locale interpolation differences outside the surveys namespace, and confirmed `node scripts/validate-translations.cjs` passed with `Errors: 0` and `Warnings: 0`.
- (2026-03-21) Completed `F006`: ran the Italian accent audit against [server/public/locales/it/msp/surveys.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/public/locales/it/msp/surveys.json). The broad grep only surfaced legitimate `e` conjunctions; a targeted search for known missing-accent spellings (`puo`, `gia`, `verra`, `funzionalita`, `necessario`) returned no matches, so no Italian copy changes were needed.
- (2026-03-21) Completed `F010`: added [server/public/locales/en/msp/schedule.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/public/locales/en/msp/schedule.json) as the English schedule namespace. The file groups strings by `page`, `sidebar`, `agentView`, `calendar`, `weeklyEvent`, `requests`, `availabilitySettings`, and `entryPopup` so the upcoming wiring can move the schedule surface off hardcoded English in coherent slices.
- (2026-03-21) Validation for `F010`: parsed `server/public/locales/en/msp/schedule.json` successfully with `node -e "JSON.parse(...)"`.
- (2026-03-21) Completed `F011`: wired the three largest schedule files to `useTranslation('msp/schedule')`. `EntryPopup.tsx` now uses translated dialog/validation/approval/recurrence copy and locale-aware date formatting for appointment request timestamps; `AvailabilitySettings.tsx` now translates dialog tabs, auto-approval/settings copy, tables, exceptions, and success/error toasts; `ScheduleCalendar.tsx` now translates the legend, toolbar, loading states, delete dialogs, and month-view event tooltips with locale-aware dates.
- (2026-03-21) Validation for `F011`: `git diff --check` passed, and `npx tsc -p packages/scheduling/tsconfig.json --noEmit` passed after the schedule rewrites.
- (2026-03-21) Completed `F012`: localized the rest of the schedule surface. `AppointmentRequestsPanel.tsx` now translates the request list/detail/approval flow and uses locale-aware request timestamps; `SchedulePage.tsx`, `AgentScheduleView.tsx`, `WeeklyScheduleEvent.tsx`, and `TechnicianSidebar.tsx` now translate page chrome, overlay states, compare controls, delete tooltips, and event tooltip copy.
- (2026-03-21) Validation for `F012`: `git diff --check` passed, and `npx tsc -p packages/scheduling/tsconfig.json --noEmit` passed after wiring the remaining schedule files with user-visible strings.
- (2026-03-21) Completed `F013`: added schedule locale files for `de`, `es`, `fr`, `it`, `nl`, and `pl`, then generated targeted `xx` and `yy` pseudo-locales from the English source. The schedule namespace now exists in all 9 required locales under `server/public/locales/*/msp/schedule.json`.
- (2026-03-21) Validation for `F013`: counted 293 leaf strings in each generated real locale, confirmed the pseudo-locale outputs return `11111` for schedule keys, and re-ran `node scripts/validate-translations.cjs` with `Errors: 0` and `Warnings: 0`.
- (2026-03-21) Completed `F014`: ran the Italian accent audit against [server/public/locales/it/msp/schedule.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/public/locales/it/msp/schedule.json). The broad grep only matched legitimate conjunctions such as `data e ora` and `Questo e gli eventi futuri`; a tighter search for common accentless spellings (`puo`, `gia`, `verra`, `funzionalita`, `perche`, weekday names without accents) returned no matches, so no Italian copy changes were required.
- (2026-03-21) Completed `F020`: added [server/public/locales/en/msp/knowledge-base.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/public/locales/en/msp/knowledge-base.json) as the English KB namespace source of truth. The file is grouped by surface (`page`, `list`, `editor`, `filters`, `categoryTree`, `publishing`, `reviewDashboard`, `importDialog`, `staleness`, `shared`) so the upcoming KB rewrites can move off `features/documents` cleanly while also covering the currently hardcoded status, audience, type, review-cycle, and pagination labels.
- (2026-03-21) Validation for `F020`: parsed the new JSON successfully and counted 163 leaf strings, covering the existing `kb.*` copy plus the missing hardcoded option-label maps surfaced during the KB inventory.
- (2026-03-21) Completed `F021`: rewired [KBArticleEditor.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/documents/src/components/kb/KBArticleEditor.tsx), [KBArticleList.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/documents/src/components/kb/KBArticleList.tsx), and [KnowledgeBasePage.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/documents/src/components/kb/KnowledgeBasePage.tsx) to `useTranslation('msp/knowledge-base')`. The editor and list now pull status, audience, type, review-cycle, pagination, and archive-dialog copy from the new KB namespace, and the editor/list date rendering now uses locale-aware `useFormatters()` helpers instead of hardcoded English formatting defaults.
- (2026-03-21) Validation for `F021`: `git diff --check` passed, `rg` confirmed there are no remaining `features/documents` or legacy `kb.` lookups in the three rewritten files, and `npx tsc -p packages/documents/tsconfig.json --noEmit` passed after the KB namespace swap.
- (2026-03-21) Completed `F022`: moved the rest of the KB surface to `msp/knowledge-base`: [KBImportDialog.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/documents/src/components/kb/KBImportDialog.tsx), [KBPublishingControls.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/documents/src/components/kb/KBPublishingControls.tsx), [KBReviewDashboard.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/documents/src/components/kb/KBReviewDashboard.tsx), [KBArticleFilters.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/documents/src/components/kb/KBArticleFilters.tsx), [KBCategoryTree.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/documents/src/components/kb/KBCategoryTree.tsx), and [KBStalenessBadge.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/documents/src/components/kb/KBStalenessBadge.tsx). This pass also removed the remaining hardcoded status, audience, type, and import-summary strings, and converted the inline English date/count string-building in publishing, import, review, and staleness UI to named interpolation values.
- (2026-03-21) Validation for `F022`: `git diff --check` passed, `rg` confirmed the six remaining KB files no longer reference `features/documents` or legacy `kb.` keys, and `npx tsc -p packages/documents/tsconfig.json --noEmit` passed after the remainder of the KB namespace migration.
- (2026-03-21) Completed `F023`: added KB namespace files for `de`, `es`, `fr`, `it`, `nl`, and `pl`, then generated targeted `xx` and `yy` pseudo-locales from the English source. The KB namespace now exists in all 9 required locales under `server/public/locales/*/msp/knowledge-base.json`.
- (2026-03-21) Validation for `F023`: counted 163 leaf strings in each generated real locale, confirmed the pseudo-locale outputs were generated from the KB English source without touching unrelated namespaces, and re-ran `node scripts/validate-translations.cjs` with `Errors: 0` and `Warnings: 0`.
- (2026-03-21) Completed `F024`: ran the Italian accent audit against [server/public/locales/it/msp/knowledge-base.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/public/locales/it/msp/knowledge-base.json). The broad grep only surfaced legitimate conjunctions such as `creare e gestire`; a tighter search for common accentless spellings (`puo`, `gia`, `verra`, `funzionalita`, `perche`, weekday names without accents) returned no matches, so no Italian copy changes were required.
- (2026-03-21) Completed `F030`: added [server/public/locales/en/msp/jobs.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/public/locales/en/msp/jobs.json) as the English jobs namespace. The file is grouped by monitoring surface (`recentTable`, `metrics`, `historyTable`, `progress`, `drawer`, `stepHistory`, `shared`) so the next jobs rewrite can cover table columns, status/runner labels, relative-time copy, drawer headings, and step-history labels from one namespace.
- (2026-03-21) Validation for `F030`: parsed the new JSON successfully and counted 47 leaf strings, reflecting the extra step-history and time-format copy that the original jobs estimate undercounted.
- (2026-03-21) Completed `F031`: rewired the jobs monitoring components to `useTranslation('msp/jobs')`: [RecentJobsDataTable.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/jobs/src/components/monitoring/RecentJobsDataTable.tsx), [JobMetricsDisplay.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/jobs/src/components/monitoring/JobMetricsDisplay.tsx), [JobHistoryTable.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/jobs/src/components/monitoring/JobHistoryTable.tsx), [JobProgress.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/jobs/src/components/monitoring/JobProgress.tsx), [JobDetailsDrawer.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/jobs/src/components/monitoring/JobDetailsDrawer.tsx), and [JobStepHistory.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/jobs/src/components/monitoring/JobStepHistory.tsx). This moved the remaining hardcoded table/drawer/metrics copy into the jobs namespace, localized status and runner labels, and replaced the progress panel's English-only `date-fns` relative-time string with locale-aware `useFormatters()`.
- (2026-03-21) Validation for `F031`: `git diff --check` passed, `npx tsc -p packages/jobs/tsconfig.json --noEmit` passed after the jobs namespace swap, and the one TypeScript issue surfaced during the pass (`count` typed as a string in the seconds formatter) was fixed by keeping the interpolated count numeric.

## Open Questions

- **Public survey page locale**: How does SurveyResponsePage.tsx resolve locale without an authenticated MSP session?
- **Security settings overlap**: Which SecuritySettingsPage strings are already in `msp/settings`?
- **Email namespace loading**: Adding `msp/email-providers` to the already-loaded `/msp/settings` route increases namespace count. Check performance.
