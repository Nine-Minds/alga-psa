# Plan — Client-owned items staged on a project go through equipment custody

Card: c7faed5f · Joymode Business Solutions (Munjal Thakkar) · ticket alga-2026-0002683 · branch
feature/alga-2026-0002683-c6-follow-up-client-owned-item
Worktree read: `/home/robert/alga-copies/feature-alga-2026-0002683-c6-follow-up-client-owned-item` @ 23f023416d (main)
Predecessors: C4 custody (#3890, `design-C4-equipment-custody.md`), C6 project staging (#3892, `design-C6-project-staging.md`)

## Asked

A client-owned device staged on a project must be in MSP custody: staging it either links the open
custody episode or receives the device into custody, through C4's receive core; every physical staging
step is a custody event (so the asset timeline and the `/msp/assets/custody` queue show where it is);
installing on site closes custody with a fitting reason; box labels and the packing manifest mark held
client items as client-owned. Decide what `client_item` (free-text) lines do, and how releasing a line,
deleting a task, or deleting a project affects custody. Invariant: client items never touch
`stock_units`, `stock_movements`, `stock_levels`, `project_materials`, billing or time; C4 and C6 tests
stay green. Produce the design, not the implementation.

## What the code actually does (read, not inferred)

1. **Client staging lines are status-only today.** `addClientLines`
   (`packages/inventory/src/lib/staging.ts:859-935`) inserts `kind='client_asset'|'client_item'` lines
   with `status='received'`; it checks the asset belongs to the project's client and is on no other open
   client line. `stageLineInTransaction` moves `received → staged`; `installLines` (`:721-780`) moves a
   client line to `installed` with no material row; `releaseLineInTransaction` (`:530-555`) returns it to
   `released` and removes its box membership. Nothing in the file touches custody — the header says so
   at `:39`, and the C6 design's D9 says "if C4 has not merged, `client_asset` lines are plain links".
2. **Custody is asset-level and already anticipates this.** `packages/types/src/interfaces/assetCustody.interfaces.ts`
   defines one open `asset_custody` episode per asset (partial unique index), states
   `in_office|with_vendor|closed`, event vocabulary `received|moved|handed_off|shipped|returned`,
   close reasons `returned_to_client|disposed|transferred_to_rma|returned_to_vendor`, and **purposes
   already include `staging`**. `design-C4-equipment-custody.md:351` says C6 "will call `openCustody`
   with `purpose = staging`". Position is `(location_id, bin)` where `bin` is free text
   (`IAssetCustody.bin`, `IAssetCustodyEvent.from_bin/to_bin`).
3. **The cores are transaction-taking and composable.** `openCustody` (`packages/assets/src/lib/custody/openCustody.ts:26-175`),
   `recordCustodyEvent` (`recordCustodyEvent.ts:39-199`) and `closeCustodyEpisode`
   (`closeCustodyEpisode.ts:31-65`) all run inside the caller's transaction and write only
   `assets`/`asset_custody`/`asset_custody_events`/`asset_history`. Post-commit publishing is the
   caller's job (`publishCustodyChanged`, `publishRecordedCustodyEvent`, `publishEquipmentReceived` in
   `service.ts`). `@alga-psa/inventory` already depends on `@alga-psa/assets`, and `assets` deliberately
   does not import `inventory` (`assetInventoryActions.ts:11-14`) — the dependency edge is already the
   right way round.
4. **Two C4 asymmetries this card must resolve.** (a) `openCustody` never writes `assets.status`: only
   ticket intake sets `held_by_msp` (`receiveEquipment.ts:92`), and only a `returned` event clears it
   back to `active` (`recordCustodyEvent.ts:144-146`) — so an *existing* client asset received into
   custody still reads `active` in the asset list. (b) `recordCustodyEvent('returned')` hard-codes
   `returned_to_client`, and `closeCustodyEpisode` accepts only `disposed|returned_to_vendor`; the file
   already carries `LEVERAGE: friction custody-close-reason` about exactly this.
5. **Boxes are physical containers with an identifier, not locations.** `staging_containers`
   (`stagingContainers.ts:30-160`) has `identifier = <project_number>-B<nn>` (also the Code 128 value),
   an optional `stock_location_id`, `location_note`, `status open|sealed`. `packLines`
   (`:178-246`) stages a reserved/received line as it packs it; a serialized or client-asset line lives
   in at most one box; `sealContainer` only flips the box; `releaseLiveLinesWhere` reopens sealed boxes
   before releasing their lines (`staging.ts:581-612`).
6. **Labels and manifest.** `stagingContainerLabelViewModel` (`packages/projects/src/lib/stagingLabelViewModelProvider.ts:43-59`)
   prints identifier, project, client and task — nothing about item ownership.
   `buildStagingManifestViewModel` (`stagingManifestViewModelProvider.ts:44-106`) already prints
   `owner: 'Client'` for `client_asset` and `client_item` rows. The manifest half of the requirement is
   already satisfied; the box label is not.
