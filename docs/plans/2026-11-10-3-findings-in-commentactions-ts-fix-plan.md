# Fix plan — Security: 3 findings in commentActions.ts

Card: `7e2c7c4b-6002-5816-b8ca-5d845d1a68bf`
Source review: PR #3996, merge `b0c288153a047771efaf9e0836104d390b6a7fac`
Target file: `packages/tickets/src/actions/comment-actions/commentActions.ts`

## Summary of verdicts

| # | Finding | Verdict |
|---|---------|---------|
| 1 | `assertClientCanCreateComment` bypasses contact/board visibility | **Already fixed** on this branch — no code change needed; confirm with evidence + existing test |
| 2 | `assertMayChangeComment` ownership bypasses ticket perms on edit/delete | **Already fixed** for the client attack path; one narrow residual flagged as out-of-scope |
| 3 | `cancelScheduledComment` / `rescheduleScheduledComment` admit any internal user | **Real and unaddressed** — this is the work |

The review ran against merge `b0c288153a04` (2026-10-30 19:24). Between that commit and this branch, three commits already landed on `main` and are ancestors of HEAD that rewrote findings 1 and 2's code:

- `4073c274c6` fix(tickets): require authorship to update or delete a comment, whitelist the patch
- `5cc56904ba` fix(tickets): enforce record authz and client guards on addTicketComment and comment mutations
- `8bd7fe5d48` fix(tickets): enforce record-level authz on client createComment; remove client_id-only check

The finding prose therefore cites line numbers and a `client_id`-only comparison that no longer exist in the named functions. The code is the truth; the plan is written against the file as it stands now.

---

## Finding 1 — `assertClientCanCreateComment` (authz, high) → already fixed

### What the finding described
`createComment` did only coarse `ticket:update` RBAC, then `assertClientCanCreateComment` admitted any client whose ticket shared the client organization (a `client_id === clientId` comparison), ignoring contact / board / billing-profile / watcher narrowing. A portal contact could add a public comment to a same-client ticket the portal hides or marks non-interactive.

### Why it no longer holds (evidence)
`assertClientCanCreateComment` (`commentActions.ts:117-163`) no longer compares client IDs. For a client principal it now calls, before any other lookup:

```
await authorizeTicketRecordAccessConcealed({ trx, tenant, user, ticketId: comment.ticket_id, action: 'update' });   // commentActions.ts:142
```

`authorizeTicketRecordAccessConcealed` → `authorizeTicketRecordAccess` (`packages/tickets/src/lib/ticketRecordAuthorization.ts:230-284`) builds the real authorization kernel with the `contact_visibility` relationship rule and the client's `visibleBoardIds`, and evaluates `toTicketAuthorizationRecord` which carries `boardId`, `contactId`, `billingProfileId`, and `watcherContactIds` (`ticketRecordAuthorization.ts:104-122,149-188`). A missing ticket and an invisible ticket collapse to the identical `Permission denied` for a client (`ticketRecordAuthorization.ts:273-284`), so a UUID cannot be probed. The old same-client comparison (`assertClientOwnsTicket`, `commentActions.ts:81-115`) now survives only as a fail-closed *read* guard composed with the kernel in `authorizeCommentRead` (`commentActions.ts:185-198`), never as the sole create gate.

### Action
No code change. Record the verdict as a card fact citing `commentActions.ts:142` and commit `8bd7fe5d48`. Regression coverage already exists — see Proof.

---

## Finding 2 — `assertMayChangeComment` (authz, high) → fixed for the attack path

### What the finding described
`assertMayChangeComment` authorized immediately when `existing.user_id === session user`, with no current ticket permission or visibility check. A client who authored a comment and then lost ticket access could still edit it (without current `ticket:update`) or delete it (without `ticket:delete`) by invoking the native actions with the known comment UUID.

### Why the attack path no longer holds (evidence)
`assertMayChangeComment` (`commentActions.ts:641-651`) now runs a record-level gate for client principals *before* the ownership short-circuit:

```
if (isClientUserType(user.user_type) && existing.ticket_id) {
  await authorizeTicketRecordAccessConcealed({ trx, tenant, user, ticketId: existing.ticket_id, action: 'update' });  // :645
}
...
if (existing.user_id === user.user_id) return;   // :648  (ownership now only reached after record access passes)
```

