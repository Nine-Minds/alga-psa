# Spec — enforce record-level authorization on MSP ticket writes

Card: `643ed6e3-de5e-48a4-9239-1255c6bcb257` · finding from the smoke test of `a6294c24`
(PR #4021) · severity **high** · category **authz** · PSA ticket `alga-2026-0003022`

## 1. The finding, restated at the mechanism

A ticket write from the MSP ticket screen checks **tenant-wide RBAC only**:

- `packages/tickets/src/actions/optimizedTicketActions.ts:3324` — `updateTicketWithCache`
- …which calls `hasPermission(user, 'ticket', 'update', trx)` at `:3348` and then
- `updateTicketInTransaction` at `:2607`.

`updateTicketInTransaction` carries the comment *"Intentionally does NOT check permissions —
callers must authorize first"*, and no caller passes anything finer than the tenant-wide
`ticket:update` bit. Nothing in the path consults `authorizeTicketRecordAccess`
(`packages/tickets/src/lib/ticketRecordAuthorization.ts:230`), which is what applies the
bundle's client/board narrowing to a specific record and what every other ticket-scoped
surface already uses (comment write at `optimizedTicketActions.ts:3473`,
`commentActions.ts:194`, `cannedResponseActions.ts:68`, `externalLinkActions.ts:129`,
`labelViewModelProvider.ts:45`, `rmaTicketActions.ts:34`, …).

**Reach (confirms the provisional "high"):** the saved state is not a UI bug — the write
persists. Observed: internal Admin `smoke.wfauthz@emeraldcity.oz` with `ticket:update`
narrowed to `selected_clients = Wonderland` edited ticket `WFAUTHZ-EC` (client Emerald City,
outside the bundle) from the ticket detail screen and it saved. The same author is refused on
the workflow path for the same ticket, so the tenant had already decided this is
unauthorized; one write surface simply never asks.

Every caller of the core inherits the gap, which is why the fix belongs in the core rather
than in the screen:

| entry point | how it reaches the core |
| --- | --- |
| MSP ticket detail **Save Changes** | `updateTicketWithCache:3324` → core |
| `updateTicketWithCacheForCurrentUser:3368` | → `updateTicketWithCache` → core |
| bulk status/update (`ticketActions` bulk paths) | per-row `updateTicketInTransaction` (see `ticketActions.bulkStatusResolution.test.ts`) |
| REST `PUT /api/v1/tickets/{id}` | `server/src/app/api/v1/tickets/[id]/route.ts:13` → controller → ticket update action |
| quick-add / automation | through the same actions |

`packages/tickets/src/actions/ticketActions.ts:1293` (`updateTicket`) is a **second
implementation** of the same write with the same RBAC-only shape. It is in scope: a card that
fixes one door and leaves the other open has not fixed the finding.

## 2. Decision: enforce in the core, with two named exemptions

`updateTicketInTransaction` already loads the row it is about to mutate:

```ts
const currentTicket = await currentTicketQuery.first();   // optimizedTicketActions.ts:~2646
if (!currentTicket) throw new Error('Ticket not found');
```

Immediately after that check (and after the `collaboration` block that follows it), add:

```ts
if (!isSystemActor && !collaboration) {
  await authorizeTicketRecordAccess({
    trx, tenant, user, ticketId: id, action: 'update',
    ticketRow: currentTicket as TicketRecordRow,
  });
}
```

Why there and not in the wrapper:

- **One place, every door.** The wrapper is only one of five entry points. The core is where
  all of them converge, and it is where the mutation actually begins — before row locks are
  taken, before children are propagated, before events, notifications, or audit rows are
  written.
- **The row is already in hand.** `ticketRow` skips a second read inside the authorizer, and
  because the caller has already resolved the ticket in the same transaction, the check
  cannot race a concurrent reassignment of `client_id`/`board_id` (the row lock taken for
  `attributes` updates stays authoritative for the rest).
- **Denial is structural.** `authorizeTicketRecordAccess` throws `Ticket not found` (404) or
  `Permission denied: Cannot access ticket` (403); `updateTicketWithCache`'s
  `ticketActionErrorFrom` already converts both into a `TicketActionError`, so the screen
  shows the standard permission toast instead of a 500.

### Exemption 1 — `options.systemActor === true`

The auto-close engine (`packages/jobs/src/lib/handlers/autoCloseTicketsHandler.ts:377`) runs
as a placeholder system user: its bundles say nothing about *this* ticket, so a record check
would deny every auto-close in the product. `systemActor` already means "attribute to SYSTEM,
not to `user`", is already limited to engine callers, and the close is already audit-logged.
Record authorization answers "may *this principal* touch *this record*"; a system actor has no
principal.

### Exemption 2 — a `collaboration` context

A co-managed collaborator edit arrives with a `TicketMutationCollaborationContext`, has
already passed `collaboration.assertWriteAuthority(trx)`, and is limited to an explicit
field allow-list. The admitting decision is made by the shared-work domain against the
*owner's* grant; re-running the collaborator's own bundle against the owner's record would
deny the co-managed case by construction. The two mechanisms are complementary, not
layered: record authz governs native writes, the collaboration context governs shared ones.
A collaborator therefore never needs — and must never be given — a bundle covering the
owner's client.

No other exemption. In particular: no "trusted caller" flag, no per-call `skipAuthz` option,
no allowance for bulk. `tenant`/`user` mismatch is already rejected a few lines above.

## 3. `ticketActions.updateTicket` (legacy entry point)

Give it the same treatment as its sibling comment write: inside its transaction, load the
ticket row it is about to update (it already resolves `currentTicket` for its own logic) and
call `authorizeTicketRecordAccess({ action: 'update', ticketRow })` before the write, with
the same `systemActor` exemption (it has `systemActor` in its `UpdateTicketOptions`? — if it
does not, it does not need one: no engine caller uses it; confirm at implementation and
state the result in the PR).

## 4. What we are deliberately NOT doing

- **Not changing bundle/RBAC semantics.** The kernel, the bundle fields, the client/board
  narrowing and the shared-work domain are untouched; this card only asks the existing
  record authorizer the question the MSP path forgot to ask.
- **Not adding a UI-side guard.** A hidden button is not authorization; the refusal must
  come from the action layer so it holds for REST, bulk, and any future caller.
- **Not touching read paths.** Ticket reads, comment reads and the workflow path already
  enforce record authz; nothing here changes their behaviour.
- **Not widening the error surface.** A client-portal principal is already rejected before
  the permission lookup (`:3338`), so this adds no new information channel to clients.
- **Not refactoring `updateTicketInTransaction`.** It is long and load-bearing; the change is
  one guarded call plus the tests, to keep the blast radius readable in review.

## 5. Tests (the deliverable is not done without them)

In `packages/tickets/src/actions/` as an integration-style test with a real transaction (the
package's existing `*.contract.test.ts` style for the structural claims):

1. **The finding, reproduced.** Internal admin with `ticket:update` narrowed to client A
   updates a ticket whose `client_id` is client B through `updateTicketWithCache` →
   resolves to a `TicketActionError` (permission), and the ticket row, attribute mirror,
   `ticket_events`, and notifications are unchanged.
2. **No over-blocking.** The same admin updates a ticket in client A → `'success'`.
3. **`systemActor` still closes.** `updateTicketInTransaction(..., { systemActor: true })`
   for a ticket outside the (placeholder) user's bundles → `'success'`.
4. **Collaboration unaffected.** A `collaboration`-admitted edit that passed
   `assertWriteAuthority` is not denied by the new check.
5. **Both entry points.** `ticketActions.updateTicket` denies the same out-of-bundle write
   (finding 1 repeated against the legacy action).
6. **Structural guard.** A contract test asserting that the `authorizeTicketRecordAccess`
   call sits inside `updateTicketInTransaction` before the first `UPDATE`/event emission, so
   a later refactor cannot move it after the write.

## 6. Risks and how they are checked

- **A legitimate MSP write starts being refused.** The record authorizer is already the
  rule for comments, canned responses, external links and the workflow path, so "the bundle
  narrows ticket:update" is the only new refusal; test 2 pins that an in-bundle write still
  succeeds, and Smoke Test should exercise a normal MSP save end to end.
- **Bulk paths become slow or partial.** The check reuses the row the core already loads
  (no extra read) and runs inside the caller's transaction, so a bulk row that fails aborts
  exactly as a RBAC failure already does.
- **The auto-close engine regresses silently.** Test 3 plus the existing
  `autoCloseTicketsHandler` tests cover it; the exemption is explicit and named in a comment
  citing this spec.
- **A caller we have not enumerated.** The guard is in the core and the legacy action, which
  is every write path we could find by grep; the contract test makes a mismatch visible in
  review rather than in production.

## 7. Order of work

1. Core guard + exemptions in `optimizedTicketActions.ts` (one call, one comment citing this
   spec).
2. Same guard in `ticketActions.ts#updateTicket`.
3. Tests 1–6.
4. PR body: quote the observed live reproduction and the table of entry points above, so the
   reviewer can check the reach claim against the diff.

## 8. PSA ticket

`alga-2026-0003022` (created at the Link PSA Ticket step for this card).