7. **Release paths are not custody-aware.** `releaseStagingForTasks` (`staging.ts:623-655`) releases
   live lines, removes their membership (reopening sealed boxes) and detaches `task_id`;
   `releaseStagingForProject` deletes boxes, members and lines. An episode opened by staging would be
   left pointing at a bin that no longer exists.

## Decisions

### D1 — Custody is a precondition of staging, not a side effect

A `client_asset` line cannot exist without an open episode. `addClientLines` resolves it in the same
transaction: **link** the asset's open episode if there is one, otherwise **receive** the asset with
`openCustody(..., { purpose: 'staging', location_id, bin: null, next_action_party: 'msp' })`. An existing
episode keeps its own purpose (a device in for repair that then goes into a project box stays `repair`);
staging never rewrites another flow's episode.

Rejected: opening custody lazily at pack time. It would let a device sit on a project in a state no
queue can see, and it splits one rule across two call sites.

### D2 — The link is `asset_id`; no new staging column

Staging already allows one open client-asset line per asset, and custody already allows one open episode
per asset. Both models key on the asset, so every staging step finds its episode with
`asset_custody WHERE asset_id = ? AND closed_at IS NULL`. No `project_staging_lines.custody_id`, no
denormalised copy to drift. If an asset's episode closes and reopens mid-project, the step acts on the
open episode of that moment — which is the truthful one.

### D3 — A staging box is a custody **bin**, not a new kind of location

C4's position is `(location_id, bin)`; a box identifier is exactly a bin. Packing writes a `moved` event
with `to_location_id = container.stock_location_id ?? null` and `to_bin = container.identifier`
(`PRJ-0042-B03` — the same string printed on the label and the manifest), unpacking writes `moved` with
`from_bin = identifier, to_bin = null`. That gives the history and the queue "where is it" including the
box **and** the project (the identifier carries the project number), without a second location class, a
new FK, or a join in every custody reader.

Rejected: modelling containers as custody locations. It would duplicate what `bin` already means, add a
migration to every custody query and view, and break the manifest/label identity model.

### D4 — Event vocabulary grows by two, and close reasons stop being hard-coded

- **pack / unpack = `moved`** (already the physical truth, bin changes).
- **new `sealed` and `unsealed`**, both `in_office → in_office`. Sealing a box is a real custody fact
  (contents must not be disturbed) and the card names it; it is not a move, so overloading `moved`'s note
  would hide it from the timeline filter and the queue. Recorded for member client assets when a box is
  sealed, and for the assets still in it when it is reopened.
- **install = `recordCustodyEvent(event_type: 'returned', close_reason: 'installed_at_client')`**: the
  device leaves our custody at the client site and the episode closes in one append-only row. This needs
  `recordCustodyEvent` to take an optional close reason (default `returned_to_client` — today's
  behaviour), which retires the existing `LEVERAGE: friction custody-close-reason` rather than adding a
  second side door. `closeCustodyEpisode`'s `ClosableCustodyReason` also widens to every
  `CUSTODY_CLOSE_REASONS` member, so any ending can be named by the caller that knows it.
- **release never closes custody.** Release is a staging-scope act, not a statement about where the
  device physically is: a cancelled project's device may still be on our shelf. Release therefore
  unpacks (a `moved` out of the box when boxed) and leaves the episode open and in the queue. Closing
  stays an explicit custody act, or install.

### D5 — `client_item` (free-text) lines stay out of custody

Custody is a property of an **asset** (`asset_custody.asset_id` is the identity the episode, its events,
its label class and its RMA links all hang from). A free-text line has no asset; creating one would
invent inventory identity the tenant never entered — a type, attribute schema, tag, lifecycle and a
disposal story — and would make every "I brought 3 network cables" line a permanent asset record.
So: `client_item` lines remain client-owned staging lines, labelled `Client` on the manifest (already
true), and the custody queue does not show them. The staging page states this plainly and offers
**Track as asset** for a free-text line the MSP wants custody of, which runs the C4 intake and replaces
the line with a `client_asset` line (follow-up affordance, same core, no second path).

### D6 — Opening custody owns `held_by_msp`; don't clobber other lifecycle statuses

`openCustody` sets `assets.status = 'held_by_msp'` when the asset's status is the ordinary `active`
(and publishes `ASSET_UPDATED`), matching what intake already does; any other status (`retired`,
`lost`, …) is left alone because that status is someone else's decision. Install/return already restores
`active` via the `returned` event, so the pair becomes symmetric for every flow, not just staging.

### D7 — Custody writes require `asset:update`

The staging wrapper (`packages/projects/src/actions/stagingActions.ts`) gates on `project:update` + the
record-level project decision. Custody's own model requires `asset:update` for episode writes
(`openCustodyService` → `assertAssetAuthorized(..., 'update')`). Staging must not become a side door:
every staging mutation that writes custody (`add` a client asset, `pack`, `unpack`, `seal`/`reopen`,
`install`, `release`) resolves `asset:update` for each affected client asset through the C4 helpers. A
multi-line install reports the refusal on that line (the existing `InstallLineResult.ok:false` shape)
rather than failing the whole box. `addProjectClientItems`'s current `asset:read` requirement becomes
`asset:update`, since adding the line is what opens the episode.

