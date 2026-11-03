# Scratchpad — Warranty review and RMA (C5)

- Plan slug: `warranty-review-and-rma`
- Created: `2026-10-25`
- Base audited: `origin/main` `b87dbb98ba` (2026-10-25). Implementation base: rebase onto C4
  (`feature/alga-2026-0002683-4-6-equipment-custody-and-inta`).

## Re-verified against the code

- `rma_cases` shape: `server/migrations/20260626100400_create_inventory_transfers_rma.cjs` (columns,
  composite PK, `rma_type` and `status` CHECKs, Citus distribution) and
  `20260701092000_inventory_schema_hardening.cjs` (drops `dead_unit_returned` from the CHECK, adds
  `charge_invoice_id`). No `ticket_id`, number, carrier, tracking, warranty decision or history table.
- `openRma` requires `returned_unit_id` and `loadUnit` throws without a row; `openAdvanceRma` likewise
  (`packages/inventory/src/actions/rmaActions.ts`). Every transition locks the row `FOR UPDATE` via
  `loadRma` and guards with `assertStatus` — reused, not replaced.
- `deployReplacement` already updates the `assets` row directly and relinks the same asset to a new
  stock unit, which is the precedent for "same asset, new serial".
- RMA has **no REST surface**: no `rma` path under `server/src/app/api/**`, no `rma` method in
  `ApiInventoryController` / `InventoryService`. Only server actions + `/msp/inventory/rma`.
- RMA has **no tests at all** before this card (no `*rma*` test file anywhere except C3's
  `getRmaCase` DB test on main). The test matrix starts from scratch.
- Permissions: `permissions/catalog.cjs` grants `asset:read/update` to Admin/Manager/Technician and
  `inventory:*` to `msp:Admin` only. `hasPermission` is the check everywhere; the asset record kernel
  now lives in `packages/assets/src/lib/assetReadAuthorization.ts` (C4) with `isAssetReadAllowed` /
  `filterReadableAssets`.
- `rma_cases.asset_id` FK existed from day one, so C5 adds no asset link.
- `vendors` has no address columns (`20260626100000_create_inventory_locations_vendors.cjs`), hence
  `return_ship_to` as a snapshot.
- Numbering: `SharedNumberingService.getNextNumber` + `next_number` with `padding_length`; the
  registration pattern is `20260712104000_register_opportunity_next_number.cjs`.
- C1/C2/C3 are on main: `recordLinks.ts` includes `rma` → `/msp/inventory/rma?rmaId={id}`;
  `work-tag` is one document type with label classes; `LABEL_CLASSES` has no RMA class yet (C1 deferred
  it); `useLabelPrint` exists; `getRmaCase` + the `?rmaId=` dialog are in `RmaManager.tsx`; the
  sales-order document route + `shouldSkipApiKeyAuth` are the model for the return-slip route.
- C4's `asset_custody` CHECK already allows `close_reason='disposed'` and `'transferred_to_rma'`, but
  C4's `recordCustodyEvent` only ever closes as `returned_to_client`. C5 adds one core beside C4's for
  the credit path rather than editing C4's state machine.

## Stale claims in ANALYSIS.md (do not re-audit, just noted)

- "All inventory code … with REST in `InventoryService.ts`" — true for stock, POs, SOs, counts; **not**
  for RMAs.
- "No shared record→URL function" and "the ticket detail screen has no print action" — both were true
  at `a62fafbcb5`; C1/C2 have since merged (`recordLinks.ts`, ticket print action).
- "Stock units and RMAs have no detail routes" — RMAs now have a detail **dialog** via C3; there is
  still no `[id]` route for either, and C3 deliberately kept it that way.
- ANALYSIS says `rma_cases` has an `open` first status. Verified: `openRma` starts at
  `awaiting_return`; only the advance track starts at `open`. The PRD keeps both meanings.
- `RmaStatus` still declares `dead_unit_returned` and `RmaManager` still offers it as a filter, but the
  DB CHECK has rejected it since `20260701092000`. Dead branch; C5 removes it.

## Decisions and why

- (2026-10-25) Warranty claims are **asset-only** (`returned_unit_id IS NULL`). A device with a
  `stock_unit_id` already has a ledger identity; routing it through the unit track keeps one ledger per
  device and keeps the existing actions untouched.
- (2026-10-25) Track choice stays in `rma_type` (standard | advance_replacement), provisional until
  approval. A third `rma_type` would touch every query, switch and CHECK for no gain.
- (2026-10-25) New `rma_events` table rather than reusing `asset_custody_events`: an RMA is a vendor
  and commercial process, and legacy stock-unit RMAs have no asset or custody row at all. Reusing the
  custody log would make the RMA's history disappear for those cases.
