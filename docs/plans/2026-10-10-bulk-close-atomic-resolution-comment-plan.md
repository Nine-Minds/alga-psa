# Bulk close: atomic resolution comment — implementation plan

Card: 8801790f-937b-4fea-9fe2-202b452841da · Customer ticket alga-2026-0002381 (AJATechnologies)
Branch: `feature/bulk-close-write-resolution-comment-atomically-w` · Base: `main` @ b0d0b4dacf

## Problem (as the code stands)

`bulkUpdateTicketStatus` (`packages/tickets/src/actions/ticketActions.ts`, ~L2350-2445) runs two separate transactions per ticket:

1. `addTicketCommentWithCache(...)`, a `withAuth` server action that opens and commits **its own** transaction (`optimizedTicketActions.ts` ~L3413-3752).
2. `withTransaction(knex, trx => updateTicketInTransaction(trx, ..., { status_id }, statusOptions))`.

If step 2 throws (a `TicketCloseValidationError` from `enforceTicketCloseRules` for time entry, checklist, open children or required fields; the bundled-child workflow-field lock; `BundlePropagationConfirmationRequiredError`; status/board mismatch), the comment from step 1 has already committed, and its after-commit hooks have already run:

- the ticket stays open but carries an `is_resolution` comment with `metadata.closes_ticket = true`,
- `TICKET_COMMENT_ADDED` and the workflow v2 message events have already been dispatched for a ticket that never closed. Every subscriber of those events (notifications, workflows, live updates) acted on a resolution that did not take effect,
- a public comment has already set `response_state = awaiting_client` and published `TICKET_RESPONSE_STATE_CHANGED`,
- a bundle master in `sync_updates` mode has already mirrored the resolution onto its children,
- retrying adds a second resolution comment.

## What already holds (verified in code)

- **Comment-side events already wait for commit.** In `addTicketCommentWithCache` every outbound effect is either `registerAfterCommit(trx, …)` (workflow v2 message events, live update, scheduled-job arming) or `persistCommentPublication(trx, …)`. The latter writes the outbox columns on the comment row (`scheduled_publish_event_id`, `comment_publication_payload`) and registers the dispatch after commit (`shared/lib/ticketCommentAttachments.ts`). `updateTicketResponseStateFromComment` also publishes after commit.
- **Nested frames share one hook queue.** `withTransaction` given an existing `trx` reuses it without owning the commit, and hooks flush once when the outermost owning frame commits. On rollback the queue is dropped (`packages/db/src/lib/afterCommit.ts`, `tenant.ts`). If the comment write runs on the bulk loop's `trx`, its notifications fire only if the close commits. The outbox row also disappears on rollback, so the reconciler cannot replay it either.
- **The resolution gate sees in-transaction writes.** `evaluateGates` queries `comments` through the passed `trx` for `is_resolution = true OR metadata->>'closes_ticket' = 'true'`. If the comment goes in first on the same `trx`, the `require_resolution_comment` gate passes from that comment.
- **Response state composes.** A public resolution sets `awaiting_client` in-trx. `updateTicketInTransaction` then reads `currentTicket` on the same trx, sees non-null `response_state`, and clears it on close. That matches today's behavior, now in one commit.
- **The only inline side effects** are `captureAnalytics` (a no-op stub at `optimizedTicketActions.ts:169`) and `revalidatePath` (cache hint, harmless, and `updateTicketInTransaction` already does the same).

So the real gap is that the comment layer can't take a caller's transaction. Per the brief, we fix that in the comment layer and do not work around it in the bulk action. The pre-check fallback (`evaluateTicketCloseRules` before writing) is **rejected**: it races, and it also misses the non-close-rule failures (bundle lock, propagation confirmation, status validation).

## Design

### D1. Comment layer: extract `addTicketCommentInTransaction`

In `packages/tickets/src/actions/optimizedTicketActions.ts`, add an exported core that mirrors `updateTicketInTransaction`:

```ts
export interface AddTicketCommentInput {
  ticketId: string;
  content: string;
  isInternal: boolean;
  isResolution: boolean;
  closesTicket?: boolean;
  notificationSuppression?: Pick<UpdateTicketInTransactionOptions,
    'suppressContactNotifications' | 'suppressInternalNotifications'>;
  schedule?: ScheduledCommentPublication | null;
  emailRecipients?: CommentEmailRecipientsInput | null;
}

export async function addTicketCommentInTransaction(
  trx: Knex.Transaction,
  user: IUserWithRoles,
  tenant: string,
  input: AddTicketCommentInput,
): Promise<IComment>   // throws; never returns TicketActionError
```

