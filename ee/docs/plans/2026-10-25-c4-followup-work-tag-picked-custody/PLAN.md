# C4 follow-up (3/3) — Work tag shows the picked item's custody when a ticket holds several

PRD, features and tests. Design mechanism: `design-picked-custody.md`.
Parent: C4 `ee/docs/plans/2026-10-20-physical-work-tags/` (ANALYSIS.md, PLAN.md, `design-C4-equipment-custody.md`).
Ticket: alga-2026-0002683 (Joymode Business Solutions). Branch targets C4's branch until C4 merges.

## Problem

C4 gave the ticket work tag a custody line (where the item is, who acts next). When the ticket's
linked assets have more than one open custody record, the line degrades to `"n items held"` with no
next action — even when the operator explicitly picks one asset in **Print work tag**
(`formatCustodyForLabelMulti`). The picked asset is used for the tag/serial line but ignored for
custody, so a tag printed for one specific item cannot say where that item is.

## Product decisions (settled here, do not re-open in implementation)

1. **The picked asset decides.** When the operator picks an asset for the tag, the custody line is
   that asset's custody location and next action. `"n items held"` survives only for a tag with no
   asset picked.
2. **Batch printing is accepted.** **Print work tag** offers "one tag per held item" when the ticket
   has more than one item in open custody: N labels, one per held asset, each carrying its own shelf
   and next action. It is not a new rendering path — it is the print request carrying N label
   subjects instead of one.
3. **The unpicked multi-item summary keeps the count and gains the earliest follow-up.** No location
   list: the printed line budget is one short line each. `"3 items held"` / `"Follow up Oct 29"`.
   Which item the date belongs to is not printed — the summary is a ticket-level hint, and the
   operator has two better paths now (pick one, or print one per item).

Rejected alternatives and why:

- *List locations when they fit* (Q3): label lines are fixed-budget; a variable-length list either
  clips or silently drops items, and "it fits" depends on tenant data at print time. A count plus the
  earliest date is honest at any N.
- *Keep `"n items held"` for picked tags too*: that is the defect. A tag is printed for a specific
  physical item; printing a ticket-level count on it is wrong on the shop floor.
- *Separate `--batch` print endpoint*: a second path to keep in sync; the general shape below costs
  less and removes an existing special case (`linkedAssetId` only when `ids.length === 1`).

## Customer invariants (unchanged, must hold on every new path)

- Printing or scanning a label has **no side effects**: no stock, billing, ownership, custody-event,
  history or time row. The integration test asserts this on the batch and picked paths.
- A QR code is never a secret; RBAC and record-level checks apply after the scan.
- Client-owned equipment never becomes sellable stock; intake never writes stock.
- Reserving is distinct from consuming; there is no second stock ledger.
- The internal next-action **note** is never printed — only party + follow-up date.

## Scope

In:

- Custody selection rule for one label subject (picked → that asset; unpicked → one held item, else
  count + earliest follow-up; zero → no line), as a pure formatting function with unit tests.
- Print request generalised to a **list of label subjects** (`{ recordId, linkedAssetId? }`) through
  `packages/ui` client → `POST /api/labels/pdf` → `printLabels` → provider view models; the ticket
  work-tag overlay applies per subject. Removes the `ids.length === 1` rule for `linkedAssetId`.
- **Print work tag** dialog: per-asset custody in the picker options, a plain-language preview line
  ("The tag will show this item's location and next action.", `"3 items held"`), and the
  "one tag per held item (N)" option when N > 1.
- `GET /api/labels/linked-assets` returns each choice's custody facts, so the dialog can count held
  items, label the options with their shelf, and state the preview without a second round trip.
- Integration test asserting the picked and batch paths produce the expected custody lines **and**
  write nothing.

Out (deliberately):

