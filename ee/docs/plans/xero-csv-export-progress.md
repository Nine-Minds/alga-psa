# Xero CSV Export/Import - Implementation Progress (Updated for 2025 Accounting Plan)

## Overview

This document tracks the implementation progress of the Xero CSV Export/Import feature. The goal is a CSV-based Xero integration (no OAuth required) that has **the same outcomes and invariants** as the automated accounting export system (batches, mappings, audit trail, and “already exported” behavior) — the only difference should be the manual import step.

**Branch:** `feature/xero-csv-export`
**Feature File:** `ee/docs/plans/features-xero-csv-export.json`
**Started:** 2024-12-16
**Last Updated:** 2025-12-18

---

## Progress Summary

| Category | Completed | Total | Progress |
|----------|-----------|-------|----------|
| Backend | 9 | 9 | 100% |
| Frontend | 8 | 8 | 100% |
| Data model / migrations | 2 | 2 | 100% |
| Documentation | 1 | 1 | 100% |
| Testing | 0 | 5 | 0% |
| **Overall** | **20** | **25** | **80%** |

---

## Implementation Log

### 2024-12-16 - Project Setup

- [x] Created feature branch `feature/xero-csv-export` from `release/0.15.0`
- [x] Set up development environment with unique ports (3007, 5434, 6381, 6434, 1236)
- [x] Created feature tracking files:
  - `ee/docs/plans/features-xero-csv-export.json`
  - `ee/docs/plans/xero-csv-export-progress.md` (this file)
- [x] Completed codebase exploration and planning phase

### 2025-12-18 - Plan refresh after QuickBooks CSV work

- [x] Updated plan to reflect the new unified Accounting Integrations setup + CSV mapping/export patterns.
- [x] Updated feature list to include missing "full integration" work: mappings UI/modules, batch immutability, client (contact) export/import, lock reset warnings, and parity with automated exports.

### 2025-12-18 - Core Implementation

**Backend:**
- [x] Created `XeroCsvAdapter` (`server/src/lib/adapters/accounting/xeroCsvAdapter.ts`)
  - File-based delivery mode with Xero-compatible CSV format
  - Fixed tracking categories: "Source System"/"AlgaPSA" and "External Invoice ID"/{invoice_id}
  - Tax delegation support (exports as Draft for Xero tax calculation)
- [x] Registered adapter in `server/src/lib/adapters/accounting/registry.ts`
- [x] Created `XeroCsvTaxImportService` (`server/src/lib/services/xeroCsvTaxImportService.ts`)
  - Parses Xero Invoice Details Report CSV format
  - Matches invoices using tracking categories
  - Preview and import functionality with audit trail
- [x] Created server actions (`server/src/lib/actions/integrations/xeroCsvActions.ts`)
- [x] Created API routes:
  - `server/src/app/api/v1/accounting-exports/[batchId]/download/route.ts`
  - `server/src/app/api/v1/accounting-exports/xero-csv/tax-import/route.ts`

**Frontend:**
- [x] Created `XeroCsvSettings` component (`server/src/components/settings/integrations/XeroCsvSettings.tsx`)
- [x] Updated `XeroIntegrationSettings` with CSV/OAuth mode toggle
- [x] Created `XeroCsvExportPanel` (`server/src/components/billing-dashboard/accounting/XeroCsvExportPanel.tsx`)
- [x] Created `XeroCsvTaxImportPanel` (`server/src/components/billing-dashboard/accounting/XeroCsvTaxImportPanel.tsx`)
- [x] Updated `AccountingExportsTab` for Xero CSV batch support

**Documentation:**
- [x] Created user guide (`ee/docs/guides/xero-csv-integration.md`)
  - Setup instructions (tracking categories, mappings)
  - Invoice export workflow
  - Tax import workflow
  - Client export/import instructions
  - Lock reset and batch reversal documentation
  - Troubleshooting guide

### 2025-12-18 - Integration with Unified Accounting Setup

After merging release/0.15.0, adapted Xero CSV integration to work with the new unified accounting integrations infrastructure:

**Infrastructure Integration:**
- [x] Updated `AccountingIntegrationsSetup.tsx` to add `xero_csv` as a fourth integration option
- [x] Created `XeroCsvIntegrationSettings.tsx` following the `CSVIntegrationSettings` pattern
  - Merged settings from old `XeroCsvSettings.tsx` (date format, currency, setup acknowledgement)
  - Added mapping manager integration
  - Added workflow guide and navigation
