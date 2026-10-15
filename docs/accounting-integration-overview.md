# AlgaPSA Accounting Integrations & Mapping Guide

## Audience & Scope
This document serves product, engineering, implementation, and support teams. It explains how AlgaPSA connects to accounting systems (QuickBooks Online/Desktop, Xero), how mapping data is managed, how exports are produced, and how to guide customers through the related workflows. It consolidates technical architecture references, UI behaviors, and operator/user instructions.

---

## Terminology
- **Adapter** – Concrete integration for an external accounting system (e.g., `quickbooks_csv`, `quickbooks_online`, `quickbooks_desktop`, `xero`).
- **Realm / Connection ID** – Adapter-specific identifier that scopes catalog data (QBO realm ID, Xero tenant ID, etc.). CSV exports typically use no realm.
- **Mapping** – Tenant-scoped record linking an Alga entity (client, service, tax code, payment term) to an external identifier plus optional metadata.
- **Canonical export payload** – Normalized invoice data produced by `AccountingExportService` prior to adapter formatting.
- **Batch** – Logical export unit grouped by tenant, adapter, and filter set, tracked in `accounting_export_batches`.

---

## System Overview
1. Finance or onboarding staff use **Settings → Integrations → Accounting** to select an accounting package.
2. **QuickBooks CSV** and **Xero CSV** (manual import/export) are offered in every edition. **QuickBooks Online (OAuth)** and **Xero (OAuth)** are offered in Enterprise Edition only; `AccountingIntegrationsSetup` gates them on `NEXT_PUBLIC_EDITION === 'enterprise'` and omits the cards entirely otherwise.
3. The Mapping UI (generic `AccountingMappingManager`) loads adapter-provided modules and persists mappings in `tenant_external_entity_mappings`.
4. When exports run, `AccountingExportService` assembles canonical payloads from invoices/charges, resolves mappings, validates readiness, and persists `accounting_export_batches` + line-level status in `accounting_export_lines` and `accounting_export_errors`.
5. Adapters transform canonical payloads into API requests (OAuth adapters) or files (CSV) and update batch/line status.

Key architecture artifacts come from:
- UI unification plan (`ee/docs/plans/2025-10-28-accounting-mapping-ui-unification-plan.md`)
- Export abstraction plan (`ee/docs/plans/2025-10-26-accounting-export-abstraction-plan.md`)
- Generic mapping components under `packages/integrations/src/components/accounting-mappings/`
- CSV module factory: `packages/integrations/src/components/csv/csvMappingModules.ts`
- QuickBooks Online module factory: `packages/integrations/src/components/qbo/qboLiveMappingModules.ts`

---

## Mapping Subsystem

### Data Model
- `tenant_external_entity_mappings` (Postgres) stores `integration_type`, `alga_entity_type`, `alga_entity_id`, `external_entity_id`, optional `external_realm_id`, `metadata`, status fields, and timestamps.
- Unique constraints prevent duplicate mappings per tenant/entity/realm combination: one mapping per Alga entity per realm, and external targets are one-to-one, except Xero revenue-account targets (`metadata.xeroTargetKind = 'account'`), which many services may share (`idx_unique_external_mapping` is a partial index that excludes them).
- Metadata enables adapter-specific payload data (e.g., Xero tax components).

### Server Actions (`packages/integrations/src/actions/externalMappingActions.ts`)
- Expose tenant-scoped CRUD (`getExternalEntityMappings`, `createExternalEntityMapping`, `updateExternalEntityMapping`, `deleteExternalEntityMapping`).
- Enforce RBAC (`billing_settings` read/update) and wrap operations in transactions via `withTransaction`.
- Allow filtering by adapter, entity type, entity ID, and realm.
- Used directly by mapping modules unless overridden (e.g., Playwright harness, specialized metadata handling).

### Generic React Components (`packages/integrations/src/components/accounting-mappings/`)
- `AccountingMappingManager` renders tabbed modules and handles empty states. Props:
  - `modules`: array of `AccountingMappingModule` config objects.
  - `context`: `AccountingMappingContext` including optional `realmId`.
  - Optional `realmLabel`, `tabStyles`, `defaultTabId`.
