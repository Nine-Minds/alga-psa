# Alga PSA Accounting Integrations & Mapping Guide

## Audience & Scope
This document serves product, engineering, implementation, and support teams. It explains how Alga PSA connects to accounting systems (QuickBooks Online/Desktop, Xero), how mapping data is managed, how exports are produced, and how to guide customers through the related workflows. It consolidates technical architecture references, UI behaviors, and operator/user instructions.

---

## Terminology
- **Adapter** – Concrete integration for an external accounting system (e.g., `quickbooks_online`, `quickbooks_desktop`, `xero`).
- **Realm / Connection ID** – Adapter-specific identifier that scopes catalog data (QBO realm ID, Xero tenant ID, etc.).
- **Mapping** – Tenant-scoped record linking an Alga entity (service, tax region, payment term, tracking dimension) to an external identifier plus optional metadata.
- **Canonical export payload** – Normalized invoice data produced by `AccountingExportService` prior to adapter formatting.
- **Batch** – Logical export unit grouped by tenant, adapter, and filter set, tracked in `accounting_export_batches`.

---

## System Overview
1. Finance or onboarding staff use Accounting Settings to connect an adapter (OAuth for QBO/Xero, manual for Desktop).
2. The Mapping UI (generic `AccountingMappingManager`) loads adapter-provided modules that surface catalog options and CRUD operations backed by `tenant_external_entity_mappings`.
3. When exports run (manually or via automation), `AccountingExportService` assembles canonical payloads from invoices/charges, resolves mappings, validates readiness, and persists `accounting_export_batches` plus line-level status.
4. Adapter implementations transform canonical payloads into API or file requests, deliver them to the external system, and update batch/line status.
5. Operators monitor export dashboards, resolve errors (often mapping gaps), and rerun batches as needed.

Key architecture artifacts come from:
- UI unification plan (`ee/docs/plans/2025-10-28-accounting-mapping-ui-unification-plan.md`)
- Export abstraction plan (`ee/docs/plans/2025-10-26-accounting-export-abstraction-plan.md`)
- Generic mapping components under `server/src/components/accounting-mappings/`
- Adapter-specific module factories, e.g., `server/src/components/integrations/xero/xeroMappingModules.ts`

---

## Mapping Subsystem

### Data Model
- `tenant_external_entity_mappings` (Postgres) stores `integration_type`, `alga_entity_type`, `alga_entity_id`, `external_entity_id`, optional `external_realm_id`, `metadata`, status fields, and timestamps.
- Unique constraints prevent duplicate mappings per tenant/entity/realm combination.
- Metadata enables adapter-specific payload data (e.g., Xero tax components).

### Server Actions (`server/src/lib/actions/externalMappingActions.ts`)
- Expose tenant-scoped CRUD (`getExternalEntityMappings`, `createExternalEntityMapping`, `updateExternalEntityMapping`, `deleteExternalEntityMapping`).
- Enforce RBAC (`billing_settings` read/update) and wrap operations in transactions via `withTransaction`.
- Allow filtering by adapter, entity type, entity ID, and realm.
- Used directly by mapping modules unless overridden (e.g., Playwright harness, specialized metadata handling).

### Generic React Components (`server/src/components/accounting-mappings/`)
- `AccountingMappingManager` renders tabbed modules and handles empty states. Props:
  - `modules`: array of `AccountingMappingModule` config objects.
  - `context`: `AccountingMappingContext` including optional `realmId`.
  - Optional `realmLabel`, `tabStyles`, `defaultTabId`.
- `AccountingMappingModuleView` resolves overrides, loads mapping/catalog data, renders table actions, and orchestrates dialog/delete workflows. Supports:
  - Automatic enrichment of display names.
  - Adapter/realm-aware CRUD.
  - Playwright overrides through `window.__ALGA_PLAYWRIGHT_ACCOUNTING__`.
- `AccountingMappingDialog` provides add/edit UI, optional JSON metadata editing, manual entry fallback when catalog data is unavailable, and realm context readout.
- `types.ts` defines configuration contracts: `AccountingMappingModule`, `AccountingMappingContext`, `AccountingMappingOverrides`, and metadata toggles.

