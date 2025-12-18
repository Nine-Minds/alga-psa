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
| Backend | 0 | 9 | 0% |
| Frontend | 0 | 7 | 0% |
| Data model / migrations | 0 | 2 | 0% |
| Documentation | 0 | 1 | 0% |
| Testing | 0 | 5 | 0% |
| **Overall** | **0** | **24** | **0%** |

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
- [x] Updated feature list to include missing “full integration” work: mappings UI/modules, batch immutability, client (contact) export/import, lock reset warnings, and parity with automated exports.

---

## Backend Tasks

### 1. Xero CSV Adapter (adapter-create)
**File:** `server/src/lib/adapters/accounting/xeroCsvAdapter.ts` (or `xeroCSVAdapter.ts`)
**Status:** Not Started

- [ ] Create adapter class implementing AccountingExportAdapter
- [ ] Implement capabilities() with deliveryMode: 'file'
- [ ] Implement transform() to generate Xero-compatible CSV
- [ ] Include stable reconciliation identifiers (e.g., InvoiceNumber + Reference containing Alga invoice ID)
- [ ] Implement deliver() to prepare file artifact

### 2. Register Adapter (adapter-register)
**File:** `server/src/lib/adapters/accounting/registry.ts`
**Status:** Not Started

- [ ] Import XeroCsvAdapter
- [ ] Add to createDefault() adapter list

### 3. CSV Mapping Modules (mapping-modules)
**File:** `server/src/components/integrations/csv/xeroCsvMappingModules.ts`
**Status:** Not Started

- [ ] Implement mapping modules for `adapterType: 'xero_csv'`
- [ ] Support mappings for: Clients, Items/Services, Tax Codes, Payment Terms
- [ ] Ensure terminology uses “Clients” (not “Customers”) throughout UI/config
- [ ] Default the mapping tab view to “Clients”

### 4. Client Export/Import (client-export-import)
**Files:**
- `server/src/lib/services/xeroCsvClientSyncService.ts` (proposed)
- API routes under `server/src/app/api/accounting/csv/xero/...`
**Status:** Not Started

- [ ] Export Alga Clients to Xero Contacts CSV (manual import to Xero)
- [ ] Import Xero Contacts CSV back into Alga (match/update existing clients; optionally create new clients)
- [ ] Persist external-id/linking mappings for clients per tenant + adapter type

### 5. Tax Import Service (tax-import-service)
**File:** `server/src/lib/services/xeroCsvTaxImportService.ts`
**Status:** Not Started

- [ ] Parse Xero report/export format used for tax reconciliation (confirm exact report/export)
- [ ] Match invoices back to Alga using stable reconciliation identifiers
- [ ] Create previewTaxImport() method
- [ ] Create importTaxFromReport() method
- [ ] Record imports in `external_tax_imports` with consistent audit trail

### 6. Export/TX Import Actions (server-actions)
**File:** `server/src/lib/actions/integrations/xeroCsvActions.ts` (or reuse generic CSV actions)
**Status:** Not Started

- [ ] Settings read/write for Xero CSV mode
- [ ] Export: create/execute batch and return download artifact
- [ ] Import: preview + execute tax import
- [ ] Import: preview + execute client import

### 7. Xero CSV API Routes (api-routes)
**Files:** `server/src/app/api/accounting/csv/xero/...`
**Status:** Not Started

- [ ] Export execute/download endpoints (consistent with CSV export pattern)
- [ ] Tax import endpoints (upload, preview, execute, history, rollback)
- [ ] Client export/import endpoints (download contacts CSV, upload contacts CSV)

### 8. Batch Parity / Immutability (batch-parity)
**Files:** export services + selectors
**Status:** Not Started

- [ ] Ensure exports create persisted batches with an audit trail (no in-memory-only exports)
- [ ] Match OAuth export behavior for “already exported invoices” and date overlap handling
- [ ] Ensure “reverse” semantics are the same as CSV: reset invoice/batch export locks with explicit warning