- `AccountingMappingModuleView` resolves overrides, loads mapping/catalog data, renders table actions, and orchestrates dialog/delete workflows. Supports:
  - Automatic enrichment of display names. The label of the selected option is also persisted as `metadata.externalDisplayName` and used as the fallback when a later catalog load no longer carries that external id (deactivated entity, different realm, pseudo codes).
  - Adapter/realm-aware CRUD.
  - Playwright overrides through `window.__ALGA_PLAYWRIGHT_ACCOUNTING__`.
- `AccountingMappingDialog` provides add/edit UI with searchable, filterable pickers for both the Alga entity and the external target. Both pickers use `SearchableSelect` with `dropdownMode="overlay"`, so the dropdown portals into the dialog instead of being clipped by it — especially useful when a connected Xero organisation or QuickBooks realm carries hundreds of items or accounts. Optional JSON metadata editing, manual entry fallback when catalog data is unavailable, and realm context readout are also available.
- `types.ts` defines configuration contracts: `AccountingMappingModule`, `AccountingMappingContext`, `AccountingMappingOverrides`, and metadata toggles.

### Module Configuration Pattern
Each adapter defines a factory that returns `AccountingMappingModule[]`. For CSV, see `createCsvMappingModules()` in `packages/integrations/src/components/csv/csvMappingModules.ts`; for QuickBooks Online, `createQboLiveMappingModules()` in `packages/integrations/src/components/qbo/qboLiveMappingModules.ts`.
- Modules declare:
  - `id`, `adapterType`, `algaEntityType`, `externalEntityType`.
  - `labels` (tab names, table column headers, dialog copy, delete confirmations).
  - `elements` for deterministic DOM ids (support QA scripts).
  - `load(context)` which fetches mappings and catalog options. For CSV, Alga provides the catalog options (clients/services/tax codes/payment terms) and the external value is typically manually entered.
  - `create`, `update`, `remove` operations that wrap the server actions and set adapter-specific defaults (`sync_status: 'manual_link'`, metadata persistence).
  - Optional `metadata.enableJsonEditor` (enables JSON textarea in dialog).
  - Optional `resolveOverrides` returning `AccountingMappingOverrides` for test harness or niche adapter logic.

### Overrides & Testing Hooks
- Playwright tests register overrides via `window.__ALGA_PLAYWRIGHT_ACCOUNTING__[adapterType][moduleId]` to stub load/create/update/delete during e2e tests.
- Modules can set `overridesKey` to reuse a shared override set across tabs when needed.

### Existing Adapter Modules
- **QuickBooks CSV**: `createCsvMappingModules()` surfaces Client, Items/Services, Tax Codes, and Payment Terms mappings. The external identifier is entered manually (no OAuth catalog lookup).
- **QuickBooks Online (OAuth)**: `createQboLiveMappingModules()` surfaces Items/Services, Tax Codes, and Payment Terms. Each tab loads its external options live from the connected realm through the `getQboItems` / `getQboTaxCodes` / `getQboTerms` actions, so the dialog offers catalog-backed selectors. Tax-code options are labelled with their combined rate and disambiguated by QuickBooks id when Automated Sales Tax has generated codes sharing a name; the two AST pseudo codes (`TAX`, `NON`) are appended when the realm is in AST mode.
- **Xero (OAuth)**: `createXeroLiveMappingModules()` surfaces Items/Services and Tax Codes (Xero `TaxRate`), also catalog-backed. A service mapping targets either a **Xero Item** (line exports with `ItemCode`) or a **Xero Revenue Account** (line exports with `AccountCode` and no `ItemCode` — for organisations that invoice without Products & Services items). The target type is an explicit choice stored as `metadata.xeroTargetKind`; it is never inferred from the code's shape because an Item Code and an Account Code can be identical strings. Account mode offers only active revenue-class accounts (`REVENUE`, `SALES`, `OTHERINCOME`) with a code, from the exact connected organisation. Mappings saved before account mode existed remain item mappings; one whose code no longer resolves to an Item is flagged invalid in the UI and requires an explicit re-selection (valid Item, or deliberate switch to an Account) — it is never converted automatically. Several services may map to the same revenue account, and an Item and an Account may share a code; a Xero Item, by contrast, can be mapped to only one service.

### Realm Handling
- `AccountingMappingContext.realmId` is optional. OAuth adapters pass realm/tenant identifiers (QBO realm ID, Xero tenant ID); CSV exports omit it (single-tenant manual flow).
- The dialog renders the realm value read-only when provided to reduce accidental mismatches.

