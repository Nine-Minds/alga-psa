# Receive equipment polish (C4 follow-up 1/3) — PRD

Card: alga-2026-0002683 C4 follow-up (1/3). PSA ticket alga-2026-0002683 (Joymode Business Solutions /
Munjal Thakkar). Stacked on C4 (`266cc9e0`); the PR targets C4's branch until it merges.

## Why

C4 shipped Receive equipment on a ticket, custody, and the Assets panel. The C4 review guide's D section
recorded five findings against `dbf350bd79` that make receiving feel unfinished: the item does not appear
until a page reload, its status prints as a raw slug, the custody chip shoves the name out of the row, the
Existing-asset picker offers items that cannot be received, and refusals show up below the fold.

All five are usability defects on a feature the customer already uses. None needs a schema change.

## Jobs

- A technician on a ticket receives an item (new or existing) and immediately sees it in that ticket's
  Assets panel, with a readable status and a custody chip.
- The same technician cannot pick an item that is already in custody, and can see where it is instead.
- When the server refuses anything, the refusal is visible without scrolling and points at the field.

## Findings to fix (re-verify each on the base before changing it)

1. **Panel refresh.** `packages/assets/src/components/AssociatedAssets.tsx` keeps associations in local
   state and reloads only when its props change (`loadAssociatedAssets`, mounted from
   `TicketDetails.tsx` / `MspTicketDetailsContainerClient.tsx`). After a successful receive the panel still
   reads "No assets associated with this ticket" until a full page load. Custody actions taken from the
   ticket's side drawer have the same problem.
2. **Status label.** `getAssetStatusLabel` in the same file reads
   `associatedAssets.assetStatuses.<status>` while the badge text is
   `Held_by_msp`; there is no key, so the fallback prints `Held_by_msp`. The same per-surface
   implementations exist in `AssetDashboardClient.tsx:993` and `AssetDetails.tsx:75`.
3. **Row layout.** `CustodyBadge` (`packages/assets/src/components/custody/CustodyBadge.tsx`) is inline
   with no shrink rules, so at the panel's normal and narrow widths the asset name is squeezed or pushed
   out.
4. **Existing-asset picker.** `packages/msp-composition/src/tickets/ReceiveEquipmentDialog.tsx` lists
   every client asset from `listAssets`; assets with an open custody record are selectable and only the
   server refuses them. The C4 design requires them disabled with their current location shown.
5. **Error placement.** `DialogShell` (`packages/assets/src/components/custody/CustodyDialogs.tsx:46`)
   renders the submit error at the end of `DialogContent`, which is below the fold in the receive dialog
   (photos + holder + details fields). Server refusals such as
   "This item is already in custody (Main Warehouse / Shelf C1)." are therefore invisible until the user
   scrolls and are not tied to the offending field.

## Invariants (unchanged, must stay true in every card of this line)

- Printing or scanning a label has no side effects: no stock, billing, ownership or time change.
- A QR code is never a secret; RBAC and record-level checks apply after the scan.
- Client-owned equipment never becomes sellable stock; intake never writes `stock_units`, stock movements,
  costs or invoice lines.
- Reserving equipment is distinct from consuming it.
- No second stock ledger.

## Done when

On a ticket: receiving a new item shows it in the Assets panel at once, with a readable status and a name
that stays readable next to the chip; an already-held asset cannot be chosen and shows where it is; and a
forced server error is visible without scrolling, at the top and on the field. Covered by unit tests for
the panel and the dialog and by an integration or e2e check of the refresh.

## Out of scope

- Any custody state machine change, schema change, or new custody action.
- Asset Documents / custody-history photos (that is follow-up 2/3, `7199e900`, which stacks on this card).
- Bulk receive, label/print changes, permissions.
