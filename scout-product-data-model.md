# Scout Report: Product Data Model

## 1. `service_catalog` Table Schema — Product Columns

Products live inside `service_catalog`. The original table was created in `202409071803_initial_schema.cjs` (line 409) with these base columns:

| Column | Type | Constraint |
|---|---|---|
| `tenant` | uuid | NOT NULL, FK → tenants |
| `service_id` | uuid | PK (composite with tenant), default gen_random_uuid() |
| `service_name` | text | NOT NULL |
| `description` | text | nullable |
| `service_type` | text | NOT NULL (later superseded by check constraint, then dropped) |
| `default_rate` | bigint | nullable |
| `unit_of_measure` | text | nullable (no default in initial schema) |
| `category_id` | uuid | nullable, FK → service_categories |

### Product-specific columns added across migrations

**20241003202100_add_tax_column_to_service_catalog.cjs**
- `is_taxable` boolean DEFAULT true — *later dropped by 20250413154016*
- `tax_region` text nullable — *later dropped by 20250413154016*

**20250127135900_add_product_service_types.cjs**
- Adds CHECK constraint: `service_type IN ('Fixed', 'Time', 'Usage', 'Product', 'License')`
- Note: Later the `service_type` column is entirely replaced by `billing_method` + `item_kind`. The `billing_method` added by `20250326011924` initially had CHECK `billing_method IN ('fixed', 'per_unit')`, later converted to free TEXT by `20251016120000_update_billing_method_to_text.cjs`.

**20250326011924_update_service_catalog_for_billing_method.cjs**
- Drops old `service_type_check`
- Adds `billing_method` text with CHECK `('fixed', 'per_unit')`

**20250326201406_modify_service_catalog_for_service_type_id.cjs + downstream**
- Adds `standard_service_type_id` uuid (FK → `standard_service_types.id`)
- Adds `custom_service_type_id` uuid (FK → `service_types.id`)
- Adds CHECK `service_catalog_check_one_type_id` — exactly one must be non-null
- Drops old `service_type_id` column

**20250405231739_enforce_service_billing_method.cjs**
- Adds `billing_method` NOT NULL, CHECK `('fixed', 'per_unit')`
- The CHECK is later dropped by `20251016120000` and column converted to plain TEXT

**20250408220730_modify_service_catalog_for_regions.cjs**
- Adds `region_code` (FK → tax_regions), later dropped

**20250413142134_add_tax_rate_id_to_service_catalog.cjs**
- `tax_rate_id` uuid nullable, FK → `tax_rates(tenant, tax_rate_id)`

**20250413154016_remove_region_code_is_taxable_from_service_catalog.cjs**
- Drops `region_code` and `is_taxable` columns

**20260101090000_add_products_fields_to_service_catalog.cjs** — **THE KEY MIGRATION**

V1 scope comment (verbatim):
```
 * V1 scope:
 * - Products are catalog items where item_kind = 'product'
 * - Licenses are modeled as product metadata (term/cadence), not separate period/proration semantics yet
```

Columns added:

| Column | Type | Constraint |
|---|---|---|
| `item_kind` | text | NOT NULL DEFAULT 'service', CHECK `('service', 'product')` |
| `is_active` | boolean | NOT NULL DEFAULT true |
| `sku` | text | nullable |
| `cost` | bigint | nullable (cents) |
| `vendor` | text | nullable |
| `manufacturer` | text | nullable |
| `product_category` | text | nullable |
| `is_license` | boolean | NOT NULL DEFAULT false |
| `license_term` | text | nullable (e.g. monthly, annual, perpetual) |
| `license_billing_cadence` | text | nullable (e.g. monthly, annual) |

Indexes created:
- `service_catalog_product_sku_unique` — UNIQUE on `(tenant, sku)` WHERE `sku IS NOT NULL AND item_kind = 'product'`
- `idx_service_catalog_item_kind` — on `(tenant, item_kind)`
- `idx_service_catalog_product_name` — on `(tenant, service_name)` WHERE `item_kind = 'product'`

**20260107190000_add_cost_currency_to_service_catalog.cjs**
- `cost_currency` varchar(3) nullable DEFAULT 'USD'

**20260321110000_create_service_catalog_mode_defaults.cjs** (separate table)
- Table `service_catalog_mode_defaults` with: `default_id`, `tenant`, `service_id`, `billing_mode` CHECK `('fixed','hourly','usage')`, `currency_code`(3), `rate` (integer, >=0), timestamps
- UNIQUE on `(tenant, service_id, billing_mode, currency_code)`

### Final consolidated `service_catalog` column set relevant to products

