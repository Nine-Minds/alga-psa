# Scratchpad - Inventory Kits Command Center

- Plan slug: `2026-07-09-inventory-kits-command-center`
- Created: `2026-07-09`

## What This Is

Implementation notes for replacing Inventory -> Kits with the approved
command-center screen.

## Decisions

- 2026-07-09: Inventory -> Kits is the canonical common workflow for kit creation,
  BOM maintenance, readiness, and sales-order behavior. Billing -> Products remains
  advanced catalog administration.
- 2026-07-09: Kits remain sales-order templates that explode into components. They
  are not finished-good stock items in this implementation.

## Discoveries / Constraints

- 2026-07-09: Existing backend primitives already enforce single-level BOM and
  preserve sales-order explosion through `kitActions.ts`.
- 2026-07-09: Current `KitManager` only lists existing kits and manages component
  add/remove. It does not expose product creation, pricing, readiness, usage, or
  sales-order behavior.
- 2026-07-09: `QuickAddProduct` has most product creation logic but exposes kit
  pricing mode without a fixed-price amount field.

## Commands / Runbooks

- 2026-07-09: Check worktree with `git status --short`; unrelated local changes in
  `package-lock.json` and pseudo-locale files are pre-existing and must not be
  reverted.

## Links / References

- `docs/plans/2026-07-09-inventory-kits-command-center-design.md`
- `docs/plans/2026-06-26-inventory-module-design.md`
- `packages/inventory/src/actions/kitActions.ts`
- `packages/inventory/src/actions/productInventorySettingsActions.ts`
- `packages/inventory/src/components/KitManager.tsx`
- `packages/billing/src/components/settings/billing/QuickAddProduct.tsx`

## Open Questions

- Whether Create sales order can preselect the selected kit in the existing sales
  order creation flow.