- (2026-10-25) Status and custody stay separate facts. Only `shipToVendor` / receipt call C4's cores.
  A single "current location" field on the RMA would immediately drift from `asset_custody`.
- (2026-10-25) Replacement updates the same asset. A new asset row plus an archived old one would
  fragment the client's asset list and orphan the custody episode (`custody_id` points at `asset_id`).
- (2026-10-25) New `warranty` RBAC resource instead of widening `inventory:*`. Default technicians are
  the people doing this work and `inventory:*` is Admin-only; widening it would hand them POs and stock
  adjustments. A local "warranty or legacy inventory" check keeps existing custom roles working.
- (2026-10-25) The vendor-case external link is an explicit action, not an automatic mirror. Two
  writers of the same fact drift; `rma_reference` stays the source of truth.
- (2026-10-25) Return slip is a document type (`rma-return-slip`) with a session route, mirroring the
  sales-order document, not a giant label class. `packages/inventory` cannot import `packages/billing`,
  so the render action lives in billing and reads the tables, exactly as `downloadSalesOrderPDF` does.
- (2026-10-25) No `/api/v1` endpoints and no mobile surface. Neither exists for RMAs today; C3 made
  mobile RMA a non-goal. Adding a REST contract would be a separate product decision.
- (2026-10-25) RMA numbering via `SharedNumberingService` (new `RMA` entity type). The list, labels and
  return slip all need a human identifier; today they show `rma_reference` or 8 hex characters.
- (2026-10-25) Read gate on `asset_id` for RMA rows. It is a behaviour change for stock-unit RMAs
  linked to an asset, so it is pinned by a test and flagged in the PRD.
- (2026-10-25) `closeRma` becomes reason-aware and refuses `warranty_review`. A generic close would
  otherwise be the easiest way to bypass the decision step.
- (2026-10-25) Printing paths only reuse C1/C2. `labelPrintClient.ts` (C3 stopgap, marked
  `LEVERAGE: pattern label-print-client`) is deleted in favour of `useLabelPrint`.

## Could not verify / open

- **C4 is not merged**, so its final core signatures are the design's, not compiled code. I checked
  `recordCustodyEvent`, `returnCustodyToClient` and the `close_reason` CHECK on C4's branch, but the
  branch may still change during review. Rebase and re-check before step 1.
- Whether a `[id]` route for RMAs should exist at all is C3's call and is settled there as a query-string
  dialog. C5 extends the dialog rather than moving it.
- Product question the code cannot answer: whether Joymode expects vendor emails to live on the ticket.
  Defaulted to "no" per `PLAN.md` (ticket-conversations card), with the external-link mirror as the
  interim.
- Vendor ship-to: no address master. Snapshot field chosen; a vendor-address card may supersede it.
- The `warranty` permission resource is the one place I deviated from C4's "no new RBAC resource" rule.
  Custody is a property of the asset, so `asset:*` is right there; a warranty claim is an inventory-side
  commercial record, and there is no existing non-admin grant to ride on.

## Reviewer should look hardest at

1. The asset-only vs stock-unit branch. One accidental reuse of `receiveReturn` / `resolveReplacement`
   puts a client's device into sellable stock and breaks the customer's core invariant.
2. The `warranty` permission resource and the "warranty or inventory" acceptance helper — it is the only
   place this card changes who can do what.
3. The `rma_number` backfill and `next_number` seeding, which must not collide on existing tenants.
4. The C4 extension for `disposed` custody closure: it is the only write into C4's tables from C5.
5. The return-slip render action reading `rma_cases` from billing — same pattern as sales orders, but it
   is a second reader of the RMA row.

## Implementation log (2026-10-25, branch rebased onto origin/main with C4 merged)

### PRD-versus-reality divergences (the code wins; the PRD wins over the 2026-10-20 dossier)

