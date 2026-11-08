# PRD: Warranty review and RMA for client-owned equipment (alga-2026-0002683, card C5)

Card C5 of the physical work-tags stack. Design of record for the warranty/RMA slice. It builds on
`ee/docs/plans/2026-10-20-physical-work-tags/PLAN.md` and `ANALYSIS.md`; where this document settles
something differently, this document wins for C5.

Code references were re-checked against `origin/main` at `b87dbb98ba` (2026-10-25). C1 (label
foundation), C2 (print work tags) and C3 (scan to open, `getRmaCase`, `?rmaId=` RMA detail dialog) are
merged on that base. C4 (equipment custody) is **not** merged; C5 assumes it as its parent and must
rebase onto it before implementation.

## Provenance and dependencies

| Dependency | Status at design time | What C5 uses |
|---|---|---|
| C1 label foundation | merged | `recordLinks.ts` (`recordUrl('rma', id)`), `work-tag` document type, `barcode` AST node, `LabelViewModel`, `POST /api/labels/pdf` |
| C2 print work tags | merged | `useLabelPrint` (`packages/ui/src/components/labels/useLabelPrint.ts`), tenant `labelSettings.hiddenFields`, `printLabels` composition root |
| C3 scan to open | merged | `getRmaCase`, `/msp/inventory/rma?rmaId=` detail dialog in `RmaManager.tsx`, `recordPath('rma')` |
| C4 equipment custody | **not merged** | `assets.ownership`, `held_by_msp` status, `asset_custody` / `asset_custody_events`, `packages/assets/src/lib/custody/*` cores, `assetReadAuthorization.ts`, `ASSET_CUSTODY_CHANGED`, `CustodyBadge` |
| B2 scan-lookup asset permission | merged (C3 hardened asset REST) | not reused; C5 adds its own record gate for RMA reads |

C5 must not re-implement custody, intake, locations, holders or the asset record check. It calls C4's
cores inside its own transaction and reads C4's tables only for display.

## The customer story

Joymode's client returns a Dell dock that has stopped charging. It arrives at the MSP on a ticket (C4
`Receive equipment`), sits on "Main Office / Shelf B3", and the next action is the vendor. The
technician opens a **warranty claim** on the dock: is it covered, who is the vendor, what is their
case number, when must it be back?

The claim moves through: **intake → evaluate → vendor RMA → replacement/return → close**, while the
physical device is tracked separately by C4:

1. **Open** a claim against the client asset, from the RMA page or from the asset's Warranty card.
   The ticket and custody episode come along; the claim gets its own number (`RMA-00007`).
2. **Evaluate**: in warranty / not covered, vendor, case reference, return-by date. Approval picks the
   standard (we ship first) or advance-replacement (vendor ships first) track.
3. **Ship** the device to the vendor with carrier and tracking. Custody moves to `with_vendor`.
4. **Resolution**: vendor sends a replacement, repairs the same unit, or credits it. Inbound carrier
   and tracking are recorded. A replacement updates the same asset — no stock row is created.
5. **Close**: the device goes back to the client (custody closes as returned), or the claim closes with
   a reason when the vendor keeps or scraps it.
6. **Print** the RMA tag (4×2 in label with a QR) and a return slip that travels in the box.

None of this touches sellable stock, cost or billing: a client's device is never stock.

## Non-goals

- **Custody itself** — intake, locations, bins, holders, the equipment queue, custody events: C4.
- **Project staging, boxes, manifests**: C6.
- **Stock-unit RMAs.** An asset with `stock_unit_id` is a device the MSP sold from stock; its physical
  unit already carries a ledger identity. C5 routes those to the existing "Open RMA" unit flow and
  changes none of its actions. Warranty claims in this card are asset-only (`returned_unit_id IS NULL`).
- **Vendor-only conversation audiences on tickets.** As `PLAN.md` says, that is the ticket-conversations
  card. C5 keeps the vendor case on the RMA and offers a one-click mirror to the ticket's external links.
