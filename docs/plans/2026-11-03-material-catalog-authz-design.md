# Design — authorize owning ticket and catalog access in material actions

Card: `722b1207-a482-5c17-a61c-08ddbf0d90d5` — *Security: 2 findings in materialCatalogActions.ts*
Findings:
1. **authz · high** `packages/tickets/src/actions/materialCatalogActions.ts:129` (`addTicketMaterial`)
2. **secrets · high** `packages/tickets/src/actions/materialCatalogActions.ts:86` (`searchServiceCatalogForPicker`)

## Finding 1 confirmed (ticket-level authorization)

`listTicketMaterials`, `addTicketMaterial` and `deleteTicketMaterial` gate only on coarse
`ticket:read` / `ticket:update` (lines 109-127, 129-155, 183-194). The inventory layer
(`packages/inventory/src/lib/materials.ts:179-388`) accepts the supplied ticket as parent, inserts an
unbilled material, consumes stock and can create a delivered asset; `:528-556` deletes an arbitrary
material and restores stock. No layer evaluates access to the owning ticket, so a client with default
`ticket:update` can mutate a **hidden** ticket's billing and tenant inventory.

Fix: authorize the owning ticket inside the same transaction before any material write, using the
repository's existing record-level ticket authorization (the same context/helper used by ticket read
actions; resolve the ticket and assert the caller may read/update it, else return
`TicketMaterialActionError`). For deletion, resolve the material's `ticket_id` first, then authorize it,
then delete. Reject non-MSP callers unless client material management is explicitly intended (keep the
current coarse gate plus the record check).

## Finding 2 confirmed (catalog enumeration)

`searchServiceCatalogForPicker` and `getServicePrices` take `_user` and perform **no** permission check
(lines 86-107); `queryCatalogPickerItems` returns default rates, internal costs, cost currency, reorder
points and stock. Any authenticated tenant user can enumerate catalog cost/price/stock.

Fix: require an appropriate permission before calling the query — at minimum `inventory:read` and a
service-catalog read permission (or `ticket:update`, since the picker is used when adding materials).
Return an empty result or a permission error consistent with the surrounding action contract. Do not
leak internal `cost` fields to callers lacking the stronger permission; if the picker is used by
lower-privileged users, project only the fields they need.

## Regression coverage

Extend `packages/tickets/src/actions/__tests__` (mock the tickets/inventory helpers):

- add/delete material on a ticket the caller cannot read → permission error; inventory `addMaterial` /
  `deleteMaterial` not called.
- list materials on an unauthorized ticket → permission error.
- authorized ticket → material add/delete proceeds unchanged.
- picker/prices without the required permission → empty/permission error, `queryCatalogPickerItems` not
  invoked; with permission → unchanged.
- field projection: internal `cost`/`cost_currency` absent for callers without the pricing permission.

Negative tests must fail on current `main` and pass after the change.

## Acceptance

`security-finding-resolved` confirms **both** findings are fixed with tests, or refuted with evidence.
Both findings are in scope for this card.
