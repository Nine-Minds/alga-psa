# PRD - Inventory Kits Command Center

- Slug: `2026-07-09-inventory-kits-command-center`
- Date: `2026-07-09`
- Status: Approved for implementation
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

## Non-goals

- Nested kits.
- Finished-good assembly or stock held under the kit SKU.
- Quote/template integration.
- Barcode or scanning workflows.
- Rewriting sales-order or invoice generation behavior beyond preserving existing
  kit explosion semantics.
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
6. Create or inspect related sales orders.

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

## Requirements

### Functional Requirements

- Create a product-backed kit from Inventory -> Kits.
- List kit summaries with derived status and buildability.
- Load kit detail with BOM, component stock/cost context, pricing/margin, and
  usage metadata.
- Add/update/remove BOM components.
- Validate positive integer component quantities.
- Validate fixed-price kit configuration.
- Map known server errors to user-facing explanations.
- Link to advanced product settings and sales-order surfaces.

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

Existing behavior to preserve:

- Kits are `service_catalog` products with
  `product_inventory_settings.is_kit=true`.
- BOM rows live in `kit_components`.
- Sales-order explosion creates one priced parent line and zero-dollar child
  component lines.
- Child lines allocate and fulfill stock.

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

- Whether `Create sales order` can preselect the kit immediately, or should link
  to the existing create-sales-order flow in this pass.
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
- BOM rows show stock and cost context.
- The sales-order preview matches backend expansion behavior.
- Existing kit sales-order and invoice behavior does not regress.