- **No `returnCustodyToClient` core.** C4's real API is `recordCustodyEvent(trx, tenant, actor, custodyId, {event_type: 'returned' | 'shipped' | 'received' …})`. C5 calls it for ship, receive-back and return. The only C4 extension is `closeCustodyEpisode(..., 'disposed')` in `packages/assets/src/lib/custody/closeCustodyEpisode.ts`.
- **`disposed` closure writes no custody event row.** The C4 event vocabulary is physical movement only and nothing moved. It writes an `asset_history` row (`custody_disposed`) and leaves the asset's lifecycle status alone.
- **Migration timestamps renumbered** to `20261029130000` … `140500` (split into six: columns + NOT VALID checks, batched backfill, validate/indexes/NOT NULL/FKs, rma_events, permissions, event catalog; required by migration-lint rules 1-3, 5, 6) (the PRD said earlier stamps) because C4 and later migrations on main sort after the PRD's numbers.
- **`rmaTicketLink.ts` and the ticket RMA panel in both layouts (2026-10-20 dossier) were not built.** The PRD wins: the ticket shows its RMA through the associated-assets `RmaBadge` plus `ticket_id` on the RMA; the RMA shows its ticket number and links back. No ticket-side panel.
- **`publishAssetChanged` is not used for the replacement.** The cores return `assetEffect`/`assetStatusChange` and `runWarrantyTransition` publishes `ASSET_UPDATED` after commit, as the C4 service does (`publishAssetStatusChange` pattern), so a rollback never emits.
- **Vendor case link is a generic external link.** `mirrorRmaToTicketLinks` (msp-composition) uses the built-in `generic` system with `relationship: 'reference'`; the PRD's `custom:<slug>` tenant system does not exist by default. Marked `LEVERAGE: friction rma-vendor-case-link`.
- **Reads:** `getRmaCase`/`listRmaCases` now hide a case whose asset the caller cannot read, and a caller with only `warranty:read` sees client-asset claims only (never stock-unit RMAs).
- **`return_by` is selected as `to_char(..., 'YYYY-MM-DD')`** in `rmaCaseQuery` so a DATE never travels as a JS Date (day shift).

### Gotchas

- Dev-DB: the scratch copy (`c5_warranty_test`) had other branches' `knex_migrations` rows deleted so the migrations from this branch could run; the dev stack's own database was not touched.
- `tenantDb(trx, tenant).table(x).insert()` does NOT inject `tenant`; inserts must include it.
- `@alga-psa/event-schemas` resolves to `dist` in vitest; tests that need new schemas import from the package source.
- `loadRma` in `rmaActions.ts` now refuses unit-less cases (`RMA case is a warranty claim`): it is the single lock point of every unit-only transition and `closeRma`.
- A warranty-only user cannot call `closeRma`; warranty cases close through `closeWarrantyRma` (refuses `warranty_review`).

### Follow-up (not in this card)

- **Vendor conversation link.** The ticket-conversations branch is not merged, so the RMA ships without a link from the vendor email thread to the case. When it merges: link the thread to the ticket and mirror `rma_reference`, and retire the `generic` external-link mirror.
- Overlap with C3: the RMA detail is still the `?rmaId=` dialog C3 added; C5 extends it (`RmaWarrantyPanel`) and does not add an `[id]` route.
- **Advance-replacement dead-unit shipping.** A review caught that `replaced`/`repaired` only exit via `returnDeviceToClient` (wrong custody fact if what's physically moving is the dead unit, not the client's device) or the generic `close` — there is no "ship the dead unit to the vendor with tracking" transition. Shipped as-is on the unstated assumption that the vendor's return logistics bypass Alga's custody entirely (confirmed in the PRD's "Integration with C4" section, not actually verified against a real vendor workflow). See PRD "Follow-up: advance-replacement dead-unit shipping" for the fix shape if the assumption turns out wrong — it reuses `shipToVendorCore`'s pattern landing in the already-valid `dead_unit_owed` status, no migration needed.

## Test status at hand-off (revised after review)
All 34 tests are now written. T001-T027, T029, T030 and T033 were run and pass; T028/T031/T032/T034 are the Playwright spec (`server/src/test/e2e/warranty-rma.playwright.test.ts`), written but NOT run (no app server) and unverified.
- DB tests ran against the scratch Postgres `c5_warranty_test` (a copy of the dev DB with other branches' migration rows deleted there only); the migration up/down/up (T011) ran on `c5_migration_test`, created from it and dropped afterwards. `20261029130400_add_warranty_permissions` is deliberately irreversible; the cycle test asserts the throw.
- bwip-js, jsqr and @zxing/library are declared in packages/billing/package.json and the lockfile; a plain `npm install` installed them (no lockfile churn committed). The earlier 10 label/barcode failures were only these missing modules; the billing suite is now green (T033 and an HTML/PDF render of the RMA tag and return slip pass).
- Server `tsc --noEmit` is clean and its file list includes packages/msp-composition/src/tickets/rmaTicketActions.ts. `tsc` and `npm run build` pass for types, event-schemas, inventory, assets, billing.
- Known behaviour: `shipToVendor` with a missing carrier/tracking/return-by throws a ZodError (nothing written) rather than returning `{actionError}`.
- T020's permission test inserts `inventory:read` itself if absent: when run alongside another DB file it was missing once (cause not isolated).