---

## Accounting Export Architecture

### Canonical Schema (Export Abstraction Plan Phase 1-3)
- `AccountingExportService` assembles invoices/charges into canonical structures containing invoice headers, line items, taxes, and mapping resolutions.
- Stores outputs in `accounting_export_batches` and `accounting_export_lines` with statuses (`validating`, `ready`, `delivered`, `failed`), timestamps (`validated_at`, `delivered_at`), and external references.
- Maintains currency precision, service period metadata, tracking dimensions, and mapping lookups.

### Service & API Integration
- Batch creation and execution are exposed through the server actions in `packages/billing/src/actions/accountingExportActions.ts` and the routes under `server/src/app/api/accounting/exports/` (`/execute`, `/download`, `/lines`, `/errors`, `/preview`, `/locks`).
- Events (`ACCOUNTING_EXPORT_COMPLETED`, `ACCOUNTING_EXPORT_FAILED`) are published on completion for downstream automation/notifications.
- Status updates handle retries and preserve timestamps unless overwritten.

### Adapter Interface (`packages/types/src/interfaces/accountingExportAdapter.interfaces.ts`)
- Defines the common contract: `capabilities`, `transform(canonicalBatch)`, `deliver(transformedBatch)`, and optional `postProcess`, `fetchExternalInvoice`, `onTaxDelegationExport`.
- `AccountingAdapterRegistry` (`packages/billing/src/adapters/accounting/registry.ts`) registers all five adapters — `quickbooks_online`, `quickbooks_desktop`, `quickbooks_csv`, `xero`, `xero_csv` — resolved via `adapter_type`.

### QuickBooks Online Adapter Highlights
- Transforms canonical batches into QBO invoice DTOs using `QboClientService`.
- Resolves service, tax, and payment term mappings through the generic resolver and persists SyncToken metadata (stored in mapping `metadata`).
- **Automated Sales Tax.** The per-realm AST flag lives at `tenant_settings.settings.qboAutomatedSalesTax` (`{ realms: string[] }`) and is read once per batch in `transform()`. With AST on, a tax-delegated export keeps a line-level `TaxCodeRef` — the mapped code, else `NON` for a non-taxable charge and `TAX` otherwise — so Intuit computes the tax; the computed total then returns through `onTaxDelegationExport` and `fetchExternalInvoice`. With AST off, behavior is unchanged and Alga's own tax total is authoritative. `GlobalTaxCalculation` is never sent: Intuit documents it as non-US only.
- Pending work: granular rate limiting and partial-failure retry logic.

### QuickBooks Desktop
- `QuickBooksDesktopAdapter` (`packages/billing/src/adapters/accounting/quickBooksDesktopAdapter.ts`) writes an IIF file of `INVOICE` transactions for QuickBooks Desktop's **File → Utilities → Import → IIF Files**. Each Alga invoice becomes one transaction:
  - `TRNS`: debits the A/R account for the invoice total. It carries the customer name, invoice date, due date, invoice number (`DOCNUM`), mapped terms, PO number, and an `AlgaPSA: <invoiceId>` memo.
  - One `SPL` per charge: credits the line's income account with the mapped item (`INVITEM`), a negative quantity, a positive rate, and a `TAXABLE` flag. Quantity and rate come from the shared `reconcileExportLineQuantity`. Discounts post a positive amount with a negative rate.
  - When Alga computed tax, one sales-tax `SPL` (`EXTRA = AUTOSTAX`) posts the tax to the sales tax liability account.
  - Each transaction ends with `ENDTRNS`. The file uses CRLF line endings, and amounts are scaled by the invoice currency.
- **Mappings.** Desktop reuses the QuickBooks CSV mappings (`integration_type = 'quickbooks_csv'`) for customers, items, tax codes, payment terms, and discounts, the same way `xero_csv` reuses `xero`. The values are QuickBooks list names. `resolveMappingAdapterType` (`packages/billing/src/adapters/accounting/mappingAdapterType.ts`) maps `quickbooks_desktop` to `quickbooks_csv`, and both export validation and the adapter use it.
- **Validation rules for Desktop batches:**
  - Service, discount and client mappings are required. An unmapped client raises `missing_client_mapping`, because QuickBooks Desktop silently creates any customer name it doesn't recognise.
  - Tax-code and payment-term mappings are optional; the default sales tax item and blank terms cover them.
