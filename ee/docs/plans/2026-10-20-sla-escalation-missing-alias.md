# SLA escalation fails on a missing table alias: design of record

- Card: e7940fc0-f70f-452b-8709-ba4a93ec86d8
- PSA ticket: alga-2026-0002687 (YourColo; also covers TIC1045 on appliance v1.6.9)
- Branch: `fix/fix-sla-escalation-escalateticket-fails-on-missi`

## Problem

Since 4391831b55 ("feat(email): route ticket mail by board", deployed 2026-09-28 21:02 UTC), every SLA escalation in every tenant fails. Loki shows 748 failed attempts across 264 tickets and 20 tenants, and no successes since that deploy.

`escalateTicket()` in `packages/sla/src/services/escalationService.ts` starts with:

```ts
scopedDb.table('tickets').where({ ticket_id }).select('t.board_id', 'ticket_id', ..., 'board_id', ...)
```

The query has no `t` alias, so Postgres fails with `missing FROM-clause entry for table "t"`. The `try/catch` in `escalateTicket` catches the error and returns `{ success: false }`. `checkAndEscalate` in `ee/temporal-workflows/src/activities/sla-activities.ts` ignores that return value and logs "SLA escalation completed". The activity reports success and Temporal never retries. The ticket's escalation fields stay null, no manager is added to `ticket_resources`, no audit row is written, and no notification or email goes out. Breach recording (`updateSlaStatus`) is a separate activity and still works, so tickets show as breached but never escalated.

The same commit passes `boardId: ticketDetails?.board_id` to the escalation email, but the details query in `sendEscalationEmailNotification` never selects `board_id`. That value is always `undefined`, so board-routed mail never applies to escalation emails.

## What I found reading the code

These findings come from this worktree. They go beyond the card's fix list, and the fix depends on them.

1. **A swallowed DB error poisons the transaction, and the commit then rolls back silently.** All of `escalateTicket` runs on one Postgres transaction (`withTenantTransactionRetryReadOnly` in the activity). The helpers `addEscalationManagerAsResource`, `sendEscalationInAppNotification` (which calls `createNotificationFromTemplateInternal`, and that function reads and writes on the same `trx`) and `logEscalationEvent` each catch their own errors and return `false` or nothing. Once a statement fails in Postgres, the transaction is aborted. Every later statement fails with "current transaction is aborted", and each helper swallows that too. `escalateTicket` then returns `success: true`. At the end, `COMMIT` on an aborted transaction returns `ROLLBACK` without raising an error. So the same silent loss can come back through any helper, even after the alias fix and the new `checkAndEscalate` throw. Swallowing errors inside a transaction does not make a step best-effort. It hides the rollback.
2. **The escalation email goes out inside the transaction.** `sendEscalationEmailNotification` calls `emailService.sendNotification` directly. `slaNotificationService.sendEmailNotification` already defers its send with `registerAfterCommit` (`packages/db/src/lib/afterCommit.ts`). Once `checkAndEscalate` throws and Temporal retries, an inline send means the manager gets one email per failed attempt, even though the rolled-back attempts left no trace in the DB. In-app delivery is already after-commit inside `createNotificationFromTemplateInternal`, so only the email has this problem.
3. **When an activity runs out of retries, the whole SLA workflow fails.** `sla-ticket-workflow.ts` proxies activities with `maximumAttempts: 3`. It calls `checkAndEscalate` with no `try/catch`, right after `sendSlaNotification` and `updateSlaStatus` (lines ~487–508). Today the activity can't fail, so this has never come up. After item 3 of the fix, a persistent failure such as a misconfigured escalation manager row would raise `ActivityFailure` out of the workflow. That fails the execution, and the ticket stops getting later threshold notifications, breach recording at 100%, and the whole resolution phase. A lost escalation would turn into lost SLA tracking.
4. The idempotency guard the card relies on holds: `checkEscalationNeeded` returns `null` when `currentLevel >= level`, and `escalateTicket` no-ops (returns `success: true`) when `escalation_level >= newLevel`. A failed attempt rolls back completely (see 1), so a retry starts from the same state. If the commit succeeds and the activity fails afterwards (for example, the worker dies), the retry sees the new level and does nothing.
5. `escalateTicket` has one production caller: `checkAndEscalate`. Changing what it does on failure affects no other code path.

## Changes

### 1. `packages/sla/src/services/escalationService.ts`

