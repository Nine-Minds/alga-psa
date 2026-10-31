# Ticket-delete record authorization

Card: `f5edab85` — Security: authz in `performTicketDelete` (security review of PR #3995, merge `3d367811d9a8`)

## Problem

`performTicketDelete` (`packages/tickets/src/actions/ticketActions.ts:2171`) checks only the coarse
RBAC permission `ticket:delete`, then selects and deletes any ticket with the supplied UUID in the
tenant. It never evaluates record-level authorization, so:

- a bundle-restricted internal principal that can no longer see a ticket but holds `ticket:delete`
  can still delete it if it retained the UUID;
- an Algadesk client administrator — granted client-side `ticket:delete` by
  `server/migrations/utils/permissions/catalog.cjs:321` — can delete another client's ticket.

There is a second leak on the same path: `deleteTicket` / `deleteTickets` call
`deleteEntityWithValidation` (`packages/core/src/server/deletion/deletionActions.ts:16`), which runs
`validateDeletion` **before** `performTicketDelete`. For a ticket the principal cannot see, a blocked
deletion therefore returns dependency metadata (what references the ticket) — existence and relation
disclosure even though the delete itself is refused.

A third entry point exists: `TicketService.delete`
(`server/src/lib/api/services/TicketService.ts:456`) performs its own `deleteEntityWithValidation`
with an inline child-record cleanup instead of `performTicketDelete`. It must be covered by the same
record check.

## Existing mechanism to reuse

`authorizeTicketRecordAccess` (`packages/tickets/src/lib/ticketRecordAuthorization.ts:213`) resolves
the ticket row, builds the authorization kernel context (builtin relationship rules, bundle narrowing,
request cache) and evaluates it for a given action. It is already the record-level gate for the
external-links sub-resource. Its action union is currently `'read' | 'update'`.

The kernel (`packages/authorization/src/kernel/contracts.ts`) treats `resource.action` as an opaque
string; the bundle provider filters narrowing rules by exact action
(`providers/bundleProvider.ts:76`, `relationshipTemplates.ts:332`). Policy bundles ship `read`/`update`
ticket rules; there is no `delete` rule today, and absence of a matching rule means "no narrowing" —
which is exactly why a bundle-restricted user would pass if we asked for action `delete` naively.

## Change

1. **Kernel: action aliasing for mutation-derived actions.** In
   `packages/authorization/src/kernel/`, add a canonical alias map consulted when no exact rule
   matches: `delete -> update`. Bundle narrowing therefore applies the ticket `update` rules to a
   delete; an explicitly authored `delete` rule (if a bundle ever defines one) still wins. Use it in
   both `providers/bundleProvider.ts` (rule filtering) and `relationshipTemplates.ts` (template
   matching) so the two cannot drift. This is a general mechanism: any future destructive action
   that is governed by a mutation rule (`archive`, `restore`, `void`) uses the same map.

2. **Ticket domain: accept `'delete'` in the record gate.** Extend
   `authorizeTicketRecordAccess` to `action: 'read' | 'update' | 'delete'`.
   - For `delete`, after the kernel allows, additionally require the coarse RBAC
     `hasPermission(user, 'ticket', 'delete', trx)` so the two checks are enforced together at one
     call site (`ticket:delete` remains necessary, never sufficient).
   - Concealment: when the principal is a client (`user.user_type === 'client'`) both "missing" and
     "not allowed" throw `Ticket not found`; internal principals keep the existing
     `Permission denied: Cannot access ticket` distinction. This mirrors the read path's behaviour
     (`ticketActions.ts:335-338`) and removes the existence oracle from the delete surface.

3. **Authorize before dependency validation.**
   - `deleteTicket` and `deleteTickets` (`ticketActions.ts:2216`, `2257`): call the record gate on the
     connection passed to `deleteEntityWithValidation` **before** validation, so an invisible or
     missing ticket is refused without revealing dependency data. `deleteTickets` does this per id
     and reports the same generic failure it already returns for missing tickets.
   - `TicketService.delete` (`TicketService.ts:456`): same pre-check before
     `deleteEntityWithValidation`, using the request's `ServiceContext` user. Map denial to the
     service's existing `NotFoundError` for concealment.

4. **Re-check inside the deletion transaction.** `performTicketDelete` re-runs the record gate on
   `trx` immediately before `deleteTicketChildRecords`, so the authoritative check is inside the
   transaction that removes rows (defends against TOCTOU and any future direct caller).

5. **Tests (regression, must fail before the fix).**
   - Bundle-narrowed internal user with `ticket:delete` deletes a ticket it cannot see: refused, row
     still present, `deleteTickets` reports a generic failure.
   - Client admin with `ticket:delete` deletes another client's ticket: response is indistinguishable
     from a missing ticket — no `dependencies`/`alternatives` payload.
   - Authorized internal user still deletes; child records are cleaned; `TICKET_DELETED` still
     publishes once.
   - REST `TicketService.delete` with an unauthorized id returns not-found, not conflict-with-
     dependencies.
   - Kernel alias unit test: `delete` evaluates `update` bundle rules; an explicit `delete` rule takes
     precedence.
   - Existing contract test `externalLinksFacade.contract.test.ts` (pins the helper names) stays green;
     add `authorizeTicketRecordAccess` usage assertions only where the source-text contract already
     exists.

## Order of work

1. Kernel alias map + unit tests.
2. `authorizeTicketRecordAccess` action extension and concealment.
3. Wire `performTicketDelete` (transaction re-check) and the two pre-validation call sites.
4. REST service pre-check.
5. Regression suite; run the focused ticket/authorization tests.

## Non-goals

- Not changing catalog defaults or removing client-side `ticket:delete` (product decision outside this
  finding).
- Not replacing `deleteEntityWithValidation`'s dependency model.
- Not touching the duplicated `authorizeTicketRead` helper (LEVERAGE marker at
  `ticketActions.ts:308`); consolidating it onto `ticketRecordAuthorization.ts` is separate work.

## Risks

- The kernel alias is shared: run `packages/authorization` tests and any resource whose bundles use
  `update` narrowing.
- Double evaluation per delete (pre-check + in-transaction re-check) is two indexed queries plus
  kernel work; acceptable against the delete path's cost and required for correctness.
- Error-text changes for client principals may touch tests asserting `Permission denied`; update
  those tests to assert concealment.