- The body is the current transaction body of `addTicketCommentWithCache`, moved as-is: suppression-flag validation, author-type and internal-comment checks, schedule validation, ticket-exists check, markdown conversion, thread and comment insert, attachment reconcile, response state, bundle reopen and mirror, `persistCommentPublication`, workflow events, live update, activity row, and scheduled-job arming.
- It does **not** check `ticket:update` permission. That stays with callers, following the `updateTicketWithCache` → `updateTicketInTransaction` split. `bulkUpdateTicketStatus` already authorizes once up front.
- `captureAnalytics(...)` moves into `registerAfterCommit` so the core does nothing observable before commit. It is a stub today, so this costs nothing and keeps the core honest when it gets wired up.
- The scheduled-job hook currently reads the outer `db` (`tenantDb(db, tenant)` after commit). The core has no `db`, so it uses `await getConnection(tenant)` (or `createTenantKnex()`) inside the hook, the same way `persistCommentPublication`'s dispatch does.
- Requires `trx.isTransaction`. `persistCommentPublication` already enforces this.

### D2. `addTicketCommentWithCache` becomes a thin wrapper

```ts
export const addTicketCommentWithCache = withAuth(async (user, { tenant }, ticketId, content, isInternal,
    isResolution, closesTicket = false, notificationSuppression?, schedule?, emailRecipients?) => {
  try {
    const { knex: db } = await createTenantKnex();
    return await withTransaction(db, async (trx) => {
      if (!await hasPermission(user, 'ticket', 'update', trx)) throw new Error('Permission denied: Cannot add comment');
      return addTicketCommentInTransaction(trx, user as IUserWithRoles, tenant,
        { ticketId, content, isInternal, isResolution, closesTicket, notificationSuppression, schedule, emailRecipients });
    });
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to add ticket comment:', error);
    throw error;
  }
});
```

Signature and return shapes stay the same for `TicketDetails.tsx` and `addTicketCommentWithCacheForCurrentUser`.

**The catch moves outside the transaction, on purpose.** Today the `try/catch` sits inside the `withTransaction` callback, so an *expected* error is returned rather than thrown and the transaction **commits** whatever was already written. Example: `reconcileCommentAttachments` failing after the thread and comment inserts leaves a half-written comment while the UI shows an error. With the catch outside, expected errors roll back. This is the same atomicity bug in its single-ticket form, so it gets fixed here too. One behavior change worth calling out: the suppression-flag validation `throw` now goes through the catch as well. That's fine, because `ticketActionErrorFrom` returns null for it and it is rethrown exactly as before.

### D3. `bulkUpdateTicketStatus`: one transaction per ticket

```ts
for (const ticketId of uniqueIds) {
  let phase: 'resolution' | 'status' = 'status';
  try {
    await withTransaction(knex, async (trx) => {
      if (resolutionContent) {
        phase = 'resolution';
        await addTicketCommentInTransaction(trx, user as IUserWithRoles, tenant, {
          ticketId,
          content: resolutionContent,
          isInternal: resolutionComment?.isInternal === true,
          isResolution: true,
          closesTicket: true,
          notificationSuppression: {
            suppressContactNotifications: statusOptions.suppressContactNotifications,
            suppressInternalNotifications: statusOptions.suppressInternalNotifications,
          },
        });
        phase = 'status';
      }
      await updateTicketInTransaction(trx, user as IUserWithRoles, tenant, ticketId, { status_id: statusId }, statusOptions);
    });
    updatedIds.push(ticketId);
  } catch (error) {
    failed.push({
      ticketId,
      message: error instanceof TicketCloseValidationError
        ? error.message
        : await ticketBulkFailureMessage(error,
            phase === 'resolution' ? 'Failed to add resolution comment' : 'Failed to update status'),
      closeRuleFailures: error instanceof TicketCloseValidationError ? error.failures : undefined,
    });
  }
}
```

- **Order:** comment first, then status. The resolution gate then passes from the in-trx comment, any later gate failure rolls the comment back, and the comment's `TICKET_COMMENT_ADDED` (flagged `closes_ticket`) is queued before `TICKET_CLOSED`. Hooks flush in registration order, the same order as today.
- **Failure messages:** comment-phase failures keep the old fallback text (`'Failed to add resolution comment'`). Expected errors still surface their own localized message through `ticketBulkFailureMessage`, which replaces the old `isTicketActionError(commentResult)` branch.
- `isTicketActionError` in `ticketActions.ts`: remove it if this was its last caller (check with grep at implementation time).
- Update the comment block above the loop. It currently says the resolution is written "ahead of the status change". It should say the comment and the status change are written in one transaction, so a failed close leaves no resolution behind.
- The `ticketActions.ts` import list from `./optimizedTicketActions` swaps `addTicketCommentWithCache` for `addTicketCommentInTransaction`, unless `addTicketCommentWithCache` is still used elsewhere in the file.

### Behavior this keeps

| Contract | How it holds |
|---|---|
| Partial success per ticket | Still one transaction per ticket. A failure is pushed to `failed` and the loop continues. |
| Resolution dropped when target status is not closing | The `resolutionContent` derivation (target `is_closed` lookup) is unchanged. |
| Notification-suppression flags | Passed the same way to both the comment core and `updateTicketInTransaction`. The suppress-internal-requires-contact check still runs in both. |
| Bundle propagation | `updateTicketInTransaction` / `propagateBundleMasterStatus` are untouched. A sync-mode master's mirrored resolution comments now roll back with a failed close (a fix). A bundled child still fails on the workflow-field lock, but no longer leaves a stray comment (a fix). |
| Post-commit notifications | No new deferral needed. All comment publications are already after-commit or outbox, and now share the close's commit. |

