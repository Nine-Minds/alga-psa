# Security authz — REST `POST` ticket-comment reactions

Card: Security: authz in POST (`3e15e371`) · PSA ticket alga-2026-0002994
Base: `origin/main` @ `4f3ca6d132` · Worktree `feature/security-authz-in-post`
Finding: `server/src/app/api/v1/tickets/[id]/comments/[commentId]/reactions/route.ts:21` (`POST`),
authz, medium — from the review of PR #3996 / merge `b0c288153a04`.

---

## 0. Decision (Design Session, 2026-10-31)

**The finding is real on main; this is a code change.**

`route.ts:21-28` destructures only `commentId` and ignores the path ticket `id`. It requires only
`ticket:read`, never calls the record-level ticket authorizer, never checks that the comment belongs to
the path ticket, and mutates `comment_reactions` directly (`route.ts:30-57`). The server-action sibling
`toggleCommentReaction` already does it correctly: it loads the comment, then for client principals calls
`authorizeTicketRecordAccessConcealed({ action: 'update' })` on `comment.ticket_id`
(`packages/tickets/src/actions/comment-actions/commentReactionActions.ts:38-52`). The REST route is the
unfixed counterpart.

### Design

1. **Parse both identifiers**: `const { id: ticketId, commentId } = await params;` and reject a malformed
   id with the route's normal 4xx (same validation the other `/api/v1/tickets/[id]` routes use).
2. **Bind the comment to the path ticket**: resolve the comment with
   `where({ comment_id: commentId, ticket_id: ticketId })` inside the tenant transaction. A comment that
   exists under a different ticket returns the same 404 as a missing comment — never a distinguishable
   answer.
3. **Authorize the path ticket through the record policy**: keep the coarse `ticket:read` check, then call
   `authorizeTicketRecordAccess({ trx, tenant, user, ticketId, action: 'update' })` from
   `@alga-psa/tickets/lib/ticketRecordAuthorization` before any reaction read/write. Map its errors to
   403/404 with the same `deniedStatus` shape used by
   `server/src/app/api/tickets/[id]/email-html/route.ts:38-43`. The action is `update` because a reaction
   writes to the ticket's thread, matching `toggleCommentReaction`.
4. **Share the resolver** with the server action, per the finding's suggested fix. Add
   `packages/tickets/src/lib/commentReactionResolver.ts`, which exports only
   `findReactionComment(trx, tenant, commentId, ticketId?)`: a tenant-scoped lookup with an optional ticket
   binding. Access checks stay with each caller. The REST route passes the path ticketId and runs
   `authorizeTicketRecordAccess`. `commentReactionActions.ts` uses the resolver with no ticketId and keeps its
   existing client-portal check on `comment.ticket_id`. No behaviour change for the server action; no MSP
   policy check is added there.
5. **Mutate only after both checks**: the existing toggle insert/delete stays as-is, now unreachable for a
   mismatched or invisible comment. Publish the same `ticket_update` live event as today.

## 1. Scope paths

- `server/src/app/api/v1/tickets/[id]/comments/[commentId]/reactions/route.ts`
- `packages/tickets/src/lib/commentReactionResolver.ts` (new)
- `packages/tickets/src/actions/comment-actions/commentReactionActions.ts` (use the shared resolver)
- one regression test (below)

## 2. Regression test (fails without the fix)

Extend `server/src/test/integration/commentReactions.integration.test.ts` (it already owns the reaction
fixtures and `TestContext`), or add `server/src/test/integration/commentReactionRouteAuthz.integration.test.ts`:

1. comment `cB` belongs to ticket B; POST `/api/v1/tickets/{A}/comments/{cB}/reactions` as a user who can
   see ticket A → **404**, and no row appears for `(cB, user, emoji)`.
2. POST to a ticket the caller cannot see at the record level → **403**, no write.
3. POST a comment under its own path ticket → **200** `{added:true}`, then again → `{added:false}` (toggle).
4. Unknown `commentId` and comment-under-wrong-ticket produce the **same** status/body.
5. Contract assertion that the route imports and uses `findReactionComment` (guards against reverting to a
   bare `comment_id` lookup).

## 3. Verification

```
cd server
npx vitest run src/test/integration/commentReactions.integration.test.ts
cd ../../packages/tickets && npx vitest run src/actions/comment-actions/commentMutationsAuthz.test.ts
```

Plus a live check on the card's dev server (`:3135`) with the canonical login `qa@emeraldcity.oz`:
two tickets, two contacts; contact A's session gets 404 for contact B's comment UUID under A's ticket.

## 4. Out of scope

- The comment read/create fixes — already on main and covered by card `c18be408`.
- Making the route accept a comment id without a ticket id (the path is the contract; both must agree).
- Reaction aggregation/read endpoints (no mutation, already tenant-scoped).
- The in-app reaction server action is still not policy-checked for MSP users. `toggleCommentReaction` enforces
  record access only for client-portal users
  ([`commentReactionActions.ts#L33`](../../packages/tickets/src/actions/comment-actions/commentReactionActions.ts#L33),
  the `if (isClientUserType(user.user_type))` branch). This PR fixes only the REST route the finding names. A
  sibling card on the board, **Security: authz in toggleCommentReaction**, tracks the server-action gap.