- **REST/API-key endpoints for RMAs.** RMA has none today (verified: no route under `server/src/app/api/**`
  other than the sales-order document path, and no `rma` method on `ApiInventoryController` /
  `InventoryService`). Mobile RMA screens are explicitly out of scope in C3.
- **Notifications and scheduled reminders.** The claim's `return_by` date appears in the list and the
  overdue queue view; no scheduler is added.
- **Retrofitting `rma_events` onto the existing stock-unit actions.** Documented follow-up.
- **Client portal exposure.** No RMA data reaches the portal.
- **Payment/credit handling for a vendor credit.** `rma_cases.charge_invoice_id` stays for the existing
  charged-dead-unit flow; a vendor credit is recorded, not invoiced.

## Data model

### `rma_cases` (alter)

Existing columns verified in `server/migrations/20260626100400_create_inventory_transfers_rma.cjs` and
`20260701092000_inventory_schema_hardening.cjs`: `rma_type`, `returned_unit_id`, `service_id`,
`client_id`, `asset_id`, `vendor_id`, `rma_reference`, `reason`, `status`, `replacement_unit_id`,
`dead_unit_due_date`, `dead_unit_returned_at`, `opened_at`, `closed_at`, `created_by`, timestamps.
There is no `ticket_id`, no number, no carrier, no tracking, no warranty decision and no per-case
history.

New columns:

| Column | Type | Notes |
|---|---|---|
| `rma_number` | `text NOT NULL`, unique `(tenant, rma_number)` | Human identifier for labels and the return slip. Allocated through `SharedNumberingService` as entity type `RMA`, prefix `RMA-`, 5 digits. |
| `ticket_id` | `uuid NULL` | FK `tickets`. Derived from the open custody episode, never free-typed. |
| `custody_id` | `uuid NULL` | FK `asset_custody` (C4). Which stay at the MSP this claim belongs to. |
| `warranty_outcome` | `text NULL` | `covered` \| `not_covered` \| `unknown`. Null until decided. |
| `warranty_decided_at` | `timestamptz NULL` | |
| `warranty_decided_by` | `uuid NULL` | FK `users`. |
| `denial_reason` | `text NULL` | Required when the outcome is `not_covered`. |
| `closed_reason` | `text NULL` | `resolved` \| `warranty_denied` \| `cancelled` \| `duplicate` \| `vendor_credited`. Existing rows backfill to `resolved` when `closed_at IS NOT NULL`. |
| `outbound_carrier`, `outbound_tracking_number` | `text NULL` | Free text; carrier suggestions are distinct prior values, the way C4 suggests bins. |
| `outbound_shipped_at` | `timestamptz NULL` | Set when the device leaves. |
| `inbound_carrier`, `inbound_tracking_number` | `text NULL` | The vendor's return shipment. |
| `inbound_received_at` | `timestamptz NULL` | |
| `return_by` | `date NULL` | The vendor's promised return date. Calendar date, not a timestamp. |
| `return_ship_to` | `text NULL` | Ship-to block for the return slip. `vendors` has no address (verified: name, contact, email, phone, website, terms, account, notes only), so this is a snapshot the technician can edit; defaults to the vendor name. |
| `replacement_serial_number` | `text NULL` | What the vendor sent back, kept on the case after the asset row is updated. |
| `replacement_received_at` | `timestamptz NULL` | |

Status CHECK gains `warranty_review` and `repaired`; the check is re-stated with the full list (the
existing hardening migration already drops and re-adds it). `dead_unit_returned` is removed from the
`RmaStatus` union and the RMA UI because the DB CHECK stopped accepting it in
`20260701092000_inventory_schema_hardening.cjs` — the filter and badge for it are dead code today.

Indexes: `(tenant, ticket_id)`, `(tenant, asset_id)`, `(tenant, status, return_by)`.

### `rma_events` (new)

Append-only per-case history. `rma_cases` today mutates `status` with no record of who or why; a
warranty decision needs an audit trail independent of C4's custody log.