```
tenant                  uuid        NOT NULL PK FK
service_id              uuid        NOT NULL PK
service_name            text        NOT NULL
description             text        nullable
default_rate            bigint      nullable (legacy)
unit_of_measure         text        nullable (no constraint)
category_id             uuid        nullable FK → service_categories
billing_method          text        NOT NULL (free text: 'fixed'|'hourly'|'usage')
custom_service_type_id  uuid        FK → service_types (one of two type FKs required)
standard_service_type_id uuid      FK → standard_service_types (the other)
item_kind               text        NOT NULL DEFAULT 'service' CHECK('service','product')
is_active               boolean     NOT NULL DEFAULT true
sku                     text        nullable; UNIQUE INDEX (tenant, sku) WHERE item_kind='product'
cost                    bigint      nullable (cents)
cost_currency           varchar(3)  nullable DEFAULT 'USD'
vendor                  text        nullable
manufacturer            text        nullable
product_category        text        nullable
is_license              boolean     NOT NULL DEFAULT false
license_term            text        nullable
license_billing_cadence text        nullable
tax_rate_id             uuid        nullable FK → tax_rates
created_at              timestamp   (likely present, from initial schema or added)
updated_at              timestamp   (likely present)
```

## 2. TypeScript `IService` Interface

File: `packages/types/src/interfaces/billing.interfaces.ts` (lines 191–225)

```typescript
export interface IService extends TenantEntity {
  service_id: string;
  service_name: string;
  custom_service_type_id: string;      // FK to service_types (required)
  billing_method: 'fixed' | 'hourly' | 'usage'; // required
  default_rate: number;                 // convenience: primary/USD rate
  category_id: string | null;
  unit_of_measure: string;
  item_kind?: 'service' | 'product';   // catalog kind (products = filtered subset)
  is_active?: boolean;
  sku?: string | null;
  cost?: number | null;                // cents
  cost_currency?: string | null;        // ISO 4217
  vendor?: string | null;
  manufacturer?: string | null;
  product_category?: string | null;
  is_license?: boolean;
  license_term?: 'monthly' | 'annual' | 'perpetual' | string | null;
  license_billing_cadence?: 'monthly' | 'annual' | string | null;
  tax_rate_id?: string | null;          // FK to tax_rates
  description?: string | null;
  service_type_name?: string;           // from JOIN (virtual)
  prices?: IServicePrice[];             // multi-currency pricing
}
```

Zod validation schema: `packages/billing/src/models/service.ts` (lines 41–91) — `baseServiceSchema` and `serviceSchema`. The `billing_method` enum in the Zod schema is `['fixed', 'hourly', 'usage']`. The `item_kind` enum is `['service', 'product']` with default `'service'`.

There is **no `service_type` field** in the current interface — it was replaced by `custom_service_type_id` (→ `service_types`) and `standard_service_type_id` (→ `standard_service_types`).

## 3. Inventory / Stock Tracking — Confirmed Absent

**There is NO notion of physical inventory in the codebase.** Searched across all migrations and packages/types for:

- `quantity_on_hand`, `on_hand`, `stock_level`, `reorder_point` — **not found** (except a false positive in a UI reorder-context migration comment)
- `warehouse`, `bin_location`, `bin` — **not found**
- `lot`, `serial_number` — only found in `20241112031330_create_asset_management_tables.cjs` as `assets.serial_number` — this is for **IT asset tracking** (hardware: tag, type, warranty, location), not product inventory
- `stock_movement`, `goods_received`, `stock_adjustment`, `transfer_order` — **not found**
- `allocation`, `reserved` — only found as unrelated time-slot or binding allocation concepts

The closest thing to "product quantity tracking" is:

- **`ticket_materials`** and **`project_materials`** tables (created by `20260101093000_create_ticket_project_materials.cjs`): These record how many units of a product (service_id from service_catalog) were consumed in a ticket or project for billing purposes. Each row has an `integer quantity` field. This is **consumption tracking for invoicing** — NOT stock/inventory management.
- **`quote_items.quantity`** and **`invoice_items.quantity`**: Similarly track sell-side quantities, not on-hand stock.

**Conclusion: Physical inventory management (stock levels, warehouses, bins, lots/serials, transfers, adjustments) does not exist anywhere in the codebase.**

## 4. `tenant_product_code` — Not Product Inventory

File: `server/migrations/20260505140000_add_tenant_product_code.cjs`

This adds `product_code text DEFAULT 'psa'` to the `tenants` table with CHECK `('psa', 'algadesk')`. This is definitively:

> **A product-edition/entitlement flag**: `'psa'` = Alga PSA, `'algadesk'` = AlgaDesk (service desk edition).

It has nothing to do with product SKU inventory. It controls which Alga product the tenant is licensed for.

