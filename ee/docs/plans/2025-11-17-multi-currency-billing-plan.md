# Multi-Currency Billing Enablement Plan

**Date:** 2025-11-17  
**Author:** Codex AI (billing pod)  
**Scope:** All tenant-scoped billing, invoicing, ledger, reporting, and accounting export flows running in the monolith (`server/*`, `shared/*`, `ee/*`).

## Executive Summary
- The public docs ([`docs/overview.md`](../../docs/overview.md), [`docs/billing.md`](../../docs/billing.md)) promise multi-currency billing, yet the live code base still hardcodes USD across pricing tables, UI components, invoice templates, and accounting exports.
- Recent groundwork exists (e.g., migration `20251026120000_convert_invoice_and_transactions_currency.cjs` adds `invoices.currency_code` + `exchange_rate_basis_points`, `transactions.amount` now stores cents), but the data is never populated and upstream pricing sources (`service_catalog`, contract line pricing, manual invoices) remain currency-agnostic.
- This plan delivers tenant-wide base currency configuration, per-client/contract currency overrides, deterministic FX snapshots per invoice, UI/template updates, reporting rollups, and adapter-safe exports while respecting existing rules (e.g., default invoice templates must flow through `invoice_template_assignments` per [`docs/AI_coding_standards.md`](../../docs/AI_coding_standards.md)).

## Current State Assessment
### Data & Persistence
- Money columns across `service_catalog`, `contract_lines`, `client_contract_line_pricing`, `client_contract_services`, `client_contract_line_terms`, `invoices`, `invoice_charges`, `credit_tracking`, and `transactions` are integer cents with no associated `currency_code` (see `server/migrations/202409071803_initial_schema.cjs`, `20241125124900_add_credit_system.cjs`).
- `invoices.currency_code` / `exchange_rate_basis_points` exist but are always NULL because neither `server/src/lib/billing/billingEngine.ts` nor manual invoice flows set them.
- `clients` (renamed from companies in `20251003000001_company_to_client_migration.cjs`) lack any currency preference columns; `tenant_settings.settings` has locale data but no monetary configuration (see `server/migrations/20250630161508_create_tenant_settings_table.cjs`).
- Accounting export tables (`accounting_export_batches`, `accounting_export_lines`) expect a `currency_code` (per `ee/docs/plans/2025-10-26-accounting-export-abstraction-plan.md`) but ingest-only sees defaults from selectors.

### Application Logic
- `BillingEngine.calculateBilling` computes cents assuming tenant currency, with no awareness of client/contract currency or FX snapshots. Template cloning (`server/src/lib/billing/utils/templateClone.ts`) copies `custom_rate` numbers without currency context.
- Manual invoicing (`server/src/lib/actions/manualInvoiceActions.ts`, `server/src/components/billing-dashboard/ManualInvoices.tsx`) renders `$` and never stores a `currency_code`.
- Invoice persistence/services (`server/src/lib/services/invoiceService.ts`, `server/src/lib/models/invoice.ts`, `server/src/lib/actions/invoiceQueries.ts`) neither read nor write currency metadata.
- Finalization & ledger flows (`server/src/lib/actions/invoiceModification.ts`, `server/src/lib/actions/creditActions.ts`, `docs/invoice_finalization.md`) make ledger entries in cents without knowing which currency they represent.

### UI, Templates, and Client Portal
- Currency formatting is globally hard-coded to USD in `server/src/lib/utils/formatters.ts`, `server/src/lib/i18n/server.ts`, and UI layers such as `ClientContractLineDashboard.tsx`, `contracts/ContractTemplateDetail.tsx`, `ManualInvoices.tsx`, `server/src/components/billing-dashboard/accounting/AccountingExportsTab.tsx`, and client-portal surfaces (`server/src/components/client-portal/billing/BillingOverview.tsx`, `client-portal/account/ClientAccount.tsx`).
- Invoice template Wasm helpers (`server/src/invoice-templates/assemblyscript/assembly/common/format-helpers.ts`) prepend `$` and the host `WasmInvoiceViewModel` (`server/src/lib/invoice-renderer/types.ts`) carries no currency metadata, so PDF generation (`server/src/lib/actions/invoiceGeneration.ts`) cannot localize values.

