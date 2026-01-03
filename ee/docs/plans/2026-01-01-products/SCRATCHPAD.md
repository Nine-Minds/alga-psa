# Products — Scratchpad

**Plan date:** 2026-01-01

## Why this plan exists
Add a first-class “Products” capability (MSP offer catalog) integrated with contracts, invoices, taxes, and accounting exports.

## Discovery notes (repo)
### Existing primitives that overlap with “Products”
- **Service Catalog already exists** (`service_catalog`) and is used as the authoritative sellable item source in billing, tax hooks, and accounting mapping.
- Multi-currency pricing exists for catalog items via `IServicePrice` and service pricing UI (`server/src/components/settings/billing/ServiceCatalogManager.tsx`).
- Tax selection for catalog items already uses `tax_rate_id` (nullable = non-taxable).
- Accounting mapping resolution currently resolves mappings for `service` (service_catalog row) and optionally `service_category` (`server/src/lib/services/accountingMappingResolver.ts`).

### Billing engine gaps
- `BillingEngine.calculateProductCharges` and `calculateLicenseCharges` exist but are placeholders returning an empty `planServices` list (`server/src/lib/billing/billingEngine.ts`).
- There are TODOs implying `service_catalog.service_type` is missing, but migrations show the schema has evolved; current app code relies on `custom_service_type_id` + `billing_method` instead.

### Contracts / line types
- `contract_lines.contract_line_type` is stored as free text in the DB (`server/migrations/20251008000001_rename_billing_to_contracts.cjs`), but TypeScript types in `server/src/interfaces/billing.interfaces.ts` and the API service layer are narrower (often `'Fixed' | 'Hourly' | 'Usage'`).
- Tests/reference code mention additional types like `'Bucket'`, and billing engine supports bucket charges; product/license line types likely need formalization.

## Working hypothesis (recommended direction)
Implement **Products as a “kind” of catalog item** and keep a single sellable-item id flowing through:
- contract services (`client_contract_services`)
- invoice items (`invoice_items`)
- mapping resolution (accounting export)
- tax assignment (`tax_rate_id`)

This avoids duplicating tax/mapping/pricing logic and keeps a clean path for future inventory augmentation.

## Links / references
- Billing domain overview: `docs/billing/billing.md`
- Multi-currency billing plan: `ee/docs/plans/2025-11-17-multi-currency-billing-plan.md`
- Tax system completion plan: `ee/docs/plans/2025-11-24-tax-system-completion-and-external-passthrough-plan.md`

## Open decisions to confirm
- ✅ Products as `service_catalog` subset/view (single catalog id).
- ✅ Contracts: start with recurring only (no bill-once in V1).
- ✅ Price overrides allowed (no audit trail in V1).
- ✅ No line-level discounts in V1.
- ✅ Products must be usable on: contracts + invoices + tickets + projects + time entries.
- License handling: needs term/period semantics; likely implement as properties on the product (may still emit `type: 'license'` charges).
- ✅ Materials model: separate “materials” records; V1 starts with materials on tickets/projects only (defer time-entry linkage).
- ✅ Ticket/project materials: auto-bill in V1.
- ✅ Billing path: ticket/project materials roll into billing engine like usage/time (not direct invoice items at entry-time).
- ✅ License semantics: term metadata only in V1 (no start/end, no proration).

## Commands used during discovery
- `rg -n "calculateProductCharges|calculateLicenseCharges" -S server/src`
- `rg -n "service_catalog" -S server/src ee docs`

## Implementation gotchas / notes
- `getServices()` now defaults to `item_kind: 'service'` to preserve legacy expectations; use `getServices(..., { item_kind: 'product' })` or `{ item_kind: 'any' }` explicitly when you need products included.
- `server/src/components/ui/Button` requires an `id` prop; new buttons added for Products/Materials include explicit IDs.
- **Archive semantics (Products):** “Delete product” is implemented as **archive** (`service_catalog.is_active=false`). Archived products:
  - are hidden from product pickers by default (pickers now request `is_active: true`)
  - cannot be attached to new contract lines (server-side enforcement in `addServiceToContractLine`)
  - can be restored via Products UI (sets `is_active=true`).
