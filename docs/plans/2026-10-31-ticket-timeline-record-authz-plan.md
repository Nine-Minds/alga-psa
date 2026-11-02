# Security authz — `getTicketTimelineEntries` / `getTicketActivityRows`

Card: Security: authz in getTicketTimelineEntries (`0d93ebac`) · PSA ticket alga-2026-0002995
Base: `origin/main` @ `4f3ca6d132` · Worktree `feature/security-authz-in-gettickettimelineentries`
Finding: `packages/tickets/src/actions/ticketActivityActions.ts:55` (`getTicketTimelineEntries`), authz, high —
from the review of PR #3995 / merge `3d367811d9a8`.

---

## 0. Decision (Design Session, 2026-10-31)

**The finding is real on main; this is a code change. Both actions named in the evidence are affected.**

`getTicketTimelineEntries` (`ticketActivityActions.ts:52-73`) and `getTicketActivityRows`
(`:88-109`) both block client principals, check coarse `ticket:read`, and then read straight from
`tickets` / `ticket_activity` / comments / time entries. Neither calls the authorization kernel.
`ticketRecordAuthorization.ts:20-27` documents that internal principals can be narrowed by bundle and
relationship policy even when `hasPermission` succeeds, so an internal user holding a ticket UUID from
before a bundle restriction can still read comments, internal notes, activity and time entries that
`getTicketById` denies. The coarse RBAC check is not the record check the rest of the ticket surface uses.

### Design

1. **Use the record policy in both actions**, after the RBAC check and before any timeline/activity read:

   ```ts
   const ticket = await authorizeTicketRecordAccessConcealed({
     trx, tenant, user: user as any, ticketId, action: 'read', conceal: 'all',
   });
   ```

   The helper already resolves the ticket row, so the hand-rolled existence lookup
   (`tenantScopedTable(trx, 'tickets').where({ticket_id})`) is deleted in `getTicketTimelineEntries`
   and the missing one is not added to `getTicketActivityRows`. Its returned row is the record the
   kernel authorized; pass `ticket.ticket_id` to the builder.

2. **One concealed not-found for internal users too.** Today `authorizeTicketRecordAccessConcealed`
   only hides the distinction for client principals (`ticketRecordAuthorization.ts:269-282`), and this
   action is internal-only. Extend the input with an optional
   `conceal?: 'client' | 'all'` (default `'client'`, so every existing caller is unchanged) and have
   the timeline actions pass `'all'`:

   - ticket missing → `Ticket not found` (existing 404 path);
   - ticket exists but the kernel denies → the **same** `Ticket not found` path.

   That satisfies the finding's "missing and policy-hidden tickets cannot be distinguished" without
   changing the error contract for any other caller. Do not blanket-conceal in the non-concealed
   helper.

3. **Keep the client gate and `ticket:read` check.** They are defense in depth, not the record check;
   the new call is added below them, so a client user still gets the internal-only denial before the
   kernel runs. Keep the `ticketActionErrorFrom` mapping — `Ticket not found` already classifies as
   `TICKET_NOT_FOUND` and is the response shape the UI expects.

4. **No change to the timeline/activity builders** (`@alga-psa/shared/lib/ticketActivity`) or their
   visibility rules. This card is only about *whether the caller may read this ticket at all*.

## 1. Scope paths

- `packages/tickets/src/actions/ticketActivityActions.ts` (two call sites, delete one existence lookup)
- `packages/tickets/src/lib/ticketRecordAuthorization.ts` (`conceal` option on the concealed helper)
- regression tests (below)

## 2. Regression tests (must fail without the fix)

- **Unit** — new `packages/tickets/src/actions/ticketActivityActions.authz.test.ts` (mock
  `@alga-psa/auth`, `@alga-psa/db` transaction and the timeline builders):
  1. internal user with `ticket:read` but kernel denial → `TICKET_NOT_FOUND` action error for both
     actions, and neither `buildUnifiedTicketTimeline` nor `readTicketActivity` is called;
  2. nonexistent ticket and policy-hidden ticket produce the **identical** error payload;
  3. allowed internal user → builder called with the authorized ticket id; rows returned;
  4. client principal → internal-only denial before any kernel call (unchanged);
  5. the kernel is called after the `ticket:read` check and before the builders (ordering contract).
- **Integration** — add a case to
  `server/src/test/integration/authorization/` (reuse the bundle fixture pattern in
  `bundleAssignmentResolution.integration.test.ts`): a user with `ticket:read` whose bundle
  assignment no longer covers the ticket gets the same `Ticket not found` from
  `getTicketTimelineEntries` and `getTicketActivityRows` as for a random UUID, while an allowed
  internal user still receives the timeline.

## 3. Verification

```
cd packages/tickets && npx vitest run src/actions/ticketActivityActions.authz.test.ts
cd ../../server && npx vitest run src/test/integration/authorization/<new test>.integration.test.ts
```

Plus a live check against the card's dev server (`:3854`, canonical login `qa@emeraldcity.oz`): with a
bundle-restricted internal user, opening a hidden ticket's timeline must show the same not-found as a
random UUID, with no internal notes or time entries returned.

## 4. Out of scope

- Comment/read/create authz — already fixed on main (cards `c18be408`, `692afc89`).
- The REST reaction route — card `3e15e371`.
- Changing timeline visibility or filtering rules for tickets the caller *can* read.
