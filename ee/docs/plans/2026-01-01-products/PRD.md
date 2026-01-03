# Products (MSP Offer Catalog) — PRD

**Plan date:** 2026-01-01  
**Owner:** TBD  
**Status:** Draft (discovery in progress)

## 1) Problem Statement
Alga PSA needs a first-class way for MSPs to define **Products** they sell to customers and then use those products consistently across:
- Contracts (recurring + one-time billing)
- Automated invoices (from billing engine)
- Manual invoices
- Tax calculation and tax reporting/export
- Accounting exports (QBO/Xero/etc.)

Today, Alga already has a **Service Catalog** that is used as a de-facto “sellable item” source in billing, but “Products” as a user-facing concept is not implemented end-to-end, and the billing engine’s `product` / `license` charge paths are stubbed.

## 2) Goals
### V1 goals (no inventory)
1. Provide a **Products list** (CRUD) with typical product properties and multi-currency sales pricing.
2. Allow adding products to:
   - Contract templates + contracts + assigned client contracts
   - Manual invoices
3. Ensure products flow through existing pipelines:
   - Tax (internal calculation, with future external passthrough compatibility)
   - Invoice rendering (PDF/template display)
   - Accounting exports and mapping
4. Keep the model extensible to support future inventory augmentation without rewriting billing.

## 3) Non-Goals (V1)
- Inventory counts, stock locations/warehouses, purchase orders, receiving, costing methods (FIFO/LIFO), serial numbers.
- Quotes/estimates (unless already present elsewhere).
- Full CPQ/bundling engine (simple “bundle as a product group” can be deferred).

## 4) Users / Personas
- **MSP Admin / Billing Admin:** maintains catalog, pricing, taxability, accounting mapping.
- **Sales / Ops:** selects products when building contracts or invoicing.
- **Finance/Accounting:** relies on correct tax and export mappings.

## 5) Proposed Domain Model
### 5.1 Key design decision: “Products” vs “Service Catalog”
**Observation:** The current `service_catalog` is already the authoritative “sellable item” table for billing, taxation hooks, and accounting mapping resolution.

**Decision (V1):** Treat **Product** as a *subset/view* of catalog items and keep a single source of truth for sellable items.
- Implement via `service_catalog.item_kind` (at least: `service | product`) plus product fields on `service_catalog` (or tightly-coupled extension tables if we want to keep the base table slimmer).
- Downstream systems (contracts, invoices, accounting mapping, taxes) continue to anchor on the catalog item id (`service_catalog.service_id`).

### 5.2 Product properties (minimum)
Required:
- `name`
- `active` / availability
- `sales_price` (multi-currency supported; aligned with existing service pricing)

Strongly recommended:
- `sku` (unique per tenant; configurable requirement)
- `description`
- `unit_of_measure` (defaults to “each”)
- `tax_rate_id` (nullable: “non-taxable”)
- `category` and/or `type` (for filtering and mapping)
 - `vendor` / `manufacturer`
 - `cost` (non-inventory, for margin reporting)

Deferred but designed-for:
- `mfr_part_number`
- `external_ids` (for PSA/RMM/accounting integrations)

## 6) Integrations & System Touchpoints
### 6.1 Contracts
Products must be addable to:
- Contract templates (as default included products and quantities)
- Contracts (as a line’s included items)
- Client contract assignments (snapshot and per-client override)

Key behaviors:
- Quantity can be overridden at client level
- Price source hierarchy matches existing pricing rules (template → contract → schedule → client override)
- **V1 starts with recurring** product billing on contracts (no bill-once behavior yet)

### 6.2 Billing Engine
Billing engine must produce product charges as `type: 'product'` based on the items attached to a client contract line.
Current `calculateProductCharges` / `calculateLicenseCharges` are placeholders and must be implemented or removed in favor of a unified path.

### 6.3 Invoices (manual + automated)
- Manual invoice item picker should allow selecting products and entering quantity/price overrides.
- Automated invoices must render products in the same pipeline as other charges, with consistent tax calculation and rounding.
- Invoice rendering/templates must display product lines clearly (and optionally distinguish product vs service for UX).

