# Xero CSV Export/Import - Implementation Progress

## Overview

This document tracks the implementation progress of the Xero CSV Export/Import feature, which enables CSV-based invoice export to Xero and tax import without OAuth requirements.

**Branch:** `feature/xero-csv-export`
**Feature File:** `ee/docs/plans/features-xero-csv-export.json`
**Started:** 2024-12-16

---

## Progress Summary

| Category | Completed | Total | Progress |
|----------|-----------|-------|----------|
| Backend | 0 | 6 | 0% |
| Frontend | 0 | 5 | 0% |
| Documentation | 0 | 1 | 0% |
| Testing | 0 | 3 | 0% |
| **Overall** | **0** | **15** | **0%** |

---

## Implementation Log

### 2024-12-16 - Project Setup

- [x] Created feature branch `feature/xero-csv-export` from `release/0.15.0`
- [x] Set up development environment with unique ports (3007, 5434, 6381, 6434, 1236)
- [x] Created feature tracking files:
  - `ee/docs/plans/features-xero-csv-export.json`
  - `ee/docs/plans/xero-csv-export-progress.md` (this file)
- [x] Completed codebase exploration and planning phase

---

## Backend Tasks

### 1. XeroCsvAdapter (adapter-create)
**File:** `server/src/lib/adapters/accounting/xeroCsvAdapter.ts`
**Status:** Not Started

- [ ] Create adapter class implementing AccountingExportAdapter
- [ ] Implement capabilities() with deliveryMode: 'file'
- [ ] Implement transform() to generate Xero-compatible CSV
- [ ] Add tracking category columns (Source System, External Invoice ID)
- [ ] Implement deliver() to prepare file artifact

### 2. Register Adapter (adapter-register)
**File:** `server/src/lib/adapters/accounting/registry.ts`
**Status:** Not Started

- [ ] Import XeroCsvAdapter
- [ ] Add to createDefault() adapter list

### 3. Tax Import Service (tax-import-service)
**File:** `server/src/lib/services/xeroCsvTaxImportService.ts`
**Status:** Not Started

- [ ] Create parseInvoiceDetailsReport() method
- [ ] Create matchInvoicesToAlga() method using tracking categories
- [ ] Create previewTaxImport() method
- [ ] Create importTaxFromReport() method
- [ ] Add external_tax_imports table recording

### 4. Server Actions (server-actions)
**File:** `server/src/lib/actions/integrations/xeroCsvActions.ts`
**Status:** Not Started

- [ ] getXeroCsvSettings()
- [ ] updateXeroCsvSettings()
- [ ] previewXeroCsvTaxImport()
- [ ] executeXeroCsvTaxImport()

### 5. Download API Route (api-download)
**File:** `server/src/app/api/accounting-export/[batchId]/download/route.ts`
**Status:** Not Started

- [ ] Create GET endpoint
- [ ] Verify permissions
- [ ] Return CSV with proper headers

### 6. Tax Import API Route (api-tax-import)
**File:** `server/src/app/api/accounting-export/xero-csv/tax-import/route.ts`
**Status:** Not Started

- [ ] Create POST endpoint
- [ ] Handle multipart form data
- [ ] Call XeroCsvTaxImportService

---

## Frontend Tasks

### 7. CSV Settings Component (settings-csv-panel)
**File:** `server/src/components/settings/integrations/XeroCsvSettings.tsx`
**Status:** Not Started

- [ ] Date format selector (DD/MM/YYYY vs MM/DD/YYYY)
- [ ] Default currency setting
- [ ] Instructions panel

### 8. Settings Mode Toggle (settings-mode-toggle)
**File:** `server/src/components/settings/integrations/XeroIntegrationSettings.tsx`
**Status:** Not Started

- [ ] Add OAuth/CSV mode toggle
- [ ] Show/hide OAuth UI based on mode
- [ ] Show/hide CSV settings based on mode
- [ ] Keep mapping UI for both modes

### 9. Export Panel (export-panel)
**File:** `server/src/components/billing-dashboard/accounting/XeroCsvExportPanel.tsx`
**Status:** Not Started

- [ ] Download CSV button
- [ ] Export status display
- [ ] Instructions for importing to Xero

### 10. Tax Import Panel (import-panel)
**File:** `server/src/components/billing-dashboard/accounting/XeroCsvTaxImportPanel.tsx`
**Status:** Not Started

- [ ] File upload dropzone
- [ ] Preview table with match status
- [ ] Import confirmation button
- [ ] Results summary

### 11. Accounting Exports Tab Update (exports-tab-update)
**File:** `server/src/components/billing-dashboard/accounting/AccountingExportsTab.tsx`
**Status:** Not Started

- [ ] Add "Xero (CSV)" to adapter dropdown
- [ ] Show download button for xero_csv batches
- [ ] Link to tax import panel

---

## Documentation Tasks

### 12. User Instructions (user-instructions)
**File:** `ee/docs/guides/xero-csv-integration.md`
**Status:** Not Started

- [ ] Xero tracking category setup guide
- [ ] Export workflow instructions
- [ ] Tax import workflow instructions
- [ ] Troubleshooting section

---

## Testing Tasks

### 13. Adapter Tests (adapter-tests)
**File:** `server/src/test/unit/accounting/xeroCsvAdapter.spec.ts`
**Status:** Not Started

- [ ] CSV generation tests
- [ ] Tracking category inclusion tests
- [ ] Multi-invoice batch tests

### 14. Import Service Tests (import-tests)
**File:** `server/src/test/unit/accounting/xeroCsvTaxImportService.spec.ts`
**Status:** Not Started

- [ ] CSV parsing tests
- [ ] Invoice matching tests
- [ ] Tax application tests

### 15. Integration Tests (integration-tests)
**File:** `server/src/test/integration/accounting/xeroCsvExport.integration.test.ts`
**Status:** Not Started

- [ ] Full export workflow test
- [ ] Full import workflow test
- [ ] Error handling tests

---

## Notes & Decisions

### Key Implementation Notes

1. **Tracking Categories**: Using fixed names "Source System" and "External Invoice ID" for simplicity
2. **Invoice Status**: Always export as Draft to enable Xero tax calculation
3. **CSV Format**: Following Xero's Sales Invoice import specification
4. **Tax Import**: Parsing Xero's Invoice Details Report (most comprehensive format)

### Technical Debt / Future Improvements

- [ ] Consider adding batch progress tracking for large exports
- [ ] Consider adding retry logic for partial imports
- [ ] Consider caching Xero report column mappings per tenant

---

## Commits

| Date | Commit | Description |
|------|--------|-------------|
| 2024-12-16 | TBD | Initial feature setup and planning files |

---

*Last Updated: 2024-12-16*
