# PRD — Inventory Module

**Status:** Draft for review
**Owner:** Robert Isaacs
**Created:** 2026-06-26
**Plan slug:** 2026-06-26-inventory-module
**Design doc (authoritative):** `docs/plans/2026-06-26-inventory-module-design.md` (commit `f0fb7f71ea`)

> This PRD is the scope authority for the build. The design doc holds the full data-model/flow detail; this PRD references it by section (e.g. *design §6.G*) rather than restating every column.

---

## 1. Problem statement & user value

Alga PSA has a **product catalog but no inventory system**. Products are a subset of `service_catalog` (`item_kind='product'`) with pricing/cost/tax/license metadata only. Quantities live on consuming entities (contract lines, invoice items, ticket/project materials) and record what was *billed/consumed* — never decremented from an on-hand ledger. There is no stock, location, serial/lot, movement, allocation, reorder, procurement, or COGS concept anywhere.

Our ICP is reseller-heavy, including **phone-systems specialists** who warehouse serialized handsets and switches across multiple locations, sell systems as bundles, run heavy advance-replacement RMA cycles, and stock laptops/monitors/components for clients. They cannot run their business on a catalog — today they bolt spreadsheets onto the PSA for MAC lists, dead-units-owed tracking, and system-deal BOMs.

**User value:** a first-class, stock-and-hold inventory module that answers "what do we have, where, is it enough, what did it cost, who has it, and is it under warranty" — and ties hardware sales, deployments, RMAs, and billing together inside the PSA instead of in side spreadsheets.

## 2. Goals

- **G1 — Stock ledger:** per-location on-hand balances, an immutable movement ledger that is the source of truth, and reorder points. *(design §4, §6.A/D)*
- **G2 — Serialized units as the asset/RMA bridge:** per-unit serial + **MAC address** + **warranty**, with a lifecycle spanning stock → deployed asset → RMA. *(design §4, §5)*
- **G3 — Procurement:** vendor entity + lightweight POs + receiving (incl. **drop-ship to client**). *(design §6.A/J)*
- **G4 — Sales orders:** outbound document with **soft allocation** (optional **hard-hold**), **kitting**, and **configurable invoicing** that reuses the billing engine. *(design §6.I)*
- **G5 — Real-world stock movement:** **in-transit transfers**, **loaners**, **restock-to-sellable returns**. *(design §6.C/E/H)*
- **G6 — RMA incl. advance-replacement** with a **dead-unit-owed clock** and aging. *(design §6.G)*
- **G7 — Costing:** moving-average cost + COGS/margin and inventory-value reporting, **no GL dual-write**. *(design §6, §7)*
- **G8 — Asset-to-product linkage:** delivered serialized units create/link managed `assets`. *(design §7)*
- **G9 — Control:** **location-scoped** write/adjust permissions and **per-location** low-stock alert routing. *(design §6.F, §7)*

## 3. Non-goals (deferred to V1.5+)

Count/reconcile (cycle-count) workflow *(top of V1.5)*, multi-level nested BOM, GL/COGS journal dual-write to Xero/QBO, FIFO & lot tracking, landed cost, 3-way match / vendor-bill reconciliation, PO approval chains, barcode/MAC scanning hardware, one-button hot-swap flow, full per-warehouse RBAC, creating SOs from the quote/template wizard. *(design §10, §12)*

## 4. Personas & primary flows

**Persona — Hank, phone-systems MSP owner** (3 metros, 20 techs, stock-heavy). Validation persona for the hostile review (design §12).

Primary flows:
1. **Replenish:** PO to vendor → receive (capture serial/MAC/warranty) → stock on shelf; moving-average cost updates.
2. **Sell a system:** SO with a **kit** (PBX + N handsets + switch + licenses) → confirm (allocate, optionally hard-hold) → fulfill (consume, units→delivered, assets created) → invoice (on-fulfillment or manual).
3. **Drop-ship:** vendor ships straight to the client; unit + asset + invoice created with no on-hand touch.
4. **Move stock:** dispatch transfer between metros (in-transit) → receive at destination.
5. **Hot-swap / RMA (advance):** replacement ships first → deploy to client (relink asset) → dead unit owed with a clock → return to vendor or get charged.
6. **Loaner:** unit out on loan (no sale) → returns to stock.
7. **Watch stock:** per-location low-stock alerts to the location manager; create a PO from low-stock.
8. **Field lookup:** find a unit by **serial or MAC**; check warranty when a client calls.

## 5. Data model

See **design §4** for the full table/column spec. Tables introduced: `stock_locations`, `product_inventory_settings` (1:1 catalog opt-in), `stock_levels`, `stock_units` (serial+MAC+warranty+status), `stock_movements` (append-only ledger), `vendors`, `purchase_orders`/`_lines`, `sales_orders`/`_lines`, `kit_components`, `stock_transfers`/`_lines`, `rma_cases`; plus `assets.service_id` + `assets.stock_unit_id`. Conventions: `.cjs` migrations, `tenant`-first composite PKs, money as `bigint` cents.

**Invariants (design §5):** movements are truth; levels/unit-status are reconcilable caches updated in the same transaction; `quantity_on_hand` counts only sellable stock (excludes `in_transit`/`on_loan`/`returned`/`in_rma`); MAC is tenant-wide unique, serial is per-product unique.

## 6. Core flows

