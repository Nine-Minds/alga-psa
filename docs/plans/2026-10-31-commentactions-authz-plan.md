# Security authz — `commentActions.ts`: comment read + create

Card: Security: 2 findings in commentActions.ts (`c18be408`) · PSA ticket alga-2026-0002993
Base: `origin/main` @ `2754f79c81` · Worktree `feature/security-2-findings-in-commentactions-ts`
Findings from the review of PR #3994 / merge `22d6e42ed479`.

---

## 0. Decision (Design Session, 2026-10-31)

**Both findings are already fixed on current main.** The review predates two merges that landed the
suggested fix; no new production code is required for this card.

| # | Finding | Where it is fixed now |
|---|---|---|
| F1 | `authorizeCommentRead` narrowed clients only to same-client/board, omitting contact/manager/billing/watcher scope | `packages/tickets/src/lib/ticketRecordAuthorization.ts:132-159` — `createTicketAuthorizationContext` now resolves the canonical `ContactVisibilityContext` (`getClientContactVisibilityContext`) and installs the `contact_visibility` relationship rule. `authorizeCommentRead` (`commentActions.ts:185-195`) calls `authorizeTicketRecordAccess`, so a client read is fail-closed through contact + board + billing-profile + watcher narrowing. Fixed by `7c883bc821` (2026-10-30). |
| F2 | `createComment` client gate checked only same-client ownership, bypassing record authz | `commentActions.ts:117-142` — `assertClientCanCreateComment` now calls `authorizeTicketRecordAccessConcealed({action:'update'})` before the parent-thread lookup; the coarse `ticket:update` check remains the MSP gate. Fixed by `8bd7fe5d48` (2026-10-30). |

Existing regression coverage on main:

- `commentMutationsAuthz.test.ts` — createComment denies a client on a same-client ticket belonging to
  another contact and on a hidden board; identical denial shape for nonexistent/peer-contact/hidden-board;
  allows the visible own ticket; still rejects internal comments and internal-thread replies.
- `ticketRecordAuthorization.test.ts` — resolves contact visibility for client principals, never uses
  `selected_boards`, denies a client with no contact/failed resolution, and denies a hidden contact.
- `commentActions.visibility.test.ts` — read path denies a client when the record authorizer denies and
  makes forbidden/hidden/missing comments indistinguishable.

## 1. Remaining work (the only delta)

`commentActions.visibility.test.ts` **mocks** `authorizeTicketRecordAccess`, so no test in that file proves
the real contact-visibility path with a sibling-contact ticket. Add one integration-level regression (under
`server/src/test/integration/`, using the existing authorization fixtures) that:

1. seeds one client with two contacts, a visible board, and two tickets — one owned by contact A, one by
   contact B;
2. signs in as contact A and calls `findCommentsByTicketId(ticketB.id)` → denied in the same shape as a
   nonexistent ticket, no comment rows returned;
3. repeats for `findCommentById` of a comment on ticket B;
4. control: contact A reading their own ticket's comments succeeds.

No production change expected. If the test exposes a gap, fix it in `authorizeCommentRead` /
`ticketRecordAuthorization.ts` only.

## 2. Verification

```
cd server
npx vitest run src/test/integration/<new test>.integration.test.ts
cd ../../packages/tickets && npx vitest run src/actions/comment-actions/commentMutationsAuthz.test.ts src/lib/ticketRecordAuthorization.test.ts
```

Green proves F1 and F2 with the real kernel path, which is the evidence for `security-finding-resolved`.

## 3. Out of scope

- Re-deriving contact visibility in `authorizeCommentRead` (the kernel does it now).
- Changing comment projection/thread visibility (already covered by `commentActions.visibility.test.ts`).
- The REST reaction route — that is a separate card (`3e15e371`).
