# Scratchpad — MSP i18n: Credits Sub-batch

- Plan slug: `2026-04-09-msp-i18n-credits`
- Created: `2026-04-09`
- Last synced to codebase: `2026-04-17`

## Status Recheck (2026-04-17)

**Correction (2026-04-17 re-read):** an earlier version of this section said "Still 0% implemented" — that was based on stale `ls` output against `origin/main`. The **actual** state on branch `i18n/billing_credits` (32 commits ahead of origin/main) is:

- `features.json`: **22/22** features implemented.
- `tests.json`: **31/31** tests implemented.
- `server/public/locales/en/msp/credits.json` **exists** (plus de/es/fr/it/nl/pl/xx/yy — 9 locale files total, 185 lines each).
- All 8 client components wired with `useTranslation('msp/credits')` (except `CreditsPage.tsx` which delegates to the new `CreditsPageClient.tsx` wrapper per the server-component decision).
- New file: `packages/billing/src/components/credits/CreditsPageClient.tsx` (350 LOC) implementing the recommended server→client split.
- `/msp/billing/credits` added to `ROUTE_NAMESPACES` in `packages/core/src/lib/i18n/config.ts`.
- Seven new Vitest suites under `packages/billing/tests/` (`CreditsPage`, `CreditControls`, `CreditManagement`, `CreditReconciliation`, `CreditApplicationExpiration`, `CreditsLocaleSmoke`, `creditsNamespaceAndRoute`).

Status on this branch: **implementation complete, pending merge to `main`**. On `origin/main` the plan is still 0%.

### Adjacent work (context)

| Change | Impact |
|---|---|
| Billing-settings plan (`2026-04-09-msp-i18n-billing-settings`) shipped — `CreditExpirationSettings` lives in `msp/billing-settings`, not `msp/credits`. | No file overlap; the dashboard-side `CreditExpirationInfo.tsx` + `CreditExpirationModificationDialog.tsx` are covered here. Terminology mirrored across namespaces. |
| Enum-labels pattern adopted 2026-04-14 (`.ai/translation/enum-labels-pattern.md`). | No shared billing-frequency enum rendering in the 10 credit components — no migration needed. |

---

## What This Is

Greenfield i18n namespace creation + wiring for 10 credit management components. Unlike the
tickets migration (which extended an existing 147-key namespace), this batch creates
`msp/credits.json` from scratch and wires all components for the first time.

## Decisions

- **(2026-04-09)** Create a dedicated `msp/credits` namespace rather than adding to
  `features/billing.json`. Rationale: credit management is MSP-only (no client-portal
  equivalent), and the billing namespace already covers invoicing/plans. ~80 keys warrants
  its own file.
- **(2026-04-09)** `CreditsPage.tsx` is a server component. Strategy: create a thin
  `CreditsPageClient.tsx` wrapper that calls `useTranslation('msp/credits')` and passes
  translated strings down. The server component fetches data; the client component handles
  i18n. This matches the pattern used elsewhere in the codebase.
- **(2026-04-09)** `CreditsTabs.tsx` has zero user-visible strings (tab labels come from
  props). Skip it entirely.
- **(2026-04-09)** `actions.ts` is a server action file. The error strings like
  `'Authentication required'` and `'Transfer amount must be greater than zero'` do surface
  to callers via the `{ success: false, error: '...' }` return shape. However, these are
  consumed by client components that can translate them at the display layer. Leave
  `actions.ts` untouched; translate error display in consuming components.
- **(2026-04-09)** Use `t('key', { defaultValue: 'English fallback' })` pattern per project
  convention. This ensures English renders if translations are missing.
- **(2026-04-09)** Currency amounts stay formatted via `formatCurrency()` (which already
  handles locale). Dates stay formatted via `toLocaleDateString()` or `formatDateOnly()`.
  Do NOT wrap these in `t()`.