### 9. External Tax Blocking State (tax-blocking-state)
**Files:** invoice services/UI
**Status:** Not Started

- [ ] If Xero is the tax source, treat invoices as blocked from finalization until tax is imported
- [ ] Default export selection to include Draft invoices when invoices are awaiting external tax
- [ ] Surface “Awaiting external tax import” state in selection/export UX (derived, not a new DB field)

---

## Data model / migrations tasks

### A. Mapping type normalization (mapping-normalization)
**Files:** `server/migrations/...`
**Status:** Not Started

- [ ] Add/verify migrations to normalize mapping types (company → client, tax_region → tax_code) for `xero_csv`
- [ ] Ensure the mapping resolver uses canonical mapping types across adapters

### B. External ID mapping persistence (external-id-mapping)
**Files:** `tenant_external_entity_mappings` usage
**Status:** Not Started

- [ ] Persist Xero external identifiers for clients and invoices per tenant + adapter type
- [ ] Use these mappings for client import and tax import reconciliation

---

## Frontend Tasks

### 10. Xero CSV Integration Settings Panel (xero-csv-settings)
**File:** `server/src/components/settings/integrations/XeroCSVIntegrationSettings.tsx`
**Status:** Not Started

- [ ] Show instructions for manual import/export workflows (contacts + invoices + tax import)
- [ ] Surface key defaults (invoice numbering/reference scheme; date formatting if needed)
- [ ] Link users to mapping setup (must complete before exporting)

### 11. Accounting Integrations Setup Wiring (integrations-setup)
**Files:** `server/src/components/settings/integrations/AccountingIntegrationsSetup.tsx` and settings routing
**Status:** Not Started

- [ ] Keep Xero OAuth visible but disabled / “Coming soon”
- [ ] Add Xero CSV as a selectable integration option (when ready)
- [ ] Ensure only the selected integration’s panes are displayed

### 12. Mapping Manager UI (mapping-manager)
**Files:** reuse shared mapping module view + tabs
**Status:** Not Started

- [ ] Use shared mapping manager UI (standard tab control + primary color)
- [ ] Default to the “Clients” tab on load
- [ ] Ensure “Add Client Mapping” language (not “Customer”)

### 13. Xero CSV Export UI (export-panel)
**Files:** reuse CSV export panel where possible
**Status:** Not Started

- [ ] Export dialog that matches OAuth export invariants (status defaults, overlap behavior, lock handling)
- [ ] Provide “Reset export lock” / “Reverse batch” actions with warnings

### 14. Xero CSV Tax Import UI (tax-import-panel)
**Files:** reuse CSV tax import panel where possible
**Status:** Not Started

- [ ] Upload + preview + execute flow with clear reconciliation identifiers
- [ ] History + rollback UI (consistent with CSV tax import patterns)

### 15. Accounting Exports Tab Update (exports-tab-update)
**File:** `server/src/components/billing-dashboard/accounting/AccountingExportsTab.tsx`
**Status:** Not Started

- [ ] Ensure Xero CSV batches behave the same as other adapters (download, errors, lines, status)
- [ ] Link to Xero CSV tax import + client export/import panels where appropriate

### 16. Client Export/Import UI (client-sync-ui)
**Files:** settings panel / integration panes
**Status:** Not Started

- [ ] Export clients (contacts CSV) action + instructions
- [ ] Import clients from Xero contacts CSV with preview + confirmation
- [ ] Clear matching rules and “create vs update” outcomes

---

## Documentation Tasks

### 17. User Instructions (user-instructions)
**File:** `ee/docs/guides/xero-csv-integration.md`
**Status:** Not Started

- [ ] Xero contacts (clients) import/export guide
- [ ] Invoice export workflow instructions
- [ ] Tax import workflow instructions + rollback semantics
- [ ] Troubleshooting section

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

*Last Updated: 2025-12-18*
