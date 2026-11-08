# Design — Security: authz in setChecklistItemCompleted

Card: Security: authz in setChecklistItemCompleted

## Finding (confirmed on main)

getTicketChecklistItems returns checklist content for any tenant ticket after authentication alone (packages/tickets/src/actions/checklists/ticketChecklistActions.ts:73-100) and setChecklistItemCompleted (:251-279) plus update/delete/add/reorder/apply check only coarse `ticket:update`, which client roles hold by default, instead of using `authorizeTicketRecordAccess`.

## Approach

1. Route every checklist action through `authorizeTicketRecordAccessConcealed` (packages/tickets/src/lib/ticketRecordAuthorization.ts) for the owning ticket, inside the transaction, before returning or changing checklist data.
2. Apply it to the whole surface — get, set-completed, update, delete, add, reorder, template-apply — so no action path keeps the coarse shortcut.
3. Tests: a client user cannot read or mutate a checklist on a ticket they cannot see; an authorized internal user can; reorder and apply are covered too.

## Hand-off
This file is the spec the Link Spec step links to this card's PSA ticket; record it in state.psaSpecPaths.
