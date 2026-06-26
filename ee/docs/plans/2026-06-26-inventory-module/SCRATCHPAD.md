# SCRATCHPAD — Inventory Module

Working memory for the inventory-module build. Append continuously.

## Source of truth
- **Design doc:** `docs/plans/2026-06-26-inventory-module-design.md` (committed `f0fb7f71ea`). Authoritative for scope, data model, flows, decisions (1–18), and the hostile-review change log (§12).
- This plan = PRD.md + features.json + tests.json + this scratchpad. PRD is the scope authority; flip `implemented` as features ship.

## Key decisions (condensed — see design doc §3)
- Stock-and-hold ledger; **no enterprise logistics**.
- Architecture **A**: new `packages/inventory/` domain referencing `service_catalog` via a 1:1 `product_inventory_settings` opt-in row. Catalog stays the product master; billing untouched.
- Quantity ledger + per-product `is_serialized`; serialized units carry **serial + MAC + warranty** and are the asset/RMA bridge.
- `stock_movements` is the **only source of truth**; `stock_levels` + `stock_units.status` are reconcilable caches updated in the same txn.
- Soft-warn on consume (never hard-block); **except** a hard-held unit can't be poached.
- Moving-average cost + COGS/margin reporting; **no GL dual-write**.
- Sales orders in scope (soft allocation default, optional hard-hold); invoicing both/configurable over a shared `quantity_invoiced` counter.
- Folded from review: MAC, warranty, loaners, restock returns, per-location alert routing, location-scoped perms, advance-replacement RMA + dead-unit clock, kitting templates, drop-ship, in-transit transfers.

## Integration seams (real paths — from repo scout)
- **Catalog / product fields:** `service_catalog` (init: `server/migrations/202409071803_initial_schema.cjs`; product fields: `20260101090000_add_products_fields_to_service_catalog.cjs`). IService: `packages/types/src/interfaces/billing.interfaces.ts`.
- **Prices:** `service_prices` (`20251205130000_add_service_prices_table.cjs`), `service_catalog_mode_defaults` (`20260321110000_create_service_catalog_mode_defaults.cjs`).
- **Materials (consume seam):** `ticket_materials`/`project_materials` (`20260101093000_create_ticket_project_materials.cjs`); actions `packages/billing/src/actions/materialActions.ts`; invoice path `packages/billing/src/actions/invoiceGeneration.ts`. Materials auto-bill (no approval gate).
- **Assets (linkage seam):** `assets` (`20241112031330_create_asset_management_tables.cjs`); interface `packages/types/src/interfaces/asset.interfaces.ts`; actions `packages/assets/src/actions/assetActions.ts` — **uses `@alga-psa/authorization/kernel` (ABAC)**, not simple `hasPermission`. Call `createAsset` from delivery flow (don't raw-insert).
- **Contracts:** `contract_line_service_configuration.quantity` (`20251008000001_rename_billing_to_contracts.cjs`); `EditContractLineServiceQuantityDialog` in `packages/billing/src/components/billing-dashboard/...`.
- **Vendor today:** freeform `IService.vendor` text — no vendor table exists (`vendor_email_config` is unrelated/email).
- **Accounting:** Xero `packages/integrations/src/lib/xero/xeroClientService.ts` reads `IsTrackedAsInventory` (one-way, read-only). QBO `qboClientService.ts`. No COGS/GL posting anywhere.
- **Permissions pattern:** `server/migrations/20251022000000_add_service_and_storage_permissions.cjs` — insert `{resource, action, msp, client}` rows into `permissions`, assign to admin role via `role_permissions`. Materials use `hasPermission(user,'billing','create'|...)`.

## Conventions
- Migrations: `server/migrations/`, `.cjs`, `YYYYMMDDHHMM_name.cjs`, `exports.up/down`, composite PKs `tenant`-first, money = `bigint` cents, `exports.config = { transaction:false }` for big ones.
- Server actions: `packages/{feature}/src/actions/{Entity}Actions.ts`, `'use server'`, `withAuth` + `hasPermission`, `createTenantKnex` + `withTransaction`.
- Types: `packages/types/src/interfaces/{entity}.interfaces.ts`.
- Components: `packages/{feature}/src/components/{feature}/...`.
- Mirror the two-parallel-table multi-table migration pattern of `20260101093000_create_ticket_project_materials.cjs`.

## Test strategy (Pareto 80/20 — per standard)
- Concentrate tests on the high-risk 20%: **ledger integrity & reconciliation, allocation/consume correctness, RMA + advance-replacement state transitions, kitting explosion, drop-ship (no on-hand touch), invoicing idempotency (no double-bill), location-scoped permissions, contract-no-consume**.
- DB-backed integration over migrated schema for all money/stock-mutating paths (see `integration-testing` skill). Skip exhaustive CRUD-path tests.
- Target ~45 tests vs ~155 features.

## Open questions (resolve during build; defaults noted)
1. **EE vs CE gating?** Plan lives in `ee/docs/plans` but the module is core PSA functionality. **Default: ship in CE (community)**; confirm with Robert. Does it need a feature flag for staged rollout? (Not adding flags unless asked.)
2. **PO/SO number sequences** — is there an existing per-tenant sequence/number generator (like invoice numbering) to reuse? Find before building `po_number`/`so_number`.
3. **Tax on SO lines** — reuse `tax_rate_id` from product; confirm invoice tax calc path is the same the billing engine already uses.
4. **Currency rules** — enforce single currency per PO/SO; product cost vs sale currency mismatches → guard or convert? (Default: guard, no conversion.)
5. **Who can override a negative-stock soft-warn** — any consumer, or a permissioned override? (Default: warn-only, anyone; no override gate in V1.)
6. **Client-portal exposure** — confirm inventory is MSP-only (no client-portal surface). Default: MSP-only.
7. **Kit pricing** — kit price = sum of components vs independent kit price? (F108 — define.)

## Gotchas
- `assets` uses ABAC kernel — don't bypass with raw inserts; delivery flow must go through `createAsset`.
- MAC is globally unique → uniqueness must be **tenant-wide**, NOT `(tenant, service_id)` like serial.
- Returned/in-RMA/in-transit/on-loan units must be EXCLUDED from `quantity_on_hand` — easy to get wrong; covered by T007.
- Materials already auto-bill; the stock hook must be idempotent on retry (T014/T152) and must reverse on unbilled-material delete.
- Recurring contract billing must NOT decrement stock (T045) — stock is event-driven only.


## Wave 1 (action layer) — risks to verify under test (DB-backed, wave 3)
- **createAsset transaction boundary**: fulfillment/dropship call the `@alga-psa/assets` `createAsset` server action from INSIDE the inventory txn; it runs in its OWN txn, so an inventory rollback may leave an orphan asset. Revisit when testing asset linkage (T015/T016) — may need a trx-aware createAsset or compensating delete.
- **Non-serialized allocation location attribution**: SO allocation doesn't persist which location it drew from; release drains reserved/held largest-first. Net counter correct (clamped at 0) but per-location attribution can drift under concurrency. Verify T009.
- **Placeholder serials for "found" serialized adjustments** (`ADJ-<ts>-<i>`): uniqueness only checked at receive; low collision risk. Revisit if adjust-found is exercised.
- **createAsset import path inconsistency**: fulfillment imports from `@alga-psa/assets/actions`, dropship from `@alga-psa/assets` — both typecheck; normalize later.
- Whole wave is **typecheck-clean but behaviorally unverified** (no DB run yet). Wave 3 (45 pareto tests on the test-DB bootstrap) is the behavioral gate.
