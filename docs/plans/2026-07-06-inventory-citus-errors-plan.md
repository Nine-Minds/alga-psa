# Fix production inventory errors (Citus) + tenant-facade adoption for inventory reporting

**Branch:** `fix/inventory-errors-production`
**Date:** 2026-07-06
**Status:** Approved design; ready for implementation

## Background — diagnosed root causes (verified against sebastian-blue production)

Two independent Citus (distributed Postgres) failures surfaced on the inventory pages:

### Error 1 — Write-offs report (`/msp/inventory/write-offs`)

```
complex joins are only supported when all distributed tables are co-located
and joined on their distribution columns
```

Cause: in `packages/inventory/src/actions/inventoryReportingActions.ts`, `writeOffReport`
joins `users` without the tenant distribution key — `.leftJoin('users as u', 'u.user_id',
'sm.performed_by')` at lines 403 and 443. Every other join in the file carries
`andOn('x.tenant', '=', 'sm.tenant')`. **Proven via prod `EXPLAIN`**: the identical query
with `and u.tenant = sm.tenant` plans cleanly; without it, it throws the exact production
error. These are the only two tenant-less joins in the file.

### Error 2 — Ghost-usage report (`/msp/inventory/ghost-usage`)

```
direct joins between distributed and local tables are not supported
```

Cause: `ticket_materials` is a **local (undistributed)** table in production while
`tickets`, `statuses`, etc. are distributed (colocation group 41). The ghost-usage query
(`packages/inventory/src/lib/ghostUsage.ts`, `applyMaterialPredicate`) runs a
`whereExists` correlated subquery from distributed `tickets` into local
`ticket_materials`, which Citus rejects. The table was created by
`server/migrations/20260101093000_create_ticket_project_materials.cjs` with **no
companion citus migration** in `ee/server/migrations/citus/`. Its sibling
`project_materials` (same migration) *is* distributed in prod — but only because someone
distributed it manually out-of-band; no repo migration covers either table. A fresh
environment built from migrations would have both tables undistributed.

Verified in prod: `ticket_materials` distribution readiness is clean — PK
`(tenant, ticket_material_id)`, both indexes lead with `tenant`, all four FKs include
`tenant` and reference already-distributed colo-41 tables (`tenants`, `tickets`,
`clients`, `service_catalog`), zero inbound FKs, 5 rows.

### Project-pattern decision

The repo's tenant-scoped query pattern is the `tenantDb` facade
(`packages/db/src/lib/tenantDb.ts`): `tenantDb(conn, tenant).table(...)` structurally
scopes the root query to the tenant, and `.tenantJoin(...)` **auto-appends the tenant
equality to every join** — making the Error-1 bug class impossible. Adoption happens
module-by-module in "waves", each locked in by a contract test (see
`server/src/test/unit/sharedInfrastructureTenantFacadeWave2.contract.test.ts`).

The inventory package currently has **zero** facade usage and **none** of its tables are
registered in `tenantTableMetadata`. Decision (Robert): do the **full file conversion**
of `inventoryReportingActions.ts` — this is a new module and should start on the right
foot. Package-wide conversion of the other inventory action files is out of scope
(follow-up).

---

## Task 1 — Citus migration: distribute `ticket_materials` and `project_materials`

**New file:** `ee/server/migrations/citus/20260706120000_distribute_ticket_project_materials.cjs`

Model on `ee/server/migrations/citus/20260111123000_distribute_email_processed_attachments.cjs`
(the modern minimal template), plus the recovery-mode guard from
`20250930000002_distribute_boards_table.cjs`.

Shape:

```js
/**
 * Distribute ticket_materials and project_materials on Citus (tenant distribution key).
 * Companion to server/migrations/20260101093000_create_ticket_project_materials.cjs,
 * which created both tables without distributing them. project_materials is already
 * distributed in production (done out-of-band); the guard makes it a no-op there —
 * it is included so environments rebuilt from migrations get both tables distributed.
 */
exports.config = { transaction: false };

const TABLES = ['ticket_materials', 'project_materials'];

exports.up = async function up(knex) {
  // 1. Skip when in recovery (read replica): pg_is_in_recovery()
  // 2. Skip when citus extension not installed
  // For each table in TABLES:
  //   3. Skip if !hasTable
  //   4. Skip if already in pg_dist_partition
  //   5. SELECT create_distributed_table('<table>', 'tenant', colocate_with => 'tenants')
};

exports.down = async function down(knex) {
  // Same guards; SELECT undistribute_table('<table>') for each distributed table.
  // Note: down also undistributes project_materials even though this migration's up
  // may have no-opped on it in prod — acceptable; down is symmetric and guarded.
};
```

