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
- **Billing data richness:** Current `invoice_items` / `invoice_item_details` tables—slated to become `invoice_charges` / `invoice_charge_details`—already store service, contract, tax, and service-period metadata (`server/migrations/20250412214804_add_invoice_item_details_tables.cjs`, `docs/billing.md`). Amounts are persisted in cents (integers) while `transactions.amount` stays decimal, so the export layer must normalize currency precision.
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
- [ ] **Terminology alignment (Charges)**
  - Rename `invoice_items` table to `invoice_charges`; create compatibility view `invoice_items` for interim references and update ORM/Knex bindings.
  - Rename supporting detail tables (`invoice_item_details` → `invoice_charge_details`, `invoice_item_fixed_details` → `invoice_charge_fixed_details`) and adjust foreign keys.
  - Update TypeScript interfaces (`IInvoiceItem` → `IInvoiceCharge`), billing engine services, and API serializers to use “charge” terminology while maintaining backward-compatible DTO aliases where external integrations rely on the old name.
  - Migrate tests, seeds, and documentation to the new naming; publish release notes and migration guidance for self-hosted tenants.
- [x] **Add export tables**
  - `accounting_export_batches` (tenant, adapter, target_company/realm, export_type, filters, triggered_by, status timestamps, checksum).
  - `accounting_export_lines` (batch_id, tenant, invoice_id, invoice_charge_id, canonical amounts, currency, service dates, mapping references, tax breakdown, export payload snapshot).
  - `accounting_export_errors` (batch_id, line_id nullable, code, message, resolution_status).
- [ ] **Normalize currency handling**
  - Introduce `currency_code` + `exchange_rate` columns on `invoices` (defaulting to tenant currency) and extend billing engine to populate them.
  - Convert `transactions.amount` to an integer column (representing cents) via staged migration: add temp integer column, backfill by multiplying existing decimals, swap, and remove the legacy decimal.
  - Ensure `invoice_charges.unit_price/total_price` and `transactions.amount` share the same integer-based representation; add helper utilities when interfacing with external APIs that expect decimals.
- [x] **Canonical DTOs**
  - Create TypeScript interfaces (e.g., `AccountingInvoiceExport`, `AccountingLineExport`) under `server/src/interfaces/accountingExport.interfaces.ts`.
  - Implement a builder (e.g., `AccountingExportAssembler`) that reads invoices, joins `invoice_charge_details`, `client_contract_lines`, `services`, `tax_rates`, and emits canonical DTOs.
- [ ] **Audit trails**
  - Store rendered adapter payload (JSON blob / file path) per line or batch for traceability.
  - Add relationship from `transactions` to `accounting_export_batches` (nullable FK) for reconciliation reporting.

### Schema Overview (ASCII)
```
                             +-------------------------------+
                             | accounting_export_batches     |
                             |-------------------------------|
                             | batch_id (PK)                 |
                             | tenant                        |
                             | adapter_type                  |
                             | target_realm                  |
                             | export_type                   |
                             | filters_json                  |
                             | status                        |
                             | started_at / completed_at     |
                             | checksum                      |
                             +---------------+---------------+
                                             |
                              1 batch : N lines
                                             v
               +-----------------------------+-----------------------------+
               | accounting_export_lines                                  |
               |----------------------------------------------------------|
               | line_id (PK)                                             |
               | batch_id (FK -> accounting_export_batches.batch_id)      |
               | tenant                                                   |
               | invoice_id (FK -> invoices)                              |
               | invoice_charge_id (FK -> invoice_charges)                |
               | canonical_amount_cents                                   |
               | currency_code / exchange_rate                            |
               | service_period_start / service_period_end                |
               | mapping_resolution_json                                  |
               | delivery_status                                          |
               | external_document_ref                                    |
               +-----------------------------+----------------------------+
                                             |
                              1 line : N errors
                                             v
               +----------------------------------------------------------+
               | accounting_export_errors                                 |
               |----------------------------------------------------------|
               | error_id (PK)                                            |
               | batch_id (FK -> accounting_export_batches.batch_id)      |
               | line_id NULLABLE (FK -> accounting_export_lines.line_id) |
               | code                                                     |
               | message                                                  |
               | resolution_state                                         |
               | created_at / resolved_at                                 |
               +----------------------------------------------------------+
                                             ^
                                             |
                         nullable link from transactions ledger

 existing tables:
   invoices ---------+
                     |
   invoice_charges --+--> accounting_export_lines (line-level joins)

   tenant_external_entity_mappings --(
        referenced via mapping_resolution_json lookup metadata

   transactions -----(
        optional FK -> accounting_export_batches for reconciliation
```