### Reporting & Integrations
- Report definitions (`server/src/lib/reports/definitions/billing/overview.ts`, `contracts/*.ts`) and the core engine (`server/src/lib/reports/core/ReportEngine.ts`) always emit USD, making KPI dashboards incorrect for non-USD tenants.
- Accounting exports default to `'USD'` (`server/src/lib/services/accountingExportInvoiceSelector.ts`, `AccountingExportsTab.tsx`) and only pass through invoice-level currency when available; adapters (`server/src/lib/adapters/accounting/quickBooksOnlineAdapter.ts`, `.../xeroAdapter.ts`) assume same-currency credits and ignore exchange-rate gaps noted in the accounting export plan.

### Documentation Gap
- `docs/billing.md`, `docs/billing_cycles.md`, `docs/invoice_templates.md`, and `docs/invoice_finalization.md` make no mention of base currency resolution or FX handling even though marketing copy advertises multi-currency.

## Goals & Non-Goals
- **Goals:** Tenant-level base currency selection, client/contract currency overrides, deterministic FX storage per invoice, UI/template formatting with ISO 4217 codes, ledger + credit handling in mixed currencies, reporting and export parity, strong migration/backfill + tests.
- **Non-Goals:** Implementing payment processor FX, exposing automated FX rate providers to end users, or redesigning invoice template assignment semantics (must continue via `invoice_template_assignments`).

## Guiding Principles
1. **Single Source of Truth:** Base currency lives in `tenant_settings.settings.billing.currency`. Client/contract overrides cascade deterministically (tenant → client → contract → invoice).
2. **Fail Fast (per docs):** Billing services throw when currency context is missing instead of guessing.
3. **Immutable FX Snapshots:** Each invoice stores `currency_code` and `exchange_rate_basis_points` taken at generation time; charges inherit invoice currency.
4. **Integer Math Everywhere:** Continue storing cents; conversions happen via basis points to avoid floating precision issues.
5. **Backwards-Compatible APIs:** External consumers keep receiving integers but now also get explicit `currency_code` in DTOs.

## Proposed Architecture
### Currency Resolution Hierarchy
- Extend `tenant_settings` JSON to hold `{ billing: { baseCurrency: 'USD', supportedCurrencies: [...] } }` managed by `server/src/lib/actions/tenant-settings-actions/tenantSettingsActions.ts` & locale actions.
- Add `currency_code` to `clients`, `client_contracts`, `client_contract_lines`, and `contracts` to capture overrides defined in `docs/billing.md`. Rates in `service_catalog`, `contract_lines`, and `client_contract_line_pricing` gain `currency_code` metadata so cloning + billing knows how to convert before charge generation.
- `BillingEngine` determines the invoice currency per client billing cycle (see `docs/billing_cycles.md`) and records it on `invoices` + `invoice_charges` (explicit column or derived join) while persisting `exchange_rate_basis_points` representing conversion to tenant base.

### FX & Money Services
- Introduce `fx_rates` table storing `(fx_rate_id, tenant, source_currency, target_currency, rate_basis_points, effective_at, provider, metadata)` plus caching service `server/src/lib/services/exchangeRateService.ts`. Provide admin override UI later if needed.
- Add helper `Money` utilities in `shared/utils` and `server/src/lib/utils/money.ts` to normalize conversions, rounding, formatting (tying into `server/src/lib/i18n/server.ts`).

### Ledger & Reporting Alignment
- Transactions, credit tracking, and analytics events store both invoice currency (`currency_code`) and converted base-cents (`base_amount_cents`). Reports roll up base amounts but also expose per-currency breakdown when filters require.
- Accounting exports continue to emit the invoice currency while also including base currency + exchange rate for GL mapping.

### Templates & Rendering
- Extend `WasmInvoiceViewModel` with `currencyCode`, `currencySymbol`, and localized helpers. Update AssemblyScript helpers to accept a currency code argument rather than hardcoding `$`, following the instructions in `docs/invoice_templates.md` and ensuring default selection still respects `invoice_template_assignments`.

