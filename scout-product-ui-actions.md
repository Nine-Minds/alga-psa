# Scout Report: Product UI & Actions Surface Area

## 1. Products Manager UI

### Product Form Fields (QuickAddProduct.tsx)

**Present fields (create/edit dialog):**
- Product Name (required) — `formProduct.service_name`
- Type (required) — `formProduct.custom_service_type_id`, via `EditableServiceTypeSelect` (shared taxonomy with Services)
- SKU — `formProduct.sku`
- Category — `formProduct.category_id`, from `service_categories`
- Label (freeform) — `formProduct.product_category`
- Vendor — `formProduct.vendor`
- Manufacturer — `formProduct.manufacturer`
- Cost + Currency — `formProduct.cost` (cents, bigint) + `formProduct.cost_currency`
- Billing Method — only `'usage'` (single option in `BILLING_METHOD_OPTION_VALUES`)
- Multi-currency prices — `formPrices` array, editable with add/remove currency
- Tax Rate — `formProduct.tax_rate_id`, non-taxable by default
- Unit of Measure (required) — `formProduct.unit_of_measure`
- License? flag — `formProduct.is_license`
- License Term — `formProduct.license_term`, options: `['monthly', 'annual', 'perpetual']`
- License Billing Cadence — `formProduct.license_billing_cadence`
- Active — `formProduct.is_active`
- Description — `formProduct.description`

**NOT present (confirmed absent):** quantity on hand, stock level, reorder point, warehouse/location, serial/lot tracking, bin location, allocations.

### getInitialProductState

```ts
const getInitialProductState = (): Partial<IService> => ({
  item_kind: 'product',
  is_active: true,
  billing_method: 'usage',
  unit_of_measure: '',
  cost_currency: defaultCurrency,
  is_license: false,
  license_term: 'monthly',
  license_billing_cadence: 'monthly'
});
```
*(QuickAddProduct.tsx lines 57-66)*

### createService payload (create path)

```ts
const created = await createService({
  service_name: formProduct.service_name!.trim(),
  custom_service_type_id: formProduct.custom_service_type_id!,
  billing_method: (formProduct.billing_method || 'usage') as any,
  default_rate: primary.rate,
  unit_of_measure: formProduct.unit_of_measure!.trim(),
  description: formProduct.description ?? null,
  category_id: formProduct.category_id ?? null,
  tax_rate_id: formProduct.tax_rate_id ?? null,
  item_kind: 'product',
  is_active: formProduct.is_active ?? true,
  sku: formProduct.sku ?? null,
  cost: formProduct.cost ?? null,
  cost_currency: formProduct.cost_currency ?? 'USD',
  vendor: formProduct.vendor ?? null,
  manufacturer: formProduct.manufacturer ?? null,
  product_category: formProduct.product_category ?? null,
  is_license: formProduct.is_license ?? false,
  license_term: formProduct.license_term ?? null,
  license_billing_cadence: formProduct.license_billing_cadence ?? null
} as any);
```
*(QuickAddProduct.tsx lines 186-214)*

### BILLING_METHOD and LICENSE_TERM options

```ts
const LICENSE_TERM_OPTION_VALUES = ['monthly', 'annual', 'perpetual'] as const;
const BILLING_METHOD_OPTION_VALUES = ['usage'] as const;
```
*(QuickAddProduct.tsx lines 19-20)*

### Delete guard: associations checked

`checkProductCanBeDeleted` checks these tables before allowing permanent delete:
- `invoice_items`
- `time_entries`
- `ticket_materials`
- `project_materials`
- `contract_line_services`
- `contract_line_service_configuration`
- `bucket_usage`

*(serviceActions.ts `checkProductCanBeDeleted` function)*

---

## 2. Navigation Wiring

ProductsManager is a **tab within the Billing dashboard** (`/msp/billing?tab=products`). It is NOT a top-level nav item.

**Tab definition** in `billingTabsConfig.ts` (line 157-162):
```ts
{
  value: 'products',
  label: 'Products',
  labelKey: 'dashboard.tabs.products',
  href: '/msp/billing?tab=products',
  icon: Package
}
```

**Rendered at** BillingDashboard.tsx (line 237):
```tsx
<Tabs.Content value="products">
  <ProductsManager />
</Tabs.Content>
```

The BillingDashboard uses `Tabs.Root` with URL-driven tab selection (`?tab=products`). The visual tab bar is rendered by the MSP shell/layout, not inside BillingDashboard.tsx itself.

---

## 3. Server-Side Product Actions (serviceActions.ts)

### `getServices(page, pageSize, { item_kind: 'product', ... })`
- Filters `service_catalog` by `item_kind = 'product'`
- Joins `service_types` for `service_type_name`
- Fetches all `service_prices` for returned products
- Returns `{ services: IService[], totalCount }`
- No quantity/stock logic

### `createService(serviceData)`
- Validates `custom_service_type_id`, `billing_method`
- Sets `default_rate`, `tax_rate_id`
- Creates row in `service_catalog` with `tenant`
- Publishes search event `SERVICE_CATALOG_CREATED`
- SKU uniqueness enforced at DB level (`service_catalog_product_sku_unique` partial unique index)
- **No quantity/stock mutation**