- **Desktop-only settings.** These live in `tenant_settings.settings.quickbooksDesktop` and are read by `getQuickBooksDesktopSettingsForTenant` in `@alga-psa/integrations/runtime`. They are edited on the **QuickBooks Desktop (IIF)** setup card:
  - `arAccount`: defaults to `Accounts Receivable`.
  - `defaultIncomeAccount`: required unless every mapping sets `qbdIncomeAccount`.
  - `salesTaxPayableAccount`: defaults to `Sales Tax Payable`.
  - `defaultSalesTaxItem`: required only for invoices that carry tax.
  - `newProductItemType`: `NONINVENTORY` (default) or `INVENTORY`. This is the item type used when an export creates a new item for an Alga product.
  - `inventoryAssetAccount` and `cogsAccount`: used only for new Inventory Part items. They default to `Inventory Asset` and `Cost of Goods Sold`.
- **Mapping metadata overrides:**
  - `qbdIncomeAccount` on an Items / Services or Discounts mapping sets the income account per item.
  - `qbdSalesTaxItem` on a Tax Codes mapping sets the sales tax item or group per region. The tax-code mapping's own value is a QuickBooks tax *code*, not an item, so it is never used as the item.
- **Fail-closed rules.** QuickBooks Desktop creates any name it does not recognise when it imports an IIF file, so the transform throws instead of guessing in these cases:
  - Missing item, income account, or sales tax item.
  - Names over QuickBooks' limits: 41 characters for customers, 31 for items and accounts.
  - An invoice whose tax regions resolve to different sales tax items. Desktop allows one sales tax item or group per invoice.
  
  Unmapped payment terms are left blank rather than exported as Alga term ids.
