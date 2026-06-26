# Inventory Module — Design

**Date:** 2026-06-26
**Branch:** `feature/inventory-module`
**Status:** Design approved (revised after hostile-user review) — ready for implementation planning

> **Revision note:** This doc was pressure-tested against a hostile-user review role-playing a grizzled phone-systems MSP owner (three metro locations, 20 techs, stock-heavy). His critique surfaced one fatal miss (no MAC address), one internal inconsistency (warranty claimed as a goal with no field), and several ICP-specific gaps. Those fixes are now integrated throughout; see **§12** for the full change log and what was deliberately deferred.

---

## 1. Overview

Alga PSA today has a **product catalog but no inventory system**. Products are a subset of `service_catalog` (`item_kind = 'product'`) carrying only pricing/cost/tax/license metadata. Quantities exist only on consuming entities (contract lines, invoice items, ticket/project materials) — they record what was *billed or consumed*, never decremented from an on-hand ledger. There is no notion of stock, locations, lots/serials, allocations, reorder points, stock movements, procurement, or COGS.

This design adds a **first-class, stock-and-hold inventory module** aimed at our reseller-heavy ICP — explicitly including phone-systems specialists who stock serialized handsets, components, laptops, and monitors — and deliberately scoped to stop short of an enterprise logistics system.

### Guiding principle (layering)

The product catalog (`service_catalog`) remains the master of *what we sell and for how much*. The inventory module is a **new domain that references the catalog** and owns *how many we have, where, and at what cost*. Catalog products **opt in** to inventory tracking; products that aren't stocked are entirely unaffected. This mirrors the existing catalog-vs-consumption layering and keeps the billing engine untouched.

---

## 2. Goals & non-goals

### Goals (V1)
- Real stock ledger: on-hand balances per location, an immutable movement ledger, reorder points.
- Per-product serial tracking with a unit lifecycle that bridges stock → deployed asset → RMA, including **MAC address** and **per-unit warranty**.
- RMA status and return path — including **advance-replacement** (replacement ships first) with a **dead-unit-owed clock**.
- Vendors as a first-class entity; lightweight purchase orders + receiving; **drop-ship to client**.
- Sales orders (outbound) with soft allocation (with an optional **hard-hold** for committed deals) and configurable invoicing.
- **Kitting/bundle templates** so a phone system sells as one orderable thing.
- **In-transit transfers** between locations.
- **Loaners** and **restock-to-sellable returns**.
- Moving-average cost + COGS/margin reporting (no GL posting).
- Asset-to-product linkage (fixes a long-standing gap).
- Location-scoped write permissions and per-location low-stock alert routing.

### Non-goals (explicitly deferred)
Count/reconcile (cycle-count) workflow *(top of the V1.5 list)*, multi-level nested BOM, GL/COGS journal dual-write, FIFO & lot tracking, landed cost, 3-way match / vendor-bill reconciliation, PO approval chains, barcode-scanner hardware integration, full per-warehouse RBAC beyond basic location scoping, creating sales orders from the quote/template wizard, one-button hot-swap flow.

---

