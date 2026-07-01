# PRD — Inventory Module: Review Remediation & Sell-Side Completion

**Date:** 2026-07-01
**Branch:** `feature/inventory-module`
**Status:** Draft — scope decisions D1–D10 recorded in SCRATCHPAD.md; pending user confirmation
**Parents:** `ee/docs/plans/2026-06-26-inventory-module/`, `ee/docs/plans/2026-06-26-sales-order-documents/`, `docs/plans/2026-06-26-inventory-module-design.md`

---

## 1. Problem statement

A three-lens review (business flows, stock engine, schema) of the shipped inventory module found that:

1. **The sell side is dark.** Fulfillment, SO invoicing, drop-ship confirmation, and backorder→PO all exist at the action layer with tests — and have **zero callers**. An MSP can raise and confirm a hardware order but cannot ship it, capture COGS, or bill it from any screen. `invoice_mode='on_fulfillment'` (the default) does nothing.
2. **Nothing takes a row lock.** Every document flow (confirm, fulfill, receive transfer, receive PO, RMA transitions) is a check-then-write at READ COMMITTED. Double-clicks or concurrent submits double-allocate, oversell the same serial, or fabricate stock — and the reserved/held counters have **no repair path** once drifted.
3. **Business-logic flaws** in what is implemented: allocation over-reserves (inflating suggested purchase quantities), confirmed SOs can never be edited or reopened, the standard RMA replacement track dead-ends without relinking the client's asset, "charge for unreturned" bills nothing, and two currency bugs (cross-currency cost blending; USD-hardcoded suggested POs that can never be received).
4. **Controls promised but unenforced:** location write-scoping guards only manual adjustments; low-stock alert routing is computed but never dispatched.
5. **Schema gaps:** no non-negative quantity CHECKs, a dangling `tax_rate_id`, missing hot-path indexes, permanently-soft cross-document links, ledger immutability by discipline only.
6. **Business gaps a stock-heavy MSP hits first:** no vendor SKUs/price lists, no cycle counts, no landed cost, no vendor bills/AP tie-out.

**User value:** an MSP can actually sell, ship, and bill hardware through sales orders; counts stay trustworthy under concurrent multi-user use; and the first tier of real-world ops (counting, vendor pricing, freight, AP) exists.

## 2. Goals

- Close the money loop: confirmed SO → fulfill → COGS → invoice → (drop-ship / backorder→PO), all reachable from the UI.
- Make every stock-mutating flow safe under concurrent use, with a production repair path for cache drift.
- Fix the identified business-logic flaws (allocation math, SO reopen, RMA completion, RMA charging, currency guards).
- Enforce the designed controls (location scoping on all write paths; low-stock alerts actually delivered).
- Harden the schema (CHECKs, FKs, indexes, SO↔invoice linkage, ledger immutability).
- Add the four hurt-first business capabilities: vendor price lists, cycle counts, landed cost, light vendor bills.

## 3. Non-goals

- GL/COGS journal dual-write; payment processing or AP payment rails; 3-way match beyond a non-blocking variance indicator (D9).
- Client-owned/consignment stock, bin locations, barcode hardware, multi-level BOM, full per-warehouse RBAC (unchanged deferrals, D10).
- Editing sales orders after any fulfillment or invoicing (reopen is draft-state-only, D4).
- FIFO/lot costing (moving average stays).

## 4. Personas & primary flows

- **Owner/admin (Sam):** confirms orders, reviews margin, approves count variances, watches open bills aging.
- **Warehouse manager:** receives POs, applies landed cost, runs cycle counts, dispatches transfers, gets that location's low-stock alerts.
- **Field engineer:** fulfills from a van, installs materials against tickets (asset auto-created), counts their own van.
- **Back office:** generates SO invoices, records vendor bills from POs.

---

## 5. Phase 1 — Close the money loop (sell-side wiring)

