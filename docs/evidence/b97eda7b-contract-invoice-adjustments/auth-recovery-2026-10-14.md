# Invoice editor authentication recovery

Application revision: `8e3ef4fd9ab1aace63a5d523f2286edf47473848`, PR #3499.

The invoice editor handles an expired session without discarding pending rows.
`updateInvoiceManualItems` returns a serializable `UNAUTHENTICATED` result when
the authentication wrapper rejects the request or the subsequent session lookup
has no user. Both paths exit before invoice mutation. An authenticated caller
without invoice-update permission still receives `PERMISSION_DENIED`.

The editor offers sign-in in a separate tab and an explicit retry using the
existing operation ID and expected revision. It does not automatically replay
the save. Client refresh and callback failures after confirmed persistence are
reported as saved changes requiring a page refresh.

## Independently verified

From `packages/billing`:

```sh
npx vitest run src/components/billing-dashboard/ManualInvoices.expandedSave.test.tsx tests/invoiceModification.manualRecurringGuard.test.ts
npm run build
NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck
```

All three commands exited 0: 22 behavioral tests passed, the billing tsup package
build passed, and billing typecheck passed with no diagnostics. The package
build is not a full Next production build.
The tests cover serialized authentication failures, no database mutation on
rejection, preserved permission denial, retained expanded edits, explicit retry
with the same operation identity, and post-save refresh/callback failures.

Current-source translation CI run `38509817847` completed successfully.

## Remaining acceptance

The cause of repeated same-port session loss on 3185 remains unproven. This
change is an editor recovery mitigation, not evidence that session continuity
has been repaired. No cookie, secret, revocation or authorization policy changed.

No application server was started or restarted, no shared credentials were
reset, and no invoice or delivered accounting history was changed. Full server
build validation remains pending: local swap was almost exhausted, and
current-source production regression CI run `38509817942` was pending at audit.

On an authorized smoke run, sign in separately on canonical ports 3185 and
23185. Inspect the actual session before and after draft selection, save,
reload and navigation. On an owned draft, expire the session, verify that edits
remain visible, sign in again, and explicitly retry. Verify one persisted save
and stable ledger postings on repeat. Also complete discount removal,
permission/lifecycle/export protection, portal and signed true-up output checks.
Inspect the actual session in the exact Open Review pane; its reported account
alone does not establish a valid browser session. Preserve delivered fixtures.

## Draft Implementation verification — 2026-10-14

Current source includes the missing-session guard from `8e3ef4fd9ab1` and its
follow-up. In `updateInvoiceManualItems`, the authentication wrapper rejection
is converted to JSON-safe `UNAUTHENTICATED`; if the wrapper authenticated but
the next session lookup has no user ID, the action returns the same code before
creating a database connection or querying an invoice. Invoice-update
permission failure remains `PERMISSION_DENIED` and also exits before invoice
queries. No auth policy or cookie behavior was changed.

The editor keeps expanded and collapsed draft values and pending removals after
an auth rejection. It displays the reauthentication prompt and only retries
after the operator clicks **Retry save**. The retry reuses its operation ID and
revision; no financial save is automatically replayed. The server action's
confirmed invoice response marks persistence complete before client refresh or
callback work, so a later refresh failure is reported as saved.

Cookie tests confirm the intentional separation: development on port 3185 uses
`authjs.session-token.3185`; production review on port 23185 uses
`authjs.session-token`. Auth tests also cover durable session creation,
revocation checks on every JWT callback, rolling expiry extension, expired
session handling, and retaining the cookie while durable state is temporarily
unavailable. A valid `UserSession` row is required for authority. Ordinary
sign-in creates it; password-reset completion has no evidenced revocation call.
These observations do not identify the reported session-loss cause.

### Checks run on this source

- Billing action, editor, and lifecycle guard tests: 30 passed across
  `invoiceModification.manualRecurringGuard.test.ts`,
  `ManualInvoices.expandedSave.test.tsx`, and
  `invoiceAdjustmentEditability.test.ts`. This includes both unauthenticated
  action paths, zero invoice queries/mutations on rejection, permission denial,
  expanded and collapsed draft retention, removal retention, same-operation
  explicit retry, committed-save refresh failure, and the paid, cancelled,
  finalized, exporting, and exported lifecycle guards.
- Auth cookie/session/revocation tests: 20 passed across three files.
- Durable `UserSession` tests: 4 passed.
- Billing package build and billing/auth TypeScript checks: passed.
- Server TypeScript check: incomplete; `tsc` exhausted its default 4 GiB heap
  and exited 134. No production build was attempted because swap was exhausted
  and workspace disk usage was 93% during resource inspection.
- No application server was started. No delivered invoice or retained smoke
  fixture was changed.

### Live smoke handoff

Run this only during the authorized smoke phase, after its operator starts the
intended app services. Use the canonical hostname for both ports.

1. Sign in independently at
   `http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:3185`
   and
   `http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185`.
   Keep both origins on HTTP. In each exact browser pane, inspect that same
   origin's `/api/auth/session` response and record its user ID. The two
   services intentionally have separate sessions; do not inspect the other
   port's session endpoint from that pane.
2. On an owned draft, record the session response and invoice revision. Save an
   adjustment, then inspect the same-origin `/api/auth/session` after save,
   reload and navigation. Repeat after an idle interval and at expiry. A displayed QA
   identity without a user in the actual session response is not authenticated
   evidence.
3. With an owned draft and unsaved expanded and collapsed rows plus a pending
   removal, expire the session. Confirm the editor asks for sign-in and keeps
   the rows/removal. Reauthenticate at that exact same HTTP origin, return to
   the draft, and click **Retry save** once. Confirm the operation commits once and a
   repeated request does not duplicate the adjustment or ledger delta.
4. In the exact Open Review pane, inspect the actual `/api/auth/session` on
   that pane's current HTTP origin and verify the reviewer identity. Do not use
   the launcher identity as a substitute or restore the superseded QA-only
   account gate.
5. Finish discount removal and paid/cancelled/finalized/exported protection
   checks. Verify customer portal output and the signed contract-change true-up
   description and half-open period. Do not reset or unlock `INV-000063` or the
   retained `SMOKE457` fixtures.

Live acceptance remains pending until these checks pass on the repaired head.