## Phase 2 – Mapping & Configuration Enhancements
- [ ] **Extend mapping schema**
  - Allow hierarchical keys (service_id, contract_line_id, service_category) with priority ordering; store in `metadata` or add dedicated columns.
  - Introduce mapping types for GL account (`gl_account`), revenue class (`class`/`department`), and tax code fallback.
  - Track effective dates / versioning where needed (e.g., mapping changes mid-year).
- [ ] **Mapping UI upgrades**
  - Update QBO mapping tables to support fallback resolution order and surface validation warnings for unmapped entities.
  - Add Xero mapping pages (items/accounts, tax rates, tracking categories) reusing the same `externalMappingActions`.
- [x] **Lookup services**
  - Replace placeholder lookup actions with shared resolver (`AccountingMappingResolver`) that queries `tenant_external_entity_mappings`, supports fallback rules, and caches results during batch export.
- [x] **Validation hooks**
  - Add pre-export validation step that flags invoices/lines missing required mappings (service, tax code, payment term) and records them in the error table.

## Phase 3 – Export Engine & Workflow Integration
- [x] **Batch orchestration**
  - Service API (`createAccountingExportBatch`, `executeAccountingExportBatch`) handling filters (date range, invoice status, tenant, integration target).
  - Option to schedule recurring exports via Automation Hub or cron jobs; record source trigger.
- [x] **API surface**
  - Expose REST endpoints under `/api/accounting/exports` for batch CRUD, line/error append, and status updates to support UI and automation integrations.
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

## Screen Architecture & User Flows

### Accounting Settings ▸ Accounting Integrations (`/msp/settings/accounting`)
- **Layout:** Two-column settings shell. Left nav highlights “Accounting”. Primary content area renders accounting integration cards and mapping workspace.
- **Adapter Tabs:** Tab bar (`id="accounting-integration-tabs"`) with entries for each connected adapter (QuickBooks Online, QuickBooks Desktop, Xero). Selecting a tab loads adapter-specific mappings panel.
- **Mappings Panel**
  1. Sections for **Service Items**, **Tax Codes**, **Payment Terms**, and optional **GL/Class Mappings** rendered as cards with tables (Radix `Table` component).
  2. Each table header includes `Add Mapping` button (`id="add-{entity}-mapping-button"`) that opens `QboMappingFormDialog`/`XeroMappingFormDialog`.
  3. Table rows provide `Edit` (`id="edit-{entity}-mapping-{rowId}"`) and `Remove` actions in dropdown menus (`{entity}-mapping-actions-menu`).
  4. Fallback order modal triggered by `Configure Fallback` chip; modal lists overrides (contract line, service, category) with drag handles to reorder and checkbox to enable fallback.
  5. CSV import available via `Import CSV` button which opens upload dialog; download template link included.
- **Bulk Operations:** Toolbar (`id="mapping-toolbar"`) with adapter realm selector, `Refresh from Adapter`, `Import CSV`, and `Export CSV`.
- **Permissions:** Non-finance roles see tables in read-only state (buttons disabled, actions hidden) with tooltip “Finance role required”.

### Accounting Exports Dashboard (`/msp/billing/accounting-exports`)
- **Filters Bar:** Date range picker (`id="export-date-filter"`), status multi-select, adapter select, client search. `Reset Filters` chip clears selections.
- **Batch Table:** Columns for Batch ID, Created At, Adapter, Invoice Count, Amount, Status, Created By. Row click opens side drawer.
- **Create Batch CTA:** `New Export` button triggers modal with filter form (date range, invoice status, adapter target, optional client filter). `Preview Invoices` step shows resolved invoice list before confirming.
- **Side Drawer (Batch Detail):**
  - Tabs for Overview (summary, totals, download links) and Line Items (table with invoice, amount, status, message).
  - `Mark as Posted`, `Cancel Batch`, `Retry Failed Lines` buttons shown based on status.
  - Activity log timeline showing state transitions and actor.