## 3. Decisions log (the spec)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Core operating model | **Stock & hold** ledger; no enterprise logistics |
| 2 | Unit granularity | Quantity ledger + **per-product `is_serialized` toggle**; serialized products get individual unit records |
| 3 | Serial purpose | Unit-lifecycle record is the **asset/RMA bridge** (RMA, warranty, fault/security-advisory lookups) |
| 4 | RMA | Status + return path in V1 (via `rma_cases`) |
| 5 | Procurement | **Vendor entity + light PO + receive**; no approvals/3-way/landed cost |
| 6 | Costing | **Moving-average cost + COGS/margin reporting**; no GL dual-write |
| 7 | Architecture | **Approach A** — new inventory domain referencing the catalog via a 1:1 `product_inventory_settings` row |
| 8 | Availability on consume | **Soft-warn, never hard-block** (consistent with materials auto-bill) |
| 9 | Contract billing & stock | Recurring contract billing does **not** consume stock; consumption is **event-driven** |
| 10 | Sales orders | **In scope for V1** (outbound mirror of PO) |
| 11 | SO allocation | **Soft allocation** by default; **optional hard-hold** for confirmed SOs |
| 12 | SO invoicing | **Both/configurable** — bill-on-fulfillment (default) + manual "Generate invoice", over one shared invoiced-quantity ledger |
| 13 | Serialized unit identity *(review)* | Track **MAC address** (tenant-unique, searchable) **and** serial; capture **warranty expiry** per unit |
| 14 | RMA shape *(review)* | Support **advance-replacement** (replacement-first) with a **dead-unit-owed due date + aging** |
| 15 | Bundles *(review)* | **Kit/bundle templates** explode onto an SO as editable lines and decrement each component; multi-level BOM deferred |
| 16 | Drop-ship *(review)* | Vendor-ships-to-client path creates delivered unit + asset + invoice **without touching on-hand** |
| 17 | Movement realism *(review)* | **In-transit** state on transfers; **`on_loan`** status; **restock-to-sellable** return path distinct from RMA |
| 18 | Control *(review)* | **Location-scoped** write/adjust permissions; **per-location** low-stock alert routing |

---

## 4. Data model

Conventions (confirmed against the repo): `.cjs` migrations under `server/migrations/`, `tenant`-first composite PKs, money as `bigint` cents, FKs to products via `(tenant, service_id)`. All tables carry standard `tenant` + `created_at` (+ `updated_at` where mutable), omitted below for signal. The module lives in a new `packages/inventory/` (actions + components); interfaces in `packages/types/src/interfaces/inventory.interfaces.ts`.

### `stock_locations` — where stock physically lives
- `location_id` (PK), `name`, `location_type` `CHECK ('warehouse','van','office','other')`
- `assigned_user_id` (FK users, nullable) — van stock tied to a tech (drives location scoping)
- `manager_user_id` (FK users, nullable) — who receives this location's low-stock alerts
- `is_default` (one per tenant, partial unique), `is_active`
- Unique `(tenant, name)`

### `product_inventory_settings` — 1:1 opt-in bridge to `service_catalog`
- `service_id` (PK, FK service_catalog)
- `track_stock` (bool), `is_serialized` (bool), `is_kit` (bool), `creates_asset_on_delivery` (bool)
- `reorder_point` (int, nullable — global default), `reorder_quantity` (int, nullable — suggested buy qty)
- `average_cost` (bigint cents, nullable — maintained on receipt), `cost_currency`
- `default_location_id` (FK stock_locations, nullable), `preferred_vendor_id` (FK vendors, nullable)

### `kit_components` — a kit's bill of materials *(review #15)*
- PK `(tenant, kit_service_id, component_service_id)`
- `kit_service_id` (FK service_catalog — the kit, `is_kit = true`), `component_service_id` (FK service_catalog), `quantity` (int)
- Components may be stocked products *or* non-stocked lines (e.g., licenses, cabling labor). Single level only in V1 (a kit cannot contain a kit).

### `stock_levels` — (product × location) on-hand balance (maintained cache)
- PK `(tenant, service_id, location_id)`
- `quantity_on_hand` (int, default 0)
- `reserved_quantity` (int, default 0 — **soft** allocation), `held_quantity` (int, default 0 — **hard** hold)
- `reorder_point` (int, nullable — per-location override)
- Derived `available = quantity_on_hand − reserved_quantity − held_quantity`

