# Scratchpad — Inventory Review Remediation & Sell-Side Completion

Rolling working memory. Newest notes at the bottom of each section.

## Origin

This plan converts the 2026-07-01 three-lens review of the inventory module (business flows,
stock engine, schema — three parallel review agents + manual spot-verification) into a
remediation + completion plan. Parent plans:

- `ee/docs/plans/2026-06-26-inventory-module/` (F001–F155, shipped)
- `ee/docs/plans/2026-06-26-sales-order-documents/` (44 features, shipped)
- Design doc: `docs/plans/2026-06-26-inventory-module-design.md`

## Key review evidence (verified file:line — re-verify before fixing, code moves)

### Sell-side is dark (headline)
- `fulfillSalesOrderLine` (packages/inventory/src/actions/fulfillmentActions.ts),
  `generateInvoiceForSalesOrder` (packages/billing/src/actions/salesOrderInvoicingActions.ts:21),
  `confirmDropShipShipment`/`createDropShipForSoLine` (dropShipActions.ts),
  `suggestPoFromBackorder`/`computeBackorder` (salesOrderActions.ts) — **zero callers** outside
  tests (grep-verified twice). SalesOrdersManager.tsx wires only create + confirm + documents.
- `invoice_mode='on_fulfillment'` is stored but has no behavior. The dependency direction is
  billing → inventory (see comment salesOrderInvoicingActions.ts:9-13), so the fulfill+invoice
  composition must live in **billing** (or server), never inventory calling billing.

### Concurrency (no locks anywhere)
- `withTransaction` → `knex.transaction()` with no isolation option (packages/db/src/lib/tenant.ts:179)
  → READ COMMITTED. **No `forUpdate` in packages/inventory at all.**
- Double-confirm doubles `reserved_quantity` (salesOrderActions.ts:427-451 guard is unlocked read).
- Double-fulfill: blind `quantity_fulfilled + ?` add, no cap (fulfillmentActions.ts:334-340);
  same serialized unit deliverable twice; two assets per serial possible.
- Transfer double-receive fabricates stock (transferActions.ts:127-160).
- Unit allocation race: `stock_units ... WHERE status='in_stock' LIMIT n` then UPDATE by PK —
  second writer silently overwrites `allocated_so_line_id` (salesOrderActions.ts:114-132).
- `stock_movements` has NO unique/idempotency key on source doc (only plain index). Decision
  below: rely on header row locks, not a movement unique key.

### Allocation math
- `allocateLine` reserves full `remaining` regardless of on-hand (salesOrderActions.ts:139) →
  available goes negative → `suggestPoFromBackorder` over-orders (10 ordered, 3 on hand →
  suggests 17). Fix: reserve `min(available, remaining)`.
- `applyAllocationDelta` floors at 0 via `GREATEST(0, ...)` (lib/levels.ts:82-87) — masks drift.
- `reconcile.ts` deliberately skips reserved/held and is invoked only from engine.test.ts —
  no production repair path exists today.
- Serialized hard-fulfill decrements `held_quantity` that allocation never incremented
  (fulfillmentActions.ts:279-281) — dead accounting, floor-masked.

### RMA
- Standard track dead-ends: `resolveReplacement` → status `'replaced'`, but `deployReplacement`
  asserts `'replacement_received'` (rmaActions.ts:419) which only advance-replacement produces.
  Client asset stays linked to the dead unit.
- `'dead_unit_returned'` status is unreachable (recordDeadUnitReturned goes straight to closed,
  rmaActions.ts:524-528).
- `chargeForUnreturned` (rmaActions.ts:534-544) flips status only — bills nothing.

### Currency
- `receivePoLine` checks line-vs-PO currency but NOT vs the product's existing
  `average_cost`/`cost_currency` → cross-currency moving-average blend
  (purchaseOrderActions.ts:377-379, 457-483). `receiveStockManual` DOES guard this
  (stockLedgerActions.ts:106-110) — copy that guard.
- `createPoFromLowStock` hardcodes header `currency_code: 'USD'` (reorderActions.ts:191) while
  lines use product currency → non-USD PO can never be received (guard throws).

### Controls
- `assertLocationWritable` (lib/scope.ts) called ONLY from `adjustStock`
  (stockLedgerActions.ts:245). Missing from receiveStockManual, retireStock, dispatchTransfer,
  fulfillSalesOrderLine, loanOut/restock.
- Low-stock routing resolution exists (reorderActions.ts, F134 of parent plan) but nothing
  dispatches notifications — no job, no send.

### Materials path
- `lib/consume.ts` (`recordStockConsumption`) does NOT honor `creates_asset_on_delivery`
  (grep: no reference). Ticket/project installs of serialized units create no asset. The SO
  fulfill + drop-ship paths DO (fulfillmentActions.ts:285, dropShipActions.ts:288).
