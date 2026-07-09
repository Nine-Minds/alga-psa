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
- 2026-07-09: Kit pricing mode owns the reusable price policy. Sum mode is derived
  from component selling prices and quantities. Fixed mode has one configured kit
  price.
- 2026-07-09: A sales-order price edit is a transaction-scoped override. It does
  not change the kit's saved pricing mode or price. This pass identifies and
  resets the override during order creation; a durable price-source audit field
  for saved lines is deferred.
- 2026-07-09: The preview accepts a positive whole-number kit quantity. The
  parent total and each component quantity use that value.
- 2026-07-09: Kit detail can open sales-order creation with the kit preselected.
  The usage link applies a tenant-scoped server filter for orders containing the
  selected kit.

## Discoveries / Constraints

- 2026-07-09: Existing backend primitives already enforce single-level BOM and
  preserve sales-order explosion through `kitActions.ts`.
- 2026-07-09: Current `KitManager` only lists existing kits and manages component
  add/remove. It does not expose product creation, pricing, readiness, usage, or
  sales-order behavior.
- 2026-07-09: `QuickAddProduct` has most product creation logic but exposes kit
  pricing mode without a fixed-price amount field.
- 2026-07-09: `KitManager` always renders `Sales-order kit price` from the kit
  catalog `default_rate`, including in sum mode. Fixed mode renders a second price
  input.
- 2026-07-09: Kit summary/detail calculate sum mode from component catalog rates,
  but silently fall back to the kit catalog rate when the sum is zero.
- 2026-07-09: Sales-order product selection seeds every line from generic
  `default_rate`. The exported `computeKitPrice()` action is not used by the
  sales-order flow, so the kit preview and actual order can disagree.
- 2026-07-09: Component selling-price data already exists in kit detail but the
  BOM renders only component cost. The calculated sum therefore cannot be audited
  from the screen.
- 2026-07-09: Kit pricing uses the kit currency. This pass does not convert kit
  prices. A sales order in another currency requires an explicit order-specific
  amount, preventing an untagged integer from being silently relabeled.
- 2026-07-09: Missing component costs and component costs in another currency
  make margin unavailable. Treating either case as zero materially overstates
  gross profit.
- 2026-07-09: The existing worktree has unrelated changes in `package-lock.json`
  and pseudo-locale files. Do not stage or revert them.
- 2026-07-09: The Alga Dev layout exposes the worktree browser as `popup-4`, but
  browser commands cannot resolve popup panes. The headed Playwright harness is
  also blocked before discovery on Node 22 because `@alga-psa/db` is required
  through an ESM graph containing top-level await. An existing Playwright test
  fails at the same import boundary.

## Commands / Runbooks

- 2026-07-09: Check worktree with `git status --short`; unrelated local changes in
  `package-lock.json` and pseudo-locale files are pre-existing and must not be
  reverted.
- 2026-07-09: `npm run typecheck` passes in `packages/inventory`.
- 2026-07-09: The server typecheck needs
  `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`; the default 4 GB heap
  exits before TypeScript completes.
- 2026-07-09: `npx vitest run src/lib/kitmisc.test.ts` passes 8 DB-backed tests.
- 2026-07-09: The focused pricing suite passes 6 tests across
  `kitPricing.test.ts`, `KitManager.pricing.test.tsx`, and
  `SalesOrdersManager.kitPricing.test.tsx`.
- 2026-07-09: The expanded rendered-component suite passes 9 tests across the
  pricing library, kit manager, and sales-order manager. It covers preview
  multiplication, empty/no-results/retry states, preselection, and usage-filter
  messaging.
- 2026-07-09: The DB-backed kit suites pass 13 tests, including all four planned
  action/read-model cases and server-side sales-order usage filtering.
- 2026-07-09: The complete inventory package suite passes 122 tests across 23
  files.
- 2026-07-09: Inventory and server TypeScript checks pass. The server check uses
  the documented 8 GB heap setting.
- 2026-07-09: A headed Playwright workflow test exists at
  `ee/server/src/__tests__/integration/inventory-kits-command-center.playwright.test.ts`.
  It remains unexecuted because the shared harness fails during test discovery.

## Links / References

- `docs/plans/2026-07-09-inventory-kits-command-center-design.md`
- `docs/plans/2026-06-26-inventory-module-design.md`
- `packages/inventory/src/actions/kitActions.ts`
- `packages/inventory/src/actions/productInventorySettingsActions.ts`
- `packages/inventory/src/components/KitManager.tsx`
- `packages/billing/src/components/settings/billing/QuickAddProduct.tsx`

## Open Questions

- Whether product settings should deep-link to the selected Billing product or
  move to a future product detail route.
