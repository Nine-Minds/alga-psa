# Inventory Kits Command Center - Design

- Date: 2026-07-09
- Branch: `fix/inventory-per-unit-billing`
- Status: Approved design, ready for implementation planning
- Related design: `docs/plans/2026-06-26-inventory-module-design.md`

## Summary

Replace the current `/msp/inventory/kits` screen with an end-to-end kit management
workspace. The screen should bring the implemented UI up to the original inventory
module concept: a kit is an orderable catalog product, a bill of materials, a stock
readiness calculation, and a predictable sales-order/billing behavior.

The current screen is only a thin BOM editor. It lists kit products and lets users
add or remove components, but it does not explain how kits are created, priced,
validated, fulfilled, or invoiced. That split forces operators to discover
Billing -> Products for creation and leaves core behaviors hidden until the sales
order flow.

## Product Positioning

Inventory -> Kits becomes the canonical kit lifecycle surface.

Billing -> Products remains the deeper catalog administration surface, but users
should not need to leave Inventory -> Kits for the common workflow:

1. Create a kit.
2. Define its bill of materials.
3. Set pricing behavior.
4. Check stock readiness.
5. Understand sales-order expansion.
6. Start or inspect sales-order usage.

This keeps the original model intact: kits are sales-order templates that explode
into component lines. They are not finished goods held as stock under the kit SKU.
Any "can build" number is a readiness calculation derived from component
availability, not a new stock balance for the kit product.

## Goals

- Let an MSP owner or operator create a kit from Inventory -> Kits without first
  discovering Billing -> Products.
- Make "bill of materials" the central editing concept.
- Surface pricing mode and fixed-price amount directly on the kit screen.
- Show margin and cost impact before the kit is sold.
- Show buildable quantity and component stock constraints.
- Make componentless or invalid kits visibly incomplete.
- Preview the exact sales-order behavior before creating a sales order.
- Preserve the backend model where one priced parent line expands into child
  component lines that allocate and fulfill stock.

## Non-goals

- Nested kits or multi-level BOMs.
- Finished-good assembly, build orders, or stock held under the kit SKU.
- Quote/template integration.
- Barcode or scanning workflows.
- Changes to the invoice writer beyond preserving the existing kit line behavior.
- Full replacement of Billing -> Products.

## Page Structure

### Header

Use the title `Inventory kits`, not just `Kits`.

Header content:

- Summary counts: total kits, ready kits, kits needing attention.
- Primary action: `Create kit`.
- Secondary guidance should be contextual and terse, not instructional page copy.

### Kit List

The list should be searchable and filterable. Each row should show enough state to
choose the right kit without opening every record:

- Kit name.
- SKU.
- Status chip: `Ready`, `No BOM`, `Low stock`, or `Incomplete`.
- Pricing mode: `Sum of components` or `Fixed price`.
- Component count.
- Can-build quantity.
- Action: `Open` or `Edit kit`.

The list should include clear empty and no-results states. Empty state action:
`Create kit`.

### Kit Detail

The detail can be a right-side workspace, a full detail route, or a responsive
two-pane layout. It should include these sections:

- Overview.
- Bill of materials.
- Pricing and margin.
- Stock readiness.
- Sales-order behavior.
- Usage.

The detail header should show the product identity: name, SKU, pricing status,
and direct link to advanced product settings.

## Core Workflow

### Create Kit

`Create kit` opens a modal or drawer from Inventory -> Kits.

The action creates a catalog product and enables inventory with `is_kit=true`.
Required fields should be the minimum needed to create a sellable kit product:

- Kit name.
- SKU.
- Pricing mode.
- Kit price or fixed price where required.
- Required catalog basics that the existing product model enforces.

After save, the user lands directly in the new kit detail/BOM editor.

### Build BOM

Rename the component editor to `Bill of materials`.

Each component row should show:

- Component name.
- SKU.
- Stocked or non-stocked indicator.
- Serialized indicator.
- Qty per kit.
- Available quantity.
- Component unit cost.
- Extended component cost.
- Constraint contribution to can-build quantity.
- Edit and remove actions.

Adding a component that already exists should feel like updating the quantity. Do
not silently merge without making that behavior clear.

The component picker should support the backend contract: components may be
stocked products or non-stocked catalog product lines, but cannot be the kit
itself or another kit.

### Validate Readiness

Kit status should be derived server-side:

- `No BOM`: no components.
- `Ready`: has components and every stocked component has usable availability.
- `Low stock`: one or more stocked components constrains buildable quantity.
- `Incomplete`: required product or pricing configuration is invalid.

Componentless kits must never look valid, because sales-order expansion currently
fails for kits with no components.

### Price the Kit

Expose existing inventory settings:

- `kit_pricing_mode`: `sum` or `fixed`.
- `kit_fixed_price`: required when pricing mode is `fixed`.

The UI should show:

- Kit price.
- Component cost.
- Gross margin dollars.
- Gross margin percent.