### `stock_units` — one row per serialized physical unit (the asset/RMA bridge)
- `unit_id` (PK), `service_id` (FK), `serial_number`, **`mac_address`** (nullable)
- `status` `CHECK ('in_stock','allocated','in_transit','on_loan','delivered','returned','in_rma','retired')`
- `location_id` (FK, nullable — while in stock/transit), `client_id` (FK, nullable — once delivered/on-loan), `asset_id` (FK assets, nullable — linked managed asset)
- `allocated_so_line_id` (FK sales_order_lines, nullable — which SO line holds this unit, soft or hard)
- **`warranty_expires_at`** (timestamp, nullable), `warranty_term` (text, nullable)
- `loan_due_at` (timestamp, nullable — expected return for `on_loan`)
- `unit_cost` (bigint cents), `cost_currency`, `received_at`, `delivered_at`, `source_po_id` (nullable)
- Unique `(tenant, service_id, serial_number)`; **Unique `(tenant, mac_address)` where `mac_address` is not null** (a MAC is globally unique — must not collide across products)
- Indexes on `status`, `serial_number`, `mac_address` (advisory/provisioning lookups), `asset_id`, `client_id`

### `stock_movements` — immutable, append-only ledger (no `updated_at`)
- `movement_id` (PK), `movement_type` `CHECK ('receipt','consume','adjust','transfer_out','transfer_in','return_restock','return_defective','rma_out','rma_in','loan_out','loan_in','retire')`
- `service_id`, `unit_id` (nullable — serialized), `from_location_id` / `to_location_id` (nullable — direction by type)
- `quantity` (positive magnitude), `unit_cost` + `cost_currency` (on receipts → feeds moving-average), `cogs_cost` (captured on consume)
- `reason`, `source_doc_type` `('purchase_order','sales_order','ticket_material','project_material','contract','rma','transfer','loan','manual')`, `source_doc_id`, `performed_by`

### `vendors` — supplier entity (replaces freeform `service_catalog.vendor`)
- `vendor_id` (PK), `vendor_name`, contact fields, `payment_terms`, `account_number`, `is_active`
- Unique `(tenant, vendor_name)`
- *Migration backfills distinct freeform vendor strings → `vendors`, sets `preferred_vendor_id`; legacy text column left intact but deprecated.*

### `purchase_orders` / `purchase_order_lines` — light inbound PO (with drop-ship)
- PO: `po_id` (PK), `po_number` (unique per tenant), `vendor_id`, `status` `('draft','open','partially_received','received','cancelled')`, `order_date`, `expected_date`, `ship_to_location_id` (nullable), `currency_code`
- **Drop-ship:** `is_drop_ship` (bool), `drop_ship_client_id` (FK clients, nullable), `drop_ship_address` (jsonb, nullable)
- Line: `po_line_id` (PK), `po_id`, `service_id`, `quantity_ordered`, `quantity_received` (default 0), `unit_cost`, `cost_currency`, `source_so_line_id` (nullable — backorder/drop-ship link)

### `sales_orders` / `sales_order_lines` — outbound mirror of PO
- SO: `so_id` (PK), `so_number` (unique per tenant), `client_id`, `status` `('draft','confirmed','partially_fulfilled','fulfilled','invoiced','closed','cancelled')`, `order_date`, `expected_ship_date`, `ship_to`, `currency_code`, `client_po_number`, `invoice_mode` `('on_fulfillment','manual')`, `allocation_mode` `('soft','hard')`, `created_by`
- Line: `so_line_id` (PK), `so_id`, `service_id`, `quantity_ordered`, `quantity_fulfilled` (default 0), `quantity_invoiced` (default 0), `unit_price`, `cost_snapshot`, `tax_rate_id`, `fulfillment_type` `('from_stock','drop_ship')`, `parent_so_line_id` (FK self, nullable — set on exploded kit-component lines)

### `stock_transfers` / `stock_transfer_lines` — in-transit moves between locations *(review #17)*
- Transfer: `transfer_id` (PK), `from_location_id`, `to_location_id`, `status` `('dispatched','received','cancelled')`, `dispatched_by`, `dispatched_at`, `received_by`, `received_at`, `notes`
- Line: `transfer_line_id` (PK), `transfer_id`, `service_id`, `quantity`, `unit_id` (nullable — serialized)