- **`escalateTicket`, step 1:** remove `'t.board_id'` from the select. `board_id` is already in the list.
- **`sendEscalationEmailNotification`:** add `'t.board_id'` to the ticket details select, so `boardId: ticketDetails?.board_id` gets a real value. Defer the `emailService.sendNotification(...)` call with `registerAfterCommit(trx, () => ..., 'sla-escalation-email ticket=<id> user=<id>')`, the same pattern as `slaNotificationService.sendEmailNotification`. The function returns `true` once the email is queued, which is how the other service reports it.
- **Stop swallowing DB errors inside the transaction.** Remove the per-helper `try/catch` from `addEscalationManagerAsResource`, `sendEscalationInAppNotification` and `logEscalationEvent`. Errors then reach `escalateTicket`'s outer `catch`, which returns `success: false` with the message. The activity then throws (change 2), the transaction rolls back, and Temporal retries. `sendEscalationEmailNotification` keeps its `try/catch` only around non-DB work. Its subtype and ticket-details reads run on `trx`, so a failure there must also propagate. The after-commit hook's own failures are already logged and swallowed by `flushAfterCommitHooks`, after the commit, where that is safe.
  - A disabled or missing in-app template still returns `null` from `createNotificationFromTemplateInternal` without an error. That stays a non-fatal `inApp: false`.
  - "No escalation manager configured" stays a successful escalation, as it is today.
- Keep the `EscalationResult` shape. `success: false` now always means "nothing was committed".

### 2. `ee/temporal-workflows/src/activities/sla-activities.ts`: `checkAndEscalate`

- Capture the result. If `result.success` is false, throw `new Error(\`SLA escalation failed for ticket ${ticketId} (level ${level}): ${result.error}\`)` inside the `withTenantTransaction` callback, so the transaction rolls back and Temporal records the failure and retries.
- Log "SLA escalation completed" only on success, and include `managerId`, `resourceAdded` and `notificationsSent` so Loki shows what actually happened. When `result.error` is set with `success: true` (the "already at or above" no-op), log it as a no-op rather than as completed.
- Any caught exception should also log the original error object, not just the message.

### 3. `ee/temporal-workflows/src/workflows/sla-ticket-workflow.ts`

- Wrap the `activities.checkAndEscalate(...)` call in `try/catch`. On `ActivityFailure`, log with the workflow logger (`log.warn` from `@temporalio/workflow`) with the ticket, phase and threshold, then continue the threshold loop. Retries happen inside the activity; the workflow just keeps going after they run out, and SLA tracking continues.
- Replay safety: adding a `try/catch` around an existing activity call does not change the command sequence, and no existing history contains a failed `checkAndEscalate`, because the activity could not fail before this change. No `patched()` gate is needed. If the builder finds that the threshold loop's ordering has to change, that change needs a `patched()` gate.

### 4. Tests

- **New DB-backed integration test:** `server/src/test/integration/sla/escalationService.integration.test.ts`. Follow the conventions of its neighbour `slaNotificationService.integration.test.ts`: `createTestDbConnection`, `createTenant`/`createUser`/`createClient`, local `createBoard`/`createEscalationManager`/`insertTicket` helpers, and the same logger, secrets and event-bus mocks. Mock only the external email transport (`getEmailNotificationService`). Use the real `createNotificationFromTemplateInternal`, because its in-trx queries are exactly what this card's poisoning risk is about, and the `sla-escalation` internal template is seeded by migration `20260219000006`. Cases:
  1. With an L1 manager configured, `escalateTicket(trx, tenant, ticket, 1)` returns `success: true`. The ticket has `escalated = true`, `escalation_level = 1`, `escalated_at` set and `escalated_by` null. `ticket_resources` has one row with `additional_user_id = manager` and `role = 'escalation_manager_L1'`. `sla_audit_log` has one `event_type = 'ticket_escalated'` row for the ticket. An internal notification row exists for the manager.
  2. After commit, the email mock is called once with `mailClass: 'ticket'` and `boardId` equal to the ticket's board. Before commit, it has not been called (this checks the after-commit deferral).
  3. Calling `escalateTicket(..., 1)` again returns `success: true` with the "already at or above" error. There is still one `ticket_resources` row, one audit row, and one email.
  4. Escalating to L2 with an L2 manager who is the same user updates that one `ticket_resources` row's role to `escalation_manager_L2`. No second row is created.
  5. With no manager for the level, the call succeeds, the escalation fields are written, and the audit row has `manager_found: false`.
