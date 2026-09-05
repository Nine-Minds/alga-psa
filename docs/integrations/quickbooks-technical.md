# QuickBooks Integrations – Technical Overview

This document describes the current QuickBooks integration architecture in AlgaPSA.

## Current State (UI)
- **QuickBooks CSV (`quickbooks_csv`)**: selectable in **Settings → Integrations → Accounting** in every edition.
- **QuickBooks Online OAuth (`quickbooks_online`)**: selectable in **Settings → Integrations → Accounting** in Enterprise Edition. `AccountingIntegrationsSetup.tsx` gates the card on `NEXT_PUBLIC_EDITION === 'enterprise'` and omits it entirely in Community Edition.
- Settings component: `packages/integrations/src/components/settings/integrations/QboIntegrationSettings.tsx`.

## Shared Accounting Export Architecture
QuickBooks integrations use the shared accounting export pipeline:
- **Accounting Export Service** (`packages/billing/src/services/accountingExportService.ts`) orchestrates batch creation, validation, execution, and audit tracking.
- **Validation** (`packages/billing/src/services/accountingExportValidation.ts`) ensures required mappings exist and updates batch status to `ready` or `needs_attention`.
- **Audit trail** is stored in `accounting_export_batches`, `accounting_export_lines`, and `accounting_export_errors`.

## CSV Flow (QuickBooks CSV)
### UI + API
- **Settings page**: QuickBooks CSV panels live under `packages/integrations/src/components/settings/integrations/CSVIntegrationSettings.tsx`. The panel renders mappings and links to **Billing → Accounting Exports**; export and tax-import controls live there, not in settings.
- **Export API**: `POST /api/accounting/csv/export` via `server/src/lib/api/controllers/ApiCSVAccountingController.ts`.
- **Tax import APIs**: `/api/accounting/csv/import/tax/*` via the same controller.

### Mappings
- Stored in `tenant_external_entity_mappings` with `integration_type = 'quickbooks_csv'`.
- Mapping tabs are rendered by the generic mapping UI:
  - `packages/integrations/src/components/csv/CSVMappingManager.tsx`
  - `packages/integrations/src/components/csv/csvMappingModules.ts`
- Canonical Alga entity types used for QuickBooks CSV mappings:
  - `client` (QuickBooks “Customer”)
  - `service` (QuickBooks “Item”)
  - `tax_code` (QuickBooks “TaxCode”)
  - `payment_term` (QuickBooks “Term”)

### Export semantics
- **Immutability**: once an invoice is successfully exported, we create an invoice mapping for `quickbooks_csv` and exclude it from future CSV exports.
- **Retry behavior**: when users re-export with the same filter set, the request reuses the existing batch and re-validates after mappings are updated.

## OAuth Flow (QuickBooks Online)
- **Routes**: `/api/integrations/qbo/connect` starts the flow and `/api/integrations/qbo/callback` completes it. The Next.js route files under `server/src/app/api/integrations/qbo/` are thin re-exports of the handlers in `packages/integrations/src/routes/api/integrations/qbo/`. The callback redirects back to the settings page with `qbo_status=success`, or with `qbo_status=failure` plus a `qbo_error` code that `QboIntegrationSettings` renders as a message.
- **Credential resolution**: `resolveQboOAuthCredentials` in `packages/integrations/src/lib/qbo/qboClientService.ts` prefers the tenant secrets `qbo_client_id` and `qbo_client_secret`, and returns `source: 'tenant'`. When exactly one of the two is present it throws `QBO_CONFIG_MISSING` rather than falling back, so a half-configured tenant cannot OAuth against the deployment app; the settings page renders that as the `config_missing` callback error. When neither is present it resolves the deployment-wide app secrets of the same names, falling back to the env vars `QBO_CLIENT_ID`/`QBO_OAUTH_CLIENT_ID` and `QBO_CLIENT_SECRET`/`QBO_OAUTH_CLIENT_SECRET`, and returns `source: 'app'`.
- **Status surface**: `getQboConnectionStatus` in `packages/integrations/src/actions/qboActions.ts` returns `credentials.source` alongside masked values, the redirect URI, the requested scopes, and the Intuit environment. Only the provenance is exposed; app-level secret values never leave the server.
- **Catalog lookups**: `getQboItems`, `getQboTaxCodes`, and `getQboTerms` query the connected realm and are cached per tenant/realm. Queries page through `STARTPOSITION`/`MAXRESULTS` at the 1000-row ceiling, because QBO returns only 100 rows when `MAXRESULTS` is omitted and an AST company file accumulates a tax code per jurisdiction it bills into.
- **Mapping modules**: `packages/integrations/src/components/qbo/qboLiveMappingModules.ts` builds the Items / Services, Tax Codes, and Payment Terms tabs against the generic mapping components in `packages/integrations/src/components/accounting-mappings/`.
- **Delivery**: `packages/billing/src/adapters/accounting/quickBooksOnlineAdapter.ts` transforms canonical batches into QBO invoice DTOs and delivers them through `QboClientService`.