### Invoice Detail Augmentation (`/msp/billing/invoices/[invoiceId]`)
- **Export History Card:** Within right-hand sidebar. Lists export events (adapter, status, batch ID link, timestamp, actor). `Re-export Invoice` button shown when invoice eligible; opens modal referencing batch creation wizard with invoice preselected.
- **Status Chips:** When exported, invoice header shows chip “Exported to {Adapter} on {date}”.

### Notifications & Task Inbox
- **Toast/Email:** Failed batches raise toast with link to batch drawer and send email to finance distribution list.
- **Task Inbox Card:** Workflow-generated tasks for failures display `Review Accounting Export` template embedded with summary and quick actions (`Acknowledge`, `Open Batch`).

### Permissions & Feature Toggle
- Feature flag `accounting_exports` gates navigation entry and API routes. When off, menu item hidden and direct routes return 404.
- Role matrix: `finance_admin` full access; `billing_manager` can run exports but not edit mappings; others view-only.

---

## Acceptance Tests
- **Mapping Management**
  - `MappingCRUD#L1`
    1. Log in as `finance_admin`; navigate to `/msp/settings/accounting`.
    2. Select “QuickBooks Online” tab (`accounting-integration-tabs`).
    3. In Service Items section, click `Add Mapping` button; complete dialog (select PSA service `svc-001`, select QBO item `Consulting`, save).
    4. Verify new row shows PSA Service Name and QBO Item Name.
    5. Open row actions (`service-mapping-actions-menu-{rowId}`) → Edit; change QBO item to `Consulting - Premium`; save; verify table updates.
    6. Open row actions → Delete; confirm removal; entry disappears.
    7. Open Audit Log (existing system) and confirm create/update/delete entries referencing mapping ID.
  - `MappingFallback#L1`
    1. From same screen, click `Configure Fallback` chip in Service Items card.
    2. Reorder fallback list to `Contract Line`, `Service`, `Category` by dragging handles.
    3. Enable category fallback checkbox and select category `Managed Services`.
    4. Save; run test export (see `ValidationUnmapped#L1` steps) with invoice covering contract line, confirm exported payload uses contracted mapping.
    5. Move category fallback to top; run batch preview again; verify preview now shows category-based mapping.
    6. Remove category fallback, save; attempt batch creation; ensure validation error highlights unmapped line with instruction to add mapping.
  - `XeroMappings#L1`
    1. Navigate to Xero tab; click `Refresh from Adapter` to pull latest accounts/tax/tracking; ensure spinner resolves without error.
    2. Add Service mapping selecting PSA service and Xero revenue account; ensure `AccountCode` column populated.
    3. Click `Import CSV`, upload sample mapping file; verify rows added without duplicates.
    4. Mark Xero account inactive externally; click `Refresh from Adapter`; verify affected row shows warning badge and validation message.
  - `MappingPermissions#L1`
    1. Log in as `billing_manager`; confirm Add/Edit/Delete buttons enabled.
    2. Log in as `support_agent`; navigate to same screen; verify controls disabled and tooltip text “Finance role required”.
    3. Attempt to POST via API as support agent; expect 403 and audit log entry for denied attempt.
