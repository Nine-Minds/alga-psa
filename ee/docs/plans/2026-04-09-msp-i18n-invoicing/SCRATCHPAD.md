# Scratchpad -- MSP i18n: Invoicing Sub-batch

- Plan slug: `2026-04-09-msp-i18n-invoicing`
- Created: `2026-04-09`
- Last synced to codebase: `2026-04-17`

## Status Recheck (2026-04-17)

**Still 0% implemented.** Verified against the current codebase:

- `server/public/locales/en/msp/invoicing.json` — **does not exist**.
- All 22 components listed in the PRD still have `useTranslation=0`.
- `features.json` / `tests.json`: 0/37 features, 0/50 tests marked implemented.

### PRD file-path correction (important)

The PRD's "File Inventory" header says files live in `packages/billing/src/components/`, but
every component actually lives in one of three subdirectories. Update mental model to:

| Component | Actual path (relative to `packages/billing/src/components/`) |
|---|---|
| AutomaticInvoices.tsx | `billing-dashboard/AutomaticInvoices.tsx` |
| ManualInvoices.tsx | `billing-dashboard/ManualInvoices.tsx` |
| DraftsTab.tsx | `billing-dashboard/invoicing/DraftsTab.tsx` |
| FinalizedTab.tsx | `billing-dashboard/invoicing/FinalizedTab.tsx` |
| RecurringServicePeriodsTab.tsx | `billing-dashboard/RecurringServicePeriodsTab.tsx` |
| BillingCycles.tsx | `billing-dashboard/BillingCycles.tsx` |
| InvoicePreviewPanel.tsx | `billing-dashboard/invoicing/InvoicePreviewPanel.tsx` |
| InvoiceTemplateEditor.tsx | `billing-dashboard/InvoiceTemplateEditor.tsx` |
| InvoiceTemplates.tsx | `billing-dashboard/InvoiceTemplates.tsx` |
| ExternalTaxBatchImportDashboard.tsx | `invoices/ExternalTaxBatchImportDashboard.tsx` |
| ExternalTaxImportPanel.tsx | `invoices/ExternalTaxImportPanel.tsx` |
| SendInvoiceEmailDialog.tsx | `billing-dashboard/invoicing/SendInvoiceEmailDialog.tsx` |
| TaxReconciliationView.tsx | `invoices/TaxReconciliationView.tsx` |
| GenerateTab.tsx | `billing-dashboard/invoicing/GenerateTab.tsx` |
| PrepaymentInvoices.tsx | `billing-dashboard/PrepaymentInvoices.tsx` |
| ContractInvoiceItems.tsx | `billing-dashboard/invoices/ContractInvoiceItems.tsx` |
| InvoicingHub.tsx | `billing-dashboard/InvoicingHub.tsx` |
| InvoiceTemplateManager.tsx | `billing-dashboard/InvoiceTemplateManager.tsx` |
| InvoiceTaxSourceBadge.tsx | `invoices/InvoiceTaxSourceBadge.tsx` |
| InvoiceAnnotations.tsx | `billing-dashboard/InvoiceAnnotations.tsx` |
| PurchaseOrderSummaryBanner.tsx | `billing-dashboard/invoicing/PurchaseOrderSummaryBanner.tsx` |
| PaperInvoice.tsx (excluded) | `billing-dashboard/PaperInvoice.tsx` |

### Upstream changes since 2026-04-09 (affect this plan)

