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

---

## Acceptance Tests
- **Mapping Management**
  - `MappingCRUD#L1`: Admin manages QuickBooks Online mappings (create/edit/delete service, tax, term entries); UI renders resolved names; audit log captures each change.
  - `MappingFallback#L1`: Invoice line resolves through contract-line override, service override, then service-category fallback; reordering fallbacks changes exported mapping; missing fallbacks block batch with actionable validation.
  - `XeroMappings#L1`: Xero tenant imports accounts/tax rates/tracking categories, selects valid entries, handles inactive IDs with warnings, and bulk CSV import prevents duplicates.
  - `MappingPermissions#L1`: Finance role can mutate mappings while other roles are read-only; unauthorized write attempts fail due to RLS and surface clear error.
- **Export Validation & Execution**
  - `ValidationUnmapped#L1`: Batch creation detects unmapped services/taxes/terms, marks batch `needs_attention`, and lists failures in UI/API until corrected.
  - `ValidationCurrency#L1`: Multi-currency invoices export using stored exchange rate; converted totals match accounting amounts; overrides persist across retries.
  - `BatchLifecycle#L1`: Batch transitions `pending → validating → ready → delivered → posted`; duplicate reruns are blocked; cancellation allowed before delivery with proper status locks.
  - `InvoiceSelection#L1`: Batches respect filters (date range, status, client, tenant), include manual invoices, multi-period lines, credit memos, and zero-dollar charges while maintaining transaction linkage.
  - `Concurrency#L1`: Concurrent exports across tenants succeed; same-tenant overlapping ranges are rejected; single invoice cannot be exported in two live batches simultaneously.
  - `AuditTrail#L1`: Batch records canonical snapshot, adapter payload, and checksum; transaction ledger references batch and vice versa.
- **Adapters – QuickBooks Online**
  - `QBOInvoiceCreate#L1`: New invoices push with mapped items, taxes, terms, and service-period metadata; success stores QBO ID + SyncToken in mapping metadata.
  - `QBOInvoiceUpdate#L1`: Existing invoice updates via sparse payload using latest SyncToken; totals and addresses remain consistent; mapping metadata refreshes.
  - `QBOErrorHandling#L1`: 429 responses respect backoff; 401 triggers token refresh; invalid mappings produce batch errors without duplicate API calls.
  - `QBOPermissions#L1`: Revoked OAuth connections fail gracefully, surface reconnect prompt, and leave batch in failed state without data loss.
  - `QBOClassTracking#L1`: Optional class/location mapping populates when configured; absence leads to omitted fields with no failures.
- **Adapters – QuickBooks Desktop**
  - `QBDFileGeneration#L1`: Generated IIF/CSV follows schema (TRNS/SPL rows, headers, encoding) and imports cleanly into sample QuickBooks company with balanced totals.
  - `QBDAccountMapping#L1`: Income, AR, and tax liability accounts resolve via mappings; missing accounts stop batch pre-generation with clear guidance.
  - `QBDMultiInvoice#L1`: Multi-invoice batch yields single downloadable artifact with recorded checksum; re-download is tracked without duplicate batches.
  - `QBDRetry#L1`: Manual re-export after mapping fix regenerates file and updates batch history while preventing stale-download confusion.
- **Adapters – Xero**
  - `XeroInvoiceCreate#L1`: OAuth-connected tenant exports invoice with AccountCode, TaxType, and Tracking metadata; Xero reflects amounts and contact linkage.
  - `XeroMultipleTax#L1`: Mixed tax lines produce separate tax components aligned with Xero’s rules; totals reconcile.
  - `XeroErrorHandling#L1`: Validation failure (e.g., inactive tax) logs error, marks line as failed, allows targeted retry after mapping update.
  - `XeroCreditNote#L1`: Credit memos export as Xero Credit Notes, link to original invoice, and present negative totals correctly.
- **User Interface & Operations**
  - `ExportDashboard#L1`: Dashboard lists batches with status, totals, adapter, creator; pagination/search works; download gated to finance/Admin roles.
  - `InvoiceDetail#L1`: Invoice detail page shows export history, batch linkage, and enables guarded re-export when eligible.
  - `Notifications#L1`: Failed batches trigger email and task notifications to finance role; resolving batch clears alerts automatically.
  - `FeatureFlag#L1`: Feature toggle hides all export UI when disabled and restores prior batches when enabled without data loss.
- **Security & Isolation**
  - `TenantIsolation#L1`: Tenant isolation enforced across APIs and UI; direct DB queries under tenant context show only own batches.
  - `SecretManagement#L1`: OAuth secrets stored in secret provider, support rotation, and remain inaccessible to non-privileged users.
  - `LoggingPII#L1`: Logs redact tokens and sensitive IDs during success and failure flows; tests verify no PII leakage.
- **Regression & Legacy Compatibility**
  - `LegacyReexport#L1`: Historical invoices export after mapping backfill; missing service-period data defaults to invoice period without breaking downstream systems.
  - `BillingEngineCompat#L1`: Subsequent billing runs do not alter exported status; new charges require new batch; settlement flows remain intact.
  - `ArrearsAdvanceMix#L1`: Invoices containing advance and arrears lines export with distinct service periods, and accounting system reflects both timings.
- **Performance & Resilience**
  - `LargeBatch#L1`: Batch of ≥500 invoices completes within SLA, respecting memory/CPU thresholds and adapter pagination.
  - `RetryPolicy#L1`: Configurable retry counts honor limits; exhausted retries mark batch failed with aggregated reasons.
  - `SystemRestart#L1`: Export job survives worker restart by resuming from last checkpoint without duplicating payloads.