- Asset creation escapes the fulfillment transaction: `createAsset` commits independently
  (comment fulfillmentActions.ts:139) → orphan assets on multi-unit rollback.

### Schema
- No CHECK >= 0 on stock_levels reserved/held; no positive-qty CHECKs on order/transfer lines;
  no fulfilled<=ordered CHECK. NOTE: `quantity_on_hand` may go negative BY DESIGN (soft consume,
  design decision #8) — do NOT constrain it. Document in migration.
- `sales_order_lines.tax_rate_id` bare uuid, no FK; tax also dropped by the invoice bridge
  (salesOrderInvoicingActions.ts:51-56 maps only service/qty/desc/rate).
- No SO-line ↔ invoice_item backlink (reconciliation by inference).
- Missing indexes: stock_levels (tenant, location_id) — location_id is PK 3rd col, not a
  left-prefix; sales_orders (tenant, client_id)/(tenant,status); purchase_orders
  (tenant, vendor_id)/(tenant,status).
- Soft links never got FKs after table-creation ordering excuse expired:
  stock_units.allocated_so_line_id, stock_units.source_po_id,
  purchase_order_lines.source_so_line_id, sales_order_lines.parent_so_line_id.
- `stock_movements` "immutable" only by discipline — no trigger/REVOKE.
- Positive serialized adjustments fabricate `ADJ-<timestamp>-i` serials
  (stockLedgerActions.ts:288-299) → pollutes serial search/advisory lookup.
- Inventory migrations skip the Citus `create_distributed_table` + `transaction:false` pattern
  used by 2026 siblings (asset_facts, accounting_sync). Flagged as OPEN QUESTION, not a feature.

### What's sound (don't re-fix)
- Single-default-location partial unique index is race-safe.
- `applyOnHandDelta` is an atomic SQL add; `ensureStockLevel` onConflict-ignore.
- Permission checks present on every exported action; tenant scoping on joins correct.
- `recordStockMovement` single chokepoint; serialized on-hand recomputed from unit counts.
- `quantity_invoiced` already LEAST-capped and idempotent at the action layer.
- Ticket/project materials → stock + COGS + invoice is fully wired end-to-end.
- PO lifecycle (partial receipt, over-receipt flag, cancel-after-receipt block) solid.
- F084 foreign_hard_hold guard genuinely prevents hard-hold poaching.

## Decisions

- **D1**: Fulfill+invoice composition action lives in `packages/billing`
  (`fulfillAndInvoiceSoLine`), calling inventory's fulfill then `generateInvoiceForSalesOrder`
  when `invoice_mode='on_fulfillment'`. UI calls the billing action. Keeps dependency direction.
- **D2**: Concurrency strategy = `SELECT ... FOR UPDATE` on the document header row as the
  transition mutex + SQL-capped counter updates + `FOR UPDATE SKIP LOCKED` on unit picks.
  A blanket unique key on stock_movements(source_doc) was **considered and rejected** —
  legitimate repeats exist (two partial receipts of one PO line).
- **D3**: `quantity_on_hand` stays unconstrained (soft-consume is a design decision);
  reserved/held/order-line quantities get CHECKs, with a pre-clamp repair in the migration.
- **D4**: SO "reopen to draft" allowed only when quantity_fulfilled = quantity_invoiced = 0 on
  every line. Post-fulfillment edits stay out of scope (cancel remains the escape hatch).
- **D5**: RMA `'dead_unit_returned'` gets REMOVED from the status CHECK (unreachable) rather
  than wired; `dead_unit_returned_at` timestamp stays as the record.
- **D6**: `chargeForUnreturned` creates a **draft** manual invoice (line = replacement product
  at list price, editable before send) and stores the invoice ref on the case. No auto-send.
- **D7**: Cycle counts are blind (expected hidden from counters), variance visible to approvers,
  approval writes ordinary `adjust` movements with reason `'cycle_count'` — the ledger stays
  the single source of truth, no parallel adjustment pathway.
- **D8**: Landed cost is applied at the PO level across *received* quantities, idempotent via
  an `applied` flag; adjusts moving average via a cost-only path and serialized `unit_cost` of
  units from that PO. Costs-known-late is the normal case, so entry+apply is decoupled from receipt.
- **D9**: Vendor bills are a light AP record (draft/open/paid/void, manual mark-paid, 2-way
  variance indicator vs receipts). No GL, no payment rails, no 3-way match. Deliberate.
- **D10**: Client-owned/consignment stock, bins, barcode, multi-level BOM, full per-warehouse
  RBAC stay deferred (unchanged from parent design non-goals).

## Implementation notes (added 2026-07-01 while building)

- **D11 — per-line reservation attribution.** F024's min(available, remaining) made the
  old "release outstanding" wrong (it would drain OTHER orders' reservations), so
  `sales_order_lines` gained `quantity_reserved` + `reserved_location_id`
  (20260701090000). Allocation writes them; release/fulfill drain exactly them;
  backorder math adds them back; reconcile recomputes counters from them
  (open SOs = confirmed/partially_fulfilled). Serialized lines keep 0 — their claim
  is `stock_units.allocated_so_line_id`.
- **D12 — billing actions ride in as props.** Inventory components can't import
  billing (dependency direction), so the sales-orders page passes
  `fulfillAndInvoiceSoLine` / `generateInvoiceForSalesOrder` server-action references
  as props into `SalesOrdersManager` → `SalesOrderDetail`. Same pattern available for
  the RMA charge (`chargeRmaForUnreturned` in billing) when its UI is built.
- **D13 — invoice_items is a VIEW.** The SO backlink column lives on the base table
  `invoice_charges` (`so_line_id`), populated by `persistManualInvoiceCharges` via a
  new `ManualInvoiceItemInput.so_line_id`. Per-line tax rides the same path:
  `tax_rate_id` on the item input overrides the service default when deriving
  tax_region at insert.
- **D14 — lock order convention.** SO header → PO header → lines, everywhere
  (fulfill, drop-ship confirm, receive). RMA locks in loadRma (every caller is a
  transition). `loadTrackedSettings` locks product_inventory_settings because
  moving-average updates are read-modify-write.
- **D15 — landed-cost audit line.** Application writes a quantity-0 'adjust' movement
  (no on-hand effect, survives reconcile replay) carrying the allocated cents, since
  the ledger is now UPDATE/DELETE-protected by trigger.
- **F051 UI note.** There is no manual-adjustment screen anywhere (pre-existing);
  the found-serial entry UI lives in the cycle-count disposition flow (F066), which
  is the realistic path found units actually take.
- **RMA later-stage transitions still have no UI** (resolve*/deploy/markDeadUnitOwed/
  charge) — pre-existing gap, out of plan scope; actions are complete. Proposal for
  a follow-up plan.
- **Test harness gap (T-flags).** All existing tests are lib-level with direct DB
  transactions; there is NO auth/session harness for calling withAuth actions from
  vitest. remediation.test.ts therefore covers the DB-enforceable tests
  (T008/T014/T019/T023/T024 marked implemented) plus the locking/cap SQL mechanics
  of T002/T003 and the math invariant of T032. The remaining plan tests need an
  action-level harness (mock session injection) — genuine infra work, listed as the
  top follow-up.
- **Test port fix.** devstack maps postgres to 5432 (5472 was stale in every test
  file — they could not have run in this environment). All test files now use 5432.
- **Seed-independence.** The demo seed (session earlier) put stock on the default
  location and assigned Dorothy to Main Warehouse, which broke three tests that
  assumed a pristine baseline. Service selection in the DB tests now skips services
  carrying stock, and T037 creates its own unassigned warehouse fixture.
- **Migrations applied to dev** (batches 3–10): address, integrity checks, low-stock
  notification template, schema hardening, vendor_products, cycle counts, landed
  costs, vendor bills. Admin creds came from server/.env.local (DB_USER_ADMIN@5432)
  — the scratchpad's earlier "cannot apply DDL" blocker is RESOLVED.

## Gotchas / constraints

- `'use server'` files may export ONLY async functions — no const/object exports (bit us in
  the SO-documents work; Turbopack's cache for this error is sticky).
- Existing DB-backed test harness: packages/inventory/src/lib/*.test.ts run real queries
  against the migrated dev DB — follow that pattern for the new integration tests.
- knex migrations need `disableMigrationsListValidation: true` on this dev DB (EE records in
  knex_migrations not present in server/migrations).
- Dev DB: app_user cannot run DDL on inventory tables (owner is postgres). The
  2026-06-30 address migration is STILL UNAPPLIED on dev for this reason;
  `addressColumnsAvailable()` guard tolerates it. New migrations here hit the same wall —
  coordinate admin creds before implementation starts.
- Local branch is 1 commit ahead of origin (`bce7ff4580`) as of plan creation.
- Citus question: if target clusters run Citus, new tables (and the existing 15) need
  `create_distributed_table` alignment — check with Robert before adding FKs to distributed
  parents (stock_units → assets is the risky one).

## Commands

- Typecheck: `npx tsc --noEmit -p server` (and per-package as configured)
- Inventory tests: `npx vitest run --dir packages/inventory` (DB-backed; needs dev DB up)
- Migration up (dev, admin creds required):
  `DB_PASSWORD_ADMIN='<pw>' node <scratch>/apply_addr_migration.cjs` pattern — adapt per migration
- Leverage markers: `grep -rn "LEVERAGE:" packages/inventory`
