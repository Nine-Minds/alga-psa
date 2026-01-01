# QuickBooks Integrations – Technical Overview

This document describes the current QuickBooks integration architecture in Alga PSA.

## Current State (UI)
- **QuickBooks CSV (`quickbooks_csv`)**: enabled and selectable in **Settings → Integrations → Accounting**.
- **QuickBooks Online OAuth (`quickbooks_online`)**: shown as **Coming soon** (disabled in UI).

## Shared Accounting Export Architecture
QuickBooks integrations use the shared accounting export pipeline:
- **Accounting Export Service** (`server/src/lib/services/accountingExportService.ts`) orchestrates batch creation, validation, execution, and audit tracking.
- **Validation** (`server/src/lib/validation/accountingExportValidation.ts`) ensures required mappings exist and updates batch status to `ready` or `needs_attention`.
- **Audit trail** is stored in `accounting_export_batches`, `accounting_export_lines`, and `accounting_export_errors`.

## CSV Flow (QuickBooks CSV)
### UI + API
- **Settings page**: QuickBooks CSV panels live under `server/src/components/settings/integrations/CSVIntegrationSettings.tsx`.
- **Export API**: `POST /api/accounting/csv/export` via `server/src/lib/api/controllers/ApiCSVAccountingController.ts`.
- **Tax import APIs**: `/api/accounting/csv/import/tax/*` via the same controller.

### Mappings
- Stored in `tenant_external_entity_mappings` with `integration_type = 'quickbooks_csv'`.
- Mapping tabs are rendered by the generic mapping UI:
  - `server/src/components/integrations/csv/CSVMappingManager.tsx`
  - `server/src/components/integrations/csv/csvMappingModules.ts`
- Canonical Alga entity types used for QuickBooks CSV mappings:
  - `client` (QuickBooks “Customer”)
  - `service` (QuickBooks “Item”)
  - `tax_code` (QuickBooks “TaxCode”)
  - `payment_term` (QuickBooks “Term”)

### Export semantics
- **Immutability**: once an invoice is successfully exported, we create an invoice mapping for `quickbooks_csv` and exclude it from future CSV exports.
- **Retry behavior**: when users re-export with the same filter set, the request reuses the existing batch and re-validates after mappings are updated.

## OAuth Flow (QuickBooks Online – Coming Soon)
The `quickbooks_online` adapter and supporting services exist in code, but the UI entry point is disabled until OAuth rollout is complete.

When enabled, OAuth will add:
- Realm-scoped catalog lookups (items/tax codes/terms/customers) to improve mapping UX.
- API-based delivery via the `quickbooks_online` adapter (instead of file delivery).

