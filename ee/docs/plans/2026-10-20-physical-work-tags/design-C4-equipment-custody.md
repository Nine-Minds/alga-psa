# C4 design: equipment custody and intake for client-owned devices

Card C4 of alga-2026-0002683 (Joymode Business Solutions). It stacks on C2 (print work tags) and is followed by C5 (warranty review and RMA). This is the design of record for C4. Where it differs from `PLAN.md` or `ANALYSIS.md` in this folder, this document wins for C4.

Code references are to `origin/main` at `c5a8b29e4a` (2026-10-23). C1 has merged (#3821). C2's branch has no commits yet, so anything this card needs from C2 is written as a contract C2 must meet, or as a fallback C4 builds itself (see "Dependency on C2").

## Outcome

An MSP technician can:

1. Open a ticket and choose **Receive equipment**.
2. Link one of the client's existing assets, or create a minimal client asset.
3. Record where the item sits (stock location plus shelf), who holds it, why it is here, who owes the next action, and when to follow up.
4. Print the ticket's work tag, which shows the shelf and the next action.
5. Later move the item, hand it to a colleague, ship it to the vendor, take it back, or return it to the client. Each step lands in an append-only custody log and as a one-line entry on the asset's timeline.
6. Find every item the MSP holds on one queue page, whatever state its ticket is in.

None of this touches stock, cost, billing or time.

The demo that proves the card is the Dell scenario. Receive Joymode's dock on a ticket onto "Main Office / Shelf B3" with "waiting on vendor, follow up in 5 days". Print the work tag and see the shelf on it. Move the dock to "Shelf C1". Open the asset timeline and the queue and see both positions and the move.

## Settled questions

### Q1: custody is a property of assets

PLAN.md question 1 is settled: **custody belongs to assets.** We do not add a separate handling record that can exist with no asset.

Why:

- **The device is usually already an asset.** The Dell dock normally exists as a client asset, often synced from the RMM. Custody attached to that asset gives one history, one permission model (`asset` RBAC plus the asset record-level kernel) and one record that C5's RMA can point at (`rma_cases.asset_id` already exists).
- **A separate record would compete with assets.** It would need its own permissions, its own history, its own label class and its own RMA link. Every later card (C5 RMA, C6 staging) would then need to accept "asset or handling record".
- **The list-pollution concern is handled by scoping.** PLAN.md worried that held client assets would pollute the client's asset list. Two rules keep that small:
  - Only standalone devices become assets. Cables, power supplies, bags and other accessories are recorded on the custody record's **accessories** list, not as assets.
  - A walk-in device with no asset becomes a real client asset. It *is* the client's equipment and the MSP is accountable for it, so having it in the list is correct, not pollution. It is easy to find and filter: it has `ownership = client` and the status `held_by_msp`, and the asset list gains an "In MSP custody" filter.

### Q2: location is a stock location plus a free-text bin

PLAN.md question 2 is settled: **a stock location plus a free-text bin/shelf.** Stock locations do not get a bin hierarchy in this card.

Why:

- **Bins are an inventory change, not a custody change.** A real bin hierarchy changes the stock ledger's grain: stock levels per bin, transfers between bins, cycle counts per bin, the location deactivation guard, and the `levels.ts` maths. That is the deferred inventory item D10 (`ee/docs/plans/2026-07-01-inventory-review-remediation/PRD.md:35`), and it belongs in its own inventory card.
- **The Dell scenario only needs a printable, searchable shelf string.**
- **Autocomplete keeps entries consistent.** The bin input suggests previously used bins for the chosen location (distinct open and recent values), so "Shelf B3" doesn't drift into "shelf b-3".
- **The upgrade path stays open.** If D10 later adds bins, a migration can map distinct `(location_id, bin)` pairs onto bin rows.

## Decisions later steps must honour

### D1. Ownership on assets

- **Column.** `assets.ownership text NOT NULL DEFAULT 'client'` with `CHECK (ownership IN ('client','msp'))`. Every existing row backfills to `client`, because `assets.client_id` is NOT NULL and every asset today is a client's.
- **Who sets `msp`.** Users set it explicitly in the asset form, for example for MSP-owned loaners or internal kit tracked as assets.
- **Intake always writes `client`.** The intake path never creates an `msp`-owned asset.
- **Not a stock flag.** Ownership does not turn an asset into stock or out of it. `stock_units` remains the only stock record. The invariant "client-owned equipment never becomes sellable stock" is enforced by the intake path never reaching inventory writers (D6), not by this column.
- **Visibility.** It appears on the asset detail, the asset form (create and edit), the `listAssets` filters (`assetQuerySchema` plus `applyFilters` in `packages/assets/src/actions/assetActions.ts` ~2300) and the REST asset schema.

### D2. Custody is an episode table plus an append-only event table

Custody is a property of the asset, stored as **episodes**: one row per stay at the MSP. An asset can come in for repair in March and again in October; each stay is its own episode with its own events. Columns on `assets` were rejected because they lose the earlier stays.

**`asset_custody`**: one row per episode, mutable while open.

| Column | Notes |
|---|---|
| `tenant`, `custody_id` | PK `(tenant, custody_id)` |
| `asset_id` | FK assets |
| `client_id` | Copied from the asset at open. Used by the queue filter and the record check. |
| `ticket_id` | Nullable. The ticket it was received on. |
| `state` | `in_office` \| `with_vendor` \| `closed` |
| `purpose` | `repair` \| `warranty_evaluation` \| `loaner_prep` \| `staging` |
| `holder_user_id` | FK users. Required while `in_office`. |
| `location_id`, `bin` | `location_id` is an FK to `stock_locations`, required while `in_office`. `bin` is text, nullable, trimmed, max 64. |
| `next_action_party` | `msp` \| `client` \| `vendor` |
| `next_action_note` | Text, nullable. Internal only, never printed. |
| `follow_up_on` | `date`, nullable (calendar date; follow the date-only standards) |
| `condition_note` | Text, nullable |
| `accessories` | jsonb array of `{ label, quantity }`, default `[]` |
| `opened_at`, `opened_by` | Set when the episode opens |
| `closed_at`, `closed_by`, `close_reason` | `close_reason` is `returned_to_client` \| `disposed` \| `transferred_to_rma`. C5 uses `transferred_to_rma` only if it decides to; C4 writes only `returned_to_client`. |
| `created_at`, `updated_at` | |

Constraints:
- At most one open episode per asset: a partial unique index on `(tenant, asset_id) WHERE closed_at IS NULL`.
- CHECKs on every enum.
- A CHECK that `state = 'in_office'` implies `holder_user_id` and `location_id` are present.

**`asset_custody_events`**: append-only, one row per physical step.

| Column | Notes |
|---|---|
| `tenant`, `event_id` | |
| `custody_id`, `asset_id` | |
| `event_type` | `received` \| `moved` \| `handed_off` \| `shipped` \| `returned` |
| `occurred_at` | Defaults to now; the user may back-date |
| `recorded_at`, `actor_user_id` | |
| `from_location_id`, `from_bin`, `to_location_id`, `to_bin` | |
| `from_holder_user_id`, `to_holder_user_id` | |
| `counterparty` | Text: the vendor or carrier for `shipped`; the client contact name for `returned` |
| `note` | |
| `document_ids` | jsonb, photo document ids taken at this step |

What each event type does:
- **`received`** opens an episode. It can also occur on an open `with_vendor` episode, when the item comes back from the vendor, which puts it back `in_office`.
- **`moved`** changes the location and/or bin.
- **`handed_off`** changes the holder.
- **`shipped`** sets the state to `with_vendor` and clears the location, bin and holder. The from-location is kept on the event.
- **`returned`** closes the episode as `returned_to_client`.

Other changes are **not** events, because they are not physical steps: purpose, next-action party and note, follow-up date, condition, and accessories. They update the episode row and write an `asset_history` row with `change_type = 'custody_updated'`, holding a before/after diff. The event log stays the chain of custody, and the timeline still shows who changed the next action and when.

**Append-only enforcement** copies `stock_movements`:
- On plain Postgres, a trigger rejects UPDATE and DELETE (see the trigger in `server/migrations/20260626100100_create_inventory_stock.cjs` / `20260701092000_inventory_schema_hardening.cjs`).
- On Citus it is app discipline: only `recordCustodyEvent` inserts, and nothing updates.

**Schema rules:**
- Both tables are distributed with `ensureTenantDistribution` (`server/migrations/utils/citusDistribution.cjs`), as `asset_assignments` is (`20261009122000_create_asset_assignments.cjs`).
- Every FK includes `tenant`.
- Both tables are registered in `packages/db/src/lib/tenantTableMetadata.ts` and the migration shim `server/migrations/utils/tenantDb.cjs` in the same change.
- Indexes: `(tenant, state, follow_up_on)`, `(tenant, location_id) WHERE closed_at IS NULL`, `(tenant, ticket_id)`, `(tenant, holder_user_id) WHERE closed_at IS NULL`, and events on `(tenant, custody_id, occurred_at)`.

### D3. Asset history summary and events

**History.** Every custody event writes one `asset_history` row in the same transaction:
- `change_type = 'custody_' + event_type`.
- `changes` holds a compact summary: from/to location and bin, from/to holder, purpose and the ticket number.

**Timeline.** `AssetTimeline.tsx` `describeAssetHistoryEntry` (~95–196) gains a branch for `custody_*` and `custody_updated` that renders one sentence, for example "Moved from Main Office / B3 to Main Office / C1 by Dana". Its i18n keys go under `assetTimeline.changeTypes.*`.

**Asset change events.**
- Changes to real asset columns (`ownership`, and `status` when intake or return changes it) publish `ASSET_UPDATED` through `publishAssetChanged` (`packages/assets/src/lib/assetChangeEvents.ts`). Publishing happens after the transaction commits, and errors are logged and swallowed, as the existing callers do.
- Custody steps publish one new catalog workflow event, **`ASSET_CUSTODY_CHANGED`**, with this payload: `{ assetId, custodyId, clientId, ticketId, eventType | 'updated', state, purpose, nextActionParty, followUpOn, locationId, bin, holderUserId, actorUserId, occurredAt }`.
- Adding the event needs a schema in `packages/event-schemas` (alongside `assetMediaEventSchemas.ts`), an entry in `eventBusSchema.ts` and `workflowEventCatalog.ts`, a payload builder in `workflow-streams`, and a catalog upsert migration following `20260123150000_upsert_domain_workflow_event_catalog_v2.cjs`.
- This lets tenants build "tell the client their device is ready for pickup" as a workflow without C4 hard-coding notifications.

### D4. Code location and layering

**Everything lives in `packages/assets`.** Assets cannot import `@alga-psa/inventory`, because inventory already imports assets (`packages/assets/src/actions/assetInventoryActions.ts:10-13`). Custody reads `stock_locations` directly through `tenantDb`, as assets already does for its inventory provenance.

**Step 0 is an authorization extraction.** Move the asset subject and record resolution (`resolveAuthorizationSubjectForUser`, `resolveAssetAuthorizationRecords` and the read kernel at `assetActions.ts` ~510–692) into a non-`'use server'` module, `packages/assets/src/lib/assetAuthorization.ts`. Then point `assetActions.ts` and `lib/labelViewModelProvider.ts` at it. This resolves the existing `// LEVERAGE: pattern asset-read-authorization` marker, and custody needs the same helpers from its lib. Without the extraction, this would be a third copy.

**`packages/assets/src/lib/custody/`** holds the cores. They are plain, transaction-taking functions, so C5 and C6 can call them inside their own transactions:
- `openCustody(trx, tenant, actor, input)`
- `recordCustodyEvent(trx, tenant, actor, custodyId, event)`
- `updateCustodyDetails(trx, tenant, actor, custodyId, patch)`
- `getOpenCustodyForAssets(trx, tenant, assetIds)`
- `listCustodyQueue(trx, tenant, filters, page)`
- `formatCustodyForLabel(row)`

The state machine lives here as a pure transition table with unit tests:
- Allowed: `in_office → in_office` (moved, handed_off), `in_office → with_vendor` (shipped), `with_vendor → in_office` (received), and `in_office | with_vendor → closed` (returned).
- Every other transition is refused.

**`packages/assets/src/actions/assetCustodyActions.ts`** holds the `withAuth` server actions: `receiveEquipment`, `moveCustody`, `handOffCustody`, `shipCustody`, `receiveBackCustody`, `returnCustodyToClient`, `updateCustody`, `getAssetCustody`, `listCustodyEvents`, `listHeldEquipment`, `listCustodyBins` and `listCustodyLocations`.

**Shared types** go in `packages/types/src/interfaces/assetCustody.interfaces.ts`. Zod schemas go in `packages/assets/src/lib/schemas/assetCustody.schema.ts`.

**REST endpoints:**
- `GET/POST /api/v1/assets/{id}/custody`
- `POST /api/v1/assets/{id}/custody/events`
- `GET /api/v1/asset-custody` (the queue)

They follow the existing asset controller and service pattern, so MCP inherits RBAC. The endpoints are part of this card, because MCP and mobile reach the PSA only through REST.

### D5. Permissions

**No new RBAC resource.** Custody is a property of assets, so it rides on `asset`:

| Operation | Requires |
|---|---|
| Read custody, events or the queue | `asset:read` + the asset record-level read check |
| Open custody on an existing asset, record events, update details | `asset:update` + the record check |
| Create a minimal asset at intake | `asset:create` |
| Receive from a ticket | Also `ticket:read` + `authorizeTicketRecordAccess` on the ticket, and the ticket's `client_id` must equal the asset's `client_id` |

By default these roles have the permissions: Admin, Manager and Technician have `asset:update` and `asset:create`; Dispatcher and Finance have read only (`server/migrations/utils/permissions/catalog.cjs:66-69`).

**Stock locations.** Picking a location must **not** require `stock_location:read`, which is Admin-only by default (`catalog.cjs:258`). Technicians must be able to receive equipment. `listCustodyLocations` returns only `{location_id, name, location_type}` of active locations to anyone with `asset:update`. Stock levels, units and addresses stay behind inventory permissions.

**Queue filtering.** The queue runs through `buildAuthorizationAwarePage` with the asset record check, as `listAssets` does. A user never sees custody for an asset they cannot open.

**Client portal.** The portal receives no custody data. Custody fields, events, bins and notes are MSP-only and are not added to any client-portal query. A minimal held asset shows in the portal like any other client asset, which is accurate: it is the client's device.

### D6. Receive equipment never touches stock, cost, billing or time

**The intake path:**
- calls `createAssetInTransaction` (`assetActions.ts` ~1106) for new assets;
- calls the association insert for the ticket link;
- calls the custody cores, and nothing else.

**The intake path must not:**
- import `packages/inventory/src/lib/receive.ts` or anything under `packages/inventory`;
- write `stock_units`, `stock_movements`, `stock_levels`, `product_inventory_settings`, invoices, invoice charges or time entries;
- set `assets.stock_unit_id` or `assets.service_id`.

**Tests enforce this** (see "Test strategy"):
- An integration test counts rows in each of those tables before and after both intake modes, plus move, ship, receive-back and return.
- A static test asserts that no file under `packages/assets/src/{lib/custody,actions/assetCustodyActions.ts}` imports `@alga-psa/inventory` or `@alga-psa/billing`.

### D7. Receive equipment from a ticket

**Entry point.**
- **Placement:** a `Receive equipment` action sits in the ticket header beside `Print work tag` (C2). Tickets cannot import assets, so it arrives as a new render prop, `renderReceiveEquipment`, on the same seam as `renderQuickInvoice` (`packages/tickets/src/components/ticket/TicketDetails.tsx` ~255–275, rendered in `bento/BentoHero.tsx` ~954 and `TicketInfo.tsx` ~2045). The prop is threaded through `TicketDetailsContainer.tsx` and supplied by `packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx`, which already injects `AssociatedAssets`.
- **Visibility:** the action is hidden in AlgaDesk mode (as Quick Invoice is) and when the user lacks `asset:update`.

**Dialog, step 1: the item.** A choice between:
- **Link an existing asset.** A picker over the ticket client's assets, with the ticket's already associated assets listed first. Assets that already have an open episode are disabled, with their current location shown.
- **New item.** Fields: name (required); asset type (registry picker, default `unknown`); manufacturer, model and serial number (optional); asset tag (optional).
  - If the tag is left blank, it is generated as `<ticket_number>-EQ<n>`, where n is one more than the count of custody episodes already opened from this ticket. A uniqueness retry covers collisions.
  - The status is `held_by_msp` and the ownership is `client`.

**Dialog, step 2: custody.**
- Purpose (required).
- Location (required): stock location picker plus bin with autocomplete. The location defaults to the tenant's default stock location.
- Holder: defaults to the current user.
- Next-action party: defaults to `msp`.
- Follow-up date and next-action note.
- Condition note.
- Accessories list.
- Photos (optional): uploaded through `uploadDocument` from `@alga-psa/documents` with both `assetId` and `ticketId`, `is_client_visible = false`. The document ids are stored on the `received` event.

**One transaction:**
1. Create the asset (new-item mode).
2. Insert the `asset_associations` row (ticket, `relationship_type = 'affected'`) if it is missing.
3. Open the episode.
4. Insert the `received` event.
5. Write the history rows.

`ASSET_CREATED`, `ASSET_UPDATED` and `ASSET_CUSTODY_CHANGED` publish after commit. Photo upload happens before the transaction; if the transaction fails, the uploaded documents are deleted.

**Refusals, with clear errors:**
- The ticket has no client.
- The asset's client differs from the ticket's client.
- The asset already has an open episode (the error says where it is).
- The location is inactive.

**After success:** a toast offers **Print work tag** (C2's action) and **Open asset**.

**On the ticket:** C4 adds a custody chip to each associated asset row in `AssociatedAssets.tsx`, for example "Held · Main Office / B3 · waiting on vendor". The chip appears for any asset with an open episode, whichever ticket received it.

**`held_by_msp` status.**
- A new built-in asset status, slug `held_by_msp`, label "Held by MSP", kind `pending`, is seeded into `asset_statuses` for every tenant by the migration.
- Only intake-created assets get it. Existing assets keep their status; custody is orthogonal to status.
- On `returned`, an asset whose status is still `held_by_msp` moves to `active`. Any other status is left alone.

### D8. Asset detail: custody panel and actions

The asset detail (`AssetDetailView.tsx` / `AssetBentoLayout.tsx`) gains a **Custody** card.

**When the asset has an open episode**, the card shows the current state: location / bin, holder, purpose, next action, follow-up (red when overdue), condition, accessories, and a link to the receiving ticket. It has these actions:
- Move
- Hand off
- Ship to vendor (counterparty text)
- Received back
- Return to client
- Edit details

Each action is a small dialog that writes one event (or one `custody_updated` history row for Edit details).

**When it has no open episode**, the card offers "Receive into custody" with `ticket_id = null`, plus a link to past episodes.

**Event log.** The card's "History" tab lists events across all episodes, newest first.

**Guards elsewhere:**
- Asset delete is refused while an episode is open (`deleteAsset` guard).
- `deactivateStockLocation` (`packages/inventory/src/actions/stockLocationActions.ts:207`) is refused while open episodes sit at that location. Inventory may read the custody table directly, as it already imports assets.

### D9. Held-equipment queue

**Route and navigation.**
- Route: `/msp/assets/custody`, titled "Equipment in custody" in the UI. Inventory already uses "held" for hard sales-order allocations (`stock_levels.held_quantity`), so UI copy avoids "Held" as a bare noun beside inventory screens.
- Navigation: a new entry under Assets in `server/src/config/menuConfig.ts` (~196), with an i18n key.

**Query.** The queue lists open episodes only. It never joins ticket status into its filter, so a closed ticket's item still shows.

**Preset tabs**, which are not mutually exclusive:

| Tab | Rule |
|---|---|
| All open | Every open episode |
| In office | `state = in_office` |
| Waiting on vendor | `next_action_party = vendor` or `state = with_vendor` |
| Waiting on client pickup | `state = in_office` and `next_action_party = client` |
| Overdue follow-up | `follow_up_on < today` in the user's timezone |

The Dell dock on the shelf while Dell decides appears under both "In office" and "Waiting on vendor". That is intended.

**Filters, columns and actions.**
- Filters: client, location, holder, purpose, next-action party, and "mine" (holder is me).
- Columns: asset (tag, name), client, ticket, location / bin, holder, purpose, next action, follow-up, days held.
- The table uses the DataTable action-menu standard: row actions open the same dialogs as the asset panel, plus Print work tag when a ticket is linked.
- Counts per tab appear in the tab labels.

**Scheduled reminders are not built.** The overdue tab is the follow-up mechanism in C4 (see "Non-goals").

### D10. Work tags show custody (stacks on C2)

**New `LabelViewModel` fields.** `packages/types/src/lib/labels.ts` `LabelViewModel` gains two nullable fields:
- `custodyLocation`: for example "Main Office · Shelf B3", or "With vendor" when shipped.
- `nextAction`: for example "Next: vendor · follow up 30 Oct".

They are also added to the label bindings (`packages/billing/src/lib/label-template-ast/bindings.ts`), the sample data, and the standard ticket work-tag template (`standardTemplates.ts` `buildTicketWorkTag`).

**Line budget.** The 4×2 in label is already at its 44 mm line budget. The custody lines replace the `detail` (work reason) line when present, rather than adding height. The renderer collapses empty bindings, so a ticket with no custody prints exactly as before.

**Where the values come from.**
- **Exactly one open episode** with `ticket_id` = this ticket, or one associated asset in custody: print its location and next action.
- **More than one:** `custodyLocation = "<n> items held"` and `nextAction = null`.
- `nextAction` never includes the free-text note: labels sit on open shelves.

**Who computes them.** Tickets must not import assets, so the ticket provider cannot read custody. The asset side computes the values through `formatCustodyForLabel` and an exported `getTicketCustodyLabelFacts(trx, tenant, user, ticketIds)`. That function applies the asset record check: a custody line for an asset the user cannot read is dropped, not leaked. The server composition root `server/src/lib/labels/printLabels.ts` merges these facts into ticket view models. This is the same seam C2 needs for "linked asset tag and serial suffix", which the ticket provider explicitly defers to C2 (`packages/tickets/src/lib/labelViewModelProvider.ts` header). **If C2 lands a different enrichment seam, C4 uses C2's seam rather than adding a second one.**

**Printing stays read-only.** No custody row, event or history entry is written by printing.

**Permanent labels don't change.** The asset identity label does not show custody: it is a permanent label and custody is temporary.

### D11. Asset list and form

- **List.** New filters "In MSP custody" (has an open episode) and "Ownership", in `assetQuerySchema` and `applyFilters`. A small custody badge appears in the list row.
- **Form.** The asset form gets an Ownership select (client / MSP).
- **No status-dropdown restriction.** `held_by_msp` is a normal selectable status; the form does not restrict it.

## Order of work

0. **Authorization extraction** (D4 step 0). Refactor only, with existing tests green.
1. **Migrations:**
   - `assets.ownership` with backfill;
   - the `held_by_msp` status seed for all tenants;
   - `asset_custody` and `asset_custody_events` with CHECKs, the partial unique index, the Postgres append-only trigger and Citus distribution;
   - tenant metadata and shim registration;
   - the `ASSET_CUSTODY_CHANGED` catalog upsert.
2. **Types, Zod schemas, event schema and payload builder.**
3. **Custody cores** in `packages/assets/src/lib/custody/`: state machine, open, event, update, queue query and label formatting, with unit tests.
4. **Server actions and REST endpoints** with RBAC and record checks. Integration tests, including the no-stock invariant.
5. **Asset detail Custody card and dialogs.** Timeline rendering of `custody_*`. Asset list filters and ownership in the form.
6. **Ticket `Receive equipment`:** render prop seam, dialog, photos, `AssociatedAssets` chip.
7. **Queue page** and nav entry.
8. **Work-tag custody fields** (after C2 is merged into this branch): `LabelViewModel`, bindings, template and composition-root enrichment.
9. **Guards:** asset delete, stock-location deactivation.
10. **Dell scenario walkthrough** in the browser, against the dev stack.

Steps 0–7 and 9 do not depend on C2. Step 8 does. Rebase onto main when C2 merges, before step 8.

## Non-goals

- **RMA for client-owned devices**, `warranty_review`, shipping carrier and tracking numbers, vendor case links: C5. In C4, `shipped` records only a counterparty text and a note. C5 may add a `rma_id` to the events or close the episode as `transferred_to_rma`.
- **Bin hierarchy** for stock locations (inventory D10).
- **Scheduled follow-up reminders** or notifications. The queue's Overdue tab covers it in C4. A later card can add an `emitDateDomainEventOnce` follow-up-due event, and `ASSET_CUSTODY_CHANGED` already lets tenants build workflows.
- **Custody for items with no asset**, other than through the minimal-asset path. Accessories ride on the parent episode.
- **Showing custody to the client portal.**
- **Mobile app screens and scan-driven custody steps** (C3 owns scanning; a "scan shelf, move item" flow is a later card).
- **Project staging and client-provided project items:** C6, which will call `openCustody` with `purpose = staging`.
- **Changing `stock_units`, loaners or any inventory ledger.**
- **Print history:** C2's decision applies.

## Risks

| Risk | Mitigation |
|---|---|
| C2's enrichment seam for ticket labels differs from D10's assumption. | D10 defers to C2's seam. Step 8 is last and isolated. |
| Citus: no DB-level append-only guarantee; partial unique index on a distributed table. | Insert-only core and no update path. Unique index includes `tenant` (the distribution column), so Citus accepts it. Test on the Citus smoke job. |
| Technicians without `stock_location:read` cannot pick locations. | Dedicated minimal `listCustodyLocations` gated by `asset:update` (D5). |
| A held minimal asset appears in the client portal. | Accepted: it is the client's device. No custody data is exposed. Revisit if Joymode objects. |
| `ASSET_ASSIGNED` publish in `createAssetAssociation` is not wrapped and can throw after commit (`assetActions.ts` ~3765). | Intake inserts the association inside its own transaction and publishes after commit through the guarded post-commit path. It does not call `createAssetAssociation`. |
| Generated tags `<ticket_number>-EQ<n>` collide with existing tags. | Uniqueness check plus retry; users may enter their own tag. |
| Label line budget overflow. | Custody lines replace the reason line; there is a renderer test with the longest location, bin and next-action strings. |
| The word "held" means hard allocation in inventory. | UI copy says "in custody"; the status label is "Held by MSP" only on assets. |

## Test strategy

alga-plan's `features.json` and `tests.json` will enumerate these in detail.

- **Unit tests:**
  - the custody state-machine transition table;
  - `formatCustodyForLabel` (single, multiple, with vendor, overdue);
  - the tag generator;
  - Zod schemas;
  - `describeAssetHistoryEntry` for `custody_*`.
- **Integration tests** (`server/src/test/integration/`, real DB):
  - Receive with an existing asset and with a new asset: the episode, the event, the history, the association.
  - **No `stock_units`, `stock_movements`, `stock_levels`, `product_inventory_settings`, invoice or time-entry rows change** across receive, move, hand-off, ship, receive-back and return.
  - Second open episode refused.
  - Client mismatch refused.
  - Ticket without a client refused.
  - Inactive location refused.
  - Append-only trigger rejects UPDATE and DELETE on plain Postgres.
  - Queue tabs, including that a closed ticket's item still appears.
  - Queue and custody reads respect the asset record check.
  - Ownership backfill.
  - Asset delete and location deactivation guards.
  - `held_by_msp` → `active` on return.
- **API tests:** the REST custody endpoints enforce `asset:*` plus record checks; a user without access gets 404, not 403 with data.
- **Label tests:** ticket work tag with and without custody; custody hidden when the asset is unreadable; printing writes nothing.
- **Static test:** custody modules import neither `@alga-psa/inventory` nor `@alga-psa/billing`.
- **Browser test:** the Dell scenario walkthrough (receive, shelve, print, move, timeline, queue).