- [x] Created `xeroCsvMappingModules.ts` for Xero CSV-specific mapping modules
  - Clients, Items/Services, Tax Codes, Payment Terms
  - Xero-specific terminology and identifiers
- [x] Created `XeroCsvMappingManager.tsx` component using the shared `AccountingMappingManager`
- [x] Updated CSV integration index exports
- [x] Removed old `XeroCsvSettings.tsx` (merged into `XeroCsvIntegrationSettings.tsx`)

### 2025-12-18 - Backend Completion

Completed all remaining backend tasks:

**Client Export/Import:**
- [x] Created `XeroCsvClientSyncService` (`server/src/lib/services/xeroCsvClientSyncService.ts`)
  - Export Alga clients to Xero Contacts CSV format
  - Import Xero Contacts CSV with preview and matching logic
  - Persist external ID mappings per tenant + adapter type
- [x] Added client sync actions to `xeroCsvActions.ts`
- [x] Created client export API route (`/api/v1/accounting-exports/xero-csv/client-export/route.ts`)
- [x] Created client import API route (`/api/v1/accounting-exports/xero-csv/client-import/route.ts`)

**Batch Parity:**
- [x] Added `xero_csv` to `AccountingAdapterType` in `companySync.types.ts`
- [x] Updated `XeroCsvAdapter.deliver()` to create invoice mappings via `KnexInvoiceMappingRepository`
- [x] Added `xero_csv` to `shouldIncludePendingExternalDrafts()` in invoice selector

**Tax Blocking State:**
- [x] Verified existing tax blocking logic in `taxSourceActions.ts` handles `pending_external` state
- [x] Confirmed `XeroCsvTaxImportService` properly updates `tax_source` from `pending_external` to `external`
- [x] Invoice finalization is blocked until tax is imported (via `validateInvoiceFinalization`)

### 2025-12-18 - Data Model & Client Sync UI Completion

**Data Model / Migrations:**
- [x] Created `server/migrations/20251218010000_add_xero_csv_mapping_normalization.cjs`
  - Normalizes `company` → `client` for xero_csv mappings
  - Normalizes `tax_region` → `tax_code` for xero and xero_csv mappings
  - Both up and down migrations implemented
- [x] External ID mapping persistence already handled by `XeroCsvClientSyncService`
  - Persists client mappings per tenant + adapter type via `tenant_external_entity_mappings`
  - Used for client import reconciliation

**Client Sync UI:**
- [x] Created `XeroCsvClientSyncPanel.tsx` component
  - Export clients to Xero Contacts CSV with download
  - Import clients from Xero CSV with preview table
  - Match options: name, email, or Xero contact ID
  - Create/update/skip actions per client
  - Full preview → confirm → execute workflow
- [x] Integrated `XeroCsvClientSyncPanel` into `XeroCsvIntegrationSettings.tsx`

---

## Backend Tasks

### 1. Xero CSV Adapter (adapter-create)
**File:** `server/src/lib/adapters/accounting/xeroCsvAdapter.ts`
**Status:** DONE

- [x] Create adapter class implementing AccountingExportAdapter
- [x] Implement capabilities() with deliveryMode: 'file'
- [x] Implement transform() to generate Xero-compatible CSV
- [x] Include stable reconciliation identifiers (tracking categories)
- [x] Implement deliver() to prepare file artifact

### 2. Register Adapter (adapter-register)
**File:** `server/src/lib/adapters/accounting/registry.ts`
**Status:** DONE

- [x] Import XeroCsvAdapter
- [x] Add to createDefault() adapter list

### 3. CSV Mapping Modules (mapping-modules)
**File:** `server/src/components/integrations/csv/xeroCsvMappingModules.ts`
**Status:** DONE

- [x] Implement mapping modules for `adapterType: 'xero_csv'`
- [x] Support mappings for: Clients, Items/Services, Tax Codes, Payment Terms
- [x] Ensure terminology uses "Clients" (not "Customers") throughout UI/config
- [x] Default the mapping tab view to "Clients"

### 4. Client Export/Import (client-export-import)
**Files:**
- `server/src/lib/services/xeroCsvClientSyncService.ts`
- `server/src/app/api/v1/accounting-exports/xero-csv/client-export/route.ts`
- `server/src/app/api/v1/accounting-exports/xero-csv/client-import/route.ts`
**Status:** DONE

