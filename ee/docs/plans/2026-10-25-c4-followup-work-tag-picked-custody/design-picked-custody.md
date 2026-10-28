# Design — picked-item custody on the ticket work tag

Mechanism behind `PLAN.md`. Decisions there are settled; this file is how the code is shaped.

## 1. The one idea

A print job is a **list of label subjects**, not a list of record ids plus global overrides. Each
subject names a record and, optionally, the asset the operator picked for that label:

```ts
export interface LabelSubject {
  recordId: string;          // ticket / asset / stock unit
  linkedAssetId?: string;    // ticket-work-tag only: the item this label is about
}
```

Every current behaviour is the degenerate case of this list, and the two rules that today read as
special cases ("`linkedAssetId` only when `ids.length === 1`", "overrides only for a single ticket")
fall out of the general shape:

- one ticket, one subject → the pinned tag;
- one ticket, N subjects, each with a different `linkedAssetId` → one tag per held item;
- N tickets, one subject each → today's multi-record print.

So there is no batch mode, no batch flag, and no second endpoint.

## 2. Data layer (assets package)

### `packages/assets/src/lib/custody/labelFormat.ts`

Replace `formatCustodyForLabelMulti(facts)` with the full rule, keeping every function pure:

```ts
/** The custody line for ONE label. `pick` is null when no asset was picked (valid pick); otherwise `pick.facts` are
 *  the picked asset's facts, or null when the picked asset has no open custody. */
export function formatCustodyForLabelSubject(
  held: ReadonlyArray<CustodyLabelFacts>,   // every readable held item on the ticket, in caller order
  pick: { facts: CustodyLabelFacts | null } | null
): CustodyLabelFacts | null;
```

> Implementation note: the first draft typed the pick as `CustodyLabelFacts | null`, which cannot tell "no pick"
> from "picked, not held" (both `null`), so a not-held pick would have printed the ticket count. The wrapper object
> makes the two cases distinct.

- `pick` non-null → return `pick.facts` verbatim (the picked item decides; a picked item with no open custody has
  `facts: null` and so never prints the ticket count).
- no pick, `held.length === 0` → `null`.
- no pick, `held.length === 1` → `held[0]`.
- no pick, `held.length > 1` → `{ custodyLocation: `${n} items held`, nextAction: earliestFollowUp(held) }`.

`earliestFollowUp` needs the raw `follow_up_on` values, not the formatted strings, so carry the
earliest date alongside the facts: extend `CustodyLabelFacts` with `followUpOn: string | null`
(date-only, never rendered directly) and derive the printed string with the existing
`formatFollowUpDate`. `formatCustodyForLabel` and `formatFollowUpDate` stay as they are; the
`"n items held"` branch renders `Follow up <Mon D>` (party-agnostic — the line summarises several
items with different parties, so a party claim would be wrong).

Keep `formatCustodyForLabelMulti` only if a caller outside this path uses it; otherwise delete it —
`grep -rn formatCustodyForLabelMulti` before removing (today: `labelFormat.ts`,
`ticketLinkedAssetLabels.ts`, `custody.unit.test.ts`).

### `packages/assets/src/lib/ticketLinkedAssetLabels.ts`

`getTicketLinkedAssetLabelParts(context, tickets, chosen)` is already ticket-keyed, which cannot
express "same ticket, different asset". Change the entry point to be subject-keyed and keep the
ticket-wide read:

```ts
/** One entry per subject, in request order. */
export async function getTicketLinkedAssetLabelParts(
  context: LabelRequestContext,
  subjects: ReadonlyArray<{ recordId: string; linkedAssetId?: string }>
): Promise<Array<TicketLinkedAssetLabelParts | null>>;
```

Implementation: read links + assets + custody once per request (existing queries, unchanged); for each
subject pick `linkedAssetId` when it is linked **and** readable, else the single readable linked asset,
else none; `held` = custody facts of every readable linked asset on that ticket;
`custody = formatCustodyForLabelSubject(held, pickedFacts)`. The `LEVERAGE: friction
label-seam-asset-or-custody` marker goes away with the shape that caused it — the label now has an
explicit asset-or-custody subject.

`listTicketLinkedAssetChoices` gains custody so the dialog can count and preview without a second
call:

```ts
export interface TicketLinkedAssetChoice {
  assetId: string; assetTag: string | null; name: string | null;
  custody: CustodyLabelFacts | null;   // null = not in open custody (cannot be batch-printed)
}
```

`server/src/app/api/labels/linked-assets/route.ts` passes it through unchanged (it already returns
`{ assets }`).