### `updateService(serviceId, serviceData)`
- Calls `Service.update()`
- Publishes `SERVICE_CATALOG_UPDATED`
- **No quantity/stock mutation**

### `setServicePrices(serviceId, prices[])`
- Deletes all existing prices for service, inserts new ones
- Pure pricing upsert, no quantity/stock

### `checkProductCanBeDeleted(serviceId)`
- Checks 7 association tables (see section 1) before permitting permanent delete
- Returns `{ canDelete: boolean, associations: [...] }`

### `deleteProductPermanently(serviceId)`
- Requires `checkProductCanBeDeleted` to pass
- Deletes `service_prices`, `service_rate_tiers`
- Nulls out `project_tasks.service_id`, `project_template_tasks.service_id`, `invoice_charge_details.service_id`
- Deletes row from `service_catalog`
- **No quantity/stock cleanup because none exists**

### `getServiceTypesForSelection()`
- Returns all service types (shared for both Services and Products)
- No product-specific filtering

### `searchServiceCatalogForPicker()`
- Used by `ServiceCatalogPicker` UI component
- Filters by `item_kind`, `billing_method`, `is_active`, search
- Returns flat items with `default_rate`, `currency_rate`, `cost`, `cost_currency`
- **No quantity/stock fields returned**

### `productCatalogCanonicalWrites` (static test)
- Located at `server/src/test/unit/api/productCatalogCanonicalWrites.static.test.ts`
- Enforces that `ProductCatalogService.ts` only writes `billing_method: 'usage'` for products
- Verifies absence of `billing_method: 'per_unit'`
- The production `ProductCatalogService.ts` hard-codes `billing_method: 'usage'` on both create and update paths

---

## 4. Contract Line / Invoice Line Consumption

### Contract line: products attached with quantity on the LINE

`addServiceToContractLine` (`contractLineServiceActions.ts`):
- Products are validated: only allowed on `Fixed` contract lines
- Requires pricing in contract currency (or custom rate override)
- Product is stored in `contract_line_services` (junction) with a `contract_line_service_configuration` row
- The configuration row has a `quantity` field (integer)
- **No decrement of stock when a product is added to a contract line**

### `EditContractLineServiceQuantityDialog.tsx`
- Edits `quantity` and optionally `unitRateCents` on a contract line service
- No stock, no allocation, no on-hand check
- Pure billing quantity adjustment

### Invoice items
- `invoice_items` table has `quantity` (bigInteger/decimal) and `unit_price`, `total_price`
- Quoting SQL: `quantity` is a per-line billing quantity
- **No stock ledger decremented when invoice items are created**

### Confirmed: quantity lives on the LINE/SERVICE/LINE-ITEM, never decremented from a product record.

---

## 5. Quote Template Wizard — TemplateProductsStep

**File:** `packages/billing/src/components/billing-dashboard/contracts/template-wizard/steps/TemplateProductsStep.tsx`

- Allows selection of products via `ServiceCatalogPicker` with `itemKinds={['product']}`
- Each product gets a `quantity` field (suggested default quantity when creating contracts)
- Products stored in `data.product_services` as `{ service_id, service_name, quantity }`
- Description text: *"When a contract is created from this template, products will be billed each cycle using the product catalog price for the contract currency."*
- **No stock/inventory concerns — pure billing template**

---

## 6. ticket_project_materials Tables

**Migration:** `server/migrations/20260101093000_create_ticket_project_materials.cjs`

### `ticket_materials` columns:
- `tenant`, `ticket_material_id`, `ticket_id`, `client_id`, `service_id`
- `quantity` (integer, default 1)
- `rate` (bigint, cents), `currency_code`, `description`
- `is_billed` (boolean), `billed_invoice_id`, `billed_at`
- Foreign key: `service_id` → `service_catalog` with `ON DELETE RESTRICT`

### `project_materials` columns:
- Same structure, but keyed on `project_id` instead of `ticket_id`

### Key design notes from migration header:
> *"Materials are recorded on tickets and projects (not time entries yet)"*
> *"Materials auto-bill (no approval gate)"*
> *"Materials are ingested into billing engine as charges (like usage/time), then persisted to invoice items during invoice generation"*

### Confirmed: These tables record product CONSUMPTION (quantity used on a ticket/project for billing), not stock on hand. There is no decrement of any stock ledger when materials are logged. The `is_billed` flag tracks billing status, not inventory fulfillment.

---

## Summary of Architecture

```
service_catalog (item_kind = 'product')
    ├── service_prices (multi-currency rates)
    ├── contract_line_services / contract_line_service_configuration (quantity on the line)
    ├── invoice_items (quantity on the invoice line)
    ├── ticket_materials (consumption tracking, is_billed flag)
    ├── project_materials (consumption tracking, is_billed flag)
    └── quote line items (TemplateProductsStep)
    
NO: quantity_on_hand, stock_level, reorder_point, warehouse, serial/lot, allocations
```

Products are billing catalog items with SKU/tax/cost/pricing metadata. Quantities exist only on consuming entities (contract lines, invoice items, ticket/project materials) — there is no inventory ledger to decrement.
