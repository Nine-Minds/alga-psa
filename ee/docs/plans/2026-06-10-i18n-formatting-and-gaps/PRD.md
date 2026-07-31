# PRD — i18n Hardening: Locale-Aware Formatting, Gap Backfill, Pluralization, CI Enforcement

- Slug: `2026-06-10-i18n-formatting-and-gaps`
- Date: `2026-06-10`
- Status: Draft

## Summary

Close the remaining systemic i18n gaps that sit *around* string translation rather than in it. Five phases, each independently shippable as a PR:

| Phase | Area | Size |
|-------|------|------|
| P1 | Locale-aware formatting components + pseudo-locales in dev mode | ~8 files |
| P2 | Backfill 555 missing English locale keys (+ 7 locale translations) | ~20 namespaces |
| P3 | Translate skipped surfaces: `msp-composition` client/contact tabs + interactions feeds | 6 components |
| P4 | Pluralization: migrate dead legacy `_plural` keys, fix CLDR-unaware validator | 4 keys + validator |
| P5 | CI enforcement: `find-missing-i18n-keys.cjs` in CI with full path triggers | 1 workflow |

## Problem

1. **Formatting ignores locale.** `CurrencyInput`, `DatePicker`, `DateTimePicker`, `Calendar`, and `ReportEngine` hardcode `en-US`/`MM/dd/yyyy`, so even fully translated screens render US formats for all users.
2. **555 keys referenced in code don't exist in English locale files** (`find-missing-i18n-keys.cjs`), so users see default-value fallbacks or raw keys. Concentrated in workflows (131), email-providers (111), integrations (81), features/tickets (81), clients (54), assets (40), user-activities (37).
3. **`packages/msp-composition` was never claimed by any translation batch.** The MSP i18n plans were organized by feature package; the composition layer that renders the Tickets/Assets tabs on client and contact pages (`MspClientTickets`, `MspClientAssets`, `MspContactTickets`) is fully hardcoded. The interactions feeds (`InteractionsFeed`, `OverallInteractionsFeed`, `SchedulingInteractionDetails`) were similarly skipped.
4. **Legacy `key_plural` keys are dead.** i18next v25 runs in v4 plural mode (no `compatibilityJSON` is set anywhere), so the 4 legacy `_plural` keys in `en/msp/settings.json` and `en/msp/profile.json` never resolve. Worse, `validate-translations.cjs` is CLDR-unaware: it falsely warns on Polish `_few`/`_many` forms (which are *required* for Polish) while not flagging genuinely missing plural forms.
5. **Pseudo-locales (`xx`/`yy`) were meant to be selectable in dev mode** but `filterPseudoLocales()` strips them unconditionally — the original intent slipped through the cracks.
6. **No CI guard against the "missing key" class of regression.** `find-missing-i18n-keys.cjs` exits 1 on failure but is manual-only, and the `validate-translations.yml` workflow only triggers on locale-file paths, so component changes never run it.

## Goals

1. All shared formatting components and ReportEngine derive formats from the active locale (purely locale-derived; no new preference UI).
2. Pseudo-locales appear in all language pickers when `NODE_ENV === 'development'`.
3. `find-missing-i18n-keys.cjs` reports 0 missing keys; backfilled keys translated into all 7 non-English production locales + regenerated pseudo-locales.
4. Client-page Tickets/Assets/Interactions tabs (and contact-page tickets) are fully translated.
5. All plural keys use i18next v4 count-based forms (`_one`/`_other`/`_few`/`_many` per CLDR); validator understands CLDR plural categories per locale.
6. Both i18n scripts run in CI on every PR that touches components or locale files.

## Non-goals

- Transactional EJS emails (verify/reset/welcome) — explicitly deferred.
- Invoice PDF / AssemblyScript-WASM renderer localization.
- Page metadata (`generateMetadata`) localization.
- RTL support.
- Explicit user-facing date-format preference (separate future effort; this plan stays locale-derived so that effort layers on top).
- ESLint rule against hardcoded JSX strings (deferred; revisit after P5 proves out).
- Completing the `pt` locale (stays in `INCOMPLETE_LOCALES`).
- Translating ui-reflection `label`/`helperText` automation metadata (not user-visible UI).

## Requirements

### P1a — Locale-aware formatting components

Foundation: add `useOptionalI18n()` to `packages/ui/src/lib/i18n/client.tsx` — same as `useI18n()` but returns `null` outside `I18nProvider` (DatePicker/CurrencyInput render on auth pages without the provider; they must not crash). Locale falls back to `LOCALE_CONFIG.defaultLocale`. `packages/ui/src/lib/dateFnsLocale.ts` already maps all 10 locales to date-fns locale objects.

