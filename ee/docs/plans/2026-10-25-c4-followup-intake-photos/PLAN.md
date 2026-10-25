# Plan — intake photos on the asset and custody history

Mechanism read on the follow-up 1/3 base (`fc507349ef`). Note: this card's worktree still sits before C4;
the engine rebases it onto its stack parent (`3c9f8a48`). Re-verify the file:line below after that rebase.

## D1 — The custody event IS the link. No new table, no new column.

`asset_custody_events.document_ids` is already written by `openCustody` (`openCustody.ts:137`,
`JSON.stringify(input.document_ids)`) and `recordCustodyEvent` (`recordCustodyEvent.ts:83`), and already
read by the custody service (`service.ts:243`). Every custody action accepts `document_ids` today.

So the answer to the card's open question — link table, column, or association metadata — is **the existing
column**. The event owns its photos: `received`, later `moved` / `handed_off` / `shipped` / `returned`, and
C5's RMA steps all get it for free. Adding a link table would duplicate a fact the event already carries and
would have to be kept in step with it.

What is missing is not storage; it is (a) the asset-side document association and (b) two renderings.

## D2 — Associate the photos with the asset inside the receive transaction

`receiveEquipment.ts`, after `openCustody` returns and the asset id is known, inserts one
`document_associations` row per `document_ids` entry for `entity_type='asset', entity_id=assetId` — in the
**same transaction**, with `ON CONFLICT DO NOTHING` on the natural key. Direct table insert, not the
`documentActions` server action, for the same reason the file already inserts `asset_associations`
directly (`receiveEquipment.ts` comment: the action carries its own auth and would re-check a caller that is
already authorised here).

Consequences that satisfy the card's C4 rule:

- **Failed receive** → transaction rolls back, so no event and no asset association exists; the dialog's
  upload cleanup already removes the uploaded documents (keep it as-is).
- **Existing-asset receive** → same insertion; photos attach to the existing asset.
- **Idempotent** → a retried receive cannot double-associate.

Use the tenant-scoped `db` (as the existing insert does) so Citus placement follows the asset.

## D3 — Asset Documents area: prove it, do not rebuild it

`DocumentsPasswordsTab.tsx` lists by entity association (SWR, keyed by the entity). With D2 the photos appear
there with no component change. The one thing to check is the tab's default filters: if it filters
`document_type` or ownership, add the photo association to what it accepts rather than special-casing intake
photos. Add a test that asserts a `document_associations('asset')` row makes the document appear.

## D4 — Custody history renders each event's photos

- `custodyEventToHistoryEntry` gains `documentIds: string[]` from the row it already receives (no query
  change; `service.ts:243` already maps the column).
- `CustodyCard` renders a thumbnail strip under the entry when `documentIds.length > 0`, using the existing
  document thumbnail + viewer components (the same pair the Documents tab uses). Clicking opens the existing
  viewer dialog. No new dialog, no new viewer.
- **Permission-correct by construction:** the strip renders only thumbnails whose documents the viewer is
  allowed to read (the existing document read endpoint enforces RBAC). If the read refuses, render nothing —
  never a broken tile or an error row. A user without asset read never sees the card at all.

## D5 — Photos on the other custody actions (agreed; last commit)

Because the event column already exists, this is the generalisation the card asks for and it is cheap:
extract the receive dialog's photo field into a shared `<CustodyPhotoField>` and thread `document_ids` into
`open`/`return`/`handOver`/`ship`/`move` through the same `DialogShell` submit contract (which follow-up 1/3
extends with a field-anchored error). `recordCustodyEvent` already persists them; the service already reads
them; D4's strip already renders them. No new path — the same path, exercised by more callers.

Sequenced last so a smoke finding cannot be attributed to it; if D1–D4 land cleanly, it ships in this card.

## D6 — Backfill the events that already carry documents

Idempotent migration: for every `asset_custody_events` row with a non-empty `document_ids`, insert the missing
`document_associations('asset', asset_id)` rows for documents that still exist and match the tenant. `ON
CONFLICT DO NOTHING`; re-running is a no-op. It reads the evidence that exists (`document_ids`) and invents
nothing: events without stored ids are left alone and that limitation is recorded in the PR.

## Test matrix

| Area | Test |
| --- | --- |
| Association | Integration: `receiveEquipment` with two `document_ids` → both `document_associations('asset')` rows exist for the new asset and for an existing asset. |
| Rollback | Integration: force `openCustody` to refuse after upload → no event, no asset association, and the uploaded documents are gone (C4's cleanup still holds). |
| Idempotency | Integration: repeat the receive (or re-run the backfill twice) → no duplicate associations. |
| Documents area | Component: an `asset` association makes the document appear in `DocumentsPasswordsTab`. |
| History | Component: the "Received into custody" entry renders two thumbnails from `documentIds`; an entry with none renders no strip. |
| RBAC | Integration: a user without document read gets no thumbnails and the viewer route refuses; a user without asset read cannot load the card. |
| Visibility | Integration: the documents stay `is_client_visible=false`; the client portal document list does not contain them. |
| Backfill | Migration test: seed pre-card events, run the migration twice → one association set, unchanged on the second run. |

## Risks

- **Two sources for "which asset":** the event's `asset_id` and the association. They must always agree; D2
  writes the association from the event's own asset id, never from client input.
- **Duplicate render** in the ticket-side asset drawer (it mounts the same custody card) — that is the same
  component, so it is a feature, not a second implementation.
- **Backfill on a large table:** batch by asset, log the count, and keep it in the normal migration runner.
- **Stacking:** this card's branch deploys on follow-up 1/3; re-verify `DialogShell`'s contract and
  `custodyEventToHistoryEntry` after the rebase (both are touched there).
