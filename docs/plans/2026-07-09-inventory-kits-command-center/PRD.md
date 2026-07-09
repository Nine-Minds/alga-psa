# PRD - Inventory Kits Command Center

- Slug: `2026-07-09-inventory-kits-command-center`
- Date: `2026-07-09`
- Status: Implemented; headed browser smoke remains blocked by the local test harness
- Design: `../2026-07-09-inventory-kits-command-center-design.md`

## Summary

Replace the thin Inventory -> Kits BOM editor with an operational kit workspace.
The screen should let MSP operators create kit products, maintain the bill of
materials, see price/margin and stock readiness, and understand sales-order
expansion before selling the kit.

## Problem

The current Kits screen only lists existing kit products and manages components.
It does not show how to create a kit, whether the kit is valid, whether stock can
support it, how pricing works, or what happens when the kit is added to a sales
order. Operators are forced to discover Billing -> Products and learn hidden
backend behavior by trial and error.

The first command-center implementation also exposed an editable sales-order kit
price while `Sum of components` was selected. That amount competes with the
component-derived price and can disagree with the price placed on a sales order.
The screen must make the kit pricing policy singular and predictable.

## Goals

- Make Inventory -> Kits the canonical surface for common kit lifecycle work.
- Support creating a kit directly from the Kits screen.
- Show a searchable/filterable kit list with status, SKU, pricing mode, can-build
  quantity, component count, and actions.
- Show selected kit identity, BOM, pricing/margin, stock readiness,
  sales-order behavior, and usage links.
- Use operator copy: bill of materials, qty per kit, can build, used on sales
  orders, create sales order.
- Make loading, empty, no-results, error, duplicate-component, and invalid-pricing
  states explicit.
- Make sum pricing read-only and derived from component selling prices.
- Make fixed pricing use one editable kit price.
- Use the same price resolver for the kit preview and sales-order defaults.
- Preserve order-specific price negotiation as an explicit sales-order override
  that does not change kit configuration.

## Non-goals

- Nested kits.
- Finished-good assembly or stock held under the kit SKU.
- Quote/template integration.
- Barcode or scanning workflows.
- Rewriting invoice generation beyond preserving existing kit explosion
  semantics.
- Removing unit-price overrides from sales orders.
- Persisting a new historical price-source audit record for saved sales-order
  lines in this pass.
- Converting kit prices between currencies. A cross-currency sales order requires
  an explicit order-specific price.
- Replacing Billing -> Products as the advanced catalog admin screen.

## Users and Primary Flows

- MSP owner or operations manager creates a standard install bundle and proves it
  can be sold and fulfilled.
- Service coordinator updates BOM quantities and checks whether enough component
  stock exists for upcoming work.
- Billing/admin user confirms pricing mode and margin before sales order use.

Primary flow:

1. Open Inventory -> Kits.
2. Create or select a kit.
3. Add BOM components and quantities.
4. Confirm pricing/margin and stock readiness.
5. Preview sales-order expansion.
6. Create or inspect related sales orders. The sales order starts with the
   resolved kit price and may record a one-order override.

## UX / UI Notes

- Header: `Inventory kits`, summary counts, `Create kit`.
- List: search plus status filter, with row status, SKU, pricing mode, can-build
  quantity, component count, and action.
- Detail: product identity, bill of materials, pricing/margin, stock readiness,
  sales-order behavior, and usage links.
- Component load failures render inline retry, not only a toast.
- Empty BOM is a warning state.
- Duplicate component add reads as update quantity.
- Fixed-price kits require a valid fixed price.
- Sum-priced kits show `Calculated kit price` as read-only, with component
  selling prices identified as the basis.
- Fixed-priced kits show exactly one editable `Kit price` field.
- The create dialog asks for a price only when fixed pricing is selected.
- BOM rows show the component selling price and extended selling price used by
  sum mode.
- Pricing separates component cost, gross profit, and gross margin rather than
  combining the latter two under one label.
- Margin is unavailable when a component cost is missing or is not in the kit
  currency; the UI explains what must be corrected.
