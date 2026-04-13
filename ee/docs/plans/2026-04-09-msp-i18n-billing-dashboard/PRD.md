# PRD — MSP i18n: Billing Dashboard Sub-batch

- Slug: `2026-04-09-msp-i18n-billing-dashboard`
- Date: `2026-04-09`
- Status: Draft
- Parent plan: `/.ai/translation/MSP_i18n_plan.md`

## Summary

Extract hardcoded English strings from 17 top-level billing dashboard components, create a
new `msp/billing` namespace, wire `useTranslation('msp/billing')`, generate translations for
7 languages + 2 pseudo-locales, and update `ROUTE_NAMESPACES` to load the new namespace on
the `/msp/billing` route.

These 17 files are the billing dashboard "shell" components that do not belong to the contracts,
quotes, invoicing, credits, or service-catalog sub-batches. None of them currently use
`useTranslation`.

## Problem

MSP users navigating to `/msp/billing` see a fully translated sidebar and navigation chrome
but hit an English-only billing dashboard. The 17 components in this batch collectively render
~350-450 hardcoded English strings including page titles, tab labels, column headers, button
labels, toast messages, form labels, validation messages, dialog titles, status badges, and
empty states. Non-English MSP users experience a jarring language switch when entering the
billing area.

## Goals

1. Create `server/public/locales/en/msp/billing.json` with all keys needed by these 17 components
2. Wire `useTranslation('msp/billing')` into all 17 components
3. Generate translations for 6 non-English locales (fr, es, de, nl, it, pl) + 2 pseudo-locales (xx, yy)
4. Update `ROUTE_NAMESPACES['/msp/billing']` to include `msp/billing`
5. Measurable: 0 of 17 components wired -> 17 of 17 wired

## Non-goals

- Translating components in sub-directories that belong to other sub-batches:
  `contracts/`, `quotes/`, `contract-lines/`, `reports/`, invoice-related components
  (InvoiceTemplates, InvoiceTemplateEditor, InvoicingHub, BillingCycles, RecurringServicePeriodsTab,
  TaxRates), or settings components (ServiceCatalogManager, ProductsManager)
- Translating template engine output (TemplateRendererCore renders invoice HTML, not UI chrome)
- Translating tenant data (invoice content, service names, client names)
- Splitting `msp/billing` into micro-namespaces per component
- Changing `features/billing` namespace (used by client-portal billing)

## File Inventory

| # | Component | LOC | Size | Est. Strings | Key Content |
|---|-----------|-----|------|--------------|-------------|
| 1 | ReconciliationResolution.tsx | 1129 | XL | ~80 | Stepper labels, resolution options (recommended/custom/no-action), four-eyes approval flow, verification code UI, balance comparison labels, correction summary, confirmation dialog, toast/error messages |
| 2 | DiscrepancyDetail.tsx | 921 | L | ~70 | Back nav, status badges (Open/In Review/Resolved), balance comparison, transaction history table headers, credit tracking table headers, issue detail alerts, resolution dialog, recommended fix labels |
| 3 | UsageTracking.tsx | 685 | L | ~45 | Bucket hours overview, usage records table headers (Client/Service/Quantity/Usage Date/Contract Line/Actions), add/edit/delete usage dialogs, filter labels, toast messages, contract line selector guidance |
| 4 | LineItem.tsx | 514 | M | ~40 | Line item labels (Service/Quantity/Rate/Description), discount fields (type/amount/percentage), apply-to selector, taxable/non-taxable badges, subtotal, collapsed summary text |
| 5 | FixedContractLineServicesList.tsx | 500 | M | ~35 | Table headers (Service Name/Category/Billing Method/Quantity/Default Rate/Actions), billing method options, add services section, product/service badges, dropdown actions (Edit Quantity/Remove) |
| 6 | AccountingExportsTab.tsx | 458 | M | ~40 | Accounting Exports title/description, batch table headers (Batch/Adapter/Status/Created/Updated/Actions), new export dialog (Adapter/Start Date/End Date/Client Search/Invoice Statuses/Notes), batch detail dialog, status labels, action buttons |
| 7 | FixedContractLinePresetServicesList.tsx | 446 | M | ~35 | Same column structure as FixedContractLineServicesList, unsaved changes warning, save/reset buttons, navigation warning dialog, add services section, billing method labels |
| 8 | RecommendedFixPanel.tsx | 429 | M | ~40 | Recommended/Alternative/No-Action fix panels, fix dialog titles and descriptions per fix type, impact summary, notes field, custom adjustment amount, cancel/apply buttons |
| 9 | TemplateRendererCore.ts | 415 | M | ~3 | Template engine logic; few user-visible strings ("N/A", "Unknown value", "No data for list"). Most output is invoice content, not UI chrome. |
| 10 | Overview.tsx | 297 | M | ~35 | Metric card titles (Active Contract Lines/Billing Clients/Monthly Revenue/Active Services/Outstanding Amount/Credit Balance/Pending Approvals), feature card titles and descriptions, Monthly Activity, Service Catalog Management, beta warning |
| 11 | BillingDashboard.tsx | 246 | M | ~5 | Page title "Billing", beta warning banner, back-to-presets nav, quote templates heading |
| 12 | EditContractLineServiceQuantityDialog.tsx | 175 | S | ~10 | Dialog title, quantity label, validation messages (empty, not positive), save/cancel buttons, saving indicator |
| 13 | billingTabsConfig.ts | 136 | S | ~16 | Tab labels: Quotes, Quote Layouts, Quote Templates, Client Contracts, Accounting Exports, Contract Templates, Invoicing, Invoice Layouts, Tax Rates, Contract Line Presets, Billing Cycles, Service Periods, Usage Tracking, Reports, Service Catalog, Products |
| 14 | TemplateRenderer.tsx | 131 | S | ~4 | Loading text, error display, empty state message |
| 15 | PropertyEditor.tsx | 85 | S | ~7 | Field labels (Content/Data Field/Width/Height/Font Size/Color), "Select a field" placeholder |
| 16 | ConditionalRuleManager.tsx | 77 | S | ~6 | "Conditional Display Rules" heading, action options (Show/Hide/Format), input placeholders (Condition/Target), "Add Rule" button |
| 17 | ContractsHub.tsx | 77 | S | ~4 | "Contracts" heading, tab labels (Templates/Client Contracts) |

