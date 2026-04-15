# Scratchpad — MSP i18n: Credits Sub-batch

- Plan slug: `2026-04-09-msp-i18n-credits`
- Created: `2026-04-09`

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