- **Export Validation & Execution**
  - `ValidationUnmapped#L1`
    1. Create invoice with service lacking mapping.
    2. Go to `/msp/billing/accounting-exports`; click `New Export`.
    3. Select adapter, date range covering invoice, proceed to Preview; expect preview table shows red badge “Mapping Required”.
    4. Attempt to confirm; modal blocks with error banner referencing missing mapping.
    5. After adding mapping, reopen modal, preview shows green check, confirmation succeeds.
  - `ValidationCurrency#L1`
    1. Create invoice in EUR with stored exchange rate on invoice record.
    2. Run export wizard; on preview confirm displayed home currency totals match converted values.
    3. After batch delivery, inspect batch detail drawer to verify captured `currency_code`, `exchange_rate`, converted amount.
  - `BatchLifecycle#L1`
    1. Create batch via wizard and confirm; batch row shows `pending`.
    2. Trigger worker to process; observe status transitions to `validating`, `ready`, `delivered`.
    3. From drawer, click `Mark as Posted`; status updates.
    4. Attempt to re-run same filter range; wizard displays warning “Batch already exists”; prevents duplicate creation.
    5. Create second batch, cancel from drawer before delivery; status becomes `cancelled`; confirm actions disabled thereafter.
  - `InvoiceSelection#L1`
    1. Use filters: set date range, choose invoice statuses, select specific client.
    2. Click `Preview Invoices` to ensure only matching invoices appear.
    3. Verify manual invoices, multi-period items, credit memos, zero-dollar lines display with correct metadata.
    4. On confirm, ensure resulting batch references proper `transaction_id` links.
  - `Concurrency#L1`
    1. Start batch creation for Tenant A; simultaneously attempt same range for Tenant B; both succeed.
    2. Attempt to create overlapping batch for Tenant A before first finishes; wizard shows blocking message referencing existing batch.
    3. Verify same invoice ID cannot enter two `pending` batches by inspecting batch detail data.
  - `AuditTrail#L1`
    1. Open delivered batch drawer; download canonical JSON snapshot via link.
    2. Confirm `transactions` row now stores integer `amount` matching invoice charge totals (in cents) and contains `accounting_export_batch_id` referencing batch.
    3. Run reporting query to ensure batch ID appears in finance audit view.
- **Adapters – QuickBooks Online**
  - `QBOInvoiceCreate#L1`
    1. Ensure tenant connected to QBO via OAuth and mappings configured.
    2. Run export with new invoices; monitor job logs for create API call payload; confirm includes Line ServiceDate per invoice item.
    3. After success, open mapping table and confirm metadata column shows QBO invoice ID + SyncToken.
    4. In QBO sandbox, verify invoice exists with matching totals and tax.
  - `QBOInvoiceUpdate#L1`
    1. Modify exported invoice in PSA (e.g., adjust quantity).
    2. Initiate re-export via Invoice detail `Re-export` button.
    3. Confirm system performs update call (sparse, includes SyncToken).
    4. Validate QBO invoice reflects change and mapping metadata updated.
  - `QBOErrorHandling#L1`
    1. Configure mock to respond 429; execute export; ensure adapter retries with exponential backoff and records attempt log.
    2. Force 401 (expire token); verify adapter refreshes token and retries once; if refresh fails, batch flagged failed with reconnect prompt.
    3. Create invoice with missing mapping to cause validation error; ensure batch line enters `failed` with message referencing missing mapping.
  - `QBOPermissions#L1`
    1. Revoke OAuth consent from Intuit portal.
    2. Trigger export; verify batch stops with status `failed`, UI shows “Reconnect QuickBooks” CTA linking to OAuth flow.
    3. After reconnection, rerun export and confirm success.
  - `QBOClassTracking#L1`
    1. Add class/location mapping in settings.
    2. Export invoice; inspect QBO payload includes `ClassRef`/`DepartmentRef`.
    3. Remove mapping; export again; confirm fields omitted.
- **Adapters – QuickBooks Desktop**
  - `QBDFileGeneration#L1`
    1. On batch drawer, click `Download IIF`; verify file includes TRNS/SPL rows with invoice numbers.
    2. Import into QuickBooks Desktop sample company; ensure no import errors and totals match.
    3. Confirm batch record captures checksum and download timestamp.
  - `QBDAccountMapping#L1`
    1. Remove GL account mapping; attempt export; wizard blocks with error referencing missing account.
    2. Add mapping; export again; ensure generated file uses mapped account codes.
  - `QBDMultiInvoice#L1`
    1. Create batch covering >1 invoice; after delivery confirm single artifact produced.
    2. Download twice; ensure each download logged in batch activity without duplicating batch.
  - `QBDRetry#L1`
    1. After correcting mapping, click `Retry Failed Lines`; confirm new file generated and appended to activity log.
    2. Verify previous failed lines now marked delivered.
- **Adapters – Xero**
  - `XeroInvoiceCreate#L1`
    1. Connect tenant to Xero; ensure mappings present.
    2. Run export; confirm API payload contains `AccountCode`, `TaxType`, `Tracking` arrays matching mapping.
    3. Verify in Xero sandbox invoice created with correct data.
  - `XeroMultipleTax#L1`
    1. Prepare invoice with mixed GST/PST lines; export.
    2. Confirm payload includes separate tax components; Xero invoice shows correct totals.
  - `XeroErrorHandling#L1`
    1. Deactivate tax rate in Xero; run export; expect line error recorded with message from Xero.
    2. Reactivate or remap tax; use `Retry Failed Lines`; ensure success status updates.
  - `XeroCreditNote#L1`
    1. Create PSA credit memo linked to original invoice; export.
    2. Validate Xero credit note references original document and amounts are negative.