Both `updateComment` (`commentActions.ts:693`) and `deleteComment` (`commentActions.ts:871`) call it before mutating. A client who has lost visibility to the ticket is denied at `:645` regardless of authorship — the concrete attack in the finding. The editable-field allowlist the finding wanted also exists: `updateComment` only ever copies `note`, `is_resolution`, and (for MSP) `is_internal` into the patch (`commentActions.ts:696-713`), and a client can never set `is_internal` (`:710-712`).

### Residual (deliberately out of scope — see Scope)
Two gaps remain that are *not* the reported client attack path:
- `deleteComment` authorizes the client with `action: 'update'`, not a distinct delete capability. The kernel's `authorizeTicketRecordAccess` only models `'read' | 'update'` (`ticketRecordAuthorization.ts:235`); there is no `'delete'` action to request, so distinguishing `ticket:delete` would require extending the kernel. Scheduled comments aside, a client deleting their *own* still-visible comment is the portal's intended behavior; the escalation (acting after access loss) is already closed by `:645`.
- For MSP principals, ownership (`:648`) short-circuits with no re-check of current `ticket:update`. The finding's evidence is framed entirely around client users ("A client user naturally knows the UUID"); the MSP self-edit case is lower severity and shares the kernel-action limitation above.

### Action
No code change for the reported path. Record the verdict as a card fact citing `commentActions.ts:645` and commit `4073c274c6`/`5cc56904ba`. Note the residual for the reviewer.

---

## Finding 3 — `cancelScheduledComment` / `rescheduleScheduledComment` (authz, high) → REAL, fix required

### The defect, precisely
Both actions fetch a scheduled comment by UUID and authorize on user *type* alone:

```
// rescheduleScheduledComment — commentActions.ts:939
if (user?.user_id !== existing.user_id && user?.user_type !== 'internal') throw new Error('You can only reschedule your own comments');

// cancelScheduledComment — commentActions.ts:963
if (user?.user_id !== existing.user_id && user?.user_type !== 'internal') throw new Error('You can only cancel your own comments');
```

`user_type === 'internal'` is true for **every** internal user in the tenant. There is no `ticket:update` permission check and no record-level ticket access check. Neither action resolves `existing.ticket_id` against the authorization kernel.

**Attacker path:** an internal user who is restricted from a ticket (e.g. a board/bundle narrowing that denies them `ticket:update` and record access) obtains or retains a scheduled-comment UUID — from a prior view, an email, a shared link, or enumeration — and calls `cancelScheduledComment(uuid)`. The CAS update at `commentActions.ts:964-966` flips `publish_state` to `canceled`, sets `deleted_at`, and `withdrawCommentAttachments` pulls the attachments (`:967`); the queued publish job is cancelled (`:968`). The client never receives the message another agent scheduled. `rescheduleScheduledComment` is the same hole for moving the publication instant and rearming the job (`:936-953`).

**Intended boundary (for contrast):** the REST controller does it correctly — `checkPermission(update)` then `assertTicketReadAllowed(ticketId)` before calling the service (`server/src/lib/api/controllers/ApiTicketController.ts:1709-1738`). The native server actions skip both.

### The fix
Add the same record-level enforcement both native actions are missing, in one shared helper so the two call sites cannot drift:

1. **New helper** in `commentActions.ts`, beside `assertMayChangeComment`:

   ```ts
   /**
    * A scheduled comment may be canceled or rescheduled only by a principal who can
    * currently update the owning ticket at the record level — the same boundary the
    * REST controller enforces (ApiTicketController.cancelScheduledComment). user_type
    * alone is not authorization: an internal user restricted from the ticket is denied.
    */
   async function assertMayManageScheduledComment(
     trx: Knex.Transaction, user: { user_id: string; user_type: string }, existing: IComment, tenant: string,
   ): Promise<void> {
     if (!(await hasPermission(user as any, 'ticket', 'update', trx))) {
       throw new Error('Permission denied: Cannot manage scheduled comment');
     }
     if (existing.ticket_id) {
       await authorizeTicketRecordAccess({ trx, tenant, user: user as any, ticketId: existing.ticket_id, action: 'update' });
     }
   }
   ```

2. **Replace** the `user_type === 'internal'` branch at `commentActions.ts:939` and `:963` with a call to the helper, after the `publish_state !== 'scheduled'` existence check and before any mutation/job cancellation.