### Module Configuration Pattern
Each adapter defines a factory that returns `AccountingMappingModule[]`. Example: `createXeroMappingModules()` in `server/src/components/integrations/xero/xeroMappingModules.ts`.
- Modules declare:
  - `id`, `adapterType`, `algaEntityType`, `externalEntityType`.
  - `labels` (tab names, table column headers, dialog copy, delete confirmations).
  - `elements` for deterministic DOM ids (support QA scripts).
  - `load(context)` which fetches mappings and catalog options. Typically calls server actions such as `getServices`, `getTaxRegions`, `getXeroItems`, etc. Should respect `context.realmId`.
  - `create`, `update`, `remove` operations that wrap the server actions and set adapter-specific defaults (`sync_status: 'manual_link'`, metadata persistence).
  - Optional `metadata.enableJsonEditor` (enables JSON textarea in dialog).
  - Optional `resolveOverrides` returning `AccountingMappingOverrides` for test harness or niche adapter logic.

### Overrides & Testing Hooks
- Playwright tests register overrides via `window.__ALGA_PLAYWRIGHT_ACCOUNTING__[adapterType][moduleId]` to stub load/create/update/delete during e2e tests.
- Legacy `__ALGA_PLAYWRIGHT_QBO__` is still read for backward compatibility during rollout.
- Modules can set `overridesKey` to reuse a shared override set across tabs when needed.

### Existing Adapter Modules
- **QuickBooks Online/Desktop**: `createQboMappingModules(realmId)` (not shown above but follows same contract) surfaces Services, Tax Codes, Payment Terms, and additional metadata (classes, GL accounts). QBO UI now delegates to `AccountingMappingManager`.
- **Xero** (`server/src/components/integrations/xero/XeroMappingManager.tsx` and `xeroMappingModules.ts`):
  - Services/Items tab maps Alga services to Xero inventory/service codes (with JSON metadata for revenue accounts, tracking).
  - Tax Rates tab maps tax regions to Xero tax types (metadata captures composite tax components).
  - Additional modules (payment terms, tracking categories) are planned under the UI unification roadmap; metadata editor already accommodates richer payloads.

### Realm Handling
- `AccountingMappingContext.realmId` is optional. Xero passes the OAuth connection ID; QuickBooks Online uses realm IDs; Desktop modules omit it.
- Dialog renders realm value read-only when provided to reduce accidental mismatches.

---

## Accounting Export Architecture

### Canonical Schema (Export Abstraction Plan Phase 1-3)
- `AccountingExportService` assembles invoices/charges into canonical structures containing invoice headers, line items, taxes, and mapping resolutions.
- Stores outputs in `accounting_export_batches` and `accounting_export_lines` with statuses (`validating`, `ready`, `delivered`, `failed`), timestamps (`validated_at`, `delivered_at`), and external references.
- Maintains currency precision, service period metadata, tracking dimensions, and mapping lookups.

### Service & Workflow Integration
- Batch creation/execution exposed through workflow actions (`accounting_export.create_batch`, `accounting_export.execute_batch`) allowing Temporal workflows/Automation Hub to orchestrate exports.
- Events (`ACCOUNTING_EXPORT_COMPLETED`, `ACCOUNTING_EXPORT_FAILED`) emitted on completion for downstream automation/notifications.
- Status updates handle retries and preserve timestamps unless overwritten.

### Adapter Interface (`server/src/lib/adapters/accounting/accountingExportAdapter.ts`)
- Defines common contract: `capabilities`, `transform(canonicalBatch)`, `deliver(transformedBatch)`, optional `postProcess`.
- `AccountingAdapterRegistry` registers QuickBooks Online/Desktop and Xero adapters, resolved via `adapter_type`.

### QuickBooks Online Adapter Highlights (Phase 4)
- Transforms canonical batches into QBO invoice DTOs using `QboClientService`.
- Resolves service, tax, and payment term mappings through the generic resolver and persists SyncToken metadata (stored in mapping `metadata`).
- Deprecates legacy workflow helpers (`lookup_qbo_item_id`, `create_qbo_invoice`) in favor of export service orchestration.
- Pending work: granular rate limiting and partial-failure retry logic.

### QuickBooks Desktop (Planned)
- Generates IIF/CSV files capturing GL transactions (`TRNS`/`SPL` rows).
- Will expose download links via export dashboard and rely on GL account mappings (new mapping module planned).

### Xero Adapter Highlights (Phase 5)
- Uses `XeroClientService` for OAuth token refresh and catalog access (`listAccounts`, `listItems`, `listTaxRates`, `listTrackingCategories`).
- Supports multi-component tax lines, tracking category metadata, and error normalization into export line records.
- Manual retry trigger UI remains outstanding but service already flags failed lines for rerun.