### `rma_cases` — the return path (standard **and** advance-replacement)
- `rma_id` (PK), `rma_type` `('standard','advance_replacement')`, `returned_unit_id` (FK stock_units, nullable), `service_id`, `client_id`, `asset_id` (nullable), `vendor_id` (nullable — vendor RMA), `rma_reference`, `reason`
- `status` `('open','awaiting_return','returned','sent_to_vendor','replacement_received','replacement_deployed','dead_unit_owed','dead_unit_returned','replaced','credited','charged','closed')`
- `replacement_unit_id` (FK stock_units, nullable)
- **`dead_unit_due_date`** (timestamp, nullable — the advance-replacement clock), `dead_unit_returned_at` (timestamp, nullable)
- `opened_at`, `closed_at`

### Asset linkage columns (added to existing `assets`)
- `service_id` (FK service_catalog, nullable) — the product it was sold from
- `stock_unit_id` (FK stock_units, nullable) — the physical unit (MAC/serial/warranty surfaced via this link)

---

## 5. Unit state machine (`stock_units.status`)

```
                 receipt
                    │
                    ▼
   ┌──────────► in_stock ◄────────── transfer_in
   │             │  │  │  │
   │ (refurb/    │  │  │  └── allocate ─► allocated ─┐
   │  restock)   │  │  │                             │
   │             │  │  └── loan_out ─► on_loan ──────┤ (loan_in → in_stock)
   │             │  └── transfer_out ─► in_transit ──┘
   │             │
   │             └──► delivered ──(link/create Asset; capture COGS)
   │                      │
   │              ┌───────┴──────────────┐
   │     client returns           advance-replacement
   │     (defective)              (replacement ships first)
   │              │                      │
   │              ▼                      ▼
   │           returned            (new unit) in_stock → delivered → in service
   │              │                      │           old unit still owed → dead_unit_owed
   │              ▼                      ▼                 (clock: dead_unit_due_date)
   │           in_rma ──► (refurb) in_stock        dead unit returned → closed
   │              │                                  or not returned → charged → closed
   │              ├──► retired (scrapped)
   └──────────────┘
                                  retire ─► retired (terminal)
```

**Invariants:**
- `stock_movements` is the only source of truth; `stock_levels` and `stock_units.status` are updated **in the same transaction** as the movement and are fully reconcilable by replay.
- `quantity_on_hand` counts only **sellable** stock. It excludes `in_transit`, `on_loan`, `returned`, and `in_rma` units. (This is why a return/RMA does not bump on-hand.)
- Serialized units carry an exact `unit_cost`; non-serialized products carry a moving-average `average_cost`.
- A MAC is globally unique; serial uniqueness is per product, MAC uniqueness is tenant-wide.

---

## 6. Core flows

All flows run inside `withTransaction`: movement written + caches updated + unit/PO/SO/asset side-effects, atomically.

### A. Receive (inbound)
1. Assert `track_stock`; assert currency match.
2. Serialized: create one `stock_units` row per serial (`in_stock`, location, `unit_cost`, `received_at`, `source_po_id`, optional `mac_address`, optional `warranty_expires_at`); require `serials.length === quantity`; enforce serial **and MAC** uniqueness.
3. Write `stock_movements` `type='receipt'`, `to_location_id`, `unit_cost` — one movement per unit (serialized) / one batch movement (non-serialized).
4. `stock_levels.quantity_on_hand += quantity` (upsert).
5. Recompute moving-average: `new_avg = (old_qty·old_avg + recv_qty·recv_cost) / (old_qty + recv_qty)`.
6. If against a PO: `quantity_received += qty`; recompute PO status (`open → partially_received → received`). Over-receipt allowed with a warning.

### B. Consume / deliver (outbound)
Driven by a sales-order fulfillment, a ticket/project material, or an explicit deliver/install.
1. **Soft availability check** — warn on insufficiency, never block. (If a unit is **hard-held** by another SO, block poaching it specifically — see F.)
2. Serialized: pick unit(s) (user-selected serial/MAC or FIFO by `received_at`); `in_stock|allocated → delivered`, set `client_id` + `delivered_at`, clear `location_id`.
3. Write `stock_movements` `type='consume'`, `from_location_id`, `source_doc_type`/`source_doc_id`, `unit_id` if serialized. **Capture COGS** = unit's `unit_cost` (serialized) or product `average_cost` (non-serialized).
4. `stock_levels.quantity_on_hand -= quantity`; release any `reserved_quantity`/`held_quantity`.
5. **Asset linkage** (serialized + `creates_asset_on_delivery`): call the assets package's `createAsset` (respecting its ABAC kernel), set `asset.service_id`, `asset.stock_unit_id`, and the `stock_units.asset_id` back-pointer (carrying serial + MAC + warranty).