- [x] Export Alga Clients to Xero Contacts CSV (manual import to Xero)
- [x] Import Xero Contacts CSV back into Alga (match/update existing clients; optionally create new clients)
- [x] Persist external-id/linking mappings for clients per tenant + adapter type

### 5. Tax Import Service (tax-import-service)
**File:** `server/src/lib/services/xeroCsvTaxImportService.ts`
**Status:** DONE

- [x] Parse Xero Invoice Details Report CSV format
- [x] Match invoices back to Alga using tracking categories
- [x] Create previewTaxImport() method
- [x] Create importTaxFromReport() method
- [x] Record imports in `external_tax_imports` with consistent audit trail

### 6. Export/TX Import Actions (server-actions)
**File:** `server/src/lib/actions/integrations/xeroCsvActions.ts`
**Status:** DONE

- [x] Settings read/write for Xero CSV mode
- [x] Export: create/execute batch and return download artifact
- [x] Import: preview + execute tax import
- [x] Import: preview + execute client import

### 7. Xero CSV API Routes (api-routes)
**Files:** `server/src/app/api/v1/accounting-exports/...`
**Status:** DONE

- [x] Export download endpoint (`[batchId]/download/route.ts`)
- [x] Tax import endpoint (`xero-csv/tax-import/route.ts`)
- [x] Client export endpoint (`xero-csv/client-export/route.ts`)
- [x] Client import endpoint (`xero-csv/client-import/route.ts`)

### 8. Batch Parity / Immutability (batch-parity)
**Files:**
- `server/src/lib/adapters/accounting/xeroCsvAdapter.ts`
- `server/src/lib/services/accountingExportInvoiceSelector.ts`
- `server/src/lib/services/companySync/companySync.types.ts`
**Status:** DONE

- [x] Ensure exports create persisted batches with an audit trail (no in-memory-only exports)
- [x] Match OAuth export behavior for "already exported invoices" and date overlap handling
- [x] Added invoice mapping persistence in `XeroCsvAdapter.deliver()` to prevent re-export
- [x] Added `xero_csv` to `AccountingAdapterType`

### 9. External Tax Blocking State (tax-blocking-state)
**Files:**
- `server/src/lib/actions/taxSourceActions.ts`
- `server/src/lib/services/accountingExportInvoiceSelector.ts`
**Status:** DONE

- [x] If Xero is the tax source, treat invoices as blocked from finalization until tax is imported
- [x] Default export selection to include Draft invoices when invoices are awaiting external tax
- [x] `validateInvoiceFinalization()` blocks finalization for `pending_external` tax source
- [x] Added `xero_csv` to `shouldIncludePendingExternalDrafts()` for draft invoice inclusion

---

## Data model / migrations tasks

### A. Mapping type normalization (mapping-normalization)
**Files:** `server/migrations/20251218010000_add_xero_csv_mapping_normalization.cjs`
**Status:** DONE

- [x] Add/verify migrations to normalize mapping types (company → client, tax_region → tax_code) for `xero_csv`
- [x] Ensure the mapping resolver uses canonical mapping types across adapters

### B. External ID mapping persistence (external-id-mapping)
**Files:** `server/src/lib/services/xeroCsvClientSyncService.ts`
**Status:** DONE

- [x] Persist Xero external identifiers for clients and invoices per tenant + adapter type
- [x] Use these mappings for client import and tax import reconciliation

---

## Frontend Tasks

### 10. Xero CSV Integration Settings Panel (xero-csv-settings)
**File:** `server/src/components/settings/integrations/XeroCsvIntegrationSettings.tsx`
**Status:** DONE

- [x] Show instructions for manual import/export workflows (contacts + invoices + tax import)
- [x] Surface key defaults (invoice numbering/reference scheme; date formatting if needed)
- [x] Link users to mapping setup (must complete before exporting)

### 11. Accounting Integrations Setup Wiring (integrations-setup)
**File:** `server/src/components/settings/integrations/AccountingIntegrationsSetup.tsx`
**Status:** DONE

- [x] Keep Xero OAuth visible but disabled / "Coming soon" when in CSV mode
- [x] Add Xero CSV as a selectable integration option (fourth card)
- [x] Ensure only the selected integration's panes are displayed

### 12. Mapping Manager UI (mapping-manager)
**File:** `server/src/components/integrations/csv/XeroCsvMappingManager.tsx`
**Status:** DONE

- [x] Use shared mapping manager UI (standard tab control + primary color)
- [x] Default to the "Clients" tab on load
- [x] Ensure "Add Client Mapping" language (not "Customer")