| Commit | What changed | Impact on this plan |
|---|---|---|
| `d3ad4fa4f feat(billing): allow editing draft invoice details` | DraftsTab.tsx gained inline draft-editing UI. File grew 550 → 558 LOC. | Add an extra feature to wire new edit-draft strings (field labels, save/cancel, validation) under `draftsTab.editDraft.*`. |
| `9dd19bf02 Fix draft invoice preview nullable due date typing` | Typing tweak in InvoicePreviewPanel. | No new strings. |
| `7cd6f79e2 fix: persist automatic invoice filter for ready and approval views` | AutomaticInvoices.tsx filter UI persistence; file grew 1983 → 2073 LOC (~+90 LOC). | String count may be slightly higher than the PRD's ~120 estimate. Audit filter-mode labels (ready / needs approval) when extracting. |
| `63353605a feat(F001-F018): enforce recurring approval blockers in due-work, UI, and generation` | AutomaticInvoices.tsx surfaces unapproved-time blocker strings. | Include blocker/alert strings in `automaticInvoices.blockers.*`. |
| `0825b1191 fix(accounting): move net_amount backfill migration to 2026-04-16`, `22924f65c fix(accounting): use charge.net_amount for Xero/QBO export LineAmount`, `8671fdcbd feat(accounting): nudge tenants to let the accounting system calculate tax`, `ef36541f7 fix(accounting): coerce bigint/numeric charge fields in export adapters`, `60be5c878 fix(accounting): honor invoiceIds filter on export batches`, `f849c9f8f fix(accounting): return 409 instead of 500 when retry matches zero invoices`, `50b4164ad fix(xero): make invoice re-export idempotent via InvoiceID + LineItemID threading`, `2a14053b8 fix(accounting): make external-mode tax writeback actually complete` | Back-end/adapter-layer accounting work. No UI strings added to the 22 in-scope components. | No plan changes. Noted to avoid merge conflicts when touching `ExternalTax*` / `TaxReconciliationView` files. |
| Contract-lines batch shipped 2026-04-14; adopted the **enum-labels pattern** (`useBillingFrequencyOptions` / `useFormatBillingFrequency` from `@alga-psa/billing/hooks/useBillingEnumOptions`, keys under `features/billing.json#enums.billingFrequency.*`). | `BillingCycles.tsx` renders a month-anchor select (PRD's "MONTH_OPTIONS" gotcha); `RecurringServicePeriodsTab.tsx` and `AutomaticInvoices.tsx` render billing-frequency badges. | **New guidance:** any billing-frequency label rendering (badges, select options, cell renderers) must use `useFormatBillingFrequency()` / `useBillingFrequencyOptions()` — do **not** re-translate those strings in `msp/invoicing.json`. Route must load `features/billing` (it already does for `/msp/billing`). Month-name labels in `BillingCycles.tsx` remain local to this batch (not shared). |
| `i18n/billing_contracts` merged (PR #2325) and `i18n/biling_ctd` merged (PR #2313) — contract-facing invoice wiring translated (`test(T008): cover contract detail invoice tab translation keys`, `feat(F015): localize contract detail quick actions dialogs and invoices`). | Those are `msp/contracts` surfaces, not the 22 in-scope invoicing components. | No overlap; ensure the "Invoices" tab inside contract detail keeps using `msp/contracts` keys, not `msp/invoicing`. |

### Scratchpad addendum

- Add an explicit feature for **DraftsTab edit-draft fields** (commit `d3ad4fa4f`).
- Add an explicit feature for **AutomaticInvoices persisted-filter labels** (commit `7cd6f79e2`) and **unapproved-time blocker alerts** (commit `63353605a`).
- Remove/avoid re-translating billing-frequency labels; route them through `useFormatBillingFrequency()`.
- Re-estimate AutomaticInvoices from ~120 to **~135** strings to account for the +90 LOC.

No structural plan overhaul; proceed with the corrected paths and the three extra sub-features above.

---

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

## Progress Log

- **(2026-04-18) F001 complete:** created [server/public/locales/en/msp/invoicing.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/public/locales/en/msp/invoicing.json) with the planned top-level namespace groups in PRD order and seeded English keys across all invoicing domains.
  Rationale: unblock component wiring against a stable `msp/invoicing` namespace now, then expand/refine individual keys as each component lands instead of coupling every first component edit to file creation.
  Commands: `node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync('server/public/locales/en/msp/invoicing.json','utf8')); console.log(Object.keys(data).join(','));"`
  Gotcha: keeping the JSON top-level key order aligned with the PRD makes the eventual namespace-shape test straightforward and avoids churn when additional locale packs are generated.

- **(2026-04-18) F002 complete:** updated [packages/core/src/lib/i18n/config.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/core/src/lib/i18n/config.ts) so `ROUTE_NAMESPACES['/msp/billing']` preloads `msp/invoicing` alongside the existing billing/report/contract namespaces.
  Rationale: the invoicing screens render under `/msp/billing` tabs, so namespace preloading must be in place before any `useTranslation('msp/invoicing')` call can resolve outside fallback/default strings.

- **(2026-04-18) F003 complete:** wired the `Ready to Invoice` chrome in [packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx) to `useTranslation('msp/invoicing')` for the section heading, explanatory copy, preview/generate actions, filter controls, and parent-group table headers.
  Validation: added [packages/billing/tests/AutomaticInvoices.i18n.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/tests/AutomaticInvoices.i18n.test.ts) and ran `npx vitest run --config vitest.config.ts ../packages/billing/tests/AutomaticInvoices.i18n.test.ts` from `server/` (pass).
  Gotcha: in this test/runtime fallback path, interpolated `defaultValue` strings are rendered literally, so count-bearing button copy needs a pre-expanded fallback string even when the translation key still receives `count` for real locale interpolation.

- **(2026-04-18) F004 complete:** converted AutomaticInvoices parent-group summary helpers from hardcoded English to translation-key metadata, then translated the rendered item/contract/line counts, combinability badges, and incompatibility-reason list through `msp/invoicing`.
  Validation: expanded [packages/billing/tests/AutomaticInvoices.i18n.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/tests/AutomaticInvoices.i18n.test.ts) with the `T004` static contract and reran `npx vitest run --config vitest.config.ts ../packages/billing/tests/AutomaticInvoices.i18n.test.ts` from `server/` (pass).
  Decision: the helper layer now returns stable enum-like keys and CSS state only; actual user-facing copy is resolved at render time so later locale work can change strings without touching grouping logic.