- **Unit tests to update:** `packages/sla/src/services/__tests__/escalationService.test.ts` mocks knex. Assertions that a helper failure still yields `success: true` must flip to `success: false`. Assertions that check the email is sent inline must account for `registerAfterCommit`.
- **Activity unit test:** in `ee/temporal-workflows/src/activities/__tests__/sla-activities.test.ts`, add a case where `escalateTicket` resolves `{ success: false, error }` and `checkAndEscalate` rejects. Add another where `{ success: true, error: 'already at…' }` resolves without throwing.
- **Workflow test:** in `ee/temporal-workflows/src/workflows/__tests__/sla-ticket-workflow.integration.test.ts`, add a case where the `checkAndEscalate` stub always throws, and the workflow still records the 100% breach and moves on to the resolution phase.

## Order of work

1. Write the integration test (cases 1 and 2) and watch it fail on `missing FROM-clause entry for table "t"`.
2. Make the alias and `board_id` select fixes. Case 1 passes.
3. Defer the email with `registerAfterCommit`. Case 2 passes, then add cases 3–5.
4. Remove the in-transaction swallowing in the helpers and update the unit tests.
5. Make `checkAndEscalate` throw and log the result, with its unit tests.
6. Add the workflow `try/catch` and its workflow test.
7. Run the `packages/sla` unit tests, the `ee/temporal-workflows` tests, and the new integration test. Then typecheck both packages.

## Non-goals

- Changing when escalation is evaluated. Escalation runs only at the notification wake points (50/75/90/100), so L1 fires at 75% instead of 70%, and the default L3 at 110% is never evaluated because the workflow moves to the resolution phase after 100%. This needs a separate follow-up card.
- Backfilling the 264 missed escalations. Most of those tickets are closed or past the point where escalating helps.
- Reworking `checkEscalationNeeded`, `getEscalationManagerForTicket`, or the escalation-manager configuration UI.
- Changing `slaNotificationService` beyond what this card touches. It already uses the correct after-commit pattern.
- Changing the activity retry policy (`maximumAttempts: 3`, 1s→30s backoff) shared by all SLA activities.

## Risks

- **Escalation emails start arriving for every tenant.** Escalations have been dead for about four weeks. Once this ships, managers will start getting escalation mail and in-app notifications again, now board-routed. That is the intended behavior, but CS should know ahead of release, especially for YourColo.
- **Persistent failures now show up as failed activities.** The worker will report failed `checkAndEscalate` activities where it used to log fake "completed" lines. The workflow `try/catch` contains the damage. The failure log line must be greppable (`SLA escalation failed`) so it can be alerted on.
- **Escalation email becomes at-most-once.** Rolled-back attempts queue nothing. A retry after a successful commit hits the level guard and no-ops, so it cannot re-send. The cost is that if the after-commit hook fails (SMTP or provider error), the email is lost. `flushAfterCommitHooks` logs that failure with the hook label, and nothing retries it. This matches `slaNotificationService`, and it is better than duplicate emails. The in-app notification and the `ticket_resources` row still reach the manager.
- **Appliance:** v1.6.9 appliances carry the bug until they take a release that contains this fix. The fix has no migration, so it ships with a normal release.

## Decisions later steps must honour

1. Fix the alias by deleting `'t.board_id'` from the `escalateTicket` select. Do not alias the table.
2. The escalation email's ticket details query selects `t.board_id`, and `boardId` comes from it.
3. Escalation is all-or-nothing on its transaction. No helper may swallow an error from a query on `trx`. `success: false` means nothing was committed.
4. The escalation email is sent with `registerAfterCommit`, never inline.
5. `checkAndEscalate` throws on `success: false` and logs the real result on success.
6. The SLA workflow catches a `checkAndEscalate` failure that has run out of retries, logs it and continues. Escalation failures must never stop SLA tracking. No `patched()` gate unless the command order changes.
7. Idempotency rests on the existing level guards in `checkEscalationNeeded` and `escalateTicket`, plus full rollback on failure. No new dedupe table or key.
8. The integration test is `server/src/test/integration/sla/escalationService.integration.test.ts`, run against a real DB with the real in-app notification path. Only the email transport is mocked. It asserts the escalation fields, the `ticket_resources` row, the `ticket_escalated` audit row, after-commit email with `boardId`, and no duplicates on re-run.
9. Out of scope: wake-point timing (70%/110%) and backfill.