**Total estimated strings: ~475**

## Namespace Structure

**Namespace:** `msp/billing`
**File:** `server/public/locales/{lng}/msp/billing.json`

Key groups (preliminary):
- `dashboard.*` -- page title, beta warning, tab labels
- `overview.*` -- metric titles, feature cards, monthly activity, service catalog section
- `reconciliation.*` -- stepper, resolution options, balance comparison, four-eyes approval
- `discrepancy.*` -- status badges, transaction/credit tracking tables, issue detail
- `recommendedFix.*` -- fix panels, dialog titles/descriptions, impact summary
- `usage.*` -- bucket overview, usage records table, add/edit/delete forms, filters
- `lineItem.*` -- service/discount fields, taxable badges, subtotal
- `contractLineServices.*` -- service list table, add services, billing methods, actions
- `presetServices.*` -- preset service list, unsaved changes, save/reset
- `accountingExports.*` -- batch table, new export dialog, batch detail dialog
- `templateRenderer.*` -- loading, error, empty states
- `templateDesigner.*` -- property editor labels, conditional rules
- `contractsHub.*` -- heading, sub-tabs
- `editQuantityDialog.*` -- dialog title, validation, buttons
- `common.*` -- shared labels (Cancel, Save, Delete, Error, etc.) -- reuse `common` namespace where possible

## ROUTE_NAMESPACES Update

Update `packages/core/src/lib/i18n/config.ts`:

```typescript
'/msp/billing': ['common', 'msp/core', 'features/billing', 'msp/reports', 'msp/billing'],
```

This adds `msp/billing` to the existing route entry. Future billing sub-batches may add
additional namespaces (e.g., `msp/billing-contracts`, `msp/billing-invoicing`).

## Acceptance Criteria

- [ ] `server/public/locales/en/msp/billing.json` exists with all keys referenced by the 17 components
- [ ] All 17 components import `useTranslation('msp/billing')` and wrap all user-visible strings
      with `t('key', { defaultValue: 'English fallback' })`
- [ ] `TemplateRendererCore.ts` has its 2-3 user-visible strings translated (or documented as
      N/A if they only appear in generated HTML)
- [ ] `billingTabsConfig.ts` tab labels are translatable (either via `t()` calls in the config
      or in the consuming component that reads tab definitions)
- [ ] `ROUTE_NAMESPACES['/msp/billing']` includes `msp/billing`
- [ ] Translations exist for all 9 locales (en, fr, es, de, nl, it, pl, xx, yy)
- [ ] `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
      exits 0
- [ ] All existing billing-related tests pass
- [ ] Visual smoke test: `/msp/billing` renders correctly in `en` and at least one non-English
      locale; `xx` pseudo-locale shows pseudo-text for every visible string