### Risks / notes

- **Longer transaction per ticket.** It now spans the comment write and the close. Both touch the same `tickets` row in one trx, so there is no self-deadlock. The `persistCommentPublication` `FOR UPDATE` is on the just-inserted comment row.
- **Markdown conversion** (`convertBlockNoteToMarkdown`) runs inside the trx. That's already true today in its own trx. It is CPU-only, with no I/O.
- **Citus:** no schema change and no new cross-shard statements. Every statement is already tenant-scoped on the same tenant.
- Not in scope: the single-ticket UI flow in `TicketDetails.tsx` still posts the resolution comment and then closes in two calls. The same class of gap exists there. Flag it as a follow-up card rather than widening this one. The new core makes that fix easy (an action that does both in one trx).

## Tests

### T1. Unit (contract) — extend `packages/tickets/src/actions/ticketActions.bulkStatusResolution.test.ts`

The file is mock-based, so it carries the contract assertions:
- The `./optimizedTicketActions` mock adds `addTicketCommentInTransaction`. Bulk close never calls `addTicketCommentWithCache`.
- The per-ticket comment core and `updateTicketInTransaction` get the **same `trx` object**, inside **one** `withTransaction` call per ticket (`withTransactionMock` called `n` times for `n` tickets, with a distinct trx per call).
- Update the existing expectations (content, `isInternal`, `isResolution: true`, `closesTicket: true`, suppression flags) to the new input-object shape. Keep "drops when non-closing" and "skips blank text".
- New: `updateTicketInTransaction` rejects with `TicketCloseValidationError` for ticket-2 → result has ticket-1 updated and ticket-2 failed with `closeRuleFailures`. The comment core was called inside the same transaction callback that rejected, so the real `withTransaction` would roll it back.
- New: the comment core throws an expected action error → the failure message is that error's text. An unexpected error → `'Failed to add resolution comment'`, and `updateTicketInTransaction` is not called for that ticket.

### T2. DB integration: `server/src/test/integration/ticketCloseRules.integration.test.ts` (existing file)

The brief asks for "an integration test" and says to "extend the unit file". The unit file mocks `@alga-psa/db`, so it cannot observe a real rollback. The DB-backed case therefore goes in the existing close-rules integration suite, which already drives `bulkUpdateTicketStatus` against a real database with the real `withTransaction` (see T018). This adds to an existing file and starts no new one.

New case **T057: bulk close with a resolution is atomic per ticket**:
- `setBoardCloseRules(db, fixture, { require_resolution_comment: true, require_time_entry: true })`.
- `passingId` with `insertTicketTimeEntry`, and `failingId` without one.
- `bulkUpdateTicketStatus([passingId, failingId], fixture.closedStatusId, { resolutionComment: { text: 'Replaced the PSU.' } })` (public, so it exercises contact notification and response state).
- Expect `updatedIds = [passingId]`, and `failed[0].closeRuleFailures.map(r => r.rule)` = `['time_entry']`. The resolution gate is satisfied in-trx and is **not** reported.
- `passingId`: `is_closed = true`, exactly **one** `comments` row with `is_resolution = true`, `response_state` null.
- `failingId`: `is_closed = false`, **zero** `comments` rows, **zero** `comment_threads` rows, unchanged `response_state`, and no `ticket_activity` comment row.
- `publishEventMock` received no `TICKET_COMMENT_ADDED` with `ticketId === failingId`, and received one for `passingId`.
- Retry: add a time entry to `failingId`, re-run the same bulk close → it closes with exactly **one** resolution comment, so the retry does not duplicate.

Also run the existing suites that touch the comment path, to check that the D2 refactor regresses nothing: `optimizedTicketActions.*.test.ts`, `ticketActions.*.test.ts`, and the integration tests that call `addTicketCommentWithCache` (grep at implementation time).

## Files to change

| File | Change |
|---|---|
| `packages/tickets/src/actions/optimizedTicketActions.ts` | Add `AddTicketCommentInput` + `addTicketCommentInTransaction` (D1). Reduce `addTicketCommentWithCache` to a wrapper with the catch outside the trx (D2). |
| `packages/tickets/src/actions/ticketActions.ts` | `bulkUpdateTicketStatus`: one trx per ticket, comment then status, phase-aware failure message (D3). Import swap, plus removal of `isTicketActionError` if it is now unused. |
| `packages/tickets/src/actions/ticketActions.bulkStatusResolution.test.ts` | Contract tests (T1). |
| `server/src/test/integration/ticketCloseRules.integration.test.ts` | T057 DB atomicity case (T2). |

No migrations, no UI changes, no public API shape changes.