No FK drop/recreate steps are needed (verified in prod — see Background). Direct
`create_distributed_table` succeeds when all FKs include the distribution column and
reference co-located tables, exactly as `project_materials` proves.

This task alone fixes Error 2 — no code change to `ghostUsage.ts`.

## Task 2 — Register inventory tables in the tenant-table registry

**File:** `packages/db/src/lib/tenantTableMetadata.ts`

Add, in the existing alphabetical ordering, all `{ scope: 'tenant' }`:

- `product_inventory_settings`
- `purchase_orders`
- `sales_order_lines`
- `sales_orders`
- `stock_levels`
- `stock_locations`
- `stock_movements`
- `stock_units`

(`service_catalog`, `users`, `ticket_materials` are already registered.)

## Task 3 — Convert `inventoryReportingActions.ts` to the tenant facade

**File:** `packages/inventory/src/actions/inventoryReportingActions.ts`

General rules for every action:

- `import { withTransaction, createTenantKnex, tenantDb } from '@alga-psa/db';`
- Inside the transaction: `const scopedDb = tenantDb(trx, tenant);`
- Roots: `scopedDb.table('stock_movements as sm')` — replaces `trx('stock_movements as sm')`
  **and** the manual `.where('sm.tenant', tenant)` / `.where({ tenant })` (the facade
  scopes the root; the contract test forbids manual tenant-wheres).
- Joins: `scopedDb.tenantJoin(builder, 'service_catalog as sc', 'sc.service_id',
  'sm.service_id', { type: 'left' })` — replaces the function-form joins with manual
  `andOn(tenant)`. `tenantJoin` infers the root tenant column from the column qualifiers.
- Non-tenant filters (`track_stock`, `status`, date ranges…) stay as-is.

Per action:

1. **`getAccountingInventoryAlignment`** — root `product_inventory_settings as pis`
   (facade adds `pis.tenant` scope); inner `tenantJoin` to `service_catalog as sc` on
   `sc.service_id = pis.service_id`; keep `.where({ 'pis.track_stock': true })`.

2. **`inventoryValueReport`** — three queries:
   - root `stock_levels as sl` + `tenantJoin` `product_inventory_settings as pis`
     (inner) on `pis.service_id = sl.service_id`; keep `is_serialized`/quantity filters
     (note: `'pis.is_serialized': false` moves from the combined `where({...})` into its
     own `.where(...)` since the tenant key drops out).
   - root `stock_units` with `.where({ status: 'in_stock' })` (tenant key dropped).
   - root `stock_locations` (tenant where dropped).

3. **`marginReport`** — root `stock_movements as sm`; the `LEFT JOIN LATERAL
   (sales_order_lines…)` **stays as `joinRaw`** with a comment: the facade cannot
   express LATERAL joins, and the raw SQL already carries `sol.tenant = sm.tenant`.
   `service_catalog` left join → `tenantJoin`. Keep remaining filters minus tenant key.

4. **`expiringWarrantyReport`** — root `stock_units as su`; `tenantJoin`
   `service_catalog as sc` (left).

5. **`openPosWidget` / `openSosWidget`** — roots `purchase_orders` / `sales_orders` via
   facade; drop tenant from the `where`.

