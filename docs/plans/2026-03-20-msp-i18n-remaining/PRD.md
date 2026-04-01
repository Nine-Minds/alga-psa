# PRD — MSP i18n Remaining Batches: Surveys, Schedule, KB, Jobs, Email, Profile, Misc

- Slug: `2026-03-20-msp-i18n-remaining`
- Date: `2026-03-20`
- Status: Draft

## Summary

Translate all remaining MSP feature areas not covered by previous plans. This is the final plan — after this, every MSP component will have a translation plan.

| Batch | Namespace | Strings | Files | Package/Location |
|-------|-----------|---------|-------|------------------|
| 2b-13 | `msp/surveys` | ~217 | 26 | `packages/surveys/src/components/` |
| 2b-14 | `msp/schedule` | ~211 | 11 | `packages/scheduling/src/components/schedule/` |
| 2b-15 | `msp/knowledge-base` | ~189 | 10 | `packages/documents/src/components/kb/` |
| 2b-17 | `msp/jobs` | ~29 | 7 | `packages/jobs/src/components/monitoring/` |
| 2b-18 | `msp/email-providers` | ~136 | 10 | `packages/integrations/src/components/email/` (provider forms, NOT admin — admin is in 2b-8) |
| 2b-19 | `msp/profile` | ~64 | 8 | `packages/users/`, `server/src/components/settings/profile/`, `server/src/components/settings/security/`, `server/src/components/platform-updates/` |
| 2b-20 | (no new namespace) | ~0 | ~2 | Extensions + licensing — no user-visible strings found |
| **Total** | | **~846** | **72** | |

> **2b-20 is effectively empty**: `DynamicNavigationSlot.tsx`, `ReduceLicensesModal.tsx`, and `LicensePurchaseForm.tsx` have zero hardcoded strings. No namespace needed.

## Problem

These 6 remaining areas are the final untranslated MSP surfaces. While lower traffic than clients/contracts/assets, they still present English-only UI to non-English users. Completing these means 100% of MSP components have translation plans.

## Goals

1. Create 6 new namespaces (surveys, schedule, knowledge-base, jobs, email-providers, profile)
2. Wire all 72 component files with `useTranslation()`
3. Generate translations for 7 languages + 2 pseudo-locales (54 new locale files)
4. Register namespaces in `ROUTE_NAMESPACES`
5. Close batch 2b-20 as "no work needed"

## Non-goals

- Email admin components (EmailSettings, InboundTicketDefaultsManager, Microsoft365DiagnosticsDialog) — already in 2b-8 plan
- Client-portal views of surveys/schedule/KB — those would go in shared `features/*.json`
- Translating dynamic content from database (survey questions, KB article content, email body)

## Requirements

### Batch 2b-13: msp/surveys (~217 strings, 26 files)

| Component | LOC | Strings | Key content |
|-----------|-----|---------|-------------|
| triggers/TriggerForm.tsx | 656 | ~35 | Trigger configuration form |
| templates/TemplateForm.tsx | 474 | ~28 | Survey template builder |
| triggers/TriggerList.tsx | 426 | ~22 | Trigger listing, status badges |
| templates/TemplateList.tsx | 423 | ~24 | Template listing, actions |
| SurveySettings.tsx | 202 | ~12 | Settings panel |
| public/SurveyResponsePage.tsx | 189 | ~18 | Public-facing survey form |
| shared/RatingDisplay.tsx | 185 | ~14 | Rating visualization |
| responses/SurveyResponsesView.tsx | 154 | ~11 | Response listing |
| responses/ResponseFilters.tsx | 132 | ~10 | Filter UI |
| dashboard/ResponseTrendChart.tsx | 132 | ~9 | Trend chart labels |
| dashboard/ResponseMetrics.tsx | 115 | ~8 | Metric cards |
| analytics/FilterPanel.tsx | 106 | ~8 | Analytics filters |
| Remaining 14 files | ~1,099 | ~18 | Dashboard panels, cards, export, detail modal |

