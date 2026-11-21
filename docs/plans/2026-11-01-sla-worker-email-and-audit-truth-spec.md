# Spec — a worker that can actually send mail, and an audit row that cannot lie

Card `3d5269d8` · "SLA escalation email: worker email stub drops mail, audit log records email:true"

## 1. Two defects, one shape

**(a) The stub is a lie the compiler cannot catch.** `ee/temporal-workflows/src/typings/notifications/notifications/email.ts`
exists so the worker's Docker build compiles without the notification package's UI transitive deps
(`next-themes`, …). Its own header says the real package is present at runtime — but
`EmailNotificationService.sendNotification` **throws**, and that stub is what the worker's module
resolution actually binds. So the escalation path compiles, type-checks, is unit-testable, and cannot
send. Nothing in CI fails, because a throwing stub has exactly the signature of the real thing.

**(b) The audit row records intent as fact.** `sla_audit_log` is written from
`ee/temporal-workflows/src/activities/sla-activities.ts:199` / `:303`. Since PR #3877 moved the send to
an after-commit hook, the commit-time insert records `notifications.email: true` *before* the hook runs;
the hook then throws and the row keeps saying `true`. Before the PR the synchronous throw recorded
`false` — so the lie was introduced by making the send asynchronous without making the record follow.

Both are the same mistake: **a fact is recorded at the moment it is convenient, not the moment it is
true.**

## 2. Decision: a mail port, an adapter, and a state — not a better stub

### 2.1 `OutboundMailPort` in a UI-free package

Add to a package with no React/Next dependencies (the existing mailer layer — `packages/email` — or a new
`packages/mail-core` if `packages/email` still drags UI deps; verify before choosing):

```ts
export interface OutboundMail {
  send(msg: OutboundMessage): Promise<OutboundMailResult>;
}
// OutboundMailResult = { status: 'sent'; messageId: string } | { status: 'failed'; reason: string; retryable: boolean }
```

The notification service (`@alga-psa/notifications/notifications/email`) becomes one **consumer** of the
port: it resolves templates and mail class, then hands the rendered message to the port. The worker
imports the port and a real SMTP adapter, never the notification UI package.

**Delete the throwing stub.** Replace the path in `ee/temporal-workflows/tsconfig` with the port's
module. A stub may exist only for a *type-only* import (`import type`), never for a value with behaviour.

### 2.2 A build-time guard that a stub cannot come back

The stub got in because nothing checked what the worker actually resolves. Add a guard test in the worker
package that walks the module graph reachable from the worker's Temporal entrypoints and fails if any
resolved module contains a throwing placeholder — concretely: import each entrypoint's mail path in a
Node process under the worker tsconfig and assert the exported `send`/`sendNotification` does not throw
`*stub*` when called with a no-op adapter; plus a source scan for `should not be called in
<temporal|worker>` strings reachable from `ee/temporal-workflows/src`. This is the general fix: it fails
for *any* future stub, not this one.

### 2.3 Audit as a state machine, not a boolean

`notifications.email` becomes an outcome value, not a boolean:

- commit-time insert writes `email: 'queued'` (the truth at that instant);
- the after-commit hook updates the same row: `'sent'` (with the provider message id) or `'failed'` (with
  the reason), keyed by the audit row id passed into the hook closure;
- a hook failure is **logged at error** with the ticket id + audit row id and marks the row `'failed'` —
  never swallowed. If the update itself fails (row gone, DB down), that is a logged error too; the row
  staying `'queued'` is visibly stale rather than falsely `'sent'`.

Migration: widen the column (text with a check constraint on `queued|sent|failed|skipped`), backfill
legacy `true|false` to `sent|failed` only where a provider message id exists, else `queued` with a note.

### 2.4 Audit the other worker paths on the stub

`grep -rn "notifications/notifications/email" ee/temporal-workflows/src` and any other module reaching
the same stub is in scope — the fix is the port, so every such path gets a real implementation at once.
List them in the PR body (the card asks for exactly this audit).

## 3. Deliberately not doing

- **Not vendoring the notification package's UI deps into the worker image.** The port exists to keep
  the UI out of the worker, which is why the stub was written in the first place.
- **Not retrying failed sends forever.** The port reports `retryable`; the SLA activity already has
  Temporal retry semantics — the hook records the outcome after Temporal's own budget, not before.
- **Not changing which events escalate.** This card is delivery + truthfulness only.

## 4. Tests

1. **Worker resolves a real mailer** — the guard in §2.2, run in the worker package's CI job.
2. **Stub cannot reappear** — a source scan test asserting no reachable module throws a
   `*stub*` error from an exported function.
3. **Audit on failure** — force the port to return `failed`; assert the row ends `'failed'` with the
   reason, and that the commit-time value was `'queued'` (assert both writes, not just the last).
4. **Audit on success** — `'sent'` plus message id.
5. **Hook failure is visible** — port throws; assert a structured error log with ticket id + audit row id
   and a `'failed'` row.
6. **Live proof** — an escalation on the local stack produces a delivered message through the SMTP
   emulator (algasim), routed by the ticket's board (`boardId`), reproducing the PR #3877 routing path.

## 5. Risks

- **Two mail entry points diverge** (server-side notification service vs worker port). Mitigation: both
  call the same renderer; only transport differs, and the port is the single seam.
- **Audit column type change** touches reporting that reads `notifications.email` as boolean; grep the
  audit UI/export before migrating and update those readers in the same PR.
- **Legacy rows backfill** is lossy for `true` rows with no provider id — record them as `queued`, never
  claim `sent` retroactively.