6. **`writeOffReport`** — the production bug fix:
   - `base()` root via facade; `stock_units as su` and `product_inventory_settings as
     pis` joins → `tenantJoin` (left).
   - `service_catalog as sc` join → `tenantJoin` (left).
   - **Location join redesign:** replace the single join on
     `loc.location_id = COALESCE(sm.from_location_id, sm.to_location_id)` (inexpressible
     through `tenantJoin`'s column-pair API) with **two left tenantJoins**:
     `stock_locations as floc` on `floc.location_id = sm.from_location_id` and
     `stock_locations as tloc` on `tloc.location_id = sm.to_location_id`; select
     `COALESCE(floc.name, tloc.name) as location_name`. Equivalent output: location FKs
     are enforced, so a non-null `from_location_id` always resolves to a row.
   - **Users joins (both sites):**
     `scopedDb.tenantJoin(q, 'users as u', 'u.user_id', 'sm.performed_by', { type: 'left' })`
     — emits `u.tenant = sm.tenant`, which is the proven fix for the prod error.
   - Replace the inlined permission check with the shared `requireInvRead(user)`.
   - `agg` `groupBy`/selects unchanged.

## Task 4 — Contract + unit tests

1. **Contract test** (wave pattern):
   `server/src/test/unit/inventoryReportingTenantFacade.contract.test.ts`, modeled on
   `sharedInfrastructureTenantFacadeWave2.contract.test.ts`. For
   `packages/inventory/src/actions/inventoryReportingActions.ts` assert:
   - source contains `tenantDb`;
   - no direct roots on: `product_inventory_settings`, `purchase_orders`,
     `sales_order_lines`, `sales_orders`, `stock_levels`, `stock_locations`,
     `stock_movements`, `stock_units`, `service_catalog`, `users`
     (the `\b(?:knex|knexOrTrx|trx|db)\s*\(\s*['`]…` pattern from the wave test);
   - no manual tenant-wheres (`.where({ tenant`, `.where('x.tenant', tenant)` patterns
     from the wave test);
   - no 3-arg users join: source does not match `leftJoin\('users as u', 'u\.user_id'`.

2. **SQL-shape unit test** (colocated, compile-only — no DB):
   `packages/inventory/src/actions/inventoryReportingActions.test.ts` (or extend if the
   Draft agent finds an existing suitable home). Using `knex({ client: 'pg' })` and
   `tenantDb`, build the write-off users-join shape and assert `.toSQL().sql` contains
   `"u"."tenant" = "sm"."tenant"` — proving the facade emits the distribution-key
   equality for this exact join (including the inference path, since no
   `rootTenantColumn` is passed).

## Task 5 — Verification

Local (dev server on port 3002, wired to `alga-psa-local-test` infra):

1. `npm run build` / typecheck for `packages/db` and `packages/inventory` + server.
2. Run the new contract test + SQL-shape test + existing inventory package tests.
3. Smoke `/msp/inventory/write-offs` and `/msp/inventory/ghost-usage` — pages render
   (local DB is plain Postgres, so this validates behavior, not Citus pushdown).
4. Run the new citus migration against a non-Citus DB to confirm it no-ops cleanly.

Production, post-deploy:

1. Migration ran: `select * from citus_tables where table_name::text in
   ('ticket_materials','project_materials')` → both `distributed`, colocation 41.
2. Reload both pages in sebastian-blue as the triggering user; confirm no
   `Failed to load write-off report` / ghost-usage errors in blue pod logs.
3. Optional belt-and-braces: prod `EXPLAIN` of the converted write-off SQL shape.

## Out of scope / follow-ups

- Converting the remaining inventory action files (~26) to the facade — follow-up wave;
  drop a `// LEVERAGE: friction tenant-facade — rest of inventory package still on raw
  knex joins` marker in one representative file if convenient.
- The unrelated `Failed to find Server Action …` log noise (deploy skew) and the
  `NotFoundError` API entries seen during diagnosis.

## Evidence appendix (from diagnosis session, 2026-07-06)

- Blue pods `sebastian-blue-57d6dd758b-{fhsrz,kzjsk}`; both errors reproduced in
  `kubectl logs -c sebastian`.
- `citus_tables`: all involved tables distributed on `tenant`, colo 41 — **except
  `ticket_materials`, absent (local)**.
- Prod `EXPLAIN` probes: users join without tenant ⇒ exact Error 1; with tenant ⇒ OK.
  `COALESCE` location join in isolation ⇒ OK (not the culprit).
  `whereExists` tickets→ticket_materials ⇒ exact Error 2; local-driven joins
  (`ticket_materials ⋈ service_catalog`) plan fine, so ticket-detail material reads are
  unaffected.
