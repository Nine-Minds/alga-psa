# Intake photos on the asset and its custody history (C4 follow-up 2/3) — PRD

Card: alga-2026-0002683 C4 follow-up (2/3). [PSA ticket alga-2026-0002683](https://algapsa.com/msp/tickets/eb4a5b58-4bb1-48be-961f-8c2aeebcc0ed). Stacked on follow-up 1/3 (`3c9f8a48`), which also touches the Receive equipment dialog and
action; the PR targets that card's branch until it merges.

## Why

Receive equipment already accepts photos. They are uploaded as client-hidden ticket documents and passed
into `receiveEquipment` as `document_ids`, which the custody layer stores on the **custody event**
(`asset_custody_events.document_ids`, written by `openCustody`/`recordCustodyEvent`, read back in
`packages/assets/src/lib/custody/service.ts:243`). Nothing else uses them:

- the documents are associated with the **ticket only**, so the asset's Documents area does not show them;
- the custody history renders the events but never their photos, so the condition record of the item
  ("what did it look like when it arrived") lives in a ticket nobody opens when they pick the item up.

Intake photos belong to the equipment, not only to the ticket it came in on.

## Jobs

- A technician receiving an item attaches photos once; the ticket keeps them, the asset shows them, and the
  "Received into custody" history entry shows them.
- Later custody steps (moved, handed off, shipped, returned, C5's RMA steps) can attach photos through the
  same mechanism without a new one being invented.
- Nothing is visible to the client portal, and nothing becomes visible to a user who cannot read the asset
  or the document.

## Findings (verified on the follow-up 1/3 base)

1. `packages/assets/src/lib/custody/receiveEquipment.ts` passes `document_ids` into `openCustody` and stops
   there — no `document_associations` row for the asset is ever written.
2. `packages/msp-composition/src/tickets/ReceiveEquipmentDialog.tsx` uploads each photo with
   `uploadDocument(formData, { userId: '', ticketId, isClientVisible: false })`, i.e. ticket-scoped, before
   the asset exists. The association therefore cannot be created in the dialog for a new item.
3. `packages/assets/src/components/custody/CustodyCard.tsx` maps events through
   `custodyEventToHistoryEntry` (`:253-273`) and renders no documents; the event's `document_ids` are
   available in the row but never read by the UI.
4. The asset Documents area (`packages/assets/src/components/tabs/DocumentsPasswordsTab.tsx`) lists by entity
   association, so it would show them the moment the association exists.

## Upload behavior

Ticket receive and later custody actions accept up to 20 images totalling 10 MiB per submission.
All are client-hidden, including uploads filed into a client-visible folder. Move, hand off, ship,
receive back and return use the shared picker and upload transaction. Failed domain writes roll
back documents and associations. Failed storage deletion remains owned by a durable recovery
session and is retried by maintenance; it never becomes an untracked file.

## Done when

Receive a dock with two photos on a ticket; open the asset: both photos are in the asset's Documents, and
the "Received into custody" entry in custody history shows both thumbnails. The ticket still shows them.
They stay hidden from the client portal. Tests cover the association, the rollback on a failed receive, and
the RBAC/visibility rules.

## Invariants (unchanged)

Printing or scanning a label has no side effects. A QR code is never a secret. Client-owned equipment never
becomes sellable stock; intake never writes `stock_units`, movements, costs or invoice lines. Reserving is
distinct from consuming. No second stock ledger.

## Out of scope

- Photo capture, editing and compression. The shared picker adds count/aggregate-size validation only.
- Any new document store, OCR, or media-thumbnail pipeline.
- Reconstructing `document_ids` for historical events that never stored them (no evidence to do it honestly).