| Component | Change |
|-----------|--------|
| `DatePicker.tsx:117` | `format(value, 'P', { locale: getDateFnsLocale(locale) })`; optional `displayFormat` prop escape hatch |
| `DateTimePicker.tsx:182` | Explicit `timeFormat` prop wins (`'P hh:mm a'` / `'P HH:mm'`); unset → `'P p'` |
| `Calendar.tsx` | Pass date-fns locale to `DayPicker`; localize `MonthYearSelect` caption `format()` calls |
| `CurrencyInput.tsx` | Locale-aware format **and parse** (see risk below) |
| `PrintOptionsDialog.tsx:67` | `formatDefaultPrintValue` uses active locale instead of bare `toLocaleString()` |
| `ReportEngine.ts` (both copies) | `locale?: string` on `ReportExecutionOptions`, threaded to all 5 `format*` call sites; default `'en-US'` preserves behavior for untouched callers. `executeReport` action resolves locale via `getHierarchicalLocaleAction` from `@alga-psa/tenancy` |

**Critical risk — CurrencyInput parsing:** current code does `raw.replace(/,/g, '')` + `parseFloat`. If formatting becomes French (`1 234,56`) but parsing stays US, typing `12,5` yields **1250** — silent 100× data corruption. Formatting and parsing must change as a unit: derive group/decimal separators from `Intl.NumberFormat(locale).formatToParts()`, strip group separators, normalize the decimal separator to `.` before `parseFloat`. Round-trip tests for `en`, `de`, `fr`, `pl` mandatory. Only 2 usage sites, limiting blast radius.

Audit step: review DatePicker's 37+ call sites for any that rely on `MM/dd/yyyy` output for parsing/serialization rather than pure display.

### P1b — Pseudo-locales in dev mode

Single change point: `filterPseudoLocales()` in `packages/core/src/lib/i18n/config.ts:127` keeps `xx`/`yy` when `process.env.NODE_ENV === 'development'`. All 7 pickers already route through it. `INCOMPLETE_LOCALES` (`pt`) stays filtered even in dev. Precedent for `NODE_ENV` branching exists in the same file (`cookie.secure`, i18next `debug`); Next.js inlines it client-side. Rebuild `packages/core` dist (`npx nx build core`).

### P2 — Missing English keys backfill (555)

Backfill `en` first (defaults are mostly recoverable from `defaultValue` in the `t()` calls), then translate to fr/es/de/nl/it/pl/pt, then regenerate pseudo-locales. Namespace order by user impact:

| Namespace | Keys | Primary files |
|-----------|------|---------------|
| msp/workflows | 131 | `WorkflowRunList`, `WorkflowDesigner`, `RunStudioShell` (EE) |
| msp/email-providers | 111 | `InboundEmailRuleForm` (83 refs) |
| msp/integrations | 81 | `LevelIoIntegrationSettings` (61), `InboundEmailRulesManager` |
| features/tickets | 81 | `TicketChecklistSection` (30), `TicketingDashboard` (23) |
| msp/clients | 54 | `Clients.tsx`, `MeetingAttendeesPicker`, `ClientDetails` |
| msp/assets | 40 | `AssetDashboardClient` (37) |
| msp/user-activities | 37 | `ActivitiesTableFilters`, `AdHocDetailPanel` |
| ~13 others | ~120 | incl. cross-namespace `actions.print`/`actions.printOptions` cluster (print/export feature shipped without any keys) |

Exit criterion: `node scripts/find-missing-i18n-keys.cjs` exits 0.

### P3 — Skipped surfaces

| Component | Location | Namespace |
|-----------|----------|-----------|
| `MspClientTickets.tsx` | `packages/msp-composition/src/clients/` | `msp/clients` |
| `MspClientAssets.tsx` | `packages/msp-composition/src/clients/` | `msp/clients` |
| `MspContactTickets.tsx` | `packages/msp-composition/src/clients/` | `msp/contacts` |
| `InteractionsFeed.tsx` | `packages/clients/src/components/interactions/` | `msp/clients` |
| `OverallInteractionsFeed.tsx` | `packages/clients/src/components/interactions/` | `msp/clients` |
| `SchedulingInteractionDetails.tsx` | `packages/scheduling/src/components/shared/` | `msp/schedule` |