- **User Interface & Operations**
  - `ExportDashboard#L1`
    1. Navigate to dashboard; apply filters; confirm table updates.
    2. Use pagination to view additional batches; ensure data persists.
    3. As finance admin, download payload from drawer; as support agent, verify download button hidden/disabled.
  - `InvoiceDetail#L1`
    1. Open exported invoice; view Export History card listing batch links.
    2. Click batch link to open drawer; verify context slides in.
    3. Use `Re-export Invoice` button to start guided wizard prefilled with invoice; complete run and confirm new batch appended to history.
  - `Notifications#L1`
    1. Cause batch failure; ensure toast displays within 5 seconds with “View Batch” CTA.
    2. Check finance inbox for email summary containing batch ID.
    3. Open Task Inbox, locate “Review Accounting Export” task, mark as resolved; confirm toast disappears and task closed.
  - `FeatureFlag#L1`
    1. Disable `accounting_exports` via admin settings; confirm navigation entry removed and direct route returns 404.
    2. Re-enable; ensure dashboard reappears with prior data intact.
- **Security & Isolation**
  - `TenantIsolation#L1`
    1. Log in as Tenant A user; ensure only Tenant A batches visible.
    2. Switch to Tenant B; confirm Tenant A data not present.
    3. Execute API call for foreign batch ID; expect 404/403.
  - `SecretManagement#L1`
    1. Rotate OAuth secret via secret provider; execute export; confirm new token used.
    2. Attempt to read secret via unauthorized user; expect denial with audit entry.
  - `LoggingPII#L1`
    1. Enable debug logging; run successful export; inspect logs for absence of tokens.
    2. Force failure; confirm error logs scrub sensitive fields.
- **Regression & Legacy Compatibility**
  - `LegacyReexport#L1`
    1. Select invoice created prior to feature rollout; add necessary mappings.
    2. Use invoice `Re-export` button; ensure service period defaults to invoice header and export succeeds.
  - `BillingEngineCompat#L1`
    1. Export batch; trigger next billing run generating new invoice.
    2. Verify original invoice still marked exported; new invoice listed as unexported until next batch.
  - `ArrearsAdvanceMix#L1`
    1. Invoice with both advance and arrears lines; export.
    2. In accounting payload, confirm service dates reflect respective periods; downstream system displays two distinct service windows.
- **Performance & Resilience**
  - `LargeBatch#L1`
    1. Seed 500+ invoices; run export; capture processing time (< threshold) and monitor resource metrics.
    2. Verify adapter paginates API calls to stay within vendor limits.
  - `RetryPolicy#L1`
    1. Configure retry count to 2; induce transient failures; ensure system retries twice then fails with aggregated reason message.
    2. Update policy to 5; confirm new limit applied on next run.
  - `SystemRestart#L1`
    1. Launch export; midway, restart worker service.
    2. Confirm batch resumes automatically and delivered payload contains no duplicates.
- **API & Tooling**
  - `APIExports#L1`
    1. Call `POST /api/accounting/exports` to create a batch and verify response schema matches DTO definitions.
    2. Call `GET /api/accounting/exports` with filters to confirm listings respect status/adapter parameters.
  - `APIExportDetails#L1`
    1. Append lines/errors via `POST /api/accounting/exports/{batchId}/lines` and `/errors`; ensure subsequent batch fetch returns appended data.
    2. Update batch status using `PATCH /api/accounting/exports/{batchId}` and verify state transitions recorded.
  - `ValidationMissingMapping#L1`
    1. Create batch, append a line lacking service mapping, and confirm validation marks batch `needs_attention` with error record.
    2. Add mapping and re-run validation (re-append or trigger) to see batch flip to `ready`.
  - `CLITrigger#L1`
    1. Run `scripts/trigger-accounting-export.ts` and confirm it creates a placeholder batch/line.
    2. Validate seeded data appears through the API and can be managed alongside UI-driven batches.
