# Scratchpad -- MSP i18n: Invoicing Sub-batch

- Plan slug: `2026-04-09-msp-i18n-invoicing`
- Created: `2026-04-09`

## What This Is

A green-field wiring pass: 22 invoicing components x `useTranslation('msp/invoicing')`.
Unlike the tickets migration (which reused an existing namespace), this batch creates a
brand new `msp/invoicing.json` namespace from scratch. Estimated ~500 translatable strings.

## Decisions

- **(2026-04-09)** New namespace `msp/invoicing` rather than adding to an existing file.
  Invoicing is a distinct billing domain with no overlap with other translated surfaces.
  The namespace sits under `msp/` alongside `msp/settings`, `msp/dashboard`, etc.
- **(2026-04-09)** Use `t('key', { defaultValue: 'English fallback' })` everywhere for
  fallback safety, matching the pattern specified in the project i18n docs.
- **(2026-04-09)** PaperInvoice.tsx (44 LOC) is excluded -- pure layout wrapper with zero
  user-visible strings. It renders children and sets CSS dimensions only.
- **(2026-04-09)** InvoiceTemplateManager.tsx (92 LOC) has only 3 heading strings. It is
  primarily a sample invoice preview utility. Wire it for completeness.
- **(2026-04-09)** Ship as independent PRs per size tier: large (AutomaticInvoices +
  ManualInvoices), medium (DraftsTab + FinalizedTab + RecurringServicePeriodsTab +
  BillingCycles + InvoicePreviewPanel + template components + tax components +
  SendInvoiceEmailDialog + GenerateTab), small (remaining 6 components), and a final
  translations-only PR.

## Gotchas

### Currency formatting
Several components use hardcoded `new Intl.NumberFormat('en-US', ...)` or `formatCurrency`
from `@alga-psa/core`. These should be replaced with locale-aware formatting via
`useFormatters` from `@alga-psa/ui/lib/i18n/client`. Files affected:
- `DraftsTab.tsx` line 294-299 -- hardcoded `Intl.NumberFormat('en-US', ...)`
- `ContractInvoiceItems.tsx` -- hardcoded `$` prefix in template literals
- `ExternalTaxBatchImportDashboard.tsx` -- local `formatCurrency` with hardcoded `$`
- `ExternalTaxImportPanel.tsx` -- local `formatCurrency` with hardcoded `$`
- `TaxReconciliationView.tsx` -- local `formatCurrency` with hardcoded `$`
- `PurchaseOrderSummaryBanner.tsx` -- uses `formatCurrencyFromMinorUnits` with `'en-US'`

### Date formatting
`toPlainDate(value).toLocaleString()` calls in DraftsTab and FinalizedTab should receive
the current locale rather than defaulting to the browser locale. Use `useFormatters` or
pass locale explicitly.

### Duplicate adapter name maps
Three files define the same `ADAPTER_NAMES` map (`ExternalTaxBatchImportDashboard`,
`ExternalTaxImportPanel`, `InvoiceTaxSourceBadge`). Consider extracting to a shared
translated key group `externalTax.adapterNames.*` to avoid triple-maintenance.

### AutomaticInvoices.tsx is massive (1983 LOC)
This file has ~120 translatable strings spanning 5 distinct UI sections. Split into
4 features (F010-F014) for tractability. The inline helper functions
(`getParentGroupSummary`, `resolveIncompatibilityReasons`, `formatCadenceSourceBadge`,
`getRecurringAssignmentContext`) return English strings that must move to t() calls.
Some of these are called outside the component body, so they will need the `t` function
passed as a parameter or the strings must be moved inline.

### Helper functions returning hardcoded strings
Several module-level functions return English text:
- `getParentGroupSummary()` returns combinability labels
- `resolveIncompatibilityReasons()` returns reason strings
- `formatCadenceSourceBadge()` returns cadence source labels
- `summarizeCadenceSources()` joins labels
- `getRecurringAssignmentContext()` returns assignment context strings

These are defined outside the React component, so they cannot directly call `t()`.
Options: (1) move them inside the component, (2) return translation keys and call
`t()` at the render site, or (3) pass `t` as a parameter. Option (2) is cleanest
for this pattern -- return keys, translate at render.

### Interpolation needs
Several strings require `{{count}}` or `{{name}}` interpolation:
- "Actions (N)" -- bulk action button labels in DraftsTab, FinalizedTab
- "Generate Invoices for Selected Periods (N)" -- AutomaticInvoices
- "Reversing N draft invoices will delete them..." -- DraftsTab plural
- "N invoice(s) pending tax import" -- ExternalTaxBatchImportDashboard
- "N Invoice(s)" / "N ready to send" / "N missing email" -- SendInvoiceEmailDialog
- "Send N Email(s)" -- SendInvoiceEmailDialog
- "Sending N invoice(s)..." -- toast in SendInvoiceEmailDialog
- "Importing N/M..." -- ExternalTaxBatchImportDashboard progress
- "over by $X" -- PO overage dialogs

### Month names in BillingCycles
The `MONTH_OPTIONS` array has hardcoded January-December. These should be translated
via t() keys like `billingCycles.months.january` through `billingCycles.months.december`.

### RecipientSourceLabels in SendInvoiceEmailDialog
The `recipientSourceLabels` object maps enum values to display strings. These should
become `t('sendEmail.recipientSource.billingContact')` etc.

### TAX_SOURCE_CONFIG in InvoiceTaxSourceBadge
The config object has `label` and `tooltip` fields with English strings. These should
be translated at render time, not at definition time (move t() calls to render).

## Key Count Estimate

| Group | Estimated keys |
|-------|---------------|
| automaticInvoices | ~120 |
| manualInvoices | ~50 |
| draftsTab | ~30 |
| finalizedTab | ~30 |
| recurringServicePeriods | ~40 |
| billingCycles | ~25 |
| invoicePreview | ~20 |
| templateEditor | ~20 |
| templates | ~20 |
| externalTax | ~50 |
| sendEmail | ~25 |
| generateTab | ~15 |
| prepayment | ~15 |
| contractItems | ~10 |
| hub | ~5 |
| templateManager | ~5 |
| taxBadge | ~10 |
| annotations | ~5 |
| purchaseOrder | ~5 |
| common | ~15 |
| **Total** | **~515** |