For `sum` pricing, show the calculated component-derived price/cost basis. For
`fixed` pricing, use the fixed amount and flag missing or invalid fixed prices.

### Preview Business Behavior

Add a `Sales-order behavior` section that previews the actual expansion model:

- Parent kit line is priced.
- Component lines are child lines.
- Component lines are normally zero-dollar lines.
- Component lines allocate and fulfill stock.

The preview should support at least quantity 1 and a user-entered quantity so the
operator can see multiplied component quantities before creating a sales order.

### Act

Primary actions from kit detail:

- `Create sales order`.
- `View sales orders using this kit`.
- `Open product settings`.

`Create sales order` should send the user into the existing sales-order flow with
the kit preselected if the current route architecture supports it. If preselection
is not immediately practical, link to the sales-order create flow and keep the
preselection feature in the implementation plan as a follow-up item.

## Data And API Boundaries

The UI should not compute business status by stitching many raw actions together.
Add server-side read models for kit summaries and kit detail.

Recommended actions:

- `listKitSummaries()`
- `getKitDetail(kitServiceId)`
- `createKitProduct(input)`
- `updateKitProduct(input)`

`listKitSummaries()` should return the row data needed by the list:

- Catalog identity.
- Inventory kit settings.
- Component count.
- Pricing mode.
- Derived status.
- Buildable quantity.
- Usage counts when cheap enough to include.

`getKitDetail()` should return:

- Catalog fields.
- Inventory settings.
- BOM rows joined to component catalog data.
- Stock totals and availability.
- Cost and price inputs.
- Derived margin.
- Derived readiness status.
- Sales-order usage metadata.

`createKitProduct()` should create the catalog product and enable inventory with
`is_kit=true`. It should preserve the existing product/catalog source of truth
instead of inventing a parallel kit master.

`updateKitProduct()` should update only fields that belong in this screen:

- Basic product identity.
- Pricing mode and fixed price.
- Inventory kit settings that affect sales-order behavior.

Advanced catalog fields should remain linked through Billing -> Products.

## Existing Backend Behavior To Preserve

The implementation should preserve the current kit sales-order model:

- `kit_components` is the BOM table.
- A kit is a `service_catalog` product flagged by
  `product_inventory_settings.is_kit=true`.
- `explodeKitOntoSalesOrder` inserts one parent sales-order line for the kit.
- Component lines are inserted with `parent_so_line_id` set.
- Parent line carries the kit price.
- Component lines have `unit_price=0`.
- Component lines drive stock allocation and fulfillment.
- Single-level BOM is enforced; a kit cannot contain another kit.

## Error Handling

- Loading a selected kit should clear stale BOM rows immediately.
- Component load failures should render inline with a retry action.
- Empty BOM should render a warning state, not an empty valid table.
- Fixed-price kits should block save when fixed price is missing or invalid.
- Quantity entry should be positive integer only, matching server behavior.
- Known server errors should map to operator language where possible:
  - `Kit has no components defined` -> `Add at least one BOM component before using this kit on a sales order.`
  - `A kit cannot contain another kit` -> `Nested kits are not supported. Choose a non-kit product.`

## UX Copy

Use operator language consistently:

- `Inventory kits`
- `Bill of materials`
- `Qty per kit`
- `Can build`
- `Stock readiness`
- `Sales-order behavior`
- `Used on sales orders`
- `Create sales order`

Avoid making the user infer that "kit" means "a product configured elsewhere."
The screen should say what is sellable, what is inside it, and what happens when
it is ordered.

## Testing Plan

Implementation should include DB-backed coverage for the read and write behavior:

- Kit summary with no BOM.
- Ready kit with stocked components.
- Low-stock kit where one component constrains can-build quantity.
- Kit with non-stocked component.
- Fixed-price kit with valid fixed price.
- Fixed-price kit with missing fixed price.
- Sum-priced kit margin calculation.
- Create kit product creates catalog product and inventory kit settings.
- Update kit pricing mode and fixed amount.
- Add, update, and remove BOM component.
- Sales-order regression: kit explosion creates one priced parent line plus
  zero-dollar child component lines.

Browser smoke should cover:

- Create kit.
- Add BOM components.
- See readiness and margin update.
- Preview sales-order behavior.
- Enter the create-sales-order path.

## Rollout

Straight replacement of the current Kits screen is acceptable. No data migration
is expected because the required concepts already exist in `service_catalog`,
`product_inventory_settings`, and `kit_components`.

Use a feature flag only if this work needs to be merged before the workflow is
complete enough to replace the current screen.

## Acceptance Criteria

- Inventory -> Kits lets a user create a kit without visiting Billing -> Products.
- The kit list communicates status, pricing mode, component count, and can-build
  quantity.
- The detail view exposes BOM, pricing/margin, readiness, sales-order behavior,
  and usage links.
- Componentless kits are visibly incomplete.
- Fixed-price kits expose and validate the fixed amount.
- BOM rows show stock and cost context.
- The sales-order preview matches actual backend expansion behavior.
- Existing kit sales-order and invoice behavior does not regress.
