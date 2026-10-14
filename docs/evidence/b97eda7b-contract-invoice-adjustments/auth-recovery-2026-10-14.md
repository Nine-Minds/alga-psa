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

## Read-path recovery repair round — 2026-10-14

The repair adds an auth-only recovery state to capability loading, invoice line
loading, draft detail billing-profile loading, and the preview's
detail/summary/template reads. Each offers a new-tab
sign-in link and an explicit retry. Permission errors remain permission errors;
other returned action errors and ordinary request failures keep their existing
error path. Preview data from the currently selected invoice stays visible if a
same-invoice refresh fails. A new invoice selection clears the old preview and
immediately switches the manual editor identity; stale async reads from the
previous selection are ignored. On explicit line-read retry, expanded inputs
remain mounted and the fetched response does not overwrite the current draft.
Neither retry calls a financial mutation. Existing save retry still uses the
same operation ID and expected revision, and committed-save refresh errors
remain reported as committed.

Auth diagnostics now record safe reason codes for absent cookie, present-cookie
empty Auth.js session, missing identity claims, durable session missing,
revoked session, missing user, identity mismatch, and unavailable durable
lookup. Correlation uses only a validated `x-request-id` or
`x-correlation-id`; cookie values, JWTs, complete session payloads, and raw
lookup exceptions are not logged by these diagnostics. The Auth.js session
endpoint cannot distinguish signature/decoding failure from expiration or a
rejection that already returned an empty session, so a present-cookie empty
response is explicitly reported as that combined observable condition. Source
still expects the intentional port split: development 3185 uses
`authjs.session-token.3185`; production review 23185 uses
`__Secure-authjs.session-token`. The app server stayed stopped, so the effective
runtime values and the spontaneous invalidation cause remain unknown.

Behavioral verification on the repair source:

- Billing ManualInvoices/editor, draft detail, capability, and action/lifecycle
  suites: 40 passed. Includes
  read failure/retry with a retained expanded draft and no mutation, late
  response after reselection, same-operation save retry, pending removals,
  committed-save refresh handling, export/lifecycle rejection, and mutation
  transaction recalculation boundaries.
- Preview component suite under the server Vitest runner: 4 passed, including
  authentication recovery/retry and stale response rejection after reselection.
- Auth session/revocation suites: 18 passed; durable UserSession model suite: 5
  passed.
- `npm run test:i18n`: passed, including pseudo-locale regeneration and locale
  checks for de/es/fr/it/nl/pl/pt/sv.
- Current billing, auth, and DB package builds passed. Billing typecheck passed
  with an 8 GiB heap, auth typecheck with 3 GiB, and server typecheck with 11
  GiB. Server production build was not attempted; workspace disk usage was 93%.
  No application server was started.

## Required live handoff

Repair candidate: `a42d44e0de` (`fix(billing): serialize auth failures for invoice reads`). The supervised operator must roll that exact
candidate to canonical 23185 and verify the running build stamp before
acceptance. Run independent 3185 and 23185 login, save, reload, and reselection
checks; in each pane inspect same-origin `/api/auth/session`. Use an owned draft
to exercise controlled expiry with expanded and collapsed edits, a pending
addition and removal, then sign in and explicitly retry once. Verify operation
identity and no duplicate financial effect. Test failed read retry separately.

Launch Open Review from the actual workflow card and capture the card, host,
pane, origin, URL, and same-pane session response. The available handoff has a
direct 23185 browser pane (`2d721fdf-a50a-468b-bf39-54a65dfa0bd5`) that loaded
Billing, but it does not establish that this was the intended Open Review pane;
two Open Review attempts timed out and the serving build was `4571290674`.
Classify viewer/hub availability, remote-pane routing, application readiness,
and application authentication separately. The Alga Dev owner must inspect the
launcher/handoff code paths; do not attribute the timeout to invoice code.

On the verified candidate, complete PDF, portal, signed true-up explanation,
lifecycle, and accounting-export checks. Preserve `INV-000063` and delivered
`SMOKE457` fixtures; use owned editable fixtures for mutation. If spontaneous
session loss recurs, capture sanitized runtime cookie configuration, reason
code, and request ID. Do not claim any live checks passed in this server-stopped
implementation step.

## Review correction — 2026-10-14

Read actions now convert `withAuth` `AuthenticationError` rejections into a
JSON-safe `UNAUTHENTICATED` result before server-action transport sanitizes the
exception. This covers adjustment capability, invoice detail and line-item
reads, PO summary and resolved-template preview reads, billing profiles,
annotations, and converted-quote reads. The billing-profile reader now returns a
keyed permission denial, and the resolved-template reader preserves permission
denial instead of collapsing it to `null`.

The client checks permission/action errors before treating a line refresh as a
successful recovery, resets invoice identity before computing the retry state,
and keeps a failed post-commit refresh classified as a saved mutation. Draft
detail profile reads and source-quote preview reads ignore late failures from a
previous invoice selection. Read retry remains explicit and does not invoke an
invoice mutation.

Latest verification on source candidate `a42d44e0de`:

- Billing action/editor/lifecycle and auth-boundary suites: 47 passed across
  six test files. Actual exported actions were invoked with `withAuth` rejecting
  and returned JSON-safe results; UI tests cover serialized auth results,
  permission denial after recovery, preserved edits, and stale profile reads.
- Preview component suite: 6 passed under the server Vitest runner, including
  serialized auxiliary quote auth recovery and stale quote rejection after
  reselection.
- Auth/session and durable-session suites: 21 passed across three test files.
- Billing package typecheck passed with a 6 GiB Node heap; billing package
  build passed. `npm run test:i18n` passed all translation checks and 50
  localization tests. No new UI strings were added.
- The first default-heap billing typecheck exited 134 at Node's 4 GiB heap
  limit; the bounded rerun passed. No app server was started. Runtime cookie
  configuration and spontaneous invalidation cause remain unverified.

Review first: verify the JSON-safe auth classification and that capability,
detail, preview, and billing-profile read failures leave the selected invoice's
expanded/collapsed draft intact. Then perform the supervised live handoff above.