## 3. Print pipeline

### `server/src/lib/labels/printLabels.ts`

Request body becomes:

```ts
{ labelClass, labels: LabelSubject[], templateId?, templateCode?, layout?, overrides? }
```

- `ids` and the top-level `linkedAssetId` are **removed**, not kept as sugar (only two clients).
- Validate `labels` as a non-empty array, ≤ the existing `MAX_LABELS_PER_REQUEST`, each `recordId` a
  UUID, `linkedAssetId` a UUID when present. `linkedAssetId` is ignored unless
  `labelClass === 'ticket-work-tag'` — keep that 400-free rule (an inapplicable field is dropped, as
  `linkedAssetId` is today).
- `overrides` still applies only when the job names **one distinct recordId** (`new Set(...).size === 1`);
  otherwise 400 as today.
- Resolve view models per **unique** record id (`provider.getLabelViewModels` once), then materialise
  one view model per subject in request order. Unreadable record → that subject is skipped and counted;
  a subject naming an unreadable record is not expanded into extra skips.
- The ticket work-tag overlay now maps subject → parts by index, so two subjects for one ticket carry
  different `secondaryIdentifier`/`serialSuffix`/`custodyLocation`/`nextAction`. This also fixes the
  asset line: a picked asset on a multi-item ticket finally prints its own tag and serial suffix
  (today the overlay uses whichever asset the ticket-level rule chose).
- `X-Label-Skipped` counts subjects, so a ticket repeated three times and unreadable counts three.
  The uniform-404 rule is unchanged: zero readable unique records → 404.

### Clients

- `packages/ui/src/components/labels/useLabelPrint.ts` — `LabelPrintRequest.labels: LabelSubject[]`;
  drop `ids`/`linkedAssetId`.
- `packages/inventory/src/components/labelPrintClient.ts` (scan-to-open) — send one subject.

## 4. Dialog (`packages/ui/src/components/labels/LabelPrintDialog.tsx`)

Only for `labelClass === 'ticket-work-tag'` with one ticket. Today `linkedAssets` is loaded from
`/api/labels/linked-assets`; it now carries each choice's custody.

States and copy (all strings via `t()` with `defaultValue`):

| State | Shown |
| --- | --- |
| N held = 0 | no custody controls; tag prints no custody line |
| N held ≥ 1, picker visible (linked assets > 1) | picker; options read `"<tag> - <name> — Main Office / Shelf B3"` when held |
| pick made | preview: `The tag will show this item's location and next action.` |
| no pick, N held = 1 | preview: `The tag will show <location>.` |
| no pick, N held > 1, batch off | preview: `<n> items held.` |
| N held > 1, batch on | `Print <n> tags, one per held item.`; picker disabled |

Batch control: a `Checkbox` (existing standard component) labelled
`One tag per held item ({{count}})` under the picker, rendered only when N held > 1. While on, the
picker is disabled (not hidden: the last pick stays visible so turning batch off restores it) and the
request carries N subjects, one per held asset in custody order; turning it off restores the single
subject with the current pick.

Request assembly is one pure helper in the dialog module so it is unit-testable without the DOM:

```ts
export function buildLabelSubjects(
  ticketId: string, choices: TicketLinkedAssetChoice[], pickedAssetId: string, batch: boolean
): LabelSubject[];
```

- batch → one subject per `custody !== null` choice;
- otherwise → `[{ recordId: ticketId, linkedAssetId: pickedAssetId !== NO_LINKED_ASSET ? pickedAssetId : undefined }]`.

### Runtime note

The dialog must also re-load choices when the ticket's custody can change while it is open — cheap and
correct: load on open (already the case). No polling; the tag is printed from a dialog opened on
demand.

## 5. Side effects

None. Every read is `asset_associations`/`assets`/custody reads behind `asset:read` +
`isAssetReadAllowed`; the renderer is pure. The integration test asserts row counts for
`asset_custody_events` (or the custody history table name in use), `stock_units`, `stock_movements`,
billing lines and `time_entries` are unchanged across all three print shapes, and that no
next-action **note** text appears in the rendered PDF text layer.

## 6. Rollout / stacking

The card is stacked on C4 (`266cc9e0`). `labelFormat.ts` and `ticketLinkedAssetLabels.ts` exist only
on C4's branch, so there is no migration concern on main; the PR targets C4's branch and is
re-targeted when C4 merges. No DB change, no template change, no binding-catalogue change — the
existing `custodyLocation`/`nextAction` bindings already carry whatever the rule produces.
