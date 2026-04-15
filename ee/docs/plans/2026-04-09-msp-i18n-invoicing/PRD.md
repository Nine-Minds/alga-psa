# PRD -- MSP i18n: Invoicing Sub-batch

- Slug: `2026-04-09-msp-i18n-invoicing`
- Date: `2026-04-09`
- Status: Draft
- Parent plan: `/.ai/translation/MSP_i18n_plan.md`

## Summary

Extract all hardcoded English strings from 22 invoicing components in
`packages/billing/src/components/`, create the `msp/invoicing` namespace, wire
`useTranslation('msp/invoicing')`, and generate translations for 7 languages plus
pseudo-locales. PaperInvoice.tsx (44 LOC) has zero user-facing strings and is excluded.

## Problem

MSP billing pages are one of the highest-value surfaces in the application (invoicing,
templates, tax management, recurring billing). All 22 invoicing components are hardcoded
English -- zero currently use `useTranslation`. Non-English MSP users encounter a
fully translated sidebar, dashboard, and settings chrome, but switch to raw English when
they enter any invoicing workflow (drafts, finalized, automatic generation, manual
creation, templates, tax reconciliation, etc.).

## Goals

1. Create `server/public/locales/en/msp/invoicing.json` with all keys extracted from
   22 invoicing components
2. Wire `useTranslation('msp/invoicing')` into every component with user-visible strings
3. Use `useFormatters` from `@alga-psa/ui/lib/i18n/client` for currency and date formatting
   where hardcoded `Intl.NumberFormat` / `toLocaleString` is currently used
4. Generate translations for 6 non-English locales (fr, es, de, nl, it, pl) + 2
   pseudo-locales (xx, yy)