- **(2026-04-09)** Recharts `name` props in Bar/Pie components (e.g., "Credits Issued",
  "Credits Applied") need translation since they appear in chart legends. The `formatter`
  callbacks that use `formatCurrency()` do NOT need translation.

## Discoveries / Constraints

- **(2026-04-09)** `CreditManagement.tsx` (642 LOC) and `CreditReconciliation.tsx` (604 LOC)
  are the largest components. CreditManagement has duplicate column definitions with
  `CreditsPage.tsx` -- both define columns for the credits table with identical titles.
  Consider extracting shared column title keys to avoid duplication.
- **(2026-04-09)** `CreditManagement.tsx` contains a `renderCreditContext()` helper function
  with several context-specific labels (Lineage Missing, Transferred Recurring Credit,
  Recurring Source, Financial Only). These are credit-specific domain terms that need
  careful translation.
- **(2026-04-09)** `CreditReconciliation.tsx` uses `toast.success()` for the validation
  result message. This needs interpolation:
  `t('reconciliation.validationResult', { balanceCount: result.balanceDiscrepancyCount, trackingCount: result.missingTrackingCount + result.inconsistentTrackingCount })`.
- **(2026-04-09)** The chart time-range labels in `generateExpirationChartData` (< 7 days,
  < 30 days, < 90 days, > 90 days) should be translated. These are passed as `name` to
  Recharts data arrays and appear in tooltips/legends.
- **(2026-04-09)** The `/msp/billing/credits` route does not currently exist in
  `ROUTE_NAMESPACES`. The existing `/msp/billing` entry loads
  `['common', 'msp/core', 'features/billing', 'msp/reports']`. The new entry must be placed
  so that longest-prefix matching resolves it before `/msp/billing`. Since object key order
  matters for iteration, insert it immediately above the `/msp/billing` line.
- **(2026-04-09)** `CreditReconciliation.tsx` uses `useSession` from `next-auth/react` to
  get the current user ID for the validation action. This is unrelated to i18n but notable
  -- it does not use `withAuth`.

## Key Groups in msp/credits.json

| Group | Est. Keys | Source Components |
|-------|----------|-------------------|
| page | 6 | CreditsPage |
| columns | 10 | CreditsPage, CreditManagement |
| status | 5 | CreditsPage, CreditManagement |
| actions | 8 | CreditsPage, CreditManagement, AddCreditButton, BackButton |
| tabs | 3 | CreditsPage, CreditManagement |
| settings | 8 | CreditsPage |
| charts | 10 | CreditManagement, CreditsPage |
| stats | 4 | CreditManagement |
| management | 4 | CreditManagement |
| reconciliation | 25 | CreditReconciliation |
| application | 15 | CreditApplicationUI |
| expiration | 6 | CreditExpirationInfo |
| expirationDialog | 13 | CreditExpirationModificationDialog |
| context | 8 | CreditManagement |
| **Total** | **~125** | |

## Gotchas

1. **Server component**: `CreditsPage.tsx` is async and does not have `'use client'`. Cannot
   call `useTranslation()` directly. Must wrap in a client component.
2. **Duplicate column definitions**: `CreditsPage.tsx` and `CreditManagement.tsx` both define
   nearly identical column arrays with the same title strings. Use the same translation keys
   for both to avoid drift.
3. **Recharts `name` prop**: Bar and Pie chart `name` strings appear in legends and tooltips.
   These must be translated, but `name` is set at render time so `t()` works normally.
4. **Chart data labels**: The expiration chart data (`< 7 days`, `< 30 days`, etc.) is
   generated in a function and stored in state. The `t()` call must happen at generation time
   or the data must be regenerated when locale changes.
5. **Status badge HTML**: Status strings like "Expiring Soon (X days)" use JSX with
   interpolation. Use `t('status.expiringSoon', { days: daysUntilExpiration })`.
