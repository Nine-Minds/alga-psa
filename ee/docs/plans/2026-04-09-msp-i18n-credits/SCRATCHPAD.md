# Scratchpad — MSP i18n: Credits Sub-batch

- Plan slug: `2026-04-09-msp-i18n-credits`
- Created: `2026-04-09`
- Last synced to codebase: `2026-04-17`

## Status Recheck (2026-04-17)

**Still 0% implemented.** Verified against the current codebase:

- `server/public/locales/en/msp/credits.json` — **does not exist**.
- All 8 client components below still have `useTranslation=0`:
  `credits/CreditsPage.tsx`, `credits/AddCreditButton.tsx`, `credits/BackButton.tsx`,
  `billing-dashboard/CreditManagement.tsx`, `billing-dashboard/CreditReconciliation.tsx`,
  `billing-dashboard/CreditApplicationUI.tsx`, `billing-dashboard/CreditExpirationInfo.tsx`,
  `billing-dashboard/CreditExpirationModificationDialog.tsx`.
- `/msp/billing/credits` **not yet** in `ROUTE_NAMESPACES`.
- `features.json` / `tests.json`: 0/22 features, 0/31 tests marked implemented.

### Adjacent work that shipped since 2026-04-09 (affects this plan)

| Change | Impact on this plan |
|---|---|
| Billing-settings plan (`2026-04-09-msp-i18n-billing-settings`) shipped — completed **F006 "translate credit expiration settings"** and **T008 CreditExpirationSettings i18n wiring**. Namespace: `msp/billing-settings`, not `msp/credits`. | `CreditExpirationSettings` is the *settings page* under `/msp/settings`. It is **not** one of the 10 files in this plan (which covers the *dashboard-side* `CreditExpirationInfo.tsx` + `CreditExpirationModificationDialog.tsx`). No rescoping needed, but when reusing copy (e.g., "Expiration Period", "Notification Days"), mirror the keys already in `msp/billing-settings.json` to avoid translation drift. |
| Enum-labels pattern adopted 2026-04-14 (`.ai/translation/enum-labels-pattern.md`, `useBillingFrequencyOptions` / `useFormatBillingFrequency`). | No shared billing-frequency enum rendering found in the 10 credit components, so no migration required here. Keep the pattern in mind if new enum surfaces appear during wiring. |
| No edits to the 10 credit component files since 2026-04-09. | PRD file inventory and LOC counts in the PRD remain accurate; proceed as written. |

### Minor PRD corrections observed during recheck

- PRD says `CreditsTabs.tsx` is 53 LOC — still accurate.
- PRD says `CreditReconciliation.tsx` is 604 LOC — current file matches.
- PRD's `actions.ts` guidance is still correct; `'Authentication required'` and `'Transfer amount must be greater than zero'` remain the only user-surfacing error strings.

No structural changes to the plan are required. This batch is ready to start as-is; the branch `i18n/billing_credits` appears set up for this work.

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