5. Run `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
   green (exit 0) before shipping
6. Measurable: invoicing coverage goes from 0% to 100% of production components wired

## Non-goals

- Translating template content (user-designed invoice layouts, template AST field names)
- Translating invoice data (invoice numbers, client names, descriptions) -- those are
  tenant data, not UI chrome
- Moving existing non-invoicing billing keys from other namespaces
- Wiring EE-only invoicing components not exported through `@alga-psa/billing/components`
- Changing layout or visual design of any component
- Translating `console.error` / `console.log` / `console.warn` developer-only messages

## File Inventory

### Large (600+ LOC) -- 2-3 features each

| Component | LOC | Est. strings | Key content |
|-----------|-----|-------------|-------------|
| AutomaticInvoices.tsx | 1,983 | ~120 | Ready-to-invoice table, parent group labels, cadence badges, incompatibility reasons, materialization gap panel, recurring history table, reverse/delete dialogs, preview dialog, PO overage dialogs, error messages |
| ManualInvoices.tsx | 859 | ~50 | Form labels, automated items table, line item headers, prepayment checkbox, error messages, validation, submit button states |

### Medium (200-600 LOC) -- 1-2 features each

| Component | LOC | Est. strings | Key content |
|-----------|-----|-------------|-------------|
| DraftsTab.tsx | 550 | ~30 | Table column headers, search placeholder, bulk actions, empty state, reverse confirmation dialog |
| FinalizedTab.tsx | 506 | ~30 | Table column headers, search placeholder, bulk actions (download/email/unfinalize), empty state |
| RecurringServicePeriodsTab.tsx | 458 | ~40 | Page title, schedule selector, form labels, summary stats, table headers, repair panel, regeneration preview |
| BillingCycles.tsx | 397 | ~25 | Page title, tooltip, column headers, anchor labels, month names, search, loading text |
| InvoicePreviewPanel.tsx | 386 | ~20 | Preview title, template selector, action buttons, loading/error/empty states |
| InvoiceTemplateEditor.tsx | 345 | ~20 | Back nav, heading, template name label, visual/code tabs, save/cancel buttons, timestamps, validation errors |
| InvoiceTemplates.tsx | 344 | ~20 | Section heading, column headers, action menu items (edit/clone/set default/delete), create button, loading text |
| ExternalTaxBatchImportDashboard.tsx | 320 | ~25 | Card title/description, column headers, batch import button, progress bar labels, results summary, help text, empty state |
| ExternalTaxImportPanel.tsx | 297 | ~25 | Panel title, pending/imported alerts, import button, history section, reconciliation labels, help text |
| SendInvoiceEmailDialog.tsx | 278 | ~25 | Dialog title, summary counts, recipients heading, recipient source labels, custom message label, email preview, send/cancel buttons |
| TaxReconciliationView.tsx | 222 | ~20 | Card title, comparison labels (Internal/External), table headers, warning alert, help text |
| GenerateTab.tsx | 207 | ~15 | Invoice type selector labels, type descriptions, success dialog message |

### Small (< 200 LOC) -- 1 feature each

| Component | LOC | Est. strings | Key content |
|-----------|-----|-------------|-------------|
| PrepaymentInvoices.tsx | 165 | ~15 | Form heading, field labels, type options, placeholders, validation errors, submit button states |
| ContractInvoiceItems.tsx | 133 | ~10 | Table headers (Description/Quantity/Rate/Amount), subtotal labels, product badge |
| InvoicingHub.tsx | 94 | ~5 | Section heading, tab labels (Generate/Drafts/Finalized) |
| InvoiceTemplateManager.tsx | 92 | ~5 | Headings (Invoice Template Manager, Sample Invoices, Template Preview) |
| InvoiceTaxSourceBadge.tsx | 81 | ~10 | Badge labels (Tax: Internal/External/Pending), tooltip strings, adapter names |
| InvoiceAnnotations.tsx | 60 | ~5 | Heading, internal/external labels, placeholder, add button |
| PurchaseOrderSummaryBanner.tsx | 45 | ~5 | Field labels (PO Number, PO Authorized, PO Consumed, PO Remaining) |

### Excluded (zero user-facing strings)

| Component | LOC | Reason |
|-----------|-----|--------|
| PaperInvoice.tsx | 44 | Pure layout wrapper, no text content |

## Namespace Structure

```
msp/invoicing.json
  automaticInvoices.*       -- Ready-to-invoice, parent groups, history, dialogs
  manualInvoices.*          -- Manual invoice form, line items, prepayment
  draftsTab.*               -- Drafts list, bulk actions, reverse dialog
  finalizedTab.*            -- Finalized list, bulk actions
  recurringServicePeriods.* -- Schedule management, repair, regeneration
  billingCycles.*           -- Billing cycle table, anchor labels
  invoicePreview.*          -- Preview panel, action buttons
  templateEditor.*          -- Template editor form, tabs
  templates.*               -- Template list, actions
  externalTax.*             -- Batch import, single import, reconciliation
  sendEmail.*               -- Email dialog, recipient info
  generateTab.*             -- Type selector, descriptions
  prepayment.*              -- Prepayment form
  contractItems.*           -- Contract invoice items table
  hub.*                     -- Invoicing hub, tab labels
  templateManager.*         -- Template manager, sample invoices
  taxBadge.*                -- Tax source badge labels, tooltips
  annotations.*             -- Annotations section
  purchaseOrder.*           -- PO summary banner
  common.*                  -- Shared strings (Search, Cancel, Actions, Loading, etc.)
```

## Acceptance Criteria

- [ ] All 22 components with user-visible strings import `useTranslation('msp/invoicing')`
      and wrap every user-visible string with `t('key', { defaultValue: '...' })`
- [ ] `server/public/locales/en/msp/invoicing.json` contains all keys referenced by components
- [ ] Currency formatting uses `useFormatters` or locale-aware `Intl.NumberFormat` instead of
      hardcoded `'en-US'` locale
- [ ] `ROUTE_NAMESPACES` for `/msp/billing` loads the `msp/invoicing` namespace
- [ ] `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
      exits 0 (key parity across 9 locales, pseudo-locale fill patterns, Italian accent
      preservation, `{{variable}}` interpolation preservation)
- [ ] All existing billing-related unit/integration tests pass
- [ ] Visual smoke test: `/msp/billing?tab=invoicing` (all sub-tabs), `/msp/billing?tab=billing-cycles`,
      `/msp/billing?tab=service-periods`, `/msp/billing?tab=templates` render correctly in `en`
      and at least one non-English locale; `xx` pseudo-locale shows pseudo-text for every
      visible string