### Tax code labelling
- `getQboTaxCodes` issues `SELECT * FROM TaxCode` so the nested `SalesTaxRateList` comes back, then sums the referenced `TaxRate.RateValue` entries into a combined `ratePercent`. Naming columns explicitly omits the rate components.
- Inactive codes are filtered client-side rather than with `WHERE Active = true`: Intuit's `TaxCode` response omits `Active` on the `TAX` and `NON` pseudo codes, so a server-side filter drops exactly the two entries an AST company needs.
- `formatQboTaxCodeOptions` labels each code with its rate, or its description when no rate resolves, and appends `· ID <n>` to any label produced by more than one code. AST generates duplicate names deliberately.
- `AccountingMappingModuleView` persists the chosen label as `metadata.externalDisplayName` and falls back to it when the live catalog no longer carries the id, so mappings to deactivated codes, other realms, and pseudo codes stay readable.

## Automated Sales Tax export path
- **Flag storage**: per realm, under `tenant_settings.settings.qboAutomatedSalesTax` as `{ realms: string[] }`. Read and write helpers live in `packages/integrations/src/lib/qbo/qboTaxSettings.ts`; the writer locks the row `FOR UPDATE` because the whole `settings` blob is rewritten and sibling keys would otherwise be clobbered.
- **Server actions**: `getQboAutomatedSalesTaxMode` and `setQboAutomatedSalesTaxMode` in `packages/integrations/src/actions/qboActions.ts`. Flipping the flag clears the tenant's catalog caches, since the `TAX`/`NON` pseudo codes appear in the tax-code pick list only under AST.
- **Transform**: `quickBooksOnlineAdapter.transform()` resolves `isQboAutomatedSalesTaxEnabled` once per batch from `context.batch.target_realm`. A batch with no target realm cannot be on AST and the flag stays false.
- **Line tax codes**: in delegate mode (`context.taxDelegationMode === 'delegate'`) the adapter normally omits `TaxCodeRef` along with the invoice tax total. With AST on it emits one per line — the mapped tax code for the charge's region, `NON` when the charge is not taxable, and `TAX` otherwise. Without a line `TaxCodeRef`, AST returns `TotalTax` 0 and the import-back path writes that zero onto the invoice.
- **`GlobalTaxCalculation` is never sent.** Intuit documents it as non-US only and a US-locale transaction faults on it. Since Intuit's 2018-08-10 AST change an absent line `TaxCodeRef` reads as taxable rather than exempt, which is why `NON` is explicit.
- **Import back**: `onTaxDelegationExport` records pending tax imports for the delivered invoices, and `externalTaxImportService` later calls `fetchExternalInvoice` to pull `TxnTaxDetail` (total plus the `TaxLine` component breakdown) onto the AlgaPSA invoice.

## Testing
Drive multi-step accounting-sync tests through the in-memory QBO simulator at `packages/billing/src/services/accountingSync/testing/qboSimulator.ts` rather than hand-mocking `QboClientService`. See [AI coding standards](../AI_coding_standards.md) for the scenario pattern.
