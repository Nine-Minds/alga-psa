# Accounting Export Abstraction Plan

## Purpose & Overview
Deliver a reusable accounting export layer that transforms Alga PSA invoices into accounting-ready payloads and adapters for QuickBooks (Online/Desktop) and Xero. The solution must support configurable GL/item/tax mappings, batchable exports with auditability, and integration points for both file-based and API-driven handoffs.

Primary outcomes:
- Canonical “accounting export” schema that captures invoice headers, line items, tax, service-period metadata, and mapping resolutions in tenant scope.
- Mapping management UX so finance teams align PSA services, tax regions, payment terms, and tracking dimensions with accounting identifiers without engineering changes.
- Export engine that validates invoices, resolves mappings, produces adapter-ready DTOs, and records export batches/status for reconciliation.
- QuickBooks adapter(s) (Online API, Desktop IIF/CSV) and Xero adapter (API or CSV) that translate canonical payloads into package-specific formats while reusing credentials and throttling services.

---

## Discovery Highlights *(Completed)*
- **Billing data richness:** `invoice_items` and `invoice_item_details` already store service, contract, tax, and service-period metadata (`server/migrations/20250412214804_add_invoice_item_details_tables.cjs`, `docs/billing.md`). Amounts are persisted in cents (integers) while `transactions.amount` stays decimal, so the export layer must normalize currency precision.
- **Mappings backbone:** `tenant_external_entity_mappings` tracks per-tenant relationships between Alga entities and external IDs with optional metadata (`server/migrations/20250502173321_create_tenant_external_entity_mappings.cjs`). UI scaffolding exists under `server/src/components/integrations/qbo/*`, and server actions (`server/src/lib/actions/externalMappingActions.ts`) expose CRUD, but lookups inside QBO workflows still rely on placeholders.
- **Event-driven QBO sync (WIP):** Workflows (`server/src/lib/workflows/qboInvoiceSyncWorkflow.ts`, `qboCustomerSyncWorkflow.ts`) and `QboClientService` provide OAuth token management and API calls. Many actions (`lookup_qbo_item_id`, `create_qbo_invoice`) still simulate results, so the accounting export layer should either replace or harden these flows.
- **Client + tax metadata:** `clients`, `client_locations`, `client_tax_rates`, and `tax_rates` tables hold billing contacts, addresses, tax regions, and default tax codes (`server/migrations/20251003000001_company_to_client_migration.cjs`). Invoice generation already calls `TaxService` and stores `tax_rate` and `tax_region` on each line.
- **Gaps identified:**
  - No canonical export tables or status tracking exist today; reconciliations rely on `transactions`.
  - Invoice schema lacks currency code/precision fields despite multi-currency goals noted in `docs/overview.md`.
  - Mapping UIs retrieve QBO catalog data but assume a single realm and do not support fallback mapping by contract line/service category.
  - Xero integrations are absent; only QuickBooks Online scaffolding exists.

---

## Scope & Deliverables
- Canonical accounting export data model and services covering invoices, line items, taxes, and mapping resolutions.
- Mapping UX enhancements (service category fallbacks, tax code alignment, GL account mapping) leveraging `tenant_external_entity_mappings`.
- Export orchestration service with batch creation, validation, error reporting, and rerun controls.
- Adapter implementations:
  - QuickBooks Online API export (leveraging `QboClientService`).
  - QuickBooks Desktop GL export (IIF or CSV).
  - Xero API/CSV export with OAuth connection management.
- Operations UI for listing export batches, downloading files, inspecting errors, and marking batches as posted.
- Automated tests (unit/integration) and sandbox verification flows for each adapter.

Out of scope for this iteration: automatic payment imports, two-way sync of journal entries, and generalized ERP integrations beyond QuickBooks/Xero.

---

## Phase 1 – Data Model & Canonical Schema
- [ ] **Add export tables**
  - `accounting_export_batches` (tenant, adapter, target_company/realm, export_type, filters, triggered_by, status timestamps, checksum).
  - `accounting_export_lines` (batch_id, tenant, invoice_id, invoice_item_id, canonical amounts, currency, service dates, mapping references, tax breakdown, export payload snapshot).
  - `accounting_export_errors` (batch_id, line_id nullable, code, message, resolution_status).