**ROUTE_NAMESPACES:**
```
'/msp/surveys': ['common', 'msp/core', 'msp/surveys']
```

### Batch 2b-14: msp/schedule (~211 strings, 11 files)

| Component | LOC | Strings | Key content |
|-----------|-----|---------|-------------|
| EntryPopup.tsx | 1,287 | ~68 | Schedule entry create/edit popup — largest file |
| AvailabilitySettings.tsx | 1,215 | ~64 | Availability window management |
| ScheduleCalendar.tsx | 1,128 | ~42 | Main calendar view |
| AppointmentRequestsPanel.tsx | 645 | ~28 | Appointment request management |
| CalendarStyleProvider.tsx | 332 | ~4 | Style provider (minimal strings) |
| AgentScheduleView.tsx | 240 | ~3 | Agent schedule view |
| WeeklyScheduleEvent.tsx | 227 | ~1 | Weekly event rendering |
| SchedulePage.tsx | 139 | ~1 | Page wrapper |
| 3 files (TechnicianSidebar, AgentScheduleDrawerStyles, DynamicBigCalendar) | ~252 | ~0 | No user-visible strings |

**ROUTE_NAMESPACES:**
```
'/msp/schedule': ['common', 'msp/core', 'msp/schedule']
```

### Batch 2b-15: msp/knowledge-base (~189 strings, 10 files)

| Component | LOC | Strings | Key content |
|-----------|-----|---------|-------------|
| KBArticleEditor.tsx | 567 | ~52 | Article create/edit with rich text |
| KBArticleList.tsx | 395 | ~41 | Article listing, filters |
| KnowledgeBasePage.tsx | 305 | ~38 | Main KB page layout |
| KBImportDialog.tsx | 292 | ~35 | Bulk import dialog |
| KBPublishingControls.tsx | 277 | ~28 | Publish/draft/review controls |
| KBReviewDashboard.tsx | 217 | ~18 | Review queue |
| KBArticleFilters.tsx | 192 | ~12 | Filter dropdowns |
| KBCategoryTree.tsx | 168 | ~7 | Category navigation |
| KBStalenessBadge.tsx | 74 | ~2 | Staleness indicator |
| index.ts | 13 | 0 | Exports only |

**ROUTE_NAMESPACES:**
```
'/msp/knowledge-base': ['common', 'msp/core', 'features/documents', 'msp/knowledge-base']
```

### Batch 2b-17: msp/jobs (~29 strings, 7 files)

Smallest batch — job monitoring is admin-only.

| Component | LOC | Strings | Key content |
|-----------|-----|---------|-------------|
| monitoring/RecentJobsDataTable.tsx | 249 | ~10 | Job table columns, status badges |
| monitoring/JobMetricsDisplay.tsx | 134 | ~8 | Metric cards (Total, Success Rate, Avg Duration) |
| monitoring/JobHistoryTable.tsx | 122 | ~6 | History table columns |
| monitoring/JobProgress.tsx | 81 | ~3 | Progress indicator |
| monitoring/JobDetailsDrawer.tsx | 64 | ~2 | Detail drawer labels |
| monitoring/JobStepHistory.tsx | 49 | 0 | No visible strings |
| index.ts | 7 | 0 | Exports only |

**ROUTE_NAMESPACES:**
```
'/msp/jobs': ['common', 'msp/core', 'msp/jobs']
```

### Batch 2b-18: msp/email-providers (~136 strings, 10 files)

Email provider configuration forms — separate from admin settings (2b-8).