6. **Toast message in CreditReconciliation**: The `toast.success()` call uses a template
   literal. Replace with `t()` + interpolation.
7. **Month abbreviations in placeholder chart data**: The `placeholderCreditUsageData` array
   uses English month names (Jan, Feb, etc.). These are placeholder data and will eventually
   come from an analytics endpoint. For now, translate them as keys or leave as-is since
   they are placeholder/demo data. Decision: translate them since they are user-visible.

## Implementation Log

- **(2026-04-17, F001)** Added the greenfield English namespace at
  `server/public/locales/en/msp/credits.json`. The file now defines the 14 planned top-level
  groups (`page`, `columns`, `status`, `actions`, `tabs`, `settings`, `charts`, `stats`,
  `management`, `reconciliation`, `application`, `expiration`, `expirationDialog`,
  `context`) and includes the shared table/status/chart/tab vocabulary needed by all 8 client
  components plus the server `CreditsPage` wrapper. Included a few pragmatic extras inside the
  planned groups rather than adding new top-level groups:
  management load/empty states, reconciliation tab labels, short month labels for placeholder
  charts, and generic application/expiration failure strings. This keeps later wiring stable
  and avoids repeated locale-file churn.
- **(2026-04-17, F002)** Added `server/public/locales/fr/msp/credits.json` with full key parity
  against English. Kept the same structure and interpolation tokens, translated the domain-
  specific copy directly (credit reconciliation, recurring-lineage context, expiration flows),
  and preserved the placeholder chart month subgroup so later pseudo-generation remains
  mechanical.
- **(2026-04-17, F003)** Added `server/public/locales/es/msp/credits.json` with matching key
  structure and preserved interpolation variables. Kept the recurring-credit context labels,
  expiration flow copy, and reconciliation phrasing idiomatic enough for MSP billing rather
  than literal English carry-over.
- **(2026-04-17, F004)** Added `server/public/locales/de/msp/credits.json`. Paid extra
  attention to the reconciliation/dashboard nouns and the “financial artifact / recurring
  service period” explanatory copy so the German file remains readable instead of over-literal.
- **(2026-04-17, F005)** Added `server/public/locales/nl/msp/credits.json` with the same key
  shape. Kept the recurring-context explanation and reconciliation wording explicit, since
  those are the easiest places for machine-like Dutch to leak in.
- **(2026-04-17, F006)** Added `server/public/locales/it/msp/credits.json` and deliberately
  used accented/contracted Italian forms where they naturally occur (`più`, `Si è`, `Tutti gli`)
  so the later accent audit is testing a real localized file rather than English-looking copy.
- **(2026-04-17, F007)** Added `server/public/locales/pl/msp/credits.json` with preserved
  placeholders and the same month subgroup used by the chart placeholders. The recurring-
  lineage copy needed a light polish to stay understandable in Polish while keeping the billing
  domain meaning intact.
- **(2026-04-17, F008)** Ran `node scripts/generate-pseudo-locales.cjs` after the new English
  namespace landed. The generator rebuilt `62` pseudo-locale files from `31` English sources
  and created `server/public/locales/xx/msp/credits.json` plus
  `server/public/locales/yy/msp/credits.json`. No hand-edits to pseudo-locales were made.
- **(2026-04-17, F009)** Ran `node scripts/validate-translations.cjs` immediately after pseudo-
  locale generation. Result: `Errors: 0`, `Warnings: 0`, `PASSED` across `de/es/fr/it/nl/pl`
  plus `xx/yy`. This confirmed key parity, interpolation preservation, pseudo fill patterns,
  and the Italian file surviving the validator’s accent checks.
- **(2026-04-17, F010)** Added `'/msp/billing/credits'` to
  `packages/core/src/lib/i18n/config.ts` immediately above the broader `/msp/billing` entry.
  This preserves exact-match handling and longest-prefix fallback so the new page loads
  `msp/credits` instead of inheriting only the general billing namespaces.
