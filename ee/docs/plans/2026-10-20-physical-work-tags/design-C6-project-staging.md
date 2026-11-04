# C6: Project staging, boxes, and manifests (design of record)

Card: alga-2026-0002683 (6/6), board id `db831ce3-9d9c-46aa-ad74-b051abbc8622`. Stacked on C2 (print work tags). Implementation starts only after B1 ("Inventory: ticket/project materials consume stock reserved for sales orders", PR #3818) has merged, because both change `packages/inventory/src/lib/consume.ts` and `materials.ts`.

This document settles what changes, where, in what order, and which decisions the PRD, features, tests and implementation must follow. It builds on `ANALYSIS.md` and `PLAN.md` in this folder. Where it settles something differently from them, this document wins for C6.

## 1. What the code looks like today (re-verified 2026-10-23)

Code was read on `origin/main` at `c5a8b29e4a`. This worktree's HEAD (`a62fafbcb5`) is behind main; rebase before implementing.

- **Materials consume immediately.** `packages/inventory/src/lib/materials.ts` `addMaterial` inserts the `project_materials` row and calls `recordStockConsumption` (`lib/consume.ts`) in the same transaction. Nothing between "planned" and "consumed" exists.
- **Billing reads every unbilled `project_materials` row.** `packages/billing/src/lib/billing/billingEngine.ts` (~2291 and ~7126) selects `project_materials` with `is_billed = false`, filtered only by `billing_destination`. A row in that table is billable by construction.
- **The sales-order allocation model.** In `actions/salesOrderActions.ts`:
  - `allocateLine` (~264) reserves non-serialized stock as a counter on `stock_levels`: `reserved_quantity` for soft allocation, `held_quantity` for hard. The amount is capped at availability, and each line records `quantity_reserved` and `reserved_location_id`.
  - Serialized units move `in_stock → allocated` and get `stock_units.allocated_so_line_id`. On-hand is then recomputed from the `in_stock` count, so allocated units drop out of `quantity_on_hand`.
  - Allocation is not a stock movement.
  - `releaseAllocations` (~352) and `reverseAllocationCounter` (~330) undo allocations.
  - These helpers are private to the sales-order action file.
- **`lib/levels.ts`** has `availableQuantity` (on_hand − reserved − held), `applyAllocationDelta`, `recomputeSerializedOnHand` and `ensureStockLevel`.
- **Reconcile knows only sales orders.** `lib/reconcile.ts` `computeAllocationsFromTruth` rebuilds `reserved_quantity` and `held_quantity` from open sales-order lines alone. Any other writer of those counters is erased by "Rebuild stock caches".
- **Sales-order fulfillment can poach project units.** `actions/fulfillmentActions.ts` `loadCandidateUnits` (~131) takes units in `in_stock` or `allocated` status. It blocks a unit only when another sales-order line hard-holds it (`foreign_hard_hold`). A unit allocated to something other than a sales-order line would be fulfilled silently. For non-serialized stock it warns but never blocks.
- **B1 (PR #3818, open, at human review) rewrites the consume guard.** Branch `feature/inventory-ticket-project-materials-consume-stock`, commit `dea428483c`.
  - It adds `evaluateConsumption(level, qty, allowReservedOverride)`. The rules: refuse above on-hand; refuse into `held` with no override; refuse into `reserved` unless `allow_reserved_override` is set.
  - It adds `InsufficientStockError.detail`, `stockConflictResultFrom`, a `free_total` column in the catalog picker, and conflict UI in the ticket and project materials dialogs.
  - Its refusal messages say "reserved for sales orders".
  - Its docstring names `evaluateConsumption` as the basis for C6.
- **Where consumption draws from.** `consume.ts` always consumes non-serialized stock at the product's default location, falling back to the tenant default. It cannot consume from a named location.
- **C1 has merged** (`dd192d4dd4`):
  - `packages/types/src/lib/labels.ts`: `LABEL_CLASSES` = ticket-work-tag, asset-identity, stock-unit-identity; a uniform `LabelViewModel`; the `LabelViewModelProvider` contract (read-only, null for missing or forbidden).
  - `packages/types/src/lib/recordLinks.ts`: `RECORD_ENTITY_TYPES`; a byte-identical copy lives in `ee/mobile/src/urls/recordLinks.ts`, enforced by a parity test.
  - Registry: one generic `work-tag` document type in `packages/billing/src/lib/document-templates/registry.ts`.
  - Renderer: `renderLabelBatchPdf` and `renderHtmlToPdf` in `packages/billing/src/services/labelPdfService.ts`.
  - Composition root: `server/src/lib/labels/printLabels.ts`, served by `POST /api/labels/pdf`. One `labelClass` per request, at most 200 ids, all-or-nothing, any null returns 404.
- **C2 and C4** have pushed no commits yet (both are in Design Session). C2's plan question 4 (print history) is still open.
- **Project UI and permissions.**
  - Materials are a drawer (`packages/projects/src/components/ProjectMaterialsDrawer.tsx`) opened from the `ProjectInfo.tsx` header.
  - Actions are in `packages/projects/src/actions/materialCatalogActions.ts`. They gate on `project:update` RBAC only, with no record-level check.
  - `createProjectReadAuthorizer` exists twice, privately, in `projectActions.ts:374` and `projectTaskActions.ts:383`.
- **Other inventory paths are safe.** Transfers move only `in_stock` units (`transferActions.ts:165`), and SO allocation picks only `in_stock` units, so `allocated` units are already protected from both.

## 2. Decisions

These are binding on the PRD, features, tests and implementation.

**D1 (PLAN question 6): project reservations share the existing `stock_levels.reserved_quantity` / `held_quantity` counters. No separate project counter.**
Why:
- Every reader of availability already derives it from `availableQuantity` and those columns: SO `allocateLine`, `queryProductAvailability`, B1's `evaluateConsumption`, B1's picker `free_total`, and the dashboards. Shared counters make each of them respect project claims with no change.
- A separate project counter would mean finding and changing every one of those readers, now and in the future. A reader that misses it would over-promise stock. That is the "second ledger" the customer ruled out.
- Attribution stays where sales orders keep it, on the claiming row (`project_staging_lines.reserved_location_id` plus status, the counterpart of `sales_order_lines.quantity_reserved` / `reserved_location_id`).
- Reconcile (D5) rebuilds the counters from both claim sources.

**D2: reservations live in a new `project_staging_lines` table. `project_materials` keeps meaning "consumed, billable material".**
- Install creates the `project_materials` row through the canonical `addMaterial` path, consuming stock at that moment.
- The billing engine is not touched: staging lines are invisible to it, so a reservation can never be invoiced. Billing-side invariant tests prove this (T-billing).
- The rejected alternative was a status column on `project_materials`. Every billing read and every unbilled-materials count (two sites in `billingEngine.ts` and the project close "move products to hold" path at `projectActions.ts:1762`) would have needed a new filter, and any reader that missed it would bill reserved hardware.

**D3: lifecycle and claim strength.** Stock lines go `reserved → staged → installed`. Either of the first two can also go to `released`.

| Line status | Non-serialized claim | Serialized claim |
|---|---|---|
| `reserved` | `reserved_quantity` (soft) at `reserved_location_id` | unit `allocated`, `allocated_staging_line_id` set |
| `staged` | moved to `held_quantity` (hard) at the same location | unchanged |
| `installed` | released; stock consumed; `project_material_id` set | unit `delivered` to the client by the existing consume path |
| `released` | released | unit back to `in_stock`, claim cleared |

- Reserving is soft because nothing has been physically picked. B1's explicit override can still take that stock for a ticket.
- Staging means it is physically picked and labelled, so it becomes a hard hold that B1 never lets anything consume.
- A serialized project claim is never poachable in either status (D6), because the claim names one specific serial that may already be on a label or manifest.

**D4: reserving is all-or-nothing, at a single location.**
- The request names a location, or defaults to the sales-order rule: the product's default location, else the location with the most available stock (`resolveAllocationLocation`).
- The reserve locks the `stock_levels` row `FOR UPDATE` and refuses with a typed error when `qty > availableQuantity(level)`, using B1's `StockConflictDetail` shape. There are no partial reservations and no backorders.
- Serialized reserves claim the picked unit (it must be `in_stock`, taken `FOR UPDATE`). Without a pick, it takes FIFO `in_stock` units using the SO ordering, with `FOR UPDATE SKIP LOCKED`.
- **Serialized lines are one unit each**, matching the existing rule in `addMaterial`. "Reserve 12 of a serialized product" creates 12 lines in one transaction, and fails as a whole if fewer than 12 units are free.
- Kits are refused with "stage the kit's components", as is anything with `item_kind != 'product'`.
- Untracked products (`track_stock = false`) may be staged as plain lines with no claim.

**D5: the allocation code becomes one engine, and reconcile knows about projects.**
- Extract the claim primitives from `salesOrderActions.ts` into `packages/inventory/src/lib/allocation.ts`:
  - `resolveAllocationLocation`
  - claim and release of a counter at a location
  - FIFO unit claim and release, parameterised by claimant (`{ kind: 'so_line' | 'staging_line', id }`)
  - `reverseAllocationCounter`
- Sales orders call the engine with identical behaviour. The existing `alloc.db.test.ts`, `flows.db.test.ts` and `salesOrderGuards.db.test.ts` must pass unchanged.
- `computeAllocationsFromTruth` adds the staging-line claims: `reserved` adds to the reserved total and `staged` adds to the held total, both at `reserved_location_id`, for non-serialized, track_stock lines.
- Without this, "Rebuild stock caches" would silently wipe every project reservation.

**D6: the sales-order fulfillment poach guard covers project claims.** In `loadCandidateUnits`, a unit with `allocated_staging_line_id IS NOT NULL` counts as a foreign hard hold:
- it is excluded from FIFO
- an explicit pick of it fails with "allocated to project …"
- the unit picker shows it as not selectable

Non-serialized SO fulfillment keeps its current "warn, never block" behaviour. That is existing sales-order semantics, not this card's to change.

**D7: install consumes from the line's own claim, and the consume engine learns about claimants.** `recordStockConsumption` gets two new options:
- `location_id`: consume at this location instead of the product default, because a reservation may sit at a non-default location.
- `claimant`: `{ kind: 'staging_line', id }`.
  - Non-serialized: the claimant's own counter at that location is released under the same row lock, and B1's `evaluateConsumption` then runs on the freed figures.
  - Serialized: a unit in `allocated` status whose `allocated_staging_line_id` matches the claimant may be consumed, and the claim is cleared in the movement's `unitPatch`.

`addMaterial` gains an internal `from_staging_line_id` that passes the claimant through. Everything else stays exactly as today:
- validation and billing destinations
- the post-commit `createAndLinkDeliveredAsset` for `creates_asset_on_delivery`
- stock-low events
- movement `source_doc_type = 'project_material'`

There is no status-flip workaround (setting the unit back to `in_stock` and then consuming it).

**D8: undo, delete and edit.**
- **Undo install** (staging action): in one transaction, reverses the consumption through the existing `deleteMaterial` internals (refused if the material is billed), then re-claims as `staged` (a hard hold) at the original location or unit. If the stock is no longer free, it refuses and leaves the material in place.
- **Deleting an installed, staging-originated material from the Materials drawer** restores stock as today and sets the staging line to `released`, never back to a claim. This avoids a hidden re-reservation.
- **Changing a non-serialized reservation's quantity**: increases re-check availability (D4); decreases release the difference.
- **Swapping a serialized line's unit** is allowed while it is `reserved` or `staged`: release the old unit, then claim the new one under lock.

**D9: client-provided items go through staging, with no stock path at all.**
- Line kinds: `stock`, `client_asset` (an `asset_id` whose `client_id` is the project's client) and `client_item` (free-text description and quantity, no asset).
- Client lines go `received → staged → installed | released`. Every transition is a status change only: no `stock_units` row, no `stock_movements`, no `stock_levels`, no cost and no `project_materials`.
- If C4 has merged when C6 implements: a `client_asset` line requires, or creates, C4's custody record with purpose `staging`, through C4's public API, and installing it closes custody as returned to the client. If C4 has not merged, `client_asset` lines are plain links and custody is a follow-up. Implementation records which branch it took.

**D10: boxes are a staging-container record with members.**
- Tables: `staging_containers` (on a project, optionally on a task) and `staging_container_members` (container → staging line plus quantity).
- One member shape covers units, quantities and client items, because they are all staging lines.
- Rules:
  - A serialized or `client_asset` line lives in at most one box.
  - A quantity line may be split across boxes, with members' quantities summing to at most the line quantity. This is enforced in the lib under a lock on the line row.
  - Packing a `reserved` stock line stages it in the same transaction, because it has now been physically picked.
  - Packing a `received` client line stages it.
  - Container status is `open ↔ sealed`. Sealed blocks membership changes, and reopening is allowed.
  - A box can be deleted only when empty.
- Numbering:
  - `sequence` is per project, assigned max+1 and never reused.
  - The identifier is `<project_number>-B<sequence padded to 2>`, e.g. `PRJ-0042-B03`. This is the Code 128 value too.
  - "n of m" is computed at render time: n is the box's rank by `sequence` among the project's containers, and m is the count.
  - A printed label is a snapshot (C1 principle 2). The staging UI shows the current "n of m" so a reprint is obvious.

**D11: labels and manifests come from C1's machinery, with no side effects.**
- **Box label:**
  - New label class `staging-container` and new record entity type `staging_container`, with path `/msp/projects/{projectId}/staging?containerId={id}`. Like `project_task`, it needs `projectId`.
  - `matchRecordPath` gets the inverse, and the mobile copy of `recordLinks.ts` is updated byte-identically.
  - `LabelViewModel` gains `sequence: { n: number; total: number } | null`, null for every other class, with a matching designer binding.
  - A standard template `label-staging-container` shows: MSP name and logo, project number and name, client, task, a large "Box n of m", the box identifier and its Code 128, and a QR code of the record URL.
- **Bulk print:**
  - `printLabels` accepts a mixed list, `items: Array<{ labelClass, id }>`, alongside today's `{ labelClass, ids }`. It keeps order, the 200-label cap, all-or-nothing, and "any null → 404".
  - The staging page prints one PDF ordered box label first, then that box's unit labels (`stock-unit-identity`) and client-asset labels (`asset-identity`), box by box, with unboxed staged items last.
  - Non-serialized quantity lines get no per-item label; they appear on the manifest.
  - Unit labels are left out when the user lacks `inventory:read`, and the UI says so, instead of the whole batch returning 404.
  - Above 200 labels the UI asks the user to choose boxes.
- **Manifest:**
  - New registered document type `staging-manifest` with `printGeometry: 'document'`, standard template, bindings and sample data, so tenants can customise it in the existing designer.
  - Content: header (MSP branding, project, client, task, box identifier, n of m, status, sealed date and by whom), a QR code to the box, and one row per member (product or SKU or client-item description, quantity, serial, kind, task).
  - Full serial numbers of MSP stock units are shown, because the manifest exists to check box contents at the site and a serial is an identifier, not a credential. Client assets show asset tag and serial suffix. The template can hide either.
  - Rendered by a new billing service `renderRegisteredDocumentPdf(tenant, documentType, viewModel)`: tenant/standard resolution plus `renderHtmlToPdf`.
  - Served by `GET /api/projects/staging/containers/[id]/manifest` in `server/` (the composition root, modelled on `/api/labels/pdf` and on the API-key skip-list), from a view-model provider in `packages/projects`.
- **Printing writes nothing.**
  - It never touches `stock_*`, `project_materials`, `project_staging_lines`, invoices, time entries, assets or custody, and publishes no events.
  - The manifest is **not** stored as a `documents` row. This differs from the SO document download, which files its PDF.
  - If C2 decides on print history (its plan question 4), C6 adopts that mechanism for labels only, and it must not be a stock or billing write.

**D12: authorization.**
- Read staging and render its labels and manifests: `project:read` plus the record-level project read decision.
- Mutate (reserve, stage, pack, install, release, edit boxes): `project:update` plus the record-level decision.
- Listing or picking stock units additionally needs `inventory:read`, as today.
- Install keeps `addMaterial`'s semantics.
- `createProjectReadAuthorizer` is extracted from its two private copies into one exported helper in `packages/projects/src/lib/` and used by every staging action and provider. The existing Materials actions are left as they are; see Risks.
- Box label and manifest providers return null for a missing or forbidden box alike, so a scan the user cannot open reveals nothing (C1 contract, and C3's scan-to-open rule).

**D13: edition and placement.**
- CE. Projects and inventory are CE packages; nothing goes in `ee/`. The plan folder is under `ee/docs/plans` by convention only.
- Stock-claim and staging semantics live in `packages/inventory/src/lib/` (the owner of the stock tables), following the `materials.ts` pattern: a lib-layer service, with permission gating in thin wrappers.
- Actions, UI and label/manifest providers live in `packages/projects`.
- Composition routes live in `server/`.

## 3. What changes, by file

Migrations (`server/migrations/`, Citus-safe: `exports.config = { transaction: false }`, `ensureTenantDistribution`, composite `(tenant, …)` FKs, tenant in every PK and unique key, following `20261013163910_create_prepaid_block_tables.cjs`):
- **`project_staging_lines`**
  - Keys: `tenant`, `staging_line_id` (PK with tenant), `project_id` (FK projects), `task_id` (nullable FK project_tasks).
  - What it holds: `kind`, `status`, `service_id`, `unit_id`, `asset_id`, `description`, `quantity > 0`, `reserved_location_id`.
  - Planned billing fields, copied to the material at install: `rate`, `currency_code`, `billing_destination`, `billing_schedule_entry_id`.
  - Install link: `project_material_id` (nullable, set at install).
  - Audit: `reserved_at/by`, `staged_at/by`, `installed_at/by`, `released_at/by`, `created_at`, `updated_at`.
  - CHECKs per kind and status:
    - `stock` requires `service_id`
    - `client_asset` requires `asset_id`
    - `client_item` requires `description`
    - serialized stock lines have quantity 1
  - Indexes: (tenant, project_id, status); (tenant, service_id, status); (tenant, unit_id).
- **`stock_units.allocated_staging_line_id`**: nullable, composite FK, indexed, plus `CHECK (allocated_so_line_id IS NULL OR allocated_staging_line_id IS NULL)`.
- **`staging_containers`**: `container_id`, `project_id`, `task_id`, `sequence` (unique per tenant and project), `name`, `status` (`open|sealed`), `stock_location_id` (nullable; where the box physically is, informational), `location_note`, `notes`, `sealed_at/by`, `created_by`, timestamps.
- **`staging_container_members`**: `member_id`, `container_id`, `staging_line_id`, `quantity > 0`; unique (tenant, container_id, staging_line_id).

Inventory (`packages/inventory/src/lib/`):
- `allocation.ts` (new, D5); `salesOrderActions.ts` calls it.
- `consume.ts`: `location_id` and `claimant` options (D7). B1's refusal messages are generalised so a claim can read "reserved for sales orders or projects", naming which from the counter attribution where cheap and saying "reserved" otherwise.
- `materials.ts`: internal `from_staging_line_id`. `deleteMaterial` releases a linked staging line (D8).
- `reconcile.ts`: staging claims (D5).
- `staging.ts` (new): `reserveStagingLines`, `adjustReservation`, `swapUnit`, `stageLines`, `releaseLines`, `installLines` (per line, each in its own savepoint-free transaction so one failure does not undo the others; the result lists successes and failures), `undoInstall`, `addClientLines`, `listStaging`.
- `stagingContainers.ts` (new): create, rename, delete-empty, seal, reopen, pack/unpack members, list with n of m.
- `../actions/fulfillmentActions.ts` `loadCandidateUnits`: the project claim counts as a foreign hard hold (D6).
- `unitQueries.ts` and the Units view: an allocated unit shows its claimant (sales order or project) rather than a bare "Allocated".

Types (`packages/types/src/`):
- `IProjectStagingLine`, `IStagingContainer` and `IStagingContainerMember` interfaces.
- `recordLinks.ts` (plus the mobile copy): `staging_container`.
- `labels.ts`: `staging-container` class and `LabelViewModel.sequence`.

Billing (`packages/billing/src/`):
- Label template for `staging-container` and the `sequence` binding in `lib/label-template-ast/`.
- `staging-manifest` registry entry, standard template, bindings and sample in a new `lib/staging-manifest-template-ast/`.
- `services/`: `renderRegisteredDocumentPdf`.
- `DesignerDocumentKind` gains the manifest type if the designer requires it.

Projects (`packages/projects/src/`):
- `lib/projectReadAuthorizer.ts` (extracted, D12).
- `actions/stagingActions.ts`: wrappers over the inventory lib.
- `lib/stagingLabelViewModelProvider.ts` and `lib/stagingManifestViewModelProvider.ts`.
- `components/staging/`: the staging page, lines table, reserve dialog (with B1-style availability conflict display), add-client-item dialog, box panel, pack dialog, bulk-print action.
- A "Staging" button in the `ProjectInfo.tsx` header beside Materials.
- The Materials drawer shows a "From staging" marker on installed rows.

Server (`server/src/`):
- `app/msp/projects/[id]/staging/page.tsx` renders the staging page. `?containerId=` opens that box.
- `app/api/labels/pdf/route.ts` registers the staging-container provider.
- `lib/labels/printLabels.ts`: mixed items.
- `app/api/projects/staging/containers/[id]/manifest/route.ts`, plus the middleware skip-list entry.
- Locales: `server/public/locales/*/features/projects.json` for every shipped locale, following the B1 PR's pattern.

## 4. Order of work

0. **Gate.** Confirm B1 (#3818) and C2 have merged. Rebase onto main. Check whether C4 has merged (D9 branch).
1. Extract `lib/allocation.ts` and move sales orders onto it with no behaviour change (existing SO tests green).
2. Migrations, plus type interfaces.
3. Engine changes: `consume.ts` claimant and location, the poach guard, reconcile. DB tests first, written to fail before the change.
4. `staging.ts` lifecycle and its DB tests (reserve, stage, install, undo, release, client lines).
5. `stagingContainers.ts` and its DB tests.
6. Authorizer extraction, then the project staging actions.
7. Record link, label class, `sequence`, box label template and provider, mixed-items `printLabels`.
8. Manifest document type, render service, provider and route.
9. UI: staging page, header entry, dialogs, bulk print, Materials drawer marker, Units claimant display.
10. Locales, docs and the alga-plan test list closed out. Browser smoke test on the dev origin.

## 5. Out of scope

- Dispatch, in-transit tracking, on-site receipt scans and their audit events (a later card).
- Moving staged stock to a staging location through transfers: `staging_containers.stock_location_id` is informational only, and staging writes no movement.
- Reservations for ticket materials. Partial reservations, backorders, or creating purchase orders from staging.
- Kits in staging (stage components instead).
- Mobile screens for boxes and staging. A scanned box URL opens the web page; mobile routing is C3 or a later card.
- Print history or stored manifests, unless C2 decides on print history (D11).
- Changing non-serialized SO fulfillment's warn-only behaviour. Adding record-level checks to the existing Materials actions.
- New workflow or inventory events for staging transitions.
- Labels for non-serialized quantity lines.

## 6. Risks

- **B1's final shape may differ from `dea428483c`.** D7 depends on `evaluateConsumption` and `InsufficientStockError.detail`. If review changes them, adapt D7 to whatever lands and keep its semantics (release own claim, then apply the free-stock rule).
- **Stale reservations starve stock.** A finished project that never releases its lines holds soft or hard claims indefinitely. Mitigation:
  - the claimant is shown on Units and in staging
  - project deletion is refused while active stock claims exist
  - completing or closing a project shows a warning listing open claims, with a one-click "Release all reserved and staged"
- **The B1 soft override can consume project-reserved stock**, as it can sales-order-reserved stock, leaving `on_hand < reserved`. This is accepted soft semantics. Staging must still show the shortfall when it renders the line (free stock at the location below the claim), and install must surface B1's refusal rather than fail silently.
- **Non-serialized SO fulfillment can take staged (held) stock with a warning.** This is an existing sales-order behaviour (D6 leaves it). Tests document it so a later card can tighten it deliberately.
- **Cycle counts** expect `in_stock` units only. A physically present but `allocated` unit is already a sales-order edge case, and project claims make it more common. Note it in the PRD; do not fix it here.
- **The `recordLinks.ts` mobile parity test** fails unless both copies change together. C3 is editing the same file; whichever card merges second rebases.
- **Printed "n of m" goes stale** when boxes are added or removed. The UI shows the live value; there is no auto-reprint.
- **The 200-label cap** (C1) limits a single bulk print. A large rollout prints box by box.
- **The existing Materials actions have no record-level project check.** Out of scope here (D12); flagged as a follow-up for the board.

## 7. Tests the PRD must carry

These come from the card's done-criteria. The full list goes in the alga-plan `tests.json`.

- **T-reserve-availability:**
  - Reserving refuses when free stock (on_hand − reserved − held at the location) is below the request, counting SO soft reservations and SO hard holds.
  - Exact-to-free succeeds.
  - Two concurrent reserves of the last units serialize: one wins, one gets a typed refusal.
  - Serialized: a unit already claimed (by an SO or a project), or not `in_stock`, cannot be reserved. FIFO reserve of N fails as a whole when fewer than N are free.
- **T-shared-counter:** after a project reserve, SO `allocateLine`, `queryProductAvailability` and B1's consume guard all see less free stock. Staging moves the claim from reserved to held, and B1 then refuses even with the override.
- **T-reconcile:** "Rebuild stock caches" preserves project reserved and held claims and clears drift.
- **T-poach:** SO fulfillment never picks a project-claimed unit, whether by FIFO or explicit pick.
- **T-install:**
  - Install consumes exactly once at the claim's location.
  - It releases the claim and creates one `project_materials` row with the planned billing fields.
  - A serialized install delivers the claimed unit and creates the asset after commit.
  - Undo install restores the hard claim. Deleting the material releases the line.
- **T-no-side-effects:** rendering box labels, bulk labels (mixed classes) and manifests leaves these unchanged, by row count and checksum: `stock_levels`, `stock_movements`, `stock_units`, `project_materials`, `project_staging_lines`, `staging_*`, `invoices`/`invoice_charges`, `documents`, time entries, assets. No events are published.
- **T-reserve-is-not-consume:** reserve, stage and pack write no `stock_movements` and no `project_materials`. Billing run previews show no charge for staged lines.
- **T-client-items:** client lines never create `stock_units`, movements or levels, and never become sellable or billable. A `client_asset` from another client is refused.
- **T-boxes:**
  - Member quantity sums never exceed the line quantity.
  - A serialized or client-asset line is in at most one box.
  - A sealed box refuses changes.
  - Delete is allowed only when the box is empty.
  - n of m is computed correctly after deletions.
- **T-authz:**
  - Missing or forbidden boxes in label and manifest requests are indistinguishable (both 404).
  - A user without the project record-level read gets nothing.
  - Mutations need `project:update` plus the record-level check.
- **T-labels:** mixed-item `printLabels` keeps order and the all-or-nothing rule. `recordLinks` round-trips `staging_container`, and the mobile parity test passes.