### D8 — Publish after commit, from the staging action

The staging actions call the in-transaction cores, collect their custody results, and after commit call
the existing publishers (`publishCustodyChanged` / `publishRecordedCustodyEvent` /
`publishEquipmentReceived`) — exactly the contract `service.ts` documents for composed callers.

### D9 — The box label names client-owned contents

`stagingContainerLabelViewModel` gains an ownership summary derived from the box's members (which the
view already carries): when any member is a client line, the label prints `Contains client-owned
equipment (n)`; all-MSP boxes print nothing new. The manifest needs no change.

## Step-by-step mechanics

| Staging step | Custody effect (same transaction) |
| --- | --- |
| add `client_asset` | link the open episode, or `openCustody(purpose='staging')`; line `received` |
| pack into a box | `moved` → (`container.stock_location_id`, `container.identifier`); line `received/reserved → staged` (unchanged) |
| seal a box | `sealed` for each member client asset, `to_bin = identifier` |
| reopen a box | `unsealed` for each client asset still in it |
| unpack | `moved` → (`location`, `null`) |
| install | `returned` + `close_reason='installed_at_client'`, note names project + box; membership removed |
| release (user) | if boxed: `moved` out; episode stays open; line `released` |
| task delete (`releaseStagingForTasks`) | same as release, per line; never closes; never touches episodes it did not open beyond the move |
| project delete (`releaseStagingForProject`) | same, before the box rows go |

Install removing the membership is deliberately asymmetric with stock lines (which keep theirs): a stock
line's box membership is already stale-but-harmless display history, while a client asset that has left
the company's custody must not still be listed inside a sealed box.

## Build order

1. Types + schema: `CUSTODY_EVENT_TYPES` += `sealed|unsealed`; `CUSTODY_CLOSE_REASONS` +=
   `installed_at_client`; state-machine rows; migration only if the enum is DB-constrained (it is a text
   column with a check — extend it in the same migration style as C4).
2. C4 cores: optional `close_reason` on `recordCustodyEvent`; widen `closeCustodyEpisode`'s reason type;
   `openCustody` sets `held_by_msp` from `active`; return the status change for post-commit publishing.
3. `packages/inventory/src/lib/stagingCustody.ts` — one small module: `ensureCustodyForClientAsset`,
   `custodyMoveForBox`, `custodySealForContainer`, `custodyInstall`, `custodyRelease`. It calls the C4
   cores and nothing else; `staging.ts` and `stagingContainers.ts` call it at the points above.
4. Staging actions: `asset:update` resolution + post-commit publishing.
5. Box label ownership summary; staging page `client_item` note and custody state per client line
   ("in custody at Office / PRJ-0042-B03", linking to the asset's custody tab).
6. Tests (below).

## Tests

- **Unit (state machine / cores)**: `sealed`/`unsealed` are legal only from `in_office`; `returned` with
  `close_reason='installed_at_client'` closes and records one event; `openCustody` sets `held_by_msp`
  from `active` and leaves `retired` alone.
- **Behavioural (db)**: add a client asset with no episode → one episode, purpose `staging`, line
  `received`; add one that is already in a `repair` episode → same episode linked, purpose untouched, no
  second episode; pack → `moved` with the box identifier as `to_bin`; seal → `sealed` per client asset;
  install → closed `installed_at_client`, membership gone; release/task-delete/project-delete → episode
  still open, item out of the box, no dangling bin.
- **Invariants**: after a full add → pack → seal → install cycle on a client asset, no
  `stock_units`/`stock_movements`/`stock_levels`/`project_materials` rows exist for it and no
  billing/time row is written; a `client_item` line never produces a custody row.
- **Regression**: the existing C6 staging + container + manifest/label suites and the C4 custody suite
  stay green; install/release for stock lines is untouched.
- **Authorization**: a caller with `project:update` but not `asset:update` gets a typed refusal on the
  client-asset line (and only that line in a mixed install).

## Risks and open questions

- **Queue noise**: every staged client asset now appears in `/msp/assets/custody` (correct, but the queue
  will grow on staging-heavy projects). `purpose='staging'` is filterable already; a "staging" queue tab
  is a UI follow-up.
- **An episode opened by staging and never closed** (client never picks up, project archived) sits in
  the queue until someone acts. That is the intended visibility, but it is new operational work; the
  card's release rule means nobody can make it disappear by deleting a task.
- **`bin` is free text**: rename/reuse of box identifiers is not policed by custody. The identifier is
  stable per box (`sequence` max+1, soft delete never reuses), so this is display-only drift at worst.
- **`held_by_msp` from `active` is a behaviour change for `openCustody` callers outside staging**
  (repair intake). It makes existing paths consistent with intake; if a caller depends on leaving an
  active asset active while in custody, it should say so explicitly rather than relying on the omission.
- **The box label's ownership summary is a snapshot**, like every printed label.