### 5.1 Fulfill UI
A Fulfill action on confirmed/partially-fulfilled SOs opens a dialog listing lines (ordered/fulfilled/remaining). Non-serialized lines take a quantity (capped at remaining); serialized lines get a unit picker (search serial/MAC, FIFO preselect) that excludes units hard-held by other SOs and labels foreign soft-allocations. Source location defaults to the allocation-resolved location. Insufficient availability warns but never blocks (parent design decision #8).

### 5.2 Invoice wiring
Dependency direction is billing→inventory, so a new **billing** action `fulfillAndInvoiceSoLine` composes inventory fulfill + `generateInvoiceForSalesOrder` (D1). `on_fulfillment` mode bills newly fulfilled quantity automatically; `manual` mode gets a "Generate invoice" button. SO detail shows per-line `quantity_invoiced` and links to created invoices. Idempotency (LEAST-cap) already exists — covered by test, not new code.

### 5.3 Drop-ship confirmation UI
Drop-ship lines expose "Confirm vendor shipment" capturing serials/MAC/warranty (serialized), marking the line fulfilled without touching on-hand — wiring the existing `confirmDropShipShipment`.

### 5.4 Backorder → draft PO
SO detail surfaces per-line backorder and a "Create draft PO" button wiring `suggestPoFromBackorder`, linking the created PO(s).

### 5.5 SO reopen
"Reopen to draft" releases allocations and returns status to draft, enabled only when nothing is fulfilled or invoiced (D4). Existing draft-only line-edit guards then apply as-is.

### 5.6 Double-submit guards
Confirm/Cancel/Fulfill/Invoice/Reopen buttons all disable while their action promise is in flight (today only Save and the email dialog are guarded).

## 6. Phase 1 — Concurrency & integrity

### 6.1 Document-header row locks
`FOR UPDATE` on the header row before every status guard: SO (confirm/cancel/release/reopen), transfers (dispatch/receive/cancel), PO (receive line/cancel), RMA (all transitions). Post-lock re-read makes the existing status guards authoritative (D2).

### 6.2 Capped counters & unit-pick locking
`quantity_fulfilled` updates become `UPDATE … WHERE quantity_fulfilled + ? <= quantity_ordered` with rowcount checks. Serialized candidate selection (allocation + fulfillment) uses `FOR UPDATE SKIP LOCKED` so two orders cannot claim the same unit. A movement-level idempotency key was considered and rejected (legitimate repeats exist — D2).

### 6.3 Allocation math
`allocateLine` reserves `min(available, remaining)` so `reserved_quantity` can never exceed on-hand; backorder/PO-suggestion math stops double-counting the SO's own reservation (fixes the 17-instead-of-7 over-order). The serialized hard-fulfill path stops decrementing a `held_quantity` that allocation never incremented.

### 6.4 Reserved/held repair path
`reconcileStockLevels` extends to recompute reserved/held from live allocations (today it deliberately skips them and is never called in production). A permission-gated admin "Rebuild stock caches" action/button runs it and reports corrections.

### 6.5 Asset creation integrity
`createAsset` currently commits independently mid-fulfillment → orphan assets on rollback. Pending asset links are collected in-transaction and created after commit, with failures surfaced for retry.

### 6.6 Schema CHECKs
CHECKs added: `reserved_quantity >= 0`, `held_quantity >= 0`; order/transfer line `quantity > 0`; `quantity_received/fulfilled/invoiced >= 0`; SO-line `fulfilled <= ordered` and `invoiced <= ordered`. **`quantity_on_hand` stays unconstrained** — negative on-hand is the designed soft-consume signal (D3). Migration pre-clamps any existing violations.

## 7. Phase 2 — Controls, RMA, currency, schema hardening

### 7.1 Location scoping everywhere
`assertLocationWritable` extends from `adjustStock` to `receiveStockManual`, `retireStock`, `dispatchTransfer` (source), `fulfillSalesOrderLine` (source), and `loanOut`/restock — closing the "any tech touches any van" hole the design headlines.

### 7.2 Low-stock alert dispatch
A scheduled (daily, tenant-scoped) job resolves the existing routing and sends in-app/email notifications to each location's `manager_user_id` via the existing notification infra. Unmanaged locations produce no notification (no firehose), only a job-log entry.

### 7.3 RMA completion
`deployReplacement` accepts standard-track cases (status `'replaced'`) so the vendor-replacement path can deliver the new unit and relink the client's asset. `chargeForUnreturned` creates a **draft** manual invoice (replacement product at list price) and stores the invoice ref on the case (D6). The unreachable `'dead_unit_returned'` status is removed from the CHECK (D5).

### 7.4 Currency guards
`receivePoLine` gains the same product-currency guard `receiveStockManual` already has (no cross-currency average blending). `createPoFromLowStock` groups by (vendor, currency) and stamps each PO header from its lines — no more unreceivable hardcoded-USD POs.

### 7.5 Materials-path asset creation
`recordStockConsumption` honors `creates_asset_on_delivery` for serialized units on the ticket/project materials path — the most common MSP hardware touch currently silently skips asset creation.

### 7.6 Tax & SO↔invoice linkage
SO-line `tax_rate_id` flows through the invoice bridge; migration adds its missing FK and a nullable `so_line_id` backlink on `invoice_items` for real reconciliation.

### 7.7 FKs, indexes, immutability, serial hygiene
Hot-path indexes (`stock_levels (tenant, location_id)`; order headers by client/vendor/status). Composite FKs + indexes for the formerly-soft links (`allocated_so_line_id`, `source_po_id`, `source_so_line_id`, `parent_so_line_id`, ON DELETE SET NULL). A trigger rejects UPDATE/DELETE on `stock_movements`. Positive serialized adjustments require caller-supplied serials instead of fabricating `ADJ-*` ones.

## 8. Phase 3 — Vendor price lists (vendor SKUs)

New `vendor_products` table: per (vendor, product) `vendor_sku`, `unit_cost` (cents), `cost_currency`, `lead_time_days`, `is_preferred` (one preferred offer per product, partial unique). CRUD actions + a price-list tab on Vendor detail; read-only offers view on the product inventory panel. PO lines default cost/currency/vendor-SKU from the PO vendor's row; low-stock and backorder suggestions price from the preferred offer. This is how a real MSP orders — by the distributor's part number at contract price.

## 9. Phase 3 — Cycle counts

`count_sessions` (per location; draft → in_progress → review → approved/cancelled) + `count_lines` (expected snapshot, counted qty, serial lists, variance). Counts are **blind** (expected hidden from counters); variance review is approver-only; approval writes ordinary `adjust` movements with reason `'cycle_count'` — the ledger stays the single source of truth (D7). Serialized counts: expected-but-unscanned units retire on approval; unexpected serials require explicit disposition. Stock mutations during an open session flag affected lines stale rather than corrupting variance math. New `cycle_count` permission resource; counting respects location scoping (an engineer counts their own van).

## 10. Phase 4 — Landed cost

`po_landed_costs` entries (freight/duty/other, amount, allocation by value or quantity) attached to a PO and **applied** as a separate idempotent step (costs usually arrive after receipt — D8). Application allocates across received quantities, adjusts the non-serialized moving average via a cost-only path, and bumps `unit_cost` on serialized units received from that PO. PO detail shows landed totals and per-line effective unit cost; margin/valuation reports pick the change up through the existing cost fields.

## 11. Phase 4 — Vendor bills (light AP)

`vendor_bills` + `vendor_bill_lines` (D9): create from a PO (prefilled from received quantities/costs) or standalone; status draft → open → paid/void with manual mark-paid; due date defaulted from vendor `payment_terms`; a non-blocking 2-way variance indicator vs receipts; list UI + dashboard aging widget. Gives the AP tie-out the review flagged without GL or payment rails.

---

## 12. Data model changes (summary)

| Change | Table(s) | Phase |
|---|---|---|
| CHECKs: reserved/held ≥ 0, line qty > 0, fulfilled/invoiced ≤ ordered (+ pre-clamp) | stock_levels, *_lines | 1 |
| FK `tax_rate_id` → tax_rates; `invoice_items.so_line_id` backlink | sales_order_lines, invoice_items | 2 |
| Hot-path indexes (location, client, vendor, status) | stock_levels, sales_orders, purchase_orders | 2 |
| FKs + indexes for soft links (ON DELETE SET NULL) | stock_units, po_lines, so_lines | 2 |
| UPDATE/DELETE-rejecting trigger | stock_movements | 2 |
| Remove `'dead_unit_returned'` from status CHECK | rma_cases | 2 |
| New: `vendor_products` | — | 3 |
| New: `count_sessions`, `count_lines`; `cycle_count` permission | — | 3 |
| New: `po_landed_costs` | — | 4 |
| New: `vendor_bills`, `vendor_bill_lines`; `vendor_bill` permission | — | 4 |

All new tables follow the established conventions: tenant-first composite PK/FKs, CHECK-constrained statuses, money as bigint cents.

## 13. Risks & rollout

- **Locking changes touch every mutation path** — the DB-backed test suite must cover the concurrent cases (parallel transactions in-test), not just sequential guards.
- **CHECK migrations can fail on drifted data** — pre-clamp step is mandatory; run reconcile before constraint add.
- **Dev DB DDL requires admin creds** (app_user isn't table owner); the 2026-06-30 address migration is still unapplied for this reason. Coordinate before Phase 1 migrations.
- **Auto-invoicing creates real invoices** — on_fulfillment behavior changes billing output for existing SOs with that mode stored; call out in release notes.
- **Citus alignment** (open question 15.1) may constrain the new FKs.

## 14. Acceptance criteria / definition of done

1. From the UI alone: create SO → confirm → fulfill (serialized + non-serialized) → invoice generated per mode → drop-ship confirmed → backorder PO drafted. COGS visible in margin report.
2. Concurrent double-submit of confirm/fulfill/transfer-receive provably cannot double-allocate, oversell a serial, or fabricate stock (DB-backed concurrency tests green).
3. Order 10 with 3 on hand → reserved 3, suggested buy 7.
4. Standard RMA ends with the client's asset pointing at the replacement unit; unreturned-unit charge produces a draft invoice.
5. A tech cannot receive/retire/transfer/fulfill/loan against another tech's van; location managers get their own low-stock notifications.
6. New CHECKs/FKs/indexes/trigger in place; migrations round-trip (up/down) cleanly.
7. Vendor price lists drive PO line defaults; a blind cycle count applies approved variances through the ledger; landed cost changes effective unit costs idempotently; vendor bills track open/paid with aging.
8. All features in features.json implemented; all tests in tests.json green.

## 15. Open questions

1. **Citus:** do target clusters distribute these tables? The 15 existing inventory tables skip `create_distributed_table` while 2026 siblings use it. Affects FK feasibility (esp. stock_units → assets). Needs Robert's call.
2. **RLS:** inventory tables have no per-table RLS policies (drifting repo convention — recent siblings also skip). Defense-in-depth add, or accept app-level scoping?
3. **Invoice presentation:** should SO-generated invoices group lines per SO (one invoice per SO per generation) — assumed yes via existing `generateManualInvoice` semantics.
4. Should `cycle_count` approval also require the approver ≠ counter (four-eyes)? Currently: permission + location scope only.