- [ ] **Normalize currency handling**
  - Introduce `currency_code` + `exchange_rate` columns on `invoices` (defaulting to tenant currency) and extend billing engine to populate them.
  - Ensure `invoice_items.unit_price/total_price` and `transactions.amount` are reconciled in cents vs. decimals; add helper to convert consistently.
- [ ] **Canonical DTOs**
  - Create TypeScript interfaces (e.g., `AccountingInvoiceExport`, `AccountingLineExport`) under `server/src/interfaces/accountingExport.interfaces.ts`.
  - Implement a builder (e.g., `AccountingExportAssembler`) that reads invoices, joins `invoice_item_details`, `client_contract_lines`, `services`, `tax_rates`, and emits canonical DTOs.
- [ ] **Audit trails**
  - Store rendered adapter payload (JSON blob / file path) per line or batch for traceability.
  - Add relationship from `transactions` to `accounting_export_batches` (nullable FK) for reconciliation reporting.

## Phase 2 – Mapping & Configuration Enhancements
- [ ] **Extend mapping schema**
  - Allow hierarchical keys (service_id, contract_line_id, service_category) with priority ordering; store in `metadata` or add dedicated columns.
  - Introduce mapping types for GL account (`gl_account`), revenue class (`class`/`department`), and tax code fallback.
  - Track effective dates / versioning where needed (e.g., mapping changes mid-year).
- [ ] **Mapping UI upgrades**
  - Update QBO mapping tables to support fallback resolution order and surface validation warnings for unmapped entities.
  - Add Xero mapping pages (items/accounts, tax rates, tracking categories) reusing the same `externalMappingActions`.
- [ ] **Lookup services**
  - Replace placeholder lookup actions with shared resolver (`AccountingMappingResolver`) that queries `tenant_external_entity_mappings`, supports fallback rules, and caches results during batch export.
- [ ] **Validation hooks**
  - Add pre-export validation step that flags invoices/lines missing required mappings (service, tax code, payment term) and records them in the error table.

## Phase 3 – Export Engine & Workflow Integration
- [ ] **Batch orchestration**
  - Service API (`createAccountingExportBatch`, `executeAccountingExportBatch`) handling filters (date range, invoice status, tenant, integration target).
  - Option to schedule recurring exports via Automation Hub or cron jobs; record source trigger.
- [ ] **Adapter interface**
  - Define `AccountingExportAdapter` contract with methods `capabilities`, `transform(batch)`, `deliver(transformedPayload)`, `postProcess`.
  - Implement adapter registry to resolve by integration type (`quickbooks_online`, `quickbooks_desktop`, `xero`).
- [ ] **Workflow alignment**
  - Emit events (`ACCOUNTING_EXPORT_COMPLETED`, `ACCOUNTING_EXPORT_FAILED`) into event bus for downstream automation.
  - Optionally wrap export execution as Automation Hub workflow action so existing QBO workflows can invoke the canonical exporter instead of bespoke logic.
- [ ] **Status tracking**
  - Persist batch states (`pending`, `validating`, `ready`, `delivered`, `posted`, `failed`, `needs_attention`) and expose in UI + API.

## Phase 4 – QuickBooks Adapter Implementation
- [ ] **QuickBooks Online**
  - Use canonical DTOs to build QBO `Invoice` payloads; reuse `QboClientService` for OAuth/refresh.
  - Map items/tax codes/terms via the new resolver; persist SyncToken in mapping metadata (`tenant_external_entity_mappings.metadata.sync_token`).
  - Implement rate limiting, partial failure handling (retry per invoice), and write success/failure to batch tables.
  - Retire placeholder actions (`lookup_qbo_item_id`, `create_qbo_invoice`) in favor of adapter calls; update workflows to use the adapter service.
- [ ] **QuickBooks Desktop GL Export**
  - Define IIF (or CSV) writer that translates canonical batches into `TRNS`/`SPL` rows with account codes, classes, terms, and due dates.
  - Store generated file path in `accounting_export_batches` and expose Download action in UI.
  - Provide mapping for GL account codes (income, AR, tax liabilities) via new mapping types.