## Implementation Plan
### Phase 0 – Schema & Configuration Foundations (Week 1)
1. **Tenant Settings:**
   - Migration adding `settings->billing` scaffold plus admin actions to read/write base currency + supported list (`server/src/lib/actions/tenant-actions/tenantSettingsActions.ts`, `tenantLocaleActions.ts`).
   - UI stub (likely under `server/src/components/settings/general` if needed) to set currency.
2. **Entity Columns:**
   - Add `currency_code` columns + composite indexes to `clients`, `client_contracts`, `client_contract_lines`, `contracts`, `service_catalog`, `client_contract_line_pricing`, `client_contract_services`, and `invoice_charges` (even if it mirrors invoice currency for clarity) via new Knex migration.
   - Backfill existing rows: default to tenant base currency (fall back to `'USD'` until admin sets it).
3. **Ledger Tables:**
   - Extend `transactions`, `credit_tracking`, and `client_credits` with `currency_code` + optional `base_amount_cents` columns to prep for FX-aware credits described in `docs/invoice_finalization.md`.
4. **Shared Types:**
   - Update `shared/interfaces/client.interfaces.ts`, `server/src/interfaces/*.ts` (billing, invoice, contract, client) to include currency metadata. Ensure API controllers and Zod schemas (if any) accept the new fields.

### Phase 1 – Billing & Invoice Generation Logic (Weeks 2-3)
1. **Currency Resolution Service:**
   - Build `resolveCurrencyForClient(clientId)` that walks tenant → client → contract line overrides, returning `{ currencyCode, exchangeRateBasisPoints }` (uses `ExchangeRateService`).
2. **Billing Engine Updates:**
   - Inject currency context into `BillingEngine` so that `calculateBilling` populates invoice + charge currency fields, stores FX snapshot on `invoices`, and ensures all downstream calculations stay integer (update `server/src/lib/billing/billingEngine.ts` and supporting repos/queries).
   - Update template cloning (`server/src/lib/billing/utils/templateClone.ts`) and contract actions to persist rate currencies when copying from templates.
3. **Manual + Automated Invoice Paths:**
   - Extend manual invoice actions (`manualInvoiceActions.ts`, `invoiceService.ts`) to require `currency_code`, persist it on the invoice row, and surface currency selection in the UI (`ManualInvoices.tsx`, `LineItem.tsx`). Respect component ID guidelines when adding new selects.
   - Update invoice generation pipeline (`server/src/lib/actions/invoiceGeneration.ts`) so PDF/download flows include currency metadata in `InvoiceViewModel` and Wasm payloads.
4. **Finalization & Credits:**
   - Modify `finalizeInvoice`/`unfinalizeInvoice` + `creditActions.ts` to store ledger entries with both invoice and base currency amounts, handling FX gains/losses via the existing `currency_adjustment` transaction type.

### Phase 2 – UI, Templates, and Client Portal (Weeks 3-4)
1. **Shared Formatting Utilities:**
   - Replace ad-hoc USD formatting with a centralized `formatMoney(amountCents, currencyCode, locale)` exported from `server/src/lib/utils/formatters.ts` and `server/src/lib/i18n/server.ts`. Update consumers in billing dashboard cards, contract UIs, `AccountingExportsTab.tsx`, and report components.
2. **Client Portal + Billing Dashboard:**
   - Propagate currency down to `BillingOverview.tsx`, `ContractLineDetailsDialog.tsx`, `client-portal/account/ClientAccount.tsx`, and invoice tables under `server/src/components/billing-dashboard/invoicing/*.tsx` so that drafts/finalized lists display `currency_code` badges and totals.
   - Ensure manual invoice UI, contract forms, and service configuration editors show the correct currency next to rate inputs (without renaming existing fields) and allow switching currency only where permissible (likely at client/contract level, not per line item).
3. **Invoice Templates & Renderer:**
   - Update `server/src/lib/invoice-renderer/types.ts`, `wasm-executor.ts`, and AssemblyScript helpers to pass currency metadata to templates. Replace `$` in `format-helpers.ts` with dynamic symbol/resolved code. Update standard template sources under `server/src/invoice-templates/assemblyscript/standard/*` and re-run `syncStandardTemplates` per `docs/invoice_templates.md`.
   - Confirm `InvoiceTemplateEditor.tsx` surfaces currency references (maybe highlight preview currency based on selected invoice).