See **design §6**: Receive (A), Consume/deliver (B), Transfer in-transit (C), Adjust/Retire (D), Loaners (E), Reorder/low-stock (F), RMA standard + advance-replacement (G), Restock returns (H), Sales order incl. kitting & allocation & invoicing (I), Drop-ship (J). All run inside `withTransaction`.

## 7. Integration seams

*(design §7; real paths in SCRATCHPAD)*
- **Materials** (`materialActions.ts`): hook `recordStockConsumption` for `track_stock` products; serial/MAC picker; reverse on unbilled-material delete. Materials remain the **service-incidental** path; SO is the canonical hardware-sale path.
- **Contracts:** recurring billing does **not** consume stock (event-driven only).
- **Assets:** delivery calls the assets package `createAsset` (ABAC kernel), establishes bidirectional link carrying serial/MAC/warranty.
- **Billing engine:** SO invoicing emits charges into the existing invoice generation; manual generate is a trigger, not a parallel writer; single `quantity_invoiced` counter prevents double-bill.
- **Accounting:** inventory-value report reconciled manually; optional read-only alignment with Xero `IsTrackedAsInventory`; no GL writes.

## 8. Permissions & access control

New resources: `inventory`, `vendor`, `purchase_order`, `sales_order`, `stock_transfer` (CRUD) + `stock_location` (read/update), via the migration `20251022000000` pattern. **Location scoping:** a tech's write/adjust limited to own van (`assigned_user_id`) + home location; managers/admins act across locations. Stock side-effects from billing flows run under the caller's `billing:create` (no double-gate). Inventory is **MSP-only** (no client-portal surface).

## 9. UX/UI surfaces

*(design §8)* New **Inventory** nav: Stock, Units (serial/MAC search), Locations, Vendors, Purchase Orders (+drop-ship), Sales Orders, Transfers, Kits, RMA, Loaners, Movements. Per-product **Inventory panel** in ProductsManager. Material dialog gains availability + serial/MAC picker. Dashboard widgets: low-stock (per location), inventory value, open POs/SOs, **dead units owed (aging)**, loaners out, expiring warranties.

## 10. Costing, reporting & accounting

Moving-average cost maintained on receipt (exact `unit_cost` for serialized). COGS captured on consume movements. Reports: inventory value `Σ(on_hand × cost)`, margin `sell − COGS`, low-stock, dead-units-owed, loaners-out, expiring-warranty. **No GL/COGS journal dual-write** in V1.

## 11. Risks

- **Cache drift** between `stock_movements` (truth) and `stock_levels`/unit status → mitigated by same-transaction updates + a reconciliation utility + tests (T004/T008).
- **Double-billing** across on-fulfillment + manual invoicing → single `quantity_invoiced` ledger + guard (T035/T036).
- **Stock poaching** of committed cutover stock → hard-hold guard (T010).
- **Asset ABAC coupling** — must route through `createAsset`, not raw insert (T016).
- **MAC uniqueness scope** mistake (per-product instead of tenant-wide) → schema constraint + test (T002).
- **Materials idempotency** on retry / reversal on delete (T014).
- **Scope creep** toward enterprise logistics — guarded by the non-goals list.

## 12. Rollout & migration

*(design §9)* Migrations mirror the multi-table materials pattern. `vendors` backfill from freeform `service_catalog.vendor`. Inventory is **opt-in**: no product gets a `product_inventory_settings` row until enabled, so existing billing/consumption is unchanged on deploy. Seed one default `stock_locations` per tenant. Phased delivery (§15).

## 13. Open questions

See SCRATCHPAD "Open questions" — EE vs CE gating (default CE), reuse of an existing per-tenant number sequence for PO/SO, tax/currency rules on SO lines, negative-stock override gating, client-portal exposure (default MSP-only), kit pricing model.

## 14. Acceptance criteria / Definition of Done

- All in-scope features in `features.json` `implemented: true`; all `tests.json` `implemented: true` and green.
- Migrations apply and roll back cleanly on the migrated schema; vendor backfill verified.
- Ledger reconciles: replaying `stock_movements` reproduces `stock_levels` and serialized on-hand.
- No double-bill possible across both invoicing triggers; recurring contract billing creates no stock movements.
- Advance-replacement RMA, kitting explosion, drop-ship (no on-hand touch), in-transit transfers, loaners, restock returns all behave per design §6.
- Location-scoped permissions enforced; inventory absent from client portal.
- Existing product/billing/materials behavior unchanged for non-stocked products.

## 15. Phasing & sequencing

- **Phase 0 — Foundation:** migrations, types, permissions, package scaffold, movement primitive, reconciliation util. *(F001–F020)*
- **Phase 1 — Locations & catalog opt-in.** *(F021–F035)*
- **Phase 2 — Core ledger** (movements/levels/units, receive-manual, adjust/retire, search). *(F036–F055)*
- **Phase 3 — Procurement** (vendors, POs, receiving, avg cost). *(F056–F072)*
- **Phase 4 — Sales orders** (allocation, consume, asset linkage, materials hook, invoicing). *(F073–F100)*
- **Phase 5 — Kitting.** *(F101–F108)*
- **Phase 6 — Transfers, loaners, restock, RMA (incl. advance).** *(F109–F132)*
- **Phase 7 — Reorder/alerts, drop-ship, reporting, permissions enforcement, dashboards.** *(F133–F155)*