This is the single enforcement point: every scheduled-comment state change in the native action layer now funnels through `assertMayManageScheduledComment`, which composes the coarse `ticket:update` RBAC with the kernel's record-level narrowing — identical to the create/edit/delete paths and to the REST controller. Scheduled comments are MSP-internal-only by construction (`normalizeScheduledPublication`, `commentActions.ts:48-49` requires `author_type === 'internal'`), so no client-conceal variant is needed; `authorizeTicketRecordAccess` (not `...Concealed`) matches the internal-principal `Ticket not found` behavior the REST path already returns.

**Authorship:** dropped as an authorization condition, matching the REST controller, which requires `update` + record access but not authorship. Any internal user who can currently update the ticket may manage its scheduled comments; one who cannot is denied. This encodes the "non-author may manage" policy as the existing `ticket:update` + record-access permission rather than "every internal user is an admin," exactly as the finding's suggested fix asks.

### Why a shared helper is the right home
The two actions are a matched pair with identical authorization needs; a lone inline check on each is precisely the drift that let `cancel` and `reschedule` share a copy-pasted wrong predicate. One helper in the same file keeps the enforcement point singular and local to the two callers, and reuses `authorizeTicketRecordAccess` (already imported at `commentActions.ts:35`) rather than re-deriving the kernel.

---

## Proof (tests)

New test file: `packages/tickets/src/actions/comment-actions/scheduledCommentAuthz.test.ts`, mirroring the mock-DB-plus-real-kernel harness already used in `commentMutationsAuthz.test.ts` (fake `@alga-psa/db` + `getClientContactVisibilityContext`, real `ticketRecordAuthorization`). Assertions:

1. **`cancelScheduledComment`: denies an internal user without record access** — `hasPermission(ticket,update)` false (or the kernel denies via board narrowing) → the action throws and no `update({ publish_state: 'canceled' })` is issued / `withdrawCommentAttachments` is not called. **Fails before the fix** because the current `user_type === 'internal'` branch admits the user and runs the cancel CAS.
2. **`cancelScheduledComment`: allows an internal user with `ticket:update` + record access** — the CAS update and job cancellation run. Guards against over-tightening.
3. **`rescheduleScheduledComment`: denies an internal user without record access** — throws before `scheduleBackgroundJobAt` / the reschedule CAS. **Fails before the fix** for the same reason.
4. **`rescheduleScheduledComment`: allows an internal user with `ticket:update` + record access.**

Regression coverage already securing findings 1 & 2 (no new test needed, cite in the card facts):
- `packages/tickets/src/actions/comment-actions/commentMutationsAuthz.test.ts` — `createComment` denies a client on a peer-contact ticket, a hidden board, and a nonexistent ticket with an identical denial shape (`:174-198`); allows a client on their own visible ticket (`:201`); `updateComment`/`deleteComment` reject a client on a ticket they can no longer see (`:126-144`).

Validation command: `npx vitest run packages/tickets/src/actions/comment-actions/` from the repo root.

## Scope — deliberately NOT doing

- **Finding 2 residual** (distinct `ticket:delete` capability for comment deletion; MSP self-edit re-check): requires extending the authorization kernel's action set beyond `read | update` (`ticketRecordAuthorization.ts:235`). It is a policy-parity refinement, not the reported client escalation, which is already closed. Call it out for a reviewer; do not widen this card into a kernel change.
- No change to the REST controller / `ticketService` scheduled-comment paths — they already enforce the boundary.
- No change to the read/create/edit/delete client paths (findings 1 & 2), which are already remediated.

## Risks / regressions a reviewer should weigh

- **Behavioral change for finding 3:** internal users who previously could cancel/reschedule *any* scheduled comment by type alone will now be denied unless they hold `ticket:update` and record-level access to the owning ticket. If any existing UI affordance assumed the old permissive behavior (e.g. an admin console acting across tickets), it must carry a role whose RBAC/narrowing grants `ticket:update` on the ticket. This is the intended tightening and matches the REST surface, but it is a visible contract change worth confirming against the scheduled-comment UI entry points.
- **Error shape:** `assertMayManageScheduledComment` throws `Permission denied: Cannot access ticket` / `Ticket not found` via the kernel (vs. the old `You can only cancel your own comments`). Confirm the calling UI surfaces these through `ticketActionErrorFrom`-style mapping rather than leaking a raw 500; the scheduled-comment actions do not currently wrap in `ticketActionErrorFrom`, so the plan should add that mapping or verify the caller tolerates the thrown Error.
- **`hasPermission` signature:** pass `trx` as the 4th arg (as `assertMayChangeComment` does at `commentActions.ts:649`) so the permission check runs inside the transaction.