### 6.4 Taxes
- Product lines must be taxable/non-taxable via `tax_rate_id`.
- Must align with the tax “source of truth” approach (internal calc now; external passthrough possible later).

### 6.5 Accounting Export
Accounting export mapping should work seamlessly:
- If products remain in `service_catalog`, existing mapping resolution can apply.
- If a separate products entity is introduced, mapping + resolver must be extended accordingly.

### 6.6 Tickets, Projects, Time Entries
V1 must support attaching products to:
- **Tickets** (materials/parts used on a ticket) that flow into invoicing
- **Projects** (materials/parts used on a project) that flow into invoicing
- **Time entries** (see Open Question: attach products directly to time entries vs a separate “materials” record associated to the time entry)

Core requirement: these product usages must be attributable (which ticket/project/time entry) and must map to invoice items consistently (tax, currency, accounting mapping).

**Decision (V1 billing path):** Ticket/project materials should flow into invoicing **via the billing engine**, like usage/time:
- Materials become billable “charges” in billing runs (not direct invoice items at the time of entry).
- Invoice generation persists those charges into invoice items using the same tax/rounding/persistence pipeline as other charges.

## 7) UX / UI Notes (V1)
### 7.1 Navigation
- Add a **Products** entry under Billing (or Sales) that lands on a Product Manager.
- The UI can be implemented as a filtered view of catalog items (if using Option A) to avoid duplicating “Service Catalog” tooling.

### 7.2 Product Manager
- Table view: name, SKU, active, type/category, primary price, tax rate, last updated.
- Create/edit: name, description, SKU, pricing (multi-currency), tax rate.
- Fast filtering: active, category/type, search by name/SKU.

### 7.3 Contract & Invoice selection
- Product picker with search and keyboard-friendly UX.
- Display price in correct currency context (contract/client currency).
- Show “not priced in this currency” validation consistent with contract wizard behavior.

## 8) Rollout / Migration Strategy
- Add DB fields/tables behind a feature flag if needed.
- Backfill existing `service_catalog` entries:
  - Default `item_kind` to `service` (or map using service types/categories where possible).
  - Allow manually reclassifying into `product` after rollout.
- Ensure invoice rendering and accounting exports remain backwards compatible.

## 9) Risks & Mitigations
- **Model duplication risk:** creating a parallel products table can fragment pricing/tax/mapping logic. Mitigate with single catalog id.
- **Billing correctness risk:** product charges affect taxes, totals, and exports. Mitigate with strong integration tests.
- **UX confusion risk:** “Service Catalog” vs “Products” overlaps. Mitigate with clear taxonomy and filtered views.

## 10) Open Questions (need your answers)
Resolved:
1. Products are a subset/view of Service Catalog (single catalog id).
2. Licenses need term/period semantics; V1 can implement this as product properties (optionally still emitting `type: 'license'` charges where appropriate).
3. Contracts: recurring only for V1.
4. V1 product fields: SKU, cost, vendor/manufacturer, category/type, tax rate. GL/account mapping should piggyback on existing service mapping.
5. Price overrides are allowed; no audit trail requirement yet.
6. No line-level discounts for V1.
7. Products must be usable on contracts + invoices + tickets + projects + time entries.

Still open:
8. Time-entry support: V1 starts with products/materials on tickets and projects only; model uses a separate “materials” record (not attached directly to time entries).
9. Ticket/project product usages: auto-bill for V1 (no approval workflow).
10. License semantics: V1 starts with term metadata only (no start/end dates, no proration rules).

## 11) Definition of Done (V1)
- Admin can CRUD products with multi-currency pricing and tax configuration.
- Products can be added to contracts and manual invoices.
- Automated billing produces product line items correctly (quantity, pricing, taxes).
- Invoice PDFs/templates render products correctly.
- Accounting exports include product lines with correct mapping and tax behavior.
- Automated tests cover core flows and edge cases (taxable vs non-taxable, missing currency price, overrides).