### 13. Xero CSV Export UI (export-panel)
**File:** `server/src/components/billing-dashboard/accounting/XeroCsvExportPanel.tsx`
**Status:** DONE

- [x] Export dialog that matches OAuth export invariants (status defaults, overlap behavior, lock handling)
- [x] Provide "Reset export lock" / "Reverse batch" actions with warnings

### 14. Xero CSV Tax Import UI (tax-import-panel)
**File:** `server/src/components/billing-dashboard/accounting/XeroCsvTaxImportPanel.tsx`
**Status:** DONE

- [x] Upload + preview + execute flow with clear reconciliation identifiers
- [x] History + rollback UI (consistent with CSV tax import patterns)

### 15. Accounting Exports Tab Update (exports-tab-update)
**File:** `server/src/components/billing-dashboard/accounting/AccountingExportsTab.tsx`
**Status:** DONE

- [x] Ensure Xero CSV batches behave the same as other adapters (download, errors, lines, status)
- [x] Link to Xero CSV tax import + client export/import panels where appropriate

### 16. Client Export/Import UI (client-sync-ui)
**File:** `server/src/components/settings/integrations/XeroCsvClientSyncPanel.tsx`
**Status:** DONE

- [x] Export clients (contacts CSV) action + instructions
- [x] Import clients from Xero contacts CSV with preview + confirmation
- [x] Clear matching rules and "create vs update" outcomes

---

## Documentation Tasks

### 17. User Instructions (user-instructions)
**File:** `ee/docs/guides/xero-csv-integration.md`
**Status:** DONE

- [x] Xero contacts (clients) import/export guide
- [x] Invoice export workflow instructions
- [x] Tax import workflow instructions + rollback semantics
- [x] Troubleshooting section

---

## Testing Tasks

### 18. Adapter Tests (adapter-tests)
**File:** `server/src/test/unit/accounting/xeroCsvAdapter.spec.ts`
**Status:** Not Started

- [ ] CSV generation tests
- [ ] Reconciliation identifier inclusion tests
- [ ] Multi-invoice batch tests

### 19. Import Service Tests (import-tests)
**File:** `server/src/test/unit/accounting/xeroCsvTaxImportService.spec.ts`
**Status:** Not Started

- [ ] CSV parsing tests
- [ ] Invoice matching tests
- [ ] Tax application tests

### 20. Client Sync Tests (client-sync-tests)
**File:** `server/src/test/unit/accounting/xeroCsvClientSyncService.spec.ts`
**Status:** Not Started

- [ ] Client export CSV tests
- [ ] Client import matching/creation tests

### 21. Integration Tests (integration-tests)
**File:** `server/src/test/integration/accounting/xeroCsvExport.integration.test.ts`
**Status:** Not Started

- [ ] Full export workflow test
- [ ] Full import workflow test
- [ ] Error handling tests

### 22. Playwright Smoke Tests (ui-smoke-tests)
**File:** `server/src/test/playwright/accounting/xeroCsv.spec.ts`
**Status:** Not Started

- [ ] Integrations setup navigation + disabled OAuth cards
- [ ] Mapping manager default tab + save mapping flows
- [ ] Export + tax import smoke

---

## Notes & Decisions

### Key Implementation Notes

1. **Terminology**: Alga “Customers” are **Clients**; all UI/labels should use “Client”.
2. **Outcome Parity**: Xero CSV should use the same mapping resolver, batch persistence, and “already exported” handling as automated exports.
3. **Reconciliation Identifiers**: Prefer stable identifiers embedded in the CSV (InvoiceNumber + Reference containing Alga invoice ID) over relying on fragile matching rules.
4. **Immutability**: Exports are immutable; “re-export” is implemented via explicit lock reset with warnings (invoice-level and batch-level).
5. **External Tax**: When Xero is tax source, invoices should be blocked from finalization until taxes are imported (state is derived, not stored as a new field).

### Technical Debt / Future Improvements

- [ ] Consider adding batch progress tracking for large exports
- [ ] Consider adding retry logic for partial imports
- [ ] Consider caching Xero report column mappings per tenant (once the report format is finalized)

---

## Commits

| Date | Commit | Description |
|------|--------|-------------|
| 2024-12-16 | TBD | Initial feature setup and planning files |

---

*Last Updated: 2025-12-18 (Backend, Frontend, Data Model Complete - 80%; Only Testing Remains)*