| Column | Type | Notes |
|---|---|---|
| `tenant`, `event_id` | `uuid` | PK `(tenant, event_id)` |
| `rma_id` | `uuid` | composite FK to `rma_cases` |
| `event_type` | `text` | `opened` \| `warranty_approved` \| `warranty_denied` \| `device_received` \| `shipped_outbound` \| `vendor_case_recorded` \| `replacement_received` \| `repair_received` \| `vendor_credited` \| `returned_to_client` \| `closed` \| `note` |
| `from_status`, `to_status` | `text NULL` | Snapshot, so history survives a later CHECK change. |
| `occurred_at`, `recorded_at` | `timestamptz` | `occurred_at` may be back-dated. |
| `actor_user_id` | `uuid NULL` | FK `users`. |
| `carrier`, `tracking_number` | `text NULL` | Shipping events. |
| `note` | `text NULL` | |
| `payload` | `jsonb NOT NULL DEFAULT '{}'` | Before/after for warranty fields and replacement details. |
| `document_ids` | `jsonb NOT NULL DEFAULT '[]'` | Photos (C4's document pattern), e.g. the courier receipt. |

Rules copied from `stock_movements` / `asset_custody_events`: insert-only; a Postgres trigger rejects
UPDATE and DELETE; on Citus the guarantee is app discipline (triggers are not allowed on distributed
tables). Only `recordRmaEvent` inserts.

### Tenancy, Citus and RLS

Both tables are tenant-scoped by `tenant` and distributed with `ensureTenantDistribution`, colocated
with `tenants`; composite FKs include `tenant`. No RLS policy is added — the inventory tables
(`rma_cases`, `stock_units`) use app-level scoping plus Citus distribution, not RLS, and a new policy
here would be the only one in the module. Register `rma_events` in
`packages/db/src/lib/tenantTableMetadata.ts` and the migration shim `server/migrations/utils/tenantDb.cjs`
in the same change.

### Migrations

Follow the current naming convention (`server/migrations/YYYYMMDDHHMMSS_snake_case.cjs`), ordered after
C4's `20261024100000`:

1. `20261025100000_add_warranty_review_to_rma_cases.cjs` — columns, CHECKs, indexes, `rma_number`
   backfill (`ROW_NUMBER()` per tenant, padded, no collisions), seed `next_number` for `RMA` at the
   backfilled maximum, register composite FKs to `tickets` / `asset_custody` / `users`. Transactional.
2. `20261025100100_create_rma_events.cjs` — table, CHECKs, indexes, Citus distribution, append-only
   trigger. `exports.config = { transaction: false }` (distribution cannot run in a transaction).
3. `20261025100200_add_warranty_permissions.cjs` — the `warranty` resource for existing tenants plus
   default grants (pattern: `20260626100600_add_inventory_permissions.cjs`).
4. `20261025100300_upsert_inventory_rma_updated_event_catalog.cjs` — `INVENTORY_RMA_UPDATED` in
   `system_event_catalog` (pattern: `20260702150000_seed_inventory_event_catalog.cjs`).

If C4 is not merged, migration 1 fails on the `asset_custody` FK. That is intentional: C5 is not
deployable without C4.

## State machine

One record, two tracks, plus the pre-authorisation stage this card adds. Every transition takes the
`rma_cases` row `FOR UPDATE` (the existing `loadRma` lock) and asserts the allowed source statuses
(`assertStatus`), so concurrent transitions serialize.

| # | From | Action | To | May perform | Side effects |
|---|---|---|---|---|---|
| 1 | — | `openWarrantyClaim` | `warranty_review` | `warranty:create` + `asset:read` + record check; ticket check in composition | `rma_number` allocated; `client_id`, `ticket_id`, `custody_id` derived; `rma_events.opened`; `INVENTORY_RMA_CREATED` |
| 2 | `warranty_review` | `approveWarrantyClaim` (standard) | `awaiting_return` | `warranty:update` | outcome `covered`, `rma_type='standard'`, decision fields, `warranty_approved`, `INVENTORY_RMA_UPDATED` |
| 3 | `warranty_review` | `approveWarrantyClaim` (advance) | `open` | `warranty:update` | outcome `covered`, `rma_type='advance_replacement'`, same events |
| 4 | `warranty_review` | `denyWarrantyClaim` | `closed` | `warranty:update` | outcome `not_covered`, `denial_reason`, `closed_reason='warranty_denied'`, `warranty_denied` |
| 5 | `warranty_review` | `cancelWarrantyClaim` | `closed` | `warranty:update` | `closed_reason` `cancelled`\|`duplicate` |
| 6 | `awaiting_return` | `markDeviceReceived` | `returned` | `warranty:update` + `asset:update` + record check | requires an open custody episode in `in_office`; **no stock rows**; `device_received` |
| 7 | `returned` | `shipToVendor` | `sent_to_vendor` | `warranty:update` + `asset:update` | requires `vendor_id`, outbound carrier + tracking, `return_by`; C4 `recordCustodyEvent('shipped')`; `shipped_outbound` |
| 8 | `open` | `receiveVendorReplacement` | `replaced` | `warranty:update` + `asset:update` | inbound shipping; asset updated in place; C4 `recordCustodyEvent('received')`; `replacement_received` |
| 9 | `sent_to_vendor` | `receiveVendorReplacement` | `replaced` | same as 8 | same as 8 |
| 10 | `sent_to_vendor` | `recordVendorRepair` | `repaired` | `warranty:update` + `asset:update` | same unit back; `repair_received` |
| 11 | `sent_to_vendor` / `open` | `recordVendorCredit` | `credited` | `warranty:update` | closes the custody episode as `disposed`; `vendor_credited` |
| 12 | `replaced` / `repaired` | `returnDeviceToClient` | `closed` | `warranty:update` + `asset:update` | C4 `returnCustodyToClient` in the same transaction; `closed_reason='resolved'`; `returned_to_client` |
| 13 | `replaced` / `repaired` / `credited` / `returned` | `closeRma` (existing) | `closed` | `warranty:update` | `closed_reason` required when absent; `closed` event |
| 14 | `warranty_review` | `closeRma` | — | — | **refused**: a claim must be approved, denied or cancelled, so it cannot be closed by the generic catch-all |

Track choice is a parameter of approval, not a new `rma_type`: `rma_type` stays `standard` |
`advance_replacement`, provisional at creation and written on approval. That keeps every existing
query, switch and CHECK unchanged.

Asset-only and stock-unit cases share the table but not the writers: actions 2–14 branch on
`returned_unit_id`. If it is set, the existing unit actions (`receiveReturn`, `sendToVendor`,
`resolveReplacement`, `deployReplacement`, `resolveCredit`, …) remain the only path, untouched. If it is
null, the actions above run and no code path may call `rmaServiceId` or `recordStockMovement`.

Custody is the single source of physical truth. RMA status does not encode where the device is:
`sent_to_vendor` and a custody `with_vendor` episode are the paired facts, and only C4's event log
records movement. `markDeviceReceived` asserts custody rather than writing it, so a technician cannot
mark a device received while it is still on the client's site.

## Integration with C4 (do not duplicate)

- **Claim creation** reads the open `asset_custody` episode for the asset to derive `ticket_id` and
  `custody_id`. If the device is not yet in custody, the claim can still be opened (the vendor may be
  evaluating from the serial number); `custody_id` stays null until the device arrives.
- **Ship** calls `recordCustodyEvent(trx, tenant, actor, custodyId, { eventType: 'shipped', carrier,
  trackingNumber, occurredAt, note })`. C5 never writes `asset_custody`.
- **Replacement/repair receipt** calls `recordCustodyEvent(..., { eventType: 'received' })`, putting the
  episode back `in_office`. If the vendor ships straight to the client, the technician returns the
  episode with C4's `returnCustodyToClient` instead.
- **Closing to the client** calls C4's `returnCustodyToClient` in the same transaction as the RMA close,
  so a case cannot be closed with the device still on our shelf.
- **Vendor credit** closes the episode as `disposed` through a new C5 core
  (`closeCustodyEpisode(trx, tenant, actor, custodyId, 'disposed')`) added beside C4's cores. C4's
  schema already allows `close_reason='disposed'`; C4 only ever wrote `returned_to_client`. This is an
  extension of C4's engine, not a second one: same table, same state, same history row, same
  `ASSET_CUSTODY_CHANGED` publish.
- **Reads**: the Warranties card uses C4's `isAssetReadAllowed` / `filterReadableAssets`
  (`packages/assets/src/lib/assetReadAuthorization.ts`), not a new permission check.

## What C5 assumes is already on main

- `packages/types/src/lib/recordLinks.ts` resolves `rma` → `/msp/inventory/rma?rmaId={id}`.
- `POST /api/labels/pdf` accepts `labelClass`, renders through `printLabels`, and `LABEL_CLASSES` is the
  single registry of classes.
- `RmaManager` reads `?rmaId=` and shows the detail dialog via `getRmaCase`.
- C4's `asset_custody`, `asset_custody_events`, `assets.ownership`, `held_by_msp`, custody cores and
  asset read kernel exist, are distributed, and write `asset_history` summaries.
- `assets.client_id` is NOT NULL (verified in `20241112031330_create_asset_management_tables.cjs` as
  `company_id`, renamed later) and `assets.warranty_end_date` / `vendor_id` exist
  (`20261009120000_add_asset_procurement_fields.cjs`).

## Permissions

Verified in `server/migrations/utils/permissions/catalog.cjs`: `asset` read/update are granted by
default to Admin/Manager/Technician (read also Dispatcher/Finance/Project Manager); `inventory:*` is
granted **only to `msp:Admin`**. The customer's technician therefore cannot read or write RMAs with
default roles today.

Decision: add one MSP-only resource, **`warranty`** (`read`, `create`, `update`), default-granted to
Admin, Manager and Technician, and gate the warranty-claim actions and the RMA page on it. The existing
stock-unit RMA actions keep `inventory:*`, so nothing that exists today is narrowed. A small helper
accepts either the new resource or the legacy inventory action, so a tenant that granted `inventory:read`
to a custom role does not lose the RMA page.

| Operation | Requires |
|---|---|
| List/detail an RMA | `warranty:read` or `inventory:read`; plus the asset record check when `asset_id` is set |
| Open a claim | `warranty:create`, `asset:read` + asset record check |
| Open a claim from a ticket | the above, plus `ticket:read` + `authorizeTicketRecordAccess` (composition layer) |
| Approve/deny/cancel, ship, receive, credit, close | `warranty:update` |
| Any step that writes `assets` or custody | additionally `asset:update` + the asset record check |
| Print the RMA tag | `warranty:read` (+ asset record check through the provider) |
| Download the return slip | `warranty:read` (+ record check) |

Record-level gate on reads: an RMA row with `asset_id` is visible only when the caller can read that
asset. This is a deliberate behaviour change for stock-unit RMAs linked to an asset; default roles that
have `inventory:read` also have `asset:read`, and a test pins the filtered list.

## API routes

- **No `/api/v1` endpoints.** RMAs stay server-action-driven, as they are today.
- **New session route** `GET /api/inventory/rma/[id]/document?type=return-slip` — returns the return
  slip PDF. Mirrors the sales-order document route exactly: lives under `/api/inventory` (not `/api/v1`),
  authenticates in-handler with `withAuth`, and is added to `shouldSkipApiKeyAuth` in
  `server/src/middleware.ts` beside the sales-order entries. It lives in `server/` because
  `packages/inventory` may not import `packages/billing`.
- **Existing route reused** `POST /api/labels/pdf` for the RMA tag; C5 registers an `rma-work-tag`
  provider and adds the class to `LABEL_CLASSES`.

## UI surfaces

| Surface | File | Change |
|---|---|---|
| RMA page | `server/src/app/msp/inventory/rma/page.tsx`, `packages/inventory/src/components/RmaManager.tsx` | Warranty-review tab/filter, new statuses, `RMA #` column shows `rma_number`, `New warranty claim` action, `?assetId=` opens the prefilled claim dialog |
| RMA detail dialog | `packages/inventory/src/components/rma/RmaWarrantyPanel.tsx` (new), wired into `RmaManager` | Warranty decision, vendor case, shipping, return-by, actions per state, links to asset and ticket, `Print RMA tag`, `Print return slip` |
| Claim dialog | `packages/inventory/src/components/rma/NewWarrantyClaimDialog.tsx` (new) | Asset picker over held equipment (C4 `listHeldEquipment`), reason, vendor, coverage; refuses assets with a stock unit and points at "Open RMA" |
| Asset detail | `packages/assets/src/components/warranty/WarrantyCard.tsx` (new) in `AssetBentoLayout.tsx` | Warranty end, vendor, ownership, claim history, `Start warranty claim` (navigates to the RMA page with `?assetId=`), `Open RMA` |
| Asset list / ticket | `packages/assets/src/components/warranty/RmaBadge.tsx` (new), `AssociatedAssets.tsx` | "RMA RMA-00007 · sent to vendor" chip beside C4's custody chip; silent on refusal |
| Asset provenance | `packages/assets/src/actions/assetInventoryActions.ts`, `AssetInventoryProvenance.tsx` | RMA history for asset-only claims (the early return currently skips assets with no `service_id`/`stock_unit_id`) and the real `rma_number` instead of `rma_reference` |
| Designer | existing document-template routes | `rma-return-slip` appears as a document type; the RMA label is a `work-tag` standard template |

Printing stays read-only: no `rma_events`, `asset_history`, custody or stock row is written by a print
or a PDF download.

## Events and audit

- **`rma_events`** (new table) — the per-case audit trail described above.
- **`asset_history`** — one row per asset mutation made by C5:
  `warranty_replacement` (serial, model, manufacturer, `warranty_end_date` before/after) and
  `custody_disposed` for the credit path. Written inside the same transaction.
- **`INVENTORY_RMA_UPDATED`** (new workflow event) — published after commit, errors logged and
  swallowed, exactly like `INVENTORY_STOCK_UNIT_UPDATED`. Payload: `tenant`, `rma_id`, `rma_number`,
  `status`, `previous_status`, `rma_type`, `asset_id`, `ticket_id`, `client_id`, `warranty_outcome`,
  `changed_fields`, `user_id`, `timestamp`. Needs a schema in `packages/event-schemas`, an entry in
  `eventBusSchema.ts` and `workflowEventCatalog.ts`, a builder in `shared/workflow/streams`, and the
  catalog upsert migration.
- **`ASSET_UPDATED`** — via `publishAssetChanged` (`packages/assets/src/lib/assetChangeEvents.ts`) when
  the replacement changes the asset row.
- **`ASSET_CUSTODY_CHANGED`** — emitted by C4's cores, not republished by C5.
- **`external_entity_links`** — the vendor case can be mirrored onto the ticket from the RMA dialog,
  pre-filled with the tenant's `custom:<slug>` vendor-case system. It is a one-click action, not an
  automatic second write: `rma_reference` on the RMA stays the single source of truth, and the write
  stays with the package that owns the link contract (`addExternalLink`). An automatic mirror would
  immediately be able to disagree with the RMA.

## Invariants

1. A client-owned device on a warranty claim never creates or changes `stock_units`, `stock_movements`,
   `stock_levels`, `product_inventory_settings`, `invoice_charges` or time entries. Enforced by an
   integration test that counts rows across the whole flow.
2. A replacement updates the **same** `assets` row; the previous serial stays in `asset_history` and
   `rma_events`. The client keeps one asset identity per device.
3. RMA status and custody state are separate facts; no RMA transition writes custody state except
   through C4's cores.
4. Printing and PDF download are read-only.
5. Every transition is status-guarded under a row lock and writes exactly one `rma_events` row.
6. Unauthorized and missing records are indistinguishable (404 / empty list), as in C3's label path.

## Open product questions

| # | Question | Recommended default |
|---|---|---|
| 1 | Does a warranty claim need its own number? | **Yes.** `RMA-00007` via `SharedNumberingService`, because the label and the return slip need a human identifier before a vendor reference exists, and the list currently shows the first 8 hex characters of a UUID. |
| 2 | Replacement identity: update the existing asset, or create a new asset and archive the old? | **Update in place.** One client device, one asset id, one history; an archived duplicate would fragment the asset list and break C4's custody episode link. |
| 3 | Where does the vendor ship-to address come from? | **A free-text `return_ship_to` snapshot on the case**, defaulting to the vendor name. `vendors` has no address columns; adding them is a vendor-master change, not this card. |
| 4 | On a denial, does the case close immediately or wait for the device to go back? | **Close on denial** (`warranty_denied`). The physical return is C4's job and may take days; the claim's commercial outcome is already decided. The RMA detail offers "Return device to client" as a shortcut. |
| 5 | On a vendor credit, how does custody end? | **Close the episode as `disposed`** through the new C5 core. C4's CHECK already allows it; leaving `with_vendor` forever would make the equipment queue lie. |
| 6 | Does the return slip belong in C5? | **Yes**, as one standard template. It is the paper that travels with the device; without it the vendor receives an unlabelled box. |
| 7 | Should reading an RMA require `asset:read` for rows with an asset? | **Yes.** RMAs are now scannable and carry asset identity; the same reasoning as B2. Existing roles are unaffected by default. |
| 8 | New `warranty` permission resource, or widen `inventory:*`? | **New resource**, granted to Admin/Manager/Technician. Widening `inventory:*` would hand technicians purchase orders and stock adjustments to fix a warranty workflow. |

## Risks and failure modes

| Risk | Mitigation |
|---|---|
| C4 is not merged; migration 1's `asset_custody` FK fails, or the custody core signatures differ after rebase. | Rebase onto C4 first; the claim path is written against the cores (`recordCustodyEvent`, `returnCustodyToClient`), not the actions. Re-verify signatures before step 1. |
| An asset-only claim accidentally reuses `resolveReplacement` / `receiveReturn`, creating a stock unit. | Separate functions; a table-count integration test across the flow; a code review checklist item that the asset-only module never imports `recordStockMovement`. |
| Existing stock-unit RMAs change behaviour (read gate, `closeRma` hardening, status CHECK). | Branch on `returned_unit_id`; keep existing actions byte-identical; pin the old paths with regression tests. |
| `rma_number` backfill collides with the numbering sequence. | Backfill computes per-tenant max and seeds `next_number` in the same migration; a unique index makes any mistake fail loudly. |
| Two writers disagree about "shipped" (RMA status vs custody state). | Only `shipToVendor` writes both, in one transaction, and only through C4's core. |
| The return slip duplicates the RMA read model that inventory owns. | Billing reads the tables (as the sales-order document action already does); the template binds a single view model built in one place; add `// LEVERAGE: pattern` if a third document type repeats it. |
| Label line budget (C1) overflows with vendor + case number. | Standard RMA tag uses `identifier` (RMA number), `title` (device), `detail` (vendor), and the QR; case number goes on the return slip, not the 4×2 label. |
| The vendor case link drifts from `rma_reference`. | The mirror is an explicit action with a snapshot; the RMA is the source of truth, and the link notes the RMA number. |
| i18n coverage. | All copy through keys under `features/inventory` (`rma.*`) and `msp/assets` (`warranty.*`) in every locale directory `server/public/locales/*/`. |

## Test coverage

`features.json` numbers every acceptance criterion (`F001.1`, `F001.2`, …); `tests.json` maps each to at
least one unit, integration or e2e row. Criteria covered **only** at e2e level (no lower-level test can
prove them):

- `F018.3`, `F019.5` — the claim and detail dialogs work end to end from the RMA page and from an asset.
- `F020.4` — the chip appears on the ticket's associated-asset row.
- `F022.4` — the standard RMA tag prints on a 4×2 in cell with a decodable QR and no text outside the cell
  (the label batch e2e is the only harness that renders a real PDF and decodes it).
- `F023.4` — the return slip downloads from the RMA dialog and contains the shipping block.
- `F029.2` — the full Dell scenario (intake → claim → approve → ship → replacement → return → close).

## Ordered implementation sequence

1. **Migrations, types, registries.** `rma_cases` columns + CHECK + backfill + numbering; `rma_events`;
   `warranty` permissions + catalog; tenant metadata/shim; `IRmaCase`/`IRmaEvent`; `RmaStatus` cleanup.
2. **Pure state machine and event writer** (`packages/inventory/src/lib/rma/`) with unit tests. No UI,
   no action wiring yet.
3. **Asset-side cores** (`packages/assets/src/lib/warranty/`): apply replacement in place (history +
   changes), `closeCustodyEpisode('disposed')`, warranty summary and badge reads. Unit + integration.
4. **Server actions** (`rmaWarrantyActions.ts`) for transitions 1–14, plus the ticket-aware wrapper in
   `packages/msp-composition`. Integration tests for refusals, permission gates and the no-stock
   invariant.
5. **Reads**: `listRmaCases`/`getRmaCase` new columns + asset record filter + warranty summary.
6. **UI**: RMA page/tabs/detail panel, claim dialog, asset Warranty card, RMA chip.
7. **Printing**: RMA label class + provider + standard template; return-slip document type, action and
   route; replace `labelPrintClient.ts` with `useLabelPrint`.
8. **Events and audit**: `INVENTORY_RMA_UPDATED` + catalog migration; `asset_history` summaries; vendor
   case mirror.
9. **i18n, e2e scenario, docs.**

Steps 2, 3 and 7 are independent once step 1 lands. Step 6 needs 4 and 5. Step 8 can trail step 4.

## Acceptance (Dell scenario)

Receive a client's Dell dock on a ticket into custody (Main Office / Shelf B3, next action vendor).
Open a warranty claim from the asset: it gets `RMA-00001`, carries the ticket and custody episode, and
sits in `warranty_review`. Approve as covered, standard track, vendor Dell with case `123456789`.
Ship it: outbound carrier and tracking recorded, custody shows "With vendor", the RMA shows
`sent_to_vendor`, and the ticket's asset row shows an RMA chip. The vendor sends a replacement: record
the new serial and inbound tracking; the asset keeps its id but shows the new serial, `warranty_end_date`
and an `asset_history` entry. Return the device to the client: the RMA closes as resolved and custody
closes as returned. Print the RMA tag before shipping and the return slip for the box. Throughout, no
`stock_units`, `stock_movements`, `stock_levels` or billing rows change.

## Follow-up: vendor conversation link

Shipped without the vendor-conversation link because the ticket-conversations branch is not merged. Today the vendor case number lives on the RMA (`rma_reference`) and can be mirrored to the ticket's external links with one click (a `generic` reference link). Once ticket conversations land, link the vendor email thread to the ticket and the RMA, then remove the generic mirror (`LEVERAGE: friction rma-vendor-case-link`).

## Follow-up: advance-replacement dead-unit shipping

Shipped on the assumption, never stated outright until a review caught it, that the vendor's return
logistics for the dead unit in the advance-replacement track **bypass Alga's custody entirely** (a prepaid
label, the client deals with the vendor directly). That assumption is baked into "Integration with C4"
above ("If the vendor ships straight to the client, the technician returns the episode with C4's
`returnCustodyToClient` instead") but was never checked against how this actually works for Dell or other
vendors.

If it turns out the MSP sometimes *does* handle that physical leg — the dead unit was received into Alga's
custody for evaluation before approval, the vendor pre-ships a replacement, and now the dead unit has to go
back out with its own tracking — today's state machine has no transition for it. From `replaced` / `repaired`
the only exits are `returnDeviceToClient` (closes the custody episode as *returned to the client*, which is
the wrong fact when the device is actually going to the vendor) and the generic `close`. Confirm this with
the actual Dell (and other vendor) workflow before building it.

If the answer is yes, the fix is additive, not a redesign: a `shipDeadUnitToVendor` transition from
`replaced` / `repaired`, built the same way `shipToVendorCore` is (an outbound carrier/tracking custody
`shipped` event, same schema shape minus `return_by`), landing in `dead_unit_owed` — already a valid
`rma_cases.status` value inherited from the stock-unit track, so no migration is needed, only the
transition, schema, action and UI. `close` would need `dead_unit_owed` added to its `from` set.