### C. Transfer between locations — two-step, in-transit *(review #17)*
1. **Dispatch**: create `stock_transfers` (`dispatched`); per line write `transfer_out` movement (`stock_levels` source `quantity_on_hand -= qty`); serialized unit `in_stock → in_transit`. Stock is **not** available at destination yet.
2. **Receive**: transfer `→ received`; per line write `transfer_in` movement (destination `quantity_on_hand += qty`); serialized unit `in_transit → in_stock`, `location_id = to_location`.
- Cancel before receipt returns units to source.

### D. Adjust / Retire (internal)
- **Adjust**: `type='adjust'`, **`reason` required**; non-serialized `quantity_on_hand` ±; serialized loss → unit `retired`, found → new `in_stock` unit. (Subject to location-scoped permissions — §7.)
- **Retire/dispose**: `type='retire'`, `from_location`, reason; serialized → `retired`; non-serialized `quantity_on_hand -= qty`.

### E. Loaners *(review #17)*
- **Out**: `loan_out` movement; serialized unit `in_stock → on_loan`, set `client_id` + `loan_due_at`. **No COGS, no invoice** (it's not a sale); excluded from `quantity_on_hand`.
- **Back**: `loan_in` movement; unit `on_loan → in_stock`.
- Loaners-out report (where, since when, due back).

### F. Reorder / low-stock (read + convenience; no auto-reorder)
- Low-stock = `available <= reorder_point` (per-location override, else product default) for `track_stock` products.
- **Per-location alert routing** *(review #18)*: notify each location's `manager_user_id` about *that* location only — never a global firehose. Plus dashboard widget + report.
- **"Create PO from low-stock"**: draft PO grouped by `preferred_vendor_id`, suggested qty = `reorder_quantity` (or `reorder_point − available`). Suggestion only.

### G. RMA / return path *(review #14)*
**Standard (return-first):** `open → awaiting_return → returned` (movement `return_defective`, unit `delivered → returned`, **not** sellable) `→ sent_to_vendor` (`rma_out`, unit `→ in_rma`) `→` resolve (replacement `rma_in`/repair `in_rma → in_stock`/`credited`/scrap `retired`) `→ closed`.

**Advance-replacement (replacement-first):** `open` (`rma_type='advance_replacement'`) → **replacement received** (`rma_in`, new unit `in_stock`, `replacement_unit_id`) → **replacement deployed** (ship to client, relinked to same asset, `assets.serial_number`/MAC updated) → **`dead_unit_owed`** with **`dead_unit_due_date`** (aging clock) → dead unit returned (`return_defective` → `rma_out` to vendor, `dead_unit_returned_at`) → `closed`; **or** deadline missed → `charged` → `closed`.
- Dashboard widget: **"Dead units owed to vendors,"** sorted by days remaining.

### H. Restock-to-sellable return *(review #17)*
- Distinct from RMA: client returns **opened-but-unused / over-ordered** good stock.
- `return_restock` movement → `quantity_on_hand += qty` (back to **sellable**); serialized unit `delivered → in_stock`; optional **restocking fee** + credit memo. Keeps the `adjust` audit trail clean of legitimate restocks.

### I. Sales order (outbound document)
1. **Draft → Confirmed.** Kit lines **explode** into editable component lines (`parent_so_line_id` set) per `kit_components`. On confirm, allocate per `allocation_mode`:
   - *soft* (default): serialized `in_stock → allocated` (`allocated_so_line_id` set); non-serialized `reserved_quantity += qty`. Reversible; consume still soft-warns.
   - *hard*: as above but increments `held_quantity` / marks units hard-held so a casual material pull **cannot** poach committed cutover stock.
2. **Backorder → PO / Drop-ship.** Out-of-stock lines can spawn a *suggested draft PO* (soft `source_so_line_id`). A `drop_ship` line creates a PO shipped straight to the client (§6 J).
3. **Fulfill** a `from_stock` line → runs flow **B** (`source_doc_type='sales_order'`); `quantity_fulfilled += qty`; SO `confirmed → partially_fulfilled → fulfilled`.
4. **Invoice** — single shared `quantity_invoiced` counter guards both paths (`quantity_invoiced <= quantity_ordered`; each `invoice_item` links back to `so_line_id`):
   - *On-fulfillment (default):* fulfilling emits a billable charge into the existing invoice engine → `invoice_items` (reuses the materials charge pathway; partial ship → partial bill).
   - *Manual:* "Generate invoice" creates an invoice from selected lines on demand.
   - Both flow through the **same billing engine** — manual is a trigger, not a parallel invoice writer.

### J. Drop-ship (vendor → client, never on my shelf) *(review #16)*
- SO line `fulfillment_type='drop_ship'` → PO with `is_drop_ship`, `drop_ship_client_id`/address, `source_so_line_id`.
- On vendor confirmation of shipment, a **combined receipt+delivery** records the unit as `delivered` (serialized → create unit with serial/MAC/warranty, then asset) and marks the SO line fulfilled — **without** ever incrementing `quantity_on_hand` at any of my locations. Invoice proceeds per the SO's `invoice_mode`.

---

## 7. Integration seams

### Materials (`materialActions.ts`)
`addTicketMaterial`/`addProjectMaterial` gain a hook: if the product is `track_stock`, call `recordStockConsumption(...)` (flow B) with `source_doc_type='ticket_material'`. Serialized → serial/MAC picker in the dialog. Deleting an *unbilled* material writes a compensating movement to restore stock / revert the unit; billed materials remain undeletable. Materials remain the path for **service-incidental** parts; the **sales order** is the canonical path for hardware sales.

### Contracts (`contract_line_service_configuration`)
Recurring contract billing does **not** consume stock. Physical consumption is event-driven (sales order / materials / explicit delivery / drop-ship). The recurring billing engine is untouched.

### Assets (`assets`)
New nullable `service_id` + `stock_unit_id` columns. Serialized delivery calls the assets package's `createAsset` (ABAC-respecting), establishing the bidirectional link and carrying serial + **MAC** + **warranty**. Asset detail shows linked product + source unit + warranty status + RMA history; RMA replacement updates the asset's live serial/MAC.

### Costing / accounting
Margin = sell price (`service_prices`/`invoice_items`) − COGS (consume movement). Inventory value report = Σ(on-hand × cost), reconciled manually against Xero/QBO. **No GL dual-write.** Optionally align Alga's `track_stock` flag with Xero's already-read `IsTrackedAsInventory` for awareness only.

### Permissions (follows migration `20251022000000` pattern) *(review #18)*
New resources: `inventory`, `vendor`, `purchase_order`, `sales_order`, `stock_transfer` (each `create/read/update/delete`), plus `stock_location` (`read/update`).
- **Location scoping:** a tech's write/adjust is limited to his **own van** (`stock_locations.assigned_user_id`) **+ home location**; managers/admins act across all locations. This closes the "any tech edits any metro's stock" hole without full per-warehouse RBAC (which stays deferred).
- Stock side-effects from billing flows run under the caller's existing `billing:create` (no double-gating). Asset creation on delivery uses the assets ABAC path.

---

## 8. UI surfaces
- New **Inventory** nav section: **Stock** (on-hand/available by location + low-stock), **Units** (search by **serial or MAC** for RMA/advisory/provisioning), **Locations**, **Vendors**, **Purchase Orders** (incl. drop-ship), **Sales Orders**, **Transfers** (dispatch/receive), **Kits**, **RMA**, **Loaners**, **Movements** (ledger).
- **ProductsManager** (Billing settings) gains a per-product **Inventory** panel: `track_stock`, `is_serialized`, `is_kit` (+ component editor), reorder point/qty, default location, preferred vendor, `creates_asset_on_delivery`.
- Ticket/project material dialog: stock-availability indicator + serial/MAC picker.
- Dashboard widgets: low-stock (per location), inventory value, open POs, open SOs, **dead units owed to vendors (aging)**, loaners out, expiring warranties.

---

## 9. Migration & rollout notes
- New tables shipped as `.cjs` migrations mirroring the multi-table pattern of `20260101093000_create_ticket_project_materials.cjs` (create tables in dependency order, FKs with appropriate `ON DELETE`, indexes on hot filter columns; reverse in `down`).
- `vendors` backfill migration: distinct freeform `service_catalog.vendor` → `vendors`; populate `preferred_vendor_id`.
- Inventory is **opt-in**: no existing product gets a `product_inventory_settings` row until enabled, so current billing/consumption behavior is unchanged on deploy.
- Seed one default `stock_locations` row per tenant.

---

## 10. Open questions / future phases (V1.5+)
- **Count/reconcile (cycle-count) workflow** — per-location/van count → variance → manager-approved adjustment. *(Top of the list — partially mitigated by location-scoped perms in V1.)*
- Multi-level nested BOM (kits containing kits).
- PO approval chains, 3-way match, vendor bills, landed cost.
- GL/COGS journal dual-write + reconciliation to Xero/QBO.
- FIFO & lot tracking; hard backorder priorities/release rules.
- Full per-warehouse-scoped RBAC.
- Create SO from the quote/contract-template wizard; full quote → SO → PO procure-to-order binding.
- Barcode/serial/MAC scanning; one-button hot-swap flow (receive-swap-relink-open-RMA).

---

## 11. Architecture approaches considered
- **A (chosen):** new inventory domain referencing the catalog via 1:1 `product_inventory_settings`. Clean layering, per-location balances natural, billing untouched, stocked products opt in.
- **B (rejected):** stock columns on `service_catalog` + side ledger. A single product row can't hold per-location balances or serialized units; re-conflates "what we sell" with "how many we have."
- **C (rejected):** separate inventory-item master parallel to the catalog. Forks the product master into two sources of truth → drift and dual maintenance.

---

## 12. Hostile-review change log

Pressure-tested against a role-played phone-systems MSP owner (3 metros, 20 techs, stock-heavy). Disposition:

**Folded in (cheap + central):**
- **MAC address** on `stock_units` (tenant-unique, searchable) — was a fatal miss for a phone shop; provisioning and field lookups key on MAC. Serial uniqueness stays per-product; MAC uniqueness is tenant-wide.
- **Warranty per unit** (`warranty_expires_at`/`warranty_term`) — we claimed warranty lookups as a goal with no field.
- **`on_loan` status** + loaner flow/report — loaners are out-but-not-sold (no COGS).
- **Restock-to-sellable returns** — distinct from defective/RMA; keeps adjustment audit clean.
- **Per-location alert routing** (`stock_locations.manager_user_id`) — no global low-stock firehose.
- **Location-scoped write/adjust permissions** — a tech can't edit another metro's/van's stock.

**Folded in (larger scope, approved):**
- **Advance-replacement RMA** with `dead_unit_due_date` + aging + "dead units owed" widget.
- **Kitting/bundle templates** (`kit_components`) that explode onto an SO and decrement components.
- **Drop-ship to client** (PO ships to client; combined receipt+delivery; no on-hand touch).
- **In-transit transfers** (two-step dispatch→receive via `stock_transfers`) + **optional hard-hold** on confirmed SOs (`allocation_mode`, `held_quantity`).

**Deliberately deferred (V1.5+):** count/reconcile (cycle-count) workflow *(top of list)*, multi-level nested BOM, barcode/MAC scanning, one-button hot-swap, PO approvals, landed cost, GL dual-write, full per-warehouse RBAC.