## Phase 5 – Xero Adapter Implementation
- [ ] **Connectivity**
  - Introduce Xero OAuth client (tenant-secret storage similar to QBO) and throttling guard.
  - Implement retrieval of Xero items, accounts, tax rates, and tracking categories for mapping UI.
- [ ] **Invoice payload**
  - Map canonical DTOs to Xero `Invoice` API structure (or CSV template) including `AccountCode`, `TaxType`, `Tracking` arrays, and contact references.
  - Handle multi-tax lines (GST/VAT) per Xero requirements.
- [ ] **Error handling**
  - Normalize Xero API errors into export error records; support manual retries per invoice.

## Phase 6 – UI & Operational Tooling
- [ ] **Export dashboard**
  - Add “Accounting Exports” tab under billing settings showing batches, status, adapter, created by, exported totals, and links to download payload or view errors.
- [ ] **Invoice detail integration**
  - Surface export status per invoice (e.g., “Exported to QuickBooks on 2025-11-02”) with link to batch record.
  - Allow manual re-export for a single invoice after correcting mappings (creates new batch or appends to existing pending batch).
- [ ] **Notifications**
  - Trigger email/task notifications for failed batches or unmapped line items to assigned finance role.

## Phase 7 – Testing, QA, and Rollout
- [ ] **Automated tests**
  - Unit tests for mapping resolver, canonical assembler, adapter transformations.
  - Integration tests using sqlite/pg tenant fixtures to verify batch creation and error paths.
  - Sandbox tests hitting QuickBooks Online sandbox and Xero demo company; capture sample payloads for regression fixtures.
- [ ] **Data migration & backfill**
  - Backfill currency codes and service-period data for historical invoices before enabling exports.
  - Migrate existing QBO mapping data into new hierarchy/metadata structure.
- [ ] **Documentation & training**
  - Author admin guide covering mapping maintenance, export workflows, retries, and reconciliation steps.
  - Publish release notes and upgrade checklist for tenants (include mapping prerequisites).
- [ ] **Launch plan**
  - Enable feature flag for internal tenant; run pilot exports with finance team.
  - Roll out QuickBooks Online first, follow with Desktop and Xero after validation.

---

## Dependencies & Integration Points
- `tenant_external_entity_mappings` (extend schema and UI) and associated RLS policies (`server/migrations/20250512135501_update_constrains_and_fks.cjs`).
- Billing engine outputs (`server/src/lib/billing/billingEngine.ts`, `server/src/lib/services/invoiceService.ts`) for canonical data assembly.
- Event bus + Automation Hub if exports are scheduled or triggered by workflows (`server/src/lib/eventBus`, `shared/workflow/init/registerWorkflowActions.ts`).
- Secret management (`@shared/core` secret provider) for QuickBooks/Xero credentials.

---

## Risks & Mitigations
- **Mapping drift / missing references:** Mitigate with validation gates, batch-level blockers, and proactive UI warnings; consider nightly report of unmapped services.
- **Currency inconsistencies:** Normalize to cents in canonical DTOs, store currency code on invoices, and add regression tests around rounding.
- **Adapter throttling / rate limits:** Use per-tenant throttling queues and exponential backoff (reuse existing QBO throttling helpers).
- **Workflow overlap:** Coordinate with existing QBO workflow owners to deprecate placeholder logic and avoid duplicate pushes.
- **Tenant isolation in new tables:** Apply RLS and composite keys mirroring invoice tables to preserve tenancy guarantees.

---

## Open Questions
- Do we need to support QuickBooks Desktop first (file-based) or prioritize QuickBooks Online? Outputs differ (IIF vs. API).
- Should payments posted in accounting flow back into PSA (`transactions`) as part of this initiative or a follow-up?
- How many revenue recognition dimensions (department/class/location) must be supported at launch? Do we need additional PSA metadata to map them?
- What is the minimal viable currency story (single base currency vs. true multi-currency)? Do we require historical exchange rates per invoice?
- Are there regulatory requirements (e.g., VAT digital links) that dictate export format or audit storage beyond current design?
