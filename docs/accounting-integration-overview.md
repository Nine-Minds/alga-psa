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
- Unique constraints prevent duplicate mappings per tenant/entity/realm combination.
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
- `AccountingMappingDialog` provides add/edit UI, optional JSON metadata editing, manual entry fallback when catalog data is unavailable, and realm context readout.
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
- **Xero (OAuth)**: `createXeroLiveMappingModules()` surfaces Items/Services and Tax Codes (Xero `TaxRate`), also catalog-backed.

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
- `QuickBooksDesktopAdapter` is implemented and registered in `AccountingAdapterRegistry`. It generates an IIF artifact capturing GL transactions (`TRNS` rows).
- There is no setup card for it in the Accounting Integrations screen, so it cannot be selected by a tenant from the UI yet. GL account mappings and a download entry point remain outstanding.

### Xero Adapter Highlights (Phase 5)
- Uses `XeroClientService` for OAuth token refresh and catalog access (`listAccounts`, `listItems`, `listTaxRates`, `listTrackingCategories`).
- Supports multi-component tax lines, tracking category metadata, and error normalization into export line records.
- Manual retry trigger UI remains outstanding but service already flags failed lines for rerun.

---

## User Workflows

### Prerequisites
1. Ensure tenant has Accounting feature toggle enabled.
2. Select an accounting integration in **Settings → Integrations → Accounting**:
   - **QuickBooks CSV** and **Xero CSV**: manual import/export, available in every edition.
   - **QuickBooks Online (OAuth)** and **Xero (OAuth)**: Enterprise Edition only.
3. For an OAuth adapter, complete the connection first — the mapping tabs load their external options from the connected company.
4. Confirm user role grants `Billing Settings` permissions.

### Managing Mappings
1. Navigate to **Settings → Integrations → Accounting**.
2. Select the adapter. The mapping tabs are rendered by `AccountingMappingManager`.
3. For each tab:
   - Click **Add … Mapping**.
   - Choose an Alga entity (client/service/tax code/payment term). Locked when editing an existing mapping.
   - Choose the external entity from the catalog (OAuth adapters) or type the external identifier (CSV adapters).
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
   - CSV exports return a downloadable CSV compatible with the target system's invoice import.
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
  - Deliver QuickBooks Desktop file export and download UI.
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