### Phase 3 – Reporting, Analytics, and Integrations (Weeks 4-5)
1. **Reporting Layer:**
   - Teach `ReportEngine` (`server/src/lib/reports/core/ReportEngine.ts`) to read currency metadata from metrics. Update billing + contract report definitions to either (a) convert to tenant base currency using stored exchange rates or (b) emit multi-series metrics grouped by currency. Update `docs/billing.md` accordingly.
2. **Accounting Exports:**
   - Ensure selector (`server/src/lib/services/accountingExportInvoiceSelector.ts`) pulls `invoices.currency_code` and `exchange_rate_basis_points`, defaulting only when absent. Update UI (`AccountingExportsTab.tsx`) to display multi-currency totals, and include FX data in batch detail drawers.
   - Update adapters for QuickBooks/Xero to handle currency mismatches, leveraging helper conversions and new repository fields (`server/src/lib/repositories/accountingExportRepository.ts`).
3. **API/Client Surfaces:**
   - Propagate currency fields through REST controllers (`server/src/lib/api/controllers/ApiAccountingExportController.ts`, `report-actions/getRecentClientInvoices.ts`, etc.) and ensure client portal APIs (Next.js routes) include currency_code for invoice payloads.

### Phase 4 – Testing, Backfill, and Rollout (Week 6)
1. **Testing:**
   - Unit tests for money utilities, currency resolution, and FX snapshots.
   - Integration tests: billing run with mixed currencies, invoice finalization applying credits across FX, accounting export batch containing multi-c invoices (`server/src/test/integration/accounting/*`).
   - E2E/Playwright updates in `ee/server/src/__tests__/integration/batch-lifecycle.playwright.test.ts` to cover UI filtering/rendering with multiple currencies.
2. **Backfill + Scripts:**
   - Write one-time script (e.g., `scripts/backfill-invoice-currency.ts`) to set currency_code/exchange_rate on existing invoices using tenant default + rate 1.0.
   - Provide validation script to compare totals between old/new representations (ensuring ledger balances).
3. **Rollout Controls:**
   - Feature flag (env or tenant_settings) gating UI display + FX enforcement until migrations complete.
   - Monitoring: add PostHog analytics events enriched with `currency_code` for invoice generation/finalization so we can verify adoption.

## Risks & Mitigations
- **Historical Data Accuracy:** Backfilling legacy invoices with assumed USD may not match actual currency; surface a per-tenant override tool and audit report to identify invoices where manual correction is needed.
- **FX Source Reliability:** Decide on provider (manual entry vs. API). Mitigate by allowing manual overrides and caching resolved rates alongside provider metadata.
- **UI Complexity:** Introducing currency selectors everywhere may overwhelm users; limit editing to tenant/client settings and surface read-only badges elsewhere.
- **Downstream Integrations:** QuickBooks/Xero realm currencies may reject mismatched codes; enforce validation in adapters before batch creation and raise actionable errors in `AccountingExportsTab.tsx`.

## Open Questions / Decisions Needed
1. Do we support mixed currencies within a single tenant simultaneously, or enforce one invoice currency per client? (Plan assumes per-client/per-contract override but not per line item.)
2. What is the authoritative exchange-rate provider (internal manual table vs. external API)?
3. Should `transactions.amount` remain invoice currency while `base_amount_cents` stores tenant currency, or should we flip (base in `amount`, invoice in extras)?
4. How should credit balances behave when applying a USD credit to a CAD invoice—immediate FX conversion or split ledgers?

## Success Metrics
- 100% of new invoices carry non-null `currency_code` + `exchange_rate_basis_points`.
- Accounting export batches show accurate multi-currency totals and pass adapter validation for QuickBooks & Xero.
- Billing + contract reports display correct totals when at least two currencies exist in tenant data.
- Manual invoicing UI allows selecting/displaying non-USD currencies without regression failures.

## Documentation & Follow-ups
- Update `docs/billing.md`, `docs/billing_cycles.md`, `docs/invoice_finalization.md`, and `docs/invoice_templates.md` to document currency hierarchy and FX handling.
- Document admin workflows in `docs/billing.md` + customer portal references.
- Ensure release notes highlight required migrations and manual steps for self-hosted tenants.