- `Save pricing` is enabled only when the pricing policy has unsaved changes.
- The create dialog does not ask for a separate kit cost because margin is based
  on component cost.
- A changed kit price on a sales order reads `Overridden from {{price}}` and can
  be reset to the resolved kit price before save.
- The sales-order preview accepts a positive whole-number kit quantity and
  multiplies the parent total and every child quantity.
- `Create sales order` opens the existing create flow with the selected kit
  preselected. `View sales orders` shows only orders containing that kit.

## Requirements

### Functional Requirements

- Create a product-backed kit from Inventory -> Kits.
- List kit summaries with derived status and buildability.
- Load kit detail with BOM, component stock/cost context, pricing/margin, and
  usage metadata.
- Add/update/remove BOM components.
- Validate positive integer component quantities.
- Validate fixed-price kit configuration.
- Resolve sum pricing from BOM component selling prices and quantities without a
  kit catalog-rate fallback.
- Resolve fixed pricing from the configured fixed kit price.
- Seed sales-order kit lines from the canonical resolver and distinguish an
  explicit order override from the resolved default.
- Reject an untouched kit default when the sales-order currency differs from the
  kit currency; accept a deliberate order-specific amount instead.
- Keep component selling-price basis separate from component cost and margin.
- Map known server errors to user-facing explanations.
- Link to advanced product settings and sales-order surfaces.
- Filter sales-order usage on the server by the selected kit service ID.

### Non-functional Requirements

- Preserve tenant-scoped database access patterns.
- Keep the existing single-level BOM model.
- Avoid raw hex and gray utility palettes in new UI code.
- Keep screen density consistent with Alga PSA product surfaces.

## Data / API / Integrations

New or expanded inventory actions:

- `listKitSummaries()`
- `getKitDetail(kitServiceId)`
- `createKitProduct(input)`
- `updateKitProduct(input)`
- A transaction-safe canonical kit price resolver shared by kit reads and
  sales-order mutations.

Existing behavior to preserve:

- Kits are `service_catalog` products with
  `product_inventory_settings.is_kit=true`.
- BOM rows live in `kit_components`.
- Sales-order explosion creates one priced parent line and zero-dollar child
  component lines.
- Child lines allocate and fulfill stock.
- The parent line uses the resolved kit price unless the sales order explicitly
  submits an override.

## Security / Permissions

- Read operations require `inventory:read`.
- Kit creation requires inventory create permission and whatever catalog create
  permission the existing product creation path requires.
- BOM and kit settings mutations require `inventory:update`.

## Rollout / Migration

No migration is expected. The required database concepts already exist. Use a
feature flag only if the replacement cannot ship complete enough to supersede
the current screen.

## Open Questions

- Whether the product settings link should open Billing -> Products filtered to
  the product or a future product detail route.

## Acceptance Criteria (Definition of Done)

- Inventory -> Kits lets a user create a kit without visiting Billing -> Products.
- The kit list communicates status, SKU, pricing mode, component count, and
  can-build quantity.
- The selected kit detail exposes BOM, pricing/margin, readiness,
  sales-order behavior, and usage links.
- Componentless kits are visibly incomplete.
- Fixed-price kits expose and validate fixed amount.
- Sum-priced kits expose a read-only calculated amount and no independent kit
  price input.
- Fixed-priced kits expose exactly one editable price.
- The create flow does not require a price for sum mode.
- Kit preview and sales-order default price agree because both use the canonical
  resolver.
- A sales-order override is visibly identified, resettable before save, and does
  not mutate the kit's saved pricing policy.
- Missing or mixed-currency component costs never render as zero-cost margin.
- BOM rows show stock and cost context.
- The sales-order preview matches backend expansion behavior.
- The sales-order preview multiplies parent totals and component quantities for
  a user-entered kit quantity.
- Kit detail can start a sales order with that kit preselected and inspect a
  server-filtered list of orders using it.
- Existing kit sales-order and invoice behavior does not regress.
