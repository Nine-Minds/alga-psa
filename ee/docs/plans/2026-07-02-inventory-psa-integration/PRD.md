# PRD — Inventory ↔ PSA Integration ("make it interconnected")

**Date:** 2026-07-02 · **Branch:** feature/inventory-module · **Status:** approved scope (Robert), details delegated

## Problem statement

A fresh-eyes integration audit (4 parallel explorations, 2026-07-02) found the inventory module deeply
wired at the data layer but nearly invisible from the screens where users live, and entirely invisible
to platform infrastructure (search, notifications, automation, public API). The PSA promise is
interconnection; inventory currently delivers it only inside its own `/msp/inventory` wing.

Six approved work items:

1. **Quote→SO conversion + SO client linkage** — quote-to-cash has a hole in the middle: accepted
   quotes convert only to contracts/invoices; SO creation asks for a raw client UUID; no links
   SO↔client, SO↔invoice, SO↔quote.
2. **Stock visibility at the point of use** — ticket/project material pickers show no on-hand, no
   warnings; consumption can silently drive stock negative (no guard in `applyOnHandDelta`).
3. **Client 360 + asset provenance** — client detail has no equipment/orders/RMA presence; asset
   detail never reads the `service_id`/`stock_unit_id` links inventory writes; auto-created assets
   are `asset_type='unknown'`.
4. **Inventory domain events** — inventory publishes nothing to the event bus, so it is absent from
   global search, workflow automation, and notifications. One hook unlocks all three.
5. **Money story** — `invoice_charges.so_line_id` stored but never surfaced; no per-line COGS/margin;
   `marginReport` action unwired; contract profitability is labor-only; vendor bills don't reach the
   accounting export (QBO/Xero are AR-only).
6. **Correctness** — material add/delete logic triplicated (tickets/projects/billing) with divergent
   behavior: REST API `TicketService.addTicketMaterial` never consumes stock; tickets UI copy has no
   `hasPermission` gate; seeded `vendor`/`stock_transfer`/`stock_location` permissions unenforced.

## Goals

- Close the quote→SO→fulfillment→invoice journey with real conversions and clickable links both ways.
- Give techs on-hand visibility and a hard floor against negative stock on the consumption path.
- Surface equipment/orders/RMA history on client detail and inventory provenance on asset detail.
- Publish inventory domain events; wire them into search indexing, workflow event catalog, and
  internal notifications (low stock, PO received).
- Show SO backlinks and COGS/margin on internal invoice views; include hardware COGS in contract
  profitability; register the margin report centrally; export vendor bills to QBO.
- One canonical material mutation path (UI, projects, billing, REST API) with consistent stock
  consumption and permission gating.

## Non-goals

- **Activity feed**: `ActivityType` is user-actionable-item oriented (schedule/tasks/tickets);
  inventory events don't fit the drawer model. Deferred, unblocked by the event work.
- **Xero vendor-bill export**: QBO only in this pass; the export engine gains the `vendor_bill`
  export_type generically so Xero can follow.
- **Public `/api/v1` inventory resources**: REST API surface is a separate effort (only the
  material-parity fixes in item 6 touch the API layer).
- **Customer-facing COGS/margin**: margin renders on internal views only, never on customer
  PDFs/portal.
- **Task-level project materials** (stays project-level).
- **Mobile/camera-scan** (separate roadmap item).

## Users & flows

- **Tech on a ticket**: picks a part, sees on-hand at their default/van location, gets warned at/below
  reorder point, is blocked (with the available quantity in the error) if consumption would go
  negative.
- **Sales/dispatcher**: converts an accepted quote's product lines into a draft sales order (invoice
  mode `on_fulfillment` so nothing double-bills); picks clients from the standard picker; clicks
  through SO→client, SO→invoice, SO→quote.
- **Account manager**: opens client → Equipment tab → sees sales orders, delivered serialized
  equipment (linked to assets), and RMAs. Opens an asset → sees product/SKU, origin SO, RMA history.
- **Owner**: contract profitability now includes hardware COGS; margin report is a first-class report;
  invoice internal view shows per-line margin; vendor bills flow to QBO.
- **Automation author**: builds workflows triggered by `INVENTORY_STOCK_LOW`, `INVENTORY_PO_RECEIVED`,
  `INVENTORY_SO_FULFILLED`, `INVENTORY_RMA_CREATED`.

## Design decisions (made under delegated authority; revisit if wrong)

- **D1 — Negative stock is blocked on the consumption path only.** `recordStockConsumption` refuses
  insufficient non-serialized tracked stock (error names available qty). Adjustments, counts, and
  receiving remain free to set any level — they are the correction mechanisms. Rationale: COGS layers
  and valuation corrupt under negative on-hand.
- **D2 — Quote products → sales order, not direct invoice.** When the user opts into SO conversion,
  product one-time lines move to a draft SO (`invoice_mode='on_fulfillment'`) and are excluded from
  the draft-invoice conversion — the existing SO→invoice bridge does the billing. No double-bill.
  Conversion remains user-chosen in the conversion dialog (contract/invoice paths unchanged).
- **D3 — Canonical materials service lives in `packages/inventory`** (`src/lib/materials.ts` +
  actions). Dependency direction forces this: tickets depends on inventory but not billing.
  Tickets/projects/billing actions and REST `TicketService` all delegate; permission gating
  (billing-parity semantics) happens in the canonical layer.
- **D4 — Stock-low events are edge-triggered**: emitted when a consumption/fulfillment crosses the
  reorder point downward, not on every operation below it.
- **D5 — Search gains 3 object types**: `sales_order`, `purchase_order`, `stock_unit` (serial + MAC
  searchable). Products already surface via the existing `service_catalog` indexer (has `sku`).
- **D6 — Events emit post-commit** (same idiom as `createAndLinkDeliveredAsset`), never inside the
  transaction.
- **D7 — Client Equipment tab is one tab, three sections** (Sales Orders / Equipment / RMAs), hidden
  without `inventory:read`.
- **D8 — Asset type mapping**: `product_inventory_settings.default_asset_type` (nullable) applied by
  `createAndLinkDeliveredAsset`; fallback stays `'unknown'`.
- **D9 — QBO vendor-bill export** matches vendors by name with create-if-missing, maps lines to a
  default expense account (configurable later); export status tracked like invoice exports.

## Data model / migrations

- `sales_orders.quote_id` uuid nullable + FK quotes (tenant-qualified), index.
- `product_inventory_settings.default_asset_type` text nullable.
- Notification category `inventory` + subtypes (`inventory-low-stock`, `inventory-po-received`) seeds.
- `event_catalog` seeds for the 4 inventory event types.
- No changes to stock tables; the negative guard is code-level (inside the existing row-lock).

## Risks

- **QBO bill export** is the deepest unknown (adapter surface area). If the adapter pattern doesn't
  accommodate bills cleanly, checkpoint with Robert before inventing new infrastructure.
- **Cross-lane file collisions**: `salesOrderActions.ts` and `fulfillmentActions.ts` are touched by
  multiple slices — events lane (S4) runs in wave 2 after S1/S6 merge.
- **Consolidation regressions**: the canonical materials path replaces three live code paths; the
  DB-backed test suite (T-series) is the guard.

## Acceptance / definition of done

- All features in `features.json` implemented; tests in `tests.json` green (DB suite runs against
  migrated schema); `npx tsc --noEmit` clean in server; browser smoke of each new surface on the dev
  stack (port 3578, EE); features/tests flags updated; SCRATCHPAD updated with discoveries.
