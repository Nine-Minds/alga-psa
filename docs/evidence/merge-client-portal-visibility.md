# Merge resolution: client portal ticket visibility

Merge of `origin/main` (`aa124f86da`) into `feature/co-managed-it`, base
`9a59114991`. This note covers the client-portal visibility resolver and its
call sites.

## The shape of the conflict

The branch **moved** the resolver from `packages/tickets/src/lib/` to
`shared/lib/tickets/` (commit `c0c6ff2c22`) and left one-line re-export shims
behind, because `packages/co-managed` consumes it from `shared`. Main **changed
the same implementation in place**, adding contact-scoped ticket visibility.

Git therefore presented a shim-versus-implementation conflict in which taking
either side whole is wrong:

- take the branch's shim → main's contact scoping disappears, because the moved
  copy in `shared/` never received it, and nothing type checks or tests against
  the missing predicate;
- take main's implementation → two divergent copies of the resolver exist and
  `packages/co-managed` keeps importing the stale one.

Dropping the contact predicate is silent: a re-exported `ContactVisibilityContext`
still carries `effectiveTicketScope`, every board-filter test still passes, and
the only observable difference is that a non-admin portal contact sees every
ticket belonging to their client. That regression was already committed once on
this branch in `1064ee7384`.

## Resolution

One implementation, in `shared/lib/tickets/`, carrying **both** sides:

| Difference | Winner | Why |
| --- | --- | --- |
| `ContactVisibilityContext.ticketScope`, `effectiveTicketScope`, `isClientAdmin` | main | New authorization capability; the branch only relocated the old shape. |
| `applyVisibilityBoardFilter(query, boardIds, boardColumn)` → `applyTicketVisibilityFilter(query, visibility, { boardColumn, contactColumn })` | main | Richer API. The board-only helper is deleted, not kept — see "No board-only helper" below. |
| Throw on invalid/absent effective scope; throw on contact scope without a contact | main | Fail closed. A context that cannot be interpreted must not degrade to an unfiltered query. |
| `query.where(contactColumn, visibility.contactId)` when `effectiveTicketScope === 'contact'` | main | **The defect being guarded.** This is the entire effect of contact scoping. |
| `ticket_scope` resolved and validated from `client_portal_visibility_groups`; `effectiveTicketScope = isClientAdmin ? 'client' : group.ticket_scope` | main | Same. |
| `resolveVisibleBoardIds` subtracting boards with `client_portal_visible = false`, including materializing the allow-list for unassigned contacts | main | New in main; the branch's moved copy returned `null` unconditionally for unassigned contacts. |
| `options: { lock?: boolean }` taking `FOR SHARE` on the contact, its visibility group, and the group's board memberships | branch | The co-managed requester-email and portal-attachment paths authorize inside a writing transaction and need an assignment that cannot change before they commit. Three callers pass `{ lock: true }`. |
| File location (`shared/lib/tickets/` + shims under `packages/tickets/src/lib/`) | branch | `packages/co-managed` imports `@alga-psa/shared/lib/tickets/clientPortalVisibility{,.server}`; the move must stand. |

### Deliberate narrowing: the board scan is not locked

`resolveVisibleBoardIds` performs a tenant-wide scan of `boards` and is left
unlocked even under `options.lock`. The share lock exists to pin the contact's
own assignment rows; extending it to the board scan would take a share lock on
every board row in the tenant and block concurrent board edits. `client_portal_visible`
is a board-level display flag that these transactions do not mutate. Noted here
because it is a judgement call, not an oversight; it matches main, which locks
nothing at all.

### No board-only helper

The brief allowed keeping a narrow board-only helper for callers that hold board
ids but no context. No such caller exists. The two board-discovery sites
(`ticketFormActions.ts:111-119`, `client-tickets.ts:1278-1299`) hold the full
context and apply `whereIn` inline, deliberately without a contact predicate —
board discovery for ticket creation must not be contact-scoped.
`applyVisibilityBoardFilter` is therefore deleted outright.

## Files changed

Implementation:

- `shared/lib/tickets/clientPortalVisibility.ts` — main's module verbatim.
- `shared/lib/tickets/clientPortalVisibility.server.ts` — main's module plus the
  branch's `{ lock }` option and two explanatory comments. `diff` against
  `origin/main:packages/tickets/src/lib/clientPortalVisibility.server.ts` is
  exactly those additions.
- `packages/tickets/src/lib/clientPortalVisibility.ts` (conflicted) — re-export shim.
- `packages/tickets/src/lib/clientPortalVisibility.server.ts` (conflicted) — re-export shim.

Call sites:

- `server/src/lib/co-managed/portalAttachments.ts` — was the only remaining
  `applyVisibilityBoardFilter` caller. Converted to `applyTicketVisibilityFilter`
  with `{ boardColumn: 't.board_id', contactColumn: 't.contact_name_id' }`. This
  is **not** cosmetic: the call resolves visibility for the *session user's*
  contact and then authorizes an *arbitrary* `ticketId`, so without the contact
  predicate a contact-scoped portal user could read attachments on a sibling
  contact's ticket.
