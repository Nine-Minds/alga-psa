# PRD: Equipment custody and intake for client-owned devices (alga-2026-0002683, card C4)

Design of record: `ee/docs/plans/2026-10-20-physical-work-tags/design-C4-equipment-custody.md`. This PRD derives from it and does not re-analyse. Where they differ, the design wins (except the adaptations listed in SCRATCHPAD.md).

## Problem
An MSP holds client-owned devices (a dock sent for vendor repair, a walk-in laptop). Today nothing records where the item is, who has it, or who owes the next action. Tracking it as stock would corrupt the inventory ledger and billing.

## Goals
- Custody is a property of assets: `asset_custody` episodes plus append-only `asset_custody_events`.
- Location is a `stock_locations` row plus a free-text bin.
- Ticket action `Receive equipment` (link an existing client asset or create a minimal client asset).
- Move, hand off, ship to vendor, receive back, return to client; each logged and shown on the asset timeline.
- Queue page `/msp/assets/custody` ("Equipment in custody") with preset tabs.
- Ticket work tag shows the shelf and next action (through C2's label seam).
- REST endpoints for MCP/mobile.
- `assets.ownership` (client|msp), `held_by_msp` status.

## Non-goals
RMA writes, carrier/tracking (C5); scanning/deep links (C3); notifications/reminders; bin hierarchy; inventory ledger changes; client-portal exposure; staging (C6).

## Hard invariants
- Intake never touches stock or money: no import of `@alga-psa/inventory` / `@alga-psa/billing`; no writes to stock_units, stock_movements, stock_levels, product_inventory_settings, invoices, charges, time entries, `assets.stock_unit_id`, `assets.service_id`.
- Printing writes nothing; the free-text next-action note never appears on a label; the asset identity label never shows custody; custody of an unreadable asset is dropped from labels.
- No new RBAC resource: `asset:*` plus asset record-level check. REST without access -> 404, no data. `listCustodyLocations` gated by `asset:update`, exposes id, name, type only.
- Queue and "open episode" key off the open `asset_custody` row, never `assets.status`.
- Publish `ASSET_*` and `ASSET_CUSTODY_CHANGED` after commit, errors logged and swallowed. Intake does not call `createAssetAssociation`.

## Data model
See design D2. Episode states `in_office|with_vendor|closed`; events `received|moved|handed_off|shipped|returned`; non-physical edits write `asset_history` `custody_updated`. Partial unique index one open episode per asset; CHECKs; Postgres append-only trigger (skipped on Citus).

## UX
Asset detail Custody card with dialogs; timeline `custody_*` sentences; list filters (In MSP custody, Ownership) and badge; ownership select in asset form; ticket header `Receive equipment` beside `Print work tag` (render prop `renderReceiveEquipment`); custody chip in `AssociatedAssets`; queue page with tabs All open / In office / Waiting on vendor / Waiting on client pickup / Overdue follow-up, filters and DataTable action menu. All copy via i18n keys.

## Acceptance (scenario)
Receive a client's dock on a ticket onto "Main Office / Shelf B3", next action vendor, follow up in 5 days; the ticket work-tag view model shows the shelf; move to "Shelf C1"; timeline shows both positions and the move; the queue lists it. Browser walkthrough is a later step.

## Risks
Citus: no DB-level append-only guarantee; partial unique index includes the distribution column. Label line budget: custody lines replace the `detail` line.