## 5. `service_prices` / Multi-Currency Pricing

### Table: `service_prices`

Created by `20251205130000_add_service_prices_table.cjs`:

| Column | Type | Constraint |
|---|---|---|
| `price_id` | uuid | PK |
| `tenant` | uuid | NOT NULL, FK → tenants (CASCADE) |
| `service_id` | uuid | NOT NULL, FK → service_catalog (CASCADE, composite with tenant) |
| `currency_code` | varchar(3) | NOT NULL |
| `rate` | integer | NOT NULL (cents) |
| `created_at` / `updated_at` | timestamptz | NOT NULL |

UNIQUE `(tenant, service_id, currency_code)` — one price per currency per service.

The initial migration also backfills existing `service_catalog.default_rate` as USD prices.

### How prices relate to service_catalog

**Service-level action: `setServicePrices`** — `packages/billing/src/actions/serviceActions.ts` (line 1089):
- Authorized: requires `service:update` permission
- Called by `Service.setPrices()` in `packages/billing/src/models/service.ts` (line 809):
  1. Deletes all existing `service_prices` rows for the given `(tenant, service_id)`
  2. Inserts new rows from the provided `Array<{ currency_code, rate }>`

**Usage in billing engine** — `packages/billing/src/lib/billing/billingEngine.ts` (lines 3151, 3297, 3536, 3597, 3865):
- Rate resolution order: per-entry custom rate > per-user-type rate (contract config) > `service_prices` row in contract currency > **NOT** `service_catalog.default_rate` (intentionally skipped — it's currency-untagged)
- `service_prices` is LEFT JOINed on `(service_id, tenant, currency_code = contract.currency_code)`

**Usage in contract wizard** — `packages/billing/src/actions/contractWizardActions.ts` (line 1051):
- Validates that services have a price in the contract currency by joining `service_prices`

**Catalog picker** — `packages/billing/src/actions/serviceActions.ts` (lines 158–168):
- When `currency_code` is provided, LEFT JOINs `service_prices` to return `currency_rate` and `has_currency_prices` alongside catalog items
- `CatalogPickerItem` type includes `currency_rate`, `has_currency_prices`, `cost`, `cost_currency`

**Mode defaults** — `service_catalog_mode_defaults` table (created by `20260321110000`):
- Stores per-service, per-mode, per-currency default rates
- Backfilled from `service_prices` (when present) or legacy `default_rate` + `currency_code`
- Used in contract wizard rate prefills

### Key observations
- `default_rate` on `service_catalog` is now a **legacy convenience field** — the billing engine deliberately avoids it for billing calculations because it's currency-untagged.
- `service_prices` is the **authoritative** pricing source.
- `cost` and `cost_currency` on `service_catalog` are the **buy-side cost** for products, separate from sell-side pricing in `service_prices`.
- `service_catalog_mode_defaults` provides per-mode defaults but is still secondary to contract-line overrides.

## Architecture Summary

```
tenants.product_code = 'psa' | 'algadesk'   ← product edition flag, not inventory
         │
         ▼
service_catalog (item_kind IN ('service', 'product'))   ← products are filtered subset
  ├─ sku (unique per tenant when item_kind='product')
  ├─ cost / cost_currency (buy-side)
  ├─ vendor / manufacturer / product_category
  ├─ is_license / license_term / license_billing_cadence
  ├─ tax_rate_id → tax_rates
  └─ service_prices ◄── (tenant, service_id, currency_code) ──► sell-side pricing
  
service_catalog_mode_defaults ◄── (tenant, service_id, billing_mode, currency_code)
  └─ per-mode defaults for contract wizard

ticket_materials ──► service_id ──► quantity (consumption, not stock)
project_materials ──► service_id ──► quantity (consumption, not stock)
quote_items ──► service_id ──► quantity
invoice_items ──► service_id ──► quantity
```

## Start Here

Open `packages/types/src/interfaces/billing.interfaces.ts` and read the `IService` interface (line 191) and `IServicePrice` (line 182). Then open `server/migrations/20260101090000_add_products_fields_to_service_catalog.cjs` for the V1 scope comment and complete column list. The Zod schema in `packages/billing/src/models/service.ts` (line 41) shows the runtime validation shape.

## Residual Risks / Open Questions
- `cost_currency` was added after `cost` (separate migration), so some services may have `cost` set but no `cost_currency`
- `billing_method` was originally `('fixed', 'per_unit')` with CHECK, now free TEXT after `20251016120000_update_billing_method_to_text.cjs` — the Zod schema still uses a string union
- No TypeScript interface exists for `service_catalog_mode_defaults` — it's queried raw
- `unit_of_measure` has no DB default or CHECK — UI or app logic controls valid values