- `packages/tickets/src/lib/ticketRecordAuthorization.ts` — branch-added
  per-record authorization for ticket sub-resources (external links). It
  resolved the visibility context but discarded everything except
  `visibleBoardIds` and used the `selected_boards` relationship template, so it
  never applied contact scoping. Converted to main's pattern: pass the whole
  context as `contactVisibility` with the `contact_visibility` template, carry
  `contact_name_id` on `TicketRecordRow`, and set `contactId` on the
  authorization record. An unresolvable portal context now returns `null`
  (deny) rather than `[]`.
- `packages/tickets/src/lib/clientPortalVisibility.test.ts` (conflicted) — see below.
- `packages/client-portal/src/actions/client-portal-actions/client-tickets.visibility.test.ts`
  — see "Cross-cutting merge defect" below.

Unchanged by design: `packages/co-managed/src/{inboundRequesterReply,requesterCommentEmail,workflowTicketEmails}.ts`
each resolve visibility for the *ticket's own* contact and then compare against
that same ticket, so the contact predicate is satisfied by construction. They
correctly need only the client and board checks they already perform.

## Tests

The conflicted hunk in `clientPortalVisibility.test.ts` was a knex mock for the
`client_portal_visibility_groups` table: the branch added `modify()`/`forShare()`
stubs for its row locks, main added a `ticket_scope: 'client'` default to the
mocked group row. Both are required and both are kept.

Added, beyond merging both sides:

- `describe('contact scoping is enforced, not merely declared')` — asserts the
  **predicate**, not its invocation: a non-admin contact-scoped context produces
  `where(contactColumn, contactId)`; it does so alongside the board allow-list;
  it honours the caller-supplied contact column; a client admin whose scope
  resolved to `client` produces no contact predicate; an absent or unrecognised
  effective scope throws; a contact scope with no contact throws. One case runs
  the resolver end to end and feeds its real output to the filter.
- `describe('single implementation')` — asserts the package modules re-export
  the shared ones by function identity. Two copies is how the predicate went
  missing before; this fails if either shim is ever re-forked.
- `describe('row locking')` — asserts `{ lock: true }` takes `FOR SHARE` on
  exactly the contact, group, and group-board queries, that the default takes
  none, and that scope resolution still works while locking.

**Mutation check.** With `visibility.effectiveTicketScope === 'contact'`
short-circuited to `false` in the shared module — i.e. the exact regression this
merge risked — 5 tests fail. Restored, 22/22 pass. Contact-scoping enforcement
is provably present, not merely typed.

## Cross-cutting merge defect found and fixed

`packages/client-portal/.../client-tickets.visibility.test.ts` merged cleanly
but failed 2 of its cases. Main added `describe('contact-scoped portal enforcement')`,
which exercises the real predicate through `updateTicketStatus` and
`addClientTicketComment`; the branch independently added
`assertCoManagedOperationalWrite(trx, tenant)` to those two write paths, and that
guard rejects a transaction whose `isTransaction` is falsy. The merged mock
transaction had no such flag, so main's two enforcement cases died in the guard
before reaching the visibility assertion. Fixed by adding `isTransaction: true`
to the two mocked transactions in that describe block (2 lines). 20/20 pass.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` in `shared` | 1 error: the known pre-existing `services/email/inboundEmailCoreProcessor.ts(89,7)` TS2322. No new errors. |
| `npx tsc --noEmit` in `packages/tickets` | Clean, exit 0. |
| `npx tsc --noEmit` in `server` | 3 errors, all `TS1185: Merge conflict marker encountered` in `src/lib/api/services/TicketService.ts` (owned by another agent). No other errors; `portalAttachments.ts` type checks. |
| `packages/tickets` `clientPortalVisibility.test.ts` | 22/22 pass. |
| `packages/tickets` `clientPortalVisibility.userModelLifecycle.test.ts` | 5/5 pass. |
| `packages/tickets` `src/lib` + `src/actions/externalLinks` | 42 files, 365/365 pass. |
| `packages/client-portal` `client-tickets.visibility` + `dashboard.visibility` | 20/20 pass (2 were failing before the fix above). |
| `packages/authorization` full suite | 43/43 pass. |
| `server` portal attachment + `algadeskPortalTicketing.contract` | 17/17 pass. |
| Conflict markers in the three owned files | Zero. |

## Required follow-ups in files owned by other agents

1. `server/src/lib/api/services/TicketService.ts` — still has unresolved conflict
   markers at lines 2560/2576/2609 and is the only source of `server` typecheck
   errors. Its line 344 already calls
   `applyTicketVisibilityFilter(query, visibility, { boardColumn: 't.board_id', contactColumn: 't.contact_name_id' })`,
   which matches the API published here; no change is needed from that agent
   beyond finishing the resolution.
2. `packages/tickets/src/actions/ticketActions.ts` and
   `packages/tickets/src/actions/optimizedTicketActions.ts` — already resolved by
   their owner while this work was in progress, and already consistent: both
   resolve the full `ContactVisibilityContext`, select the `contact_visibility`
   relationship template, and pass `contactVisibility` into the kernel. No action
   required; recorded so the merge commit can state it was checked.

## Call-site audit

`git grep -n "applyVisibilityBoardFilter\|applyTicketVisibilityFilter\|getClientContactVisibilityContext\|ContactVisibilityContext"`
after this resolution returns zero hits for `applyVisibilityBoardFilter` in
source (only in historical planning docs under `ee/docs/` and `context.md`), and
every `applyTicketVisibilityFilter` call passes both `boardColumn` and
`contactColumn`.