---

## User Workflows

### Prerequisites
1. Ensure tenant has Accounting feature toggle enabled.
2. Connect adapter:
   - QBO: OAuth flow captures realm ID.
   - Xero: OAuth connection yields tenant ID (connectionId).
   - Desktop: configure export settings and ensure GL mappings exist.
3. Confirm user role grants `Billing Settings` permissions.

### Managing Mappings
1. Navigate to **Settings → Accounting Integrations**.
2. Select adapter tab (QuickBooks, Xero). Each shows sub-tabs rendered by `AccountingMappingManager`.
3. For each tab:
   - Click **Add Mapping**.
   - Choose Alga entity (service, tax region, etc.). Locked when editing existing mapping.
   - Select external entity from dropdown. If catalog is empty (due to permissions or connection issues), manually type the external identifier.
   - (Optional) Provide metadata JSON when adapter requires extra fields (e.g., Xero tax component array).
   - Save; dialog displays validation errors from server actions.
4. To edit or delete:
   - Use the row action menu.
   - Confirm deletion in modal. Deleting removes mapping record from `tenant_external_entity_mappings`.
5. Refresh data via tab reload (automatic after create/update/delete).

### Running Exports
1. From **Billing → Accounting Exports** (Phase 6 in progress):
   - Choose adapter/export type; define filters (date range, contract tags, etc.).
   - Trigger export to create batch (records `ready` status once validations pass).
2. Execute batch:
   - Immediate execution via UI action or automation workflow.
   - Monitor progress; delivered batches show completion timestamp and external document references.
3. Download artifacts:
   - For QuickBooks Desktop, download generated IIF/CSV.
   - For API adapters, view reference IDs returned by external system.
4. Address failures:
   - Inspect `accounting_export_lines` for errors (UI surfaces message).
   - Resolve root cause (often missing mapping, invalid tax rate, or authentication).
   - Re-run batch after correcting data; failed lines can be retried.

### Troubleshooting Checklist
- **Missing mapping error** – Create mapping in relevant tab; rerun export.
- **Realm mismatch** – Verify connection ID shown in dialog matches authorized accounting tenant.
- **Catalog empty** – Check adapter connection health; ensure integration user has rights to list items/tax rates.
- **Metadata parse failure** – Validate JSON structure in mapping dialog; see adapter-specific schema notes.
- **API rate limits** – Monitor adapter logs; QuickBooks Online rate limiting work is tracked in Export Plan Phase 4.

---

## Operational Considerations
- **Permissions** – `hasPermission(user, 'billing_settings', 'read|update')` gates mapping actions. Support teams need elevated roles to assist tenants.
- **Feature flags** – Rollout of unified mapping UI may be staged; confirm feature toggle status before enabling for tenants.
- **Logging** – Server actions log create/update/delete events with tenant context. Export flows log batch lifecycle and adapter responses.
- **Auditing** – `tenant_external_entity_mappings` retains timestamps; `accounting_export_batches` captures `triggered_by` user id for traceability.
- **Backfills & migrations** – Schema renames (`invoice_items` → `invoice_charges`, etc.) coordinated under Export Plan Phase 1. Historical data requires backfill before enabling exports.
- **Testing** – Use Playwright harness overrides for deterministic UI tests; Vitest covers module factories; integration tests execute export flows against sqlite/pg fixtures. Sandbox runs against QBO/Xero demo companies capture regression fixtures.

---

## Roadmap & Open Items
- Complete remaining tasks in the UI unification plan:
  - Add Xero modules for payment terms and tracking categories.
  - Replace legacy QBO-specific globals in Playwright with generic registry.
  - Capture screenshots for release notes and update `docs/accounting_exports.md` (to be authored once export dashboard ships).
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
- `server/src/components/accounting-mappings/AccountingMappingManager.tsx`
- `server/src/components/accounting-mappings/AccountingMappingModuleView.tsx`
- `server/src/components/accounting-mappings/AccountingMappingDialog.tsx`
- `server/src/components/accounting-mappings/types.ts`
- `server/src/components/integrations/xero/XeroMappingManager.tsx`
- `server/src/components/integrations/xero/xeroMappingModules.ts`
- `server/src/lib/actions/externalMappingActions.ts`
- `server/src/lib/adapters/accounting/accountingExportAdapter.ts`
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