- **(2026-04-17, F011)** Replaced the old mixed server/client `CreditsPage.tsx` with a thin
  server loader plus new client wrapper `packages/billing/src/components/credits/CreditsPageClient.tsx`.
  The wrapper now owns `useTranslation('msp/credits')`, translated page/card headings, tab
  labels, table column titles, status labels, and action-button copy while keeping currency and
  date formatting intact. Also normalized the expired tab to derive its rows from the fetched
  “all credits” dataset while preserving upstream fetch error states.
- **(2026-04-17, F012)** Finished the `CreditsPageClient` settings-summary translation pass.
  The inline expiration settings panel now resolves `settings.title`, `settings.creditExpiration`,
  `settings.enabled`, `settings.disabled`, `settings.expirationPeriod`, `settings.daysUnit`,
  `settings.notificationDays`, and `settings.none`, leaving no page-local settings labels in
  raw English.
- **(2026-04-17, F013)** Wired `packages/billing/src/components/credits/AddCreditButton.tsx`
  to `useTranslation('msp/credits')`. The trigger label, dialog title, placeholder paragraph,
  cancel action, and submit action all now resolve from `actions.*` / `management.addCreditPlaceholder`.
- **(2026-04-17, F014)** Wired `packages/billing/src/components/credits/BackButton.tsx` to
  `useTranslation('msp/credits')` and moved the visible label to `actions.backToCredits`.
- **(2026-04-17, F015)** Started the `CreditManagement.tsx` translation pass by wiring
  `useTranslation('msp/credits')` for the dashboard shell. Translated the page title, chart
  card titles/descriptions, stat tiles, legend labels, and placeholder month labels; moved the
  expiration bucket labels into a `generateExpirationChartData(..., t)` helper and derived the
  pie-chart labels in a locale-aware effect so pseudo/de locale changes update chart copy too.
- **(2026-04-17, F016)** Finished the `CreditManagement` table/dialog shell wiring. Refactored
  the credits table columns into `createColumns(t)` so column titles, `N/A`/`Never` fallbacks,
  status badges, row action buttons, the “Recent Credits” section copy, tab labels, “View All
  Credits” CTA, and the local add-credit dialog all now resolve from `msp/credits`.
- **(2026-04-17, F017)** Threaded `t` through `renderCreditContext()` in `CreditManagement.tsx`
  so the lineage/status explanation blocks now resolve `context.*` keys instead of rendering
  raw English helper text.
- **(2026-04-17, F018)** Began `CreditReconciliation.tsx` wiring by translating the dashboard
  heading, client selector placeholder, run button state, filter labels/options, reset action,
  and the validation toast message with `balanceCount` / `trackingCount` interpolation.
- **(2026-04-17, F019)** Completed the reporting surface in `CreditReconciliation.tsx`. The
  stat tiles, chart titles/descriptions, chart legend labels, month placeholders, table card
  copy, report-table columns, status badges, row action buttons, and tab labels with counts now
  all resolve from `msp/credits`.
- **(2026-04-17, F020)** Wired `CreditApplicationUI.tsx` to `useTranslation('msp/credits')`.
  All card copy, table columns, selection buttons, labels, helper text, empty states, and the
  generic load/apply validation errors now resolve from the credits namespace instead of raw
  English strings.
- **(2026-04-17, F021)** Wired `CreditExpirationInfo.tsx` to `useTranslation('msp/credits')`.
  The card title, applied-amount description, field labels, “Never” fallback, empty/error
  states, and ordering note now all resolve through `expiration.*`, with the applied amount
  kept as an interpolation value rather than a translated currency string.
- **(2026-04-17, F022)** Wired `CreditExpirationModificationDialog.tsx` to
  `useTranslation('msp/credits')`. The dialog title/description, field labels, switch copy,
  input label, cancel/save button states, past-date validation message, and generic update
  failure all now resolve from `expirationDialog.*` / shared `actions.*`, and raw thrown errors
  are no longer surfaced to the user.