- No change to `packages/billing` label rendering, templates, bindings catalogue, or layout presets.
- No change to the asset-identity or stock-unit label classes.
- No new permissions; the existing `asset:read` + `isAssetReadAllowed` gate is the only gate.
- No custody write path of any kind; no "pick item" persistence (the pick is a print-time choice).
- No list of locations on the summary line, no label line-budget changes.

## Done when

On a ticket holding three received items:

1. Picking one item in **Print work tag** prints a tag with that item's shelf and next action.
2. Choosing "one tag per held item" prints three labels, each with its own shelf.
3. Printing with no item picked prints `"3 items held"` and the earliest follow-up date.
4. No custody, stock, billing or time rows are written by any of the three.

## Features

- **F1 — Picked custody.** A label subject with a picked asset prints that asset's custody location
  and next action. A picked asset with no open custody prints no custody line (never the ticket
  count). Applies to both the asset line and the custody line consistently.
- **F2 — Summary custody.** With no pick: exactly one held item → existing single-item formatting;
  more than one → `"<n> items held"` + the earliest follow-up date across held items, rendered
  party-agnostically as `Follow up <Mon D>`; none held → no custody line.
- **F3 — Batch subjects.** The print request is a list of label subjects; the same record may appear
  more than once with different picks. Unreadable records are skipped and counted exactly as today;
  duplicates of the *same* subject are not deduplicated (each subject is one label).
- **F4 — Dialog.** When N > 1 held: an explicit batch choice with the label count, the asset picker
  disabled while it is on, and a preview line describing exactly what will print. When N ≤ 1: no
  batch choice, preview line names the item (or says nothing when there is no custody).
- **F5 — Read-only.** Every path is a read of custody facts; no writes.

## Tests

Unit — `packages/assets/src/lib/custody/custody.unit.test.ts` (extend the existing
`formatCustodyForLabel*` block; it already covers single-item facts and date formatting):

| Case | Expectation |
| --- | --- |
| 0 held, no pick | `null` |
| 1 held, no pick | that item's location + next action |
| 3 held, no pick | `"3 items held"` + `"Follow up Oct 29"` (earliest of the held dates) |
| 3 held, none with a date | `"3 items held"` + `null` next action |
| 3 held, pick with custody | picked item's location + next action |
| 3 held, pick withheld (no open custody) | `null` |

Unit — new `packages/assets/src/lib/ticketLinkedAssetLabels.test.ts` (there is no test file for
this module today; the module is otherwise covered only through the server integration suite):
picked asset is the one whose custody is used; unreadable assets contribute nothing to the count; a
pick that is not linked to the ticket is ignored (treated as no pick); the returned
`assetId`/`assetTag`/`serialSuffix` still follow the pick.

Component — `packages/ui/src/components/labels/LabelPrintDialog.test.tsx`: batch option appears only
when N > 1; turning it on disables the picker and sends N subjects with distinct `linkedAssetId`;
preview text matches the chosen state; single-item ticket sends exactly one subject.

Integration — `server/src/test/integration/equipmentCustody.integration.test.ts` (extend): a ticket
with three received items; print with `linkedAssetId` → one label, its shelf; print with three
subjects → three labels, three shelves; both paths write zero custody events/history/stock/billing
rows (count before/after), and the printed text never contains the next-action note.

Guard — `server/src/test/integration/labelsProviders.integration.test.ts` and `labelsFixtures.ts`
updated for the new request shape; `packages/tickets` `TicketDetails.printWorkTag.test.tsx` updated
for the dialog hand-off.

## Risks

- **Line budget.** A long location string already truncates in the renderer; the summary keeps the
  same one-line budget, so no new regime.
- **Duplicate-subject semantics.** `X-Label-Skipped` is counted per subject, so a ticket repeated
  three times that becomes unreadable counts three skips. That is the honest count (three labels not
  printed); document it in the route header comment.
- **Stacking.** The base is C4's branch; `packages/assets/src/lib/ticketLinkedAssetLabels.ts` and
  `labelFormat.ts` are files C4 also touched. Re-read them on the current base before editing.