- **External tax.** Invoices with `tax_source` `external` or `pending_external` export without a tax split, but their lines still carry `TAXABLE = Y`. IIF has no channel to return QuickBooks-calculated tax, so `supportsTaxDelegation` is `false`.
- **Creating unmapped entities from an export.** This applies to QuickBooks Desktop and QuickBooks CSV batches.
  - When a batch stops on `missing_client_mapping`, `missing_service_mapping` or `missing_discount_mapping`, **Billing → Accounting Exports** opens a prompt. The detail view's **Resolve unmapped items** button reopens it later.
  - For each entity the user chooses **Create new** or **Already in QuickBooks**, and can edit the QuickBooks name. The proposed name has separators and colons removed and is cut to the QuickBooks limit.
  - `saveQuickBooksExportMappings` (`packages/billing/src/actions/quickBooksExportMappingActions.ts`) saves each decision as a `quickbooks_csv` mapping through `SyncMappingLedger`. It needs both `exports_execute` and `mappings_manage`, and the rules are in `quickBooksExportMappingRules.ts`. The batch is then re-executed, and later exports find the mapping and never prompt again.
  - **Create new** on a Desktop batch also sets `metadata.qbdCreateInBatch = <batch_id>` on the mapping. Only that batch's IIF file writes list records ahead of the transactions, so re-downloading it produces the same file:
    - `!CUST`/`CUST` for customers: name, billing address from the billing (or default) client location, phone, email, and terms.
    - `!INVITEM`/`INVITEM` for items: `SERV` for services, `PART` or `INVENTORY` for products according to `newProductItemType`, and `DISC` for the automatic discount. Each item gets a description, income account, price (the charge's rate) and taxable flag. `INVENTORY` items also get the asset and COGS accounts and the product's average cost.
  - List records are included only for the invoices actually delivered. **Already in QuickBooks** never writes list records, so existing QuickBooks details aren't overwritten.
  - QuickBooks CSV gets mappings only. QuickBooks Online's CSV import handles unknown names itself.
- **Delivery.**
  - Each invoice is locked with `lockInvoiceForExternalSync` and recorded as an `iif:<invoice_number>` invoice mapping, which excludes it from later Desktop exports.
  - The file returned in `metadata.files` contains only the invoices that were delivered. **Billing → Accounting Exports** downloads it as soon as the batch executes.
  - `GET /api/v1/accounting-exports/{batchId}/download` regenerates the file from `transform()`.
- **Limitations.**
  - IIF imports cannot be undone. Test the first import on a backup of the company file.
  - QuickBooks Desktop multicurrency is not handled; amounts are written in the invoice currency.
  - Non-ASCII characters may not survive QuickBooks' ANSI import.
  - Serial numbers are not exported. Stock units link to sales-order lines, not invoice charges, so an invoice line has no reliable serial to carry.
  - Alga stock receipts and costs are not exported. Products created as Inventory Part will go negative in QuickBooks unless stock is also entered there.

### Xero Adapter Highlights (Phase 5)
- Uses `XeroClientService` for OAuth token refresh and catalog access (`listAccounts`, `listItems`, `listTaxRates`, `listTrackingCategories`).
- Supports multi-component tax lines, tracking category metadata, and error normalization into export line records.
- Line construction follows the mapping's explicit target kind (`metadata.xeroTargetKind`): item mode sends `ItemCode` (plus optional metadata `accountCode`), account mode sends `AccountCode` and omits the `ItemCode` property entirely. Tax type, quantities, amounts, tracking, and service periods behave identically in both modes. Each transform snapshots the resolved target (`kind`/`code`/`realm`) into the export line's `mapping_resolution.serviceTarget` as diagnostic evidence; retries re-resolve from the live mapping, so remediating a mapping and retrying the batch picks up the fix.
- Manual retry trigger UI remains outstanding but service already flags failed lines for rerun.

---

## User Workflows

### Prerequisites
1. Ensure tenant has Accounting feature toggle enabled.
2. Select an accounting integration in **Settings → Integrations → Accounting**:
   - **QuickBooks CSV**, **QuickBooks Desktop (IIF)**, and **Xero CSV**: manual import/export, available in every edition.
   - **QuickBooks Online (OAuth)** and **Xero (OAuth)**: Enterprise Edition only.
3. For an OAuth adapter, complete the connection first — the mapping tabs load their external options from the connected company.
4. Confirm user role grants `Billing Settings` permissions.

### Managing Mappings
1. Navigate to **Settings → Integrations → Accounting**.
2. Select the adapter. The mapping tabs are rendered by `AccountingMappingManager`.
3. For each tab:
   - Click **Add … Mapping**.
   - Choose an Alga entity (client/service/tax code/payment term). The picker is searchable — type to filter the list. Locked when editing an existing mapping.
   - Choose the external entity. For OAuth adapters, the picker is catalog-backed and searchable — type to narrow a long list (particularly helpful when a Xero organisation or QuickBooks realm contains hundreds of items or accounts). For CSV adapters, type the external identifier directly.
   - Save; dialog displays validation errors from server actions.
4. To edit or delete:
   - Use the row action menu.
   - Confirm deletion in modal. Deleting removes mapping record from `tenant_external_entity_mappings`.
5. Refresh data via tab reload (automatic after create/update/delete).

Exports run from **Billing → Accounting Exports** for every adapter. The adapter settings screens link there rather than exporting in place.

1. Create and execute a batch:
   - Create a new batch for the adapter and filter set. This creates (or reuses) an `accounting_export_batch` and validates mappings.
   - Execute the batch. File-based adapters return a downloadable artifact; OAuth adapters post to the external API.
2. Fix issues and retry:
   - Missing mappings transition the batch to `needs_attention` and the UI lists what to map.
   - After adding mappings, retrying validates again and the same batch can proceed once it becomes `ready`.
3. Download artifact:
   - Executing a file-based batch in **Billing → Accounting Exports** downloads the file right away.
   - CSV exports return a downloadable CSV compatible with the target system's invoice import. QuickBooks Desktop exports return an `.iif` file for **File → Utilities → Import → IIF Files**.
4. Address failures:
   - Inspect `accounting_export_lines` for errors (UI surfaces message).
   - Resolve root cause (often missing mapping, invalid tax rate, or authentication).
   - Re-run batch after correcting data; failed lines can be retried.

### Troubleshooting Checklist
- **Missing mapping error** – Create mapping in relevant tab; rerun export.
- **Realm mismatch** – Verify connection ID shown in dialog matches authorized accounting tenant.
- **Metadata parse failure** – Validate JSON structure in mapping dialog if your adapter expects metadata.

---

## Operational Considerations
- **Permissions** – `hasPermission(user, 'billing_settings', 'read|update')` gates mapping actions. Support teams need elevated roles to assist tenants.
- **Feature flags** – Rollout of unified mapping UI may be staged; confirm feature toggle status before enabling for tenants.
- **Logging** – Server actions log create/update/delete events with tenant context. Export flows log batch lifecycle and adapter responses.
- **Auditing** – `tenant_external_entity_mappings` retains timestamps; `accounting_export_batches` captures `triggered_by` user id for traceability.
- **Backfills & migrations** – Mappings are canonicalized to `alga_entity_type = 'client'` (customers) and `alga_entity_type = 'tax_code'` (tax). Migrations normalize legacy values in `tenant_external_entity_mappings`.
- **Testing** – Use Playwright harness overrides for deterministic UI tests; Vitest covers module factories. For multi-step QuickBooks Online sync flows, drive the stateful in-memory simulator at `packages/billing/src/services/accountingSync/testing/qboSimulator.ts` rather than hand-mocking `QboClientService`; see [AI coding standards](./AI_coding_standards.md). Canned mocks remain fine for single-call unit tests.

---

## Roadmap & Open Items
- UI unification plan — the OAuth adapters (QuickBooks Online, Xero) ship in the Accounting Integrations setup screen and their mapping tabs use catalog-backed selectors. Remaining:
  - Publish `docs/accounting_exports.md`; the file does not exist yet.
- Export abstraction plan outstanding work:
  - Implement QuickBooks Online rate limiting and partial failure retries.
  - Surface export dashboard, invoice detail integration, and notification flows.
  - Build manual retry UI for Xero adapter failures.
- Documentation backlog:
  - Publish customer-facing admin guide (this doc provides internal baseline).
  - Add per-adapter troubleshooting appendix once dashboard UX hardens.

---

## Key Reference Files
- `packages/integrations/src/components/accounting-mappings/AccountingMappingManager.tsx`
- `packages/integrations/src/components/accounting-mappings/AccountingMappingModuleView.tsx`
- `packages/integrations/src/components/accounting-mappings/AccountingMappingDialog.tsx`
- `packages/integrations/src/components/accounting-mappings/types.ts`
- `packages/integrations/src/components/csv/CSVMappingManager.tsx`
- `packages/integrations/src/components/csv/csvMappingModules.ts`
- `packages/integrations/src/components/qbo/qboLiveMappingModules.ts`
- `packages/integrations/src/components/xero/xeroLiveMappingModules.ts`
- `packages/integrations/src/actions/externalMappingActions.ts`
- `packages/integrations/src/lib/qbo/qboTaxSettings.ts`
- `packages/types/src/interfaces/accountingExportAdapter.interfaces.ts`
- `packages/billing/src/services/accountingExportService.ts`
- `packages/billing/src/services/accountingExportValidation.ts`
- `packages/billing/src/services/accountingMappingResolver.ts`
- `packages/billing/src/services/accountingSync/`
- `packages/billing/src/adapters/accounting/registry.ts`
- `packages/billing/src/adapters/accounting/quickBooksOnlineAdapter.ts`
- `packages/billing/src/adapters/accounting/quickBooksCSVAdapter.ts`
- `ee/docs/plans/2025-10-28-accounting-mapping-ui-unification-plan.md`
- `ee/docs/plans/2025-10-26-accounting-export-abstraction-plan.md`

---

## Appendix: Adding a New Adapter
1. **Define adapter constants** (`adapterType`, realm semantics).
2. **Implement module factory** returning `AccountingMappingModule[]`; reuse server actions or build adapter-specific actions as needed.
3. **Expose manager** in UI (e.g., `<AccountingMappingManager modules={createAdapterModules()} context={{ realmId }} />`).
4. **Implement export adapter** conforming to `accountingExportAdapter` contract; register it in `AccountingAdapterRegistry`.
5. **Wire credential management** (OAuth/token exchange) and catalog loaders.
6. **Extend Playwright overrides** for new adapter module IDs.
7. **Document user-facing setup** within release notes and support knowledge base.

---

## Appendix: User-Facing Walkthrough Template
Use the following outline when crafting tenant-facing guides:
1. Prerequisites (permissions, connector setup, sandbox links).
2. Mapping checklist per entity type with screenshots.
3. Export run book (filters, expected processing time, verification).
4. Troubleshooting table (common errors, resolutions, escalation path).
5. Change log capturing adapter updates, credential reauthorization windows, and contact info.