| Component | LOC | Strings | Key content |
|-----------|-----|---------|-------------|
| MicrosoftProviderForm.tsx | 508 | ~32 | Microsoft 365 config form |
| EmailProviderConfiguration.tsx | 464 | ~26 | Provider config router/wrapper |
| GmailProviderForm.tsx | 459 | ~24 | Gmail config form |
| forms/InboundTicketDefaultsForm.tsx | 447 | ~22 | Inbound defaults form fields |
| ImapProviderForm.tsx | 388 | ~18 | IMAP config form |
| EmailProviderCard.tsx | 338 | ~14 | Provider status card |
| 4 remaining files | ~375 | ~0 | Selector, list, wrapper, wizard (no visible strings) |

**ROUTE_NAMESPACES:** loads on settings route alongside admin:
```
'/msp/settings': ['common', 'msp/core', 'msp/settings', 'msp/admin', 'msp/email-providers', 'features/projects']
```

### Batch 2b-19: msp/profile (~64 strings, 8 files)

User profile, password change, security settings, platform updates.

| Component | LOC | Strings | Key content |
|-----------|-----|---------|-------------|
| security/AdminSessionManagement.tsx | 471 | ~16 | Session management table |
| users/settings/PasswordChangeForm.tsx | 208 | ~12 | Password form, validation |
| settings/profile/UserProfile.tsx | 164 | ~17 | Profile page layout |
| security/UserRoleAssignment.tsx | 251 | ~9 | Role assignment UI |
| security/SecuritySettingsPage.tsx | 196 | ~4 | Security page wrapper |
| platform-updates/PlatformUpdateDetail.tsx | 89 | ~6 | Update detail view |
| users/profile/UserAvatarUpload.tsx | 40 | ~0 | No visible strings |
| users/index.ts | 3 | 0 | Exports only |

**ROUTE_NAMESPACES:**
```
'/msp/profile': ['common', 'msp/core', 'msp/settings', 'msp/profile']
'/msp/security-settings': ['common', 'msp/core', 'msp/settings', 'msp/profile']
'/msp/platform-updates': ['common', 'msp/core', 'msp/profile']
```

### Batch 2b-20: extensions + licensing — NO WORK NEEDED

Investigated files:
- `packages/ui/src/components/extensions/DynamicNavigationSlot.tsx` — 0 strings
- `ReduceLicensesModal.tsx` — 0 strings
- `LicensePurchaseForm.tsx` — 0 strings

**Status: Close as "no translation needed".**

### Non-functional Requirements

- Follow naming convention from translation-guide.md
- All `t()` calls use `{ defaultValue: '...' }` for English fallback
- Feature flag `msp-i18n-enabled` OFF = forced English
- Console messages stay English

## Rollout / Migration

- Behind `msp-i18n-enabled` feature flag
- No database changes
- Batches can be merged independently

## Open Questions

1. **Public survey page**: `SurveyResponsePage.tsx` is public-facing (not behind MSP auth). Should it use `msp/surveys` or a separate shared namespace? If it's accessible without login, the locale resolution differs.
2. **Email provider forms vs admin**: The boundary between 2b-8 (admin) and 2b-18 (email-providers) needs to be clear during implementation. Admin = settings-level config. Providers = per-provider SMTP/IMAP/Gmail/M365 forms.
3. **Security settings overlap**: `SecuritySettingsPage.tsx` is already partially covered by `msp/settings` namespace (tab labels). Only the page-level wrapper and session management are new.

## Acceptance Criteria

### Per batch
- [ ] English namespace JSON created with all keys
- [ ] All component files wired with `useTranslation()`
- [ ] All 7 production locale files created
- [ ] Pseudo-locale files created (xx, yy)
- [ ] Italian accent audit passes
- [ ] `validate-translations.cjs` passes

### Cross-cutting
- [ ] `ROUTE_NAMESPACES` updated for all routes
- [ ] `msp-i18n-enabled` OFF: English text, no regressions
- [ ] `msp-i18n-enabled` ON + locale `xx`: all pages show `11111`
- [ ] `npm run build` succeeds
- [ ] 2b-20 closed as "no work needed"
- [ ] **All MSP feature areas now have translation plans — 100% coverage**