Wire `useTranslation()`, add keys to `en` + 7 locales + pseudo-locales. Verify `ROUTE_NAMESPACES` already loads the chosen namespaces on `/msp/clients` and `/msp/contacts` (it does today). Sweep the other 16 `msp-composition` files and document that they have no user-visible strings (providers/wrappers); record per-file in SCRATCHPAD.

### P4 — Pluralization

Inventory (confirmed): 4 legacy `_plural` keys across `en/msp/settings.json` + `en/msp/profile.json` (`teams.details.memberCount_plural`, interaction-types `imported_plural`, `security.sessions.subtitle_plural` ×2) plus counterparts in 7 locales.

1. Migrate to i18next v4 forms: `_one`/`_other` for English; correct CLDR set per locale (Polish: `_one`/`_few`/`_many`/`_other`).
2. Fix consumers doing manual plural selection — `AdminSessionManagement.tsx:239-240` picks `subtitle` vs `subtitle_plural` in code; replace with a single `t()` call using `count`. Note: `subtitle` interpolates two counts (`sessionCount`, `userCount`); pass `count: sessionCount` for plural selection while keeping both interpolation variables.
3. Make `validate-translations.cjs` CLDR-aware via `Intl.PluralRules(locale).resolvedOptions().pluralCategories`: stop false-warning on Polish `_few`/`_many`; **flag** locales missing required plural categories for a key that has plural forms in English.
4. Verify `generate-pseudo-locales.cjs` carries plural-suffixed keys through correctly.

Exit criterion: `validate-translations.cjs` passes with 0 warnings.

### P5 — CI enforcement

- Add a `find-missing-i18n-keys` job to `.github/workflows/validate-translations.yml` (script already exits 1 on failure).
- Expand workflow `paths` triggers to include component sources: `packages/**`, `server/src/**`, `ee/server/src/**`, `scripts/find-missing-i18n-keys.cjs` (currently locale files only — component changes never trigger validation).
- Must land **after** P2 (otherwise CI is red on arrival).

## Rollout

Five PRs, one per phase, in order P1 → P2 → P3 → P4 → P5 (P3/P4 may proceed in parallel after P2; P5 strictly after P2). Each phase leaves `main` green: validation scripts pass, existing `.i18n.test.*` audit suites pass.

## Risks

| Risk | Mitigation |
|------|------------|
| CurrencyInput locale parsing corrupts amounts (100× errors) | Format+parse change as a unit; round-trip tests across 4 locales; only 2 usage sites |
| DatePicker call sites depending on fixed `MM/dd/yyyy` output | Pre-change audit of all 37+ call sites; `displayFormat` escape hatch |
| 555-key backfill drifts from on-screen defaults | Source keys from `defaultValue` in code; pseudo-locale visual QA (unlocked by P1b) |
| Machine-translated backfill quality in 7 locales | Same translation process as prior MSP batches; `pt` already flagged incomplete |
| Plural migration changes rendered strings | Per-key before/after snapshot in tests; only 4 keys |
| CI job surfaces pre-existing failures on unrelated PRs | Land P5 only after P2 zeroes the count |

## Open Questions

1. Namespace for interactions feed keys: reuse `msp/clients` `interactions.*` prefix (where `InteractionDetails`/`QuickAddInteraction` keys already live) — assumed yes.
2. Should `DateTimePicker`'s `timeFormat` default flip to locale-derived everywhere, or keep `12h` default where currently explicit? Assumed: explicit prop wins, unset becomes locale-derived.
3. ESLint hardcoded-string rule — deferred to a follow-up after P5; revisit then.

## Acceptance Criteria / Definition of Done

- [ ] A user with `fr` locale sees `dd/MM/yyyy`-style dates in DatePicker/DateTimePicker/Calendar, French month/weekday names, and `1 234,56`-style numbers in CurrencyInput — and typed `12,5` parses as 12.5.
- [ ] Reports render dates/numbers/currency in the viewer's hierarchical locale; callers passing no locale get unchanged `en-US` output.
- [ ] In dev mode, all language pickers list `Pseudo (xx)` and `Pseudo (yy)`; in production builds they don't. `pt` hidden in both.
- [ ] `node scripts/find-missing-i18n-keys.cjs` exits 0.
- [ ] Client page Tickets/Assets/Interactions tabs and contact page Tickets tab render fully in the active locale (verified via pseudo-locale).
- [ ] No `_plural`-suffixed keys remain in any locale file; `validate-translations.cjs` passes with 0 errors and 0 warnings; Polish plural forms render correctly for counts 1, 2, 5.
- [ ] Both scripts run in CI on PRs touching `packages/**`, `server/src/**`, `ee/server/src/**`, or locale files.