## Key Paths / Runbooks

- English source namespace: `server/public/locales/en/msp/credits.json`
- Pseudo-locale generator: `node scripts/generate-pseudo-locales.cjs`
- Translation validator: `node scripts/validate-translations.cjs`
- Route namespace config: `packages/core/src/lib/i18n/config.ts`
- Credits page client wrapper: `packages/billing/src/components/credits/CreditsPageClient.tsx`
- Credits page server loader: `packages/billing/src/components/credits/CreditsPage.tsx`
- Credits namespace/route tests: `packages/billing/tests/creditsNamespaceAndRoute.i18n.test.ts`
- Plan artifacts:
  `ee/docs/plans/2026-04-09-msp-i18n-credits/{PRD.md,SCRATCHPAD.md,features.json,tests.json}`

## Test Log

- **(2026-04-17, T001)** Added `packages/billing/tests/creditsNamespaceAndRoute.i18n.test.ts`
  with an executable validator contract that reruns pseudo-locale generation plus
  `validate-translations.cjs` and asserts the combined pipeline stays green (`PASSED`,
  `Errors: 0`, `Warnings: 0`).
- **(2026-04-17, T002)** Extended the same namespace/route contract file with a strict top-level
  shape assertion for `server/public/locales/en/msp/credits.json`. This guards against accidental
  group drift when future i18n edits touch the credits namespace.
- **(2026-04-17, T003/T004)** Added route invariants to
  `packages/billing/tests/creditsNamespaceAndRoute.i18n.test.ts` that assert both the literal
  `ROUTE_NAMESPACES['/msp/billing/credits']` value and the runtime result of
  `getNamespacesForRoute('/msp/billing/credits')` / nested credit paths. This protects the
  longest-prefix behavior called out in the PRD.
- **(2026-04-17, T005-T008)** Added `packages/billing/tests/CreditsPage.i18n.test.ts` as the
  wrapper/server-page contract. The file checks that `CreditsPage.tsx` delegates to
  `CreditsPageClient`, that the client wrapper wires translated columns/status/tabs/settings
  summary keys, and that representative credits-page keys resolve to pseudo-locale fill in
  `xx/msp/credits.json`.
- **(2026-04-17, T009-T012)** Added `packages/billing/tests/CreditControls.i18n.test.ts` for
  the small page-shell controls. It asserts `AddCreditButton` and `BackButton` both import
  `useTranslation('msp/credits')` and checks the representative `xx` pseudo-locale keys those
  controls depend on.
- **(2026-04-17, T013-T016)** Added `packages/billing/tests/CreditManagement.i18n.test.ts` to
  cover the translated dashboard shell, chart legend labels/month placeholders, recurring-
  lineage context helper copy, and representative pseudo-locale coverage for the management tab.
- **(2026-04-17, T017-T020)** Added `packages/billing/tests/CreditReconciliation.i18n.test.ts`
  covering the translated dashboard/filter shell, report charts/table/status badges, the
  interpolated validation toast copy, and representative `xx` pseudo-locale backing for the
  reconciliation surface.
- **(2026-04-17, T021-T026)** Added `packages/billing/tests/CreditApplicationExpiration.i18n.test.ts`
  to cover the remaining credit application and expiration components: application card/table
  copy, error/empty/help states, applied-credit interpolation, and the expiration dialog’s
  label/validation/error wiring.
- **(2026-04-17, T027-T031)** Added `packages/billing/tests/CreditsLocaleSmoke.i18n.test.ts`
  for the final locale smoke layer: Italian accent/contracted-form checks, interpolation-token
  parity across all translated locales, representative English route-shell coverage, German
  non-English coverage for the management/reconciliation dashboards, and representative `xx`
  pseudo-fill checks across page/management/reconciliation/application/expiration flows.