- **Contracts/templates:** Client Contract Wizard + Template Wizard now have an explicit **Products** step; products are created on their own fixed contract line (“… - Products”) to avoid mixing with fixed-fee base rates.
- **Billing safety:** Billing engine now throws a clear error if a product has no catalog price in the contract currency and no custom rate override (prevents accidental $0 product charges).
- **Manual invoices:** Manual invoice service picker now uses multi-currency catalog prices (and includes products) instead of `default_rate` (which is often 0 for products).
- **Guardrails added:**
  - Service catalog mutations (create/update/delete) and service price mutations now enforce RBAC via `hasPermission(user, 'service', ...)`.
  - Catalog rates (`default_rate`, `cost`, `service_prices.rate`) are normalized to integer cents and rejected if negative.
  - Manual invoice API now requires `quantity > 0` for non-discount line items.
- **Scalable catalog pickers (contracts):**
  - Added `server/src/components/ui/AsyncSearchableSelect.tsx` (debounced, server-side search, 10-item limit + “more results” indicator).
  - Added `server/src/components/billing-dashboard/contracts/ServiceCatalogPicker.tsx` to search **services + products** (filters by `billing_method`, `item_kind`, `is_active`).
  - Wired into contract dialogs that previously loaded `getServices(1, 999, ...)` and filtered client-side.
- **Product update reliability:** `Service.update()` now strips `undefined` keys before calling Knex `update()` to avoid invalid/undefined bindings when optional product fields are omitted.
- **Product categories (V1):** Products use the existing `service_categories` reference data via `service_catalog.category_id` for controlled categorization (filtering + accounting mapping); the legacy freeform `product_category` is treated as an optional “label” field in the UI.
- **Product money formatting:** Product list/pricing surfaces avoid hard-coded `$` and always display currency context (symbol + `(CODE)`), consistent with multi-currency catalog pricing.
- **API surface added/updated:**
  - `/api/v1/products` and `/api/v1/products/{id}` provide product catalog CRUD over API keys (RBAC resource: `service`).
  - `/api/v1/services` list query now supports `item_kind` (`service|product|any`) and `is_active` filters; `billing_method` now includes `per_unit`.
  - Contract Lines API v2 now resolves plan services from `service_catalog` (not `services`) and accepts `per_unit` billing methods for product services.
- **OpenAPI/metadata:** `MetadataService.discoverSchemas()` originally looked for `server/src/lib/api/schemas` relative to `process.cwd()`, which is wrong in Next (cwd is `server/`). Fixed to scan `src/lib/api/schemas`, added support for `z.object(shapeName)` schema patterns, and tagged `/api/v1/products` under `Configuration`.
- **Invoice preview (drafts) bug:** Draft invoice preview failed with Postgres error `column reference "tenant" is ambiguous` due to an unqualified `.where({ tenant })` after joining `invoice_charges as ic` with `service_catalog as sc` in `Invoice.getInvoiceCharges`. Fixed by qualifying the where clause to `ic.tenant`/`ic.invoice_id` (`server/src/lib/models/invoice.ts`).
  - **Dev stack note:** In this worktree the Next.js server runs from a built image (not a bind-mount), so code changes may require `docker compose ... build server` + recreate to take effect.
- Local build sanity checks:
  - TypeScript passes under `NEXTAUTH_SECRET='local-build-secret' NODE_OPTIONS='--max-old-space-size=8192' npm -w server run build`
  - Next.js prerender currently fails on `/_global-error` (`useContext` null) in this environment; appears unrelated to Products work.

## Scope trims (confirmed)
- Removed “Convert Service Catalog Item to Product” UI: users can create products directly; no explicit in-app “convert service → product” workflow is required for V1.
