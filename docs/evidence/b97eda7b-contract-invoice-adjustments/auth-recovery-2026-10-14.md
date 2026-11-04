# Invoice editor authentication recovery

Initial save-recovery revision: `8e3ef4fd9ab1aace63a5d523f2286edf47473848`, PR #3499.

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

## Mitigation round 5 — correlated safe diagnostics (2026-10-14)

Published candidate: `622bf81a760a271383c52a0194fb5708b41b5deb` (`fix(auth): attribute decoder rejection stages accurately`).
This mitigation commit series adds the diagnostic hardening and current-source
evidence below; it does not claim the earlier invoice recovery fixes were
authored in this round. The follow-up also ensures a `null` edge result followed
by a full-auth exception is attributed only to the full decoder.

The mounted invoice read and edit repairs described above were re-audited on
the current branch. Capability, client/service initialization, invoice details
and line items, billing profile and location attribution, preview view model,
PO summary, resolved template, annotations, and converted-quote reads all
classify serialized authentication failures for explicit sign-in/retry. Their
action boundaries preserve permission/lifecycle results, and read retries do
not submit mutations. The retry-identity regression covers both read-completion
orders, retains collapsed additions and pending removals over repeated retries,
ignores the old invoice's late response after reselection, and preserves the
explicit save operation ID. Existing post-commit refresh handling remains
classified as saved.

One diagnostics gap was corrected: JWT/Auth.js decoder exceptions had been
logged as raw error objects. Decoder fallback now records only safe reason codes
(`edge_session_decode_failed`, `full_session_decode_failed`) with the validated
request/correlation ID supplied by the existing logger. Behavioral tests assert
these reasons, durable revocation and lookup-unavailable reasons, and verify
that cookie/error payload text is absent from captured logs. This describes
observable rejection stages; it does not identify why the runtime session
became empty.

Fresh-source verification on this mitigation round:

- `packages/auth`: `npx vitest run src/lib/getSession.test.ts
  src/lib/session.test.ts` — 17 passed; auth typecheck and package build passed.
- `packages/billing`: six focused editor/action/capability/attribution/
  lifecycle files — 60 passed; billing typecheck and package build passed.
- `server`: `InvoicePreviewPanel.test.tsx` — 6 passed.
- `npm run test:i18n` — passed; 10 locales checked, no errors/warnings, all
  50 localization tooling tests passed, and no newly unwired components.
- Changed-file auth ESLint — 0 errors, 5 pre-existing warnings (`any` in test
  fixtures and global `process` recognition in this file).
- The full server typecheck and Next production build were not run. Host
  inspection showed 7.7 GiB free disk and 3.2 GiB free swap; no isolated build
  output was created. No app server was started or restarted.

Runtime and launcher evidence remain incomplete. The retained capture shows an
empty same-origin `/api/auth/session` after navigation while QA identity still
rendered, two Open Review timeouts during the same interval (causality
unproven), and a later direct 23185 browser pane serving build `4571290674`.
The actual Open Review pane/session and launcher handoff were not captured, and
no launcher source change was made. The next supervised run must record the
effective origin, environment mode, configured cookie name/options and cookie
presence (never its value), request/correlation ID, safe rejection reason, and
the ordered login/save/reload/reselect/separate-review-login sequence. It must
separately classify hub availability, pane routing/handoff, app readiness, and
application authentication. Direct browser login is not launcher verification.

The exact current candidate, `622bf81a760a271383c52a0194fb5708b41b5deb`, must be
deployed and its build stamp verified by the supervised operator before live
acceptance. Repeat controlled expiry and
spontaneous navigation-loss checks on canonical 3185 and 23185, same-operation
save/retry monetary parity, fresh PDF and portal true-up descriptions, and
lifecycle/export protections. Preserve `INV-000063` and delivered `SMOKE457`
fixtures. Until those checks pass, implementation verification is complete but
runtime acceptance remains pending.

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

## Historical live handoff — superseded candidate; checks remain applicable

This earlier handoff named `7bc86a28b4fe98c23f4728587002484171088a03`; that
SHA is historical and must not be deployed for acceptance. The authoritative
candidate is `622bf81a760a271383c52a0194fb5708b41b5deb`. The supervised operator
must deploy that exact SHA to canonical 23185 and verify its running build stamp
before acceptance. The remaining checks in this section are still required.
Run independent 3185 and 23185 login, save, reload, and reselection
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

Verification for the prior read-path repair on source candidate `a42d44e0deb4bb79c04bf723ae33637ffee3078e`:

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

## Follow-up review correction — 2026-10-14

The adjustment card now uses recoverable server-action wrappers for its client
and service reads as well as its capability read. An auth failure from any one
of the three produces the same explicit sign-in and retry UI; permission
denials remain distinct. Draft attribution reads now use recoverable location
loading and the existing recoverable billing-profile action. Their auth
failures show the read recovery prompt, and **Retry loading** reruns attribution
and invoice-detail reads. The line-read recovery guard preserves unsaved rows
while those requests settle; attribution state is reset by invoice identity so
an earlier selection cannot leave an expiry warning or options behind.

Prior focused verification on source candidate
`4dc4f344d90dadc8aeebbe9e62bfa2fef3310fd7`:

- 58 tests passed across the focused billing action, editor, capability,
  attribution recovery, and lifecycle suites. Coverage includes all three
  initial reads returning serialized auth failure, independent client/service
  expiry, explicit retry, permission-denial distinction, billing-profile and
  location attribution expiry, preserved draft edits, and no invoice mutation.
- Billing typecheck passed with a 6 GiB Node heap and billing package build
  passed. The app server stayed untouched.

The takeover repair below supersedes this candidate for supervised rollout.


## Historical repair record: repeated read recovery — 2026-10-14

Code candidate: `7bc86a28b4fe98c23f4728587002484171088a03`.

A repeated attribution failure could discard collapsed unsaved lines. When
attribution failed before a slower detail request succeeded, that successful
request cleared the shared recovery flag. The next retry then replaced the
editor draft with persisted rows, also undoing pending removals.

Draft preservation now depends on the retry attempt for the selected invoice,
not an authentication flag. Detail and attribution reads manage their own
expiry state. Every same-invoice recovery retry preserves draft rows; selecting
a different invoice establishes a new initial read. Explicit save recovery
continues to reuse the same operation ID and expected revision.

The deferred-response regression failed on the inherited source in the
attribution-first order. Both completion orders now pass, preserving collapsed
additions and removals across two retries, issuing no financial mutation during
read recovery, and submitting the same payload and operation identity after a
subsequent save authentication failure.

Validation on this code:

- 60 focused billing tests passed across six files: action serialization,
  manual-write guards, expanded/collapsed edits, capability, billing-profile
  reads, and lifecycle restrictions.
- Six preview tests passed under the server Vitest runner.
- Billing typecheck passed with a 6 GiB heap; billing package build passed.
- Changed-file ESLint exited 0 with warnings and no errors. No UI strings changed.

No app server was started or restarted, no financial fixtures were modified,
and no authentication policy changed. Full Next production build and live
acceptance are not claimed. Workspace disk remained 93% used. Spontaneous
session-loss cause, effective runtime cookie configuration, and the exact Open
Review pane/session remain unresolved. Use the supervised procedure above with
this code candidate before claiming production acceptance.

## Historical checkout verification — 2026-10-14

At that earlier verification, the checkout was `449eaaee41b36655bd86872ca1e49c89482ccb8b`,
matching `origin/feature/contract-invoices-automatic-adjustments-and-disc`.
Commit `7bc86a28b4` is present and its repeated-recovery draft-preservation
repair is unchanged. No implementation gap was demonstrated, so that round
made no application-code changes. At that time, the plan's supervised
candidate pointed to this checkout SHA; the authoritative current candidate
is listed in Mitigation round 5 above.

Commands run against this revision:

- In `packages/billing`, `npx vitest run` for
  `ManualInvoices.expandedSave.test.tsx`,
  `DraftInvoiceAdjustmentsCard.authRecovery.test.tsx`, and
  `DraftInvoiceDetailsCard.billingProfile.test.tsx`: exit 0, 38 tests passed.
- In `server`, `npx vitest run
  ../packages/billing/src/components/billing-dashboard/invoicing/InvoicePreviewPanel.test.tsx`:
  exit 0, 6 tests passed.
- In `server`, `npx vitest run` for billing-profile auth serialization,
  invoice editability, and manual recurring/lifecycle guards: exit 0, 22 tests
  passed, including paid/cancelled/finalized/exporting/exported protections.
- In `packages/auth`, focused `getSession`, durable revocation, session expiry,
  and cookie tests: exit 0, 28 tests passed.
- `npm run typecheck` in `packages/billing` and `packages/auth`: both exit 0.
- `npm run build` in `packages/billing`: exit 0 (tsup package build).
- Targeted billing ESLint: exit 0, 0 errors and 144 warnings.
- Translation validation, translation audit, and untranslated UI scan: exit 0;
  no new unwired components were found.

The full server typecheck and Next production build were not run. The checkout
filesystem is 93% used with 7.7 GiB available and swap is nearly exhausted;
existing isolated build directories were left untouched. No app server was
started. Runtime cookie settings on ports 3185 and 23185, spontaneous session
loss cause, supervised deployment/build stamp, exact Open Review pane and
session, and live invoice lifecycle/output acceptance remain unverified.
Historical evidence reports the direct 23185 review service serving
`4571290674`; that revision was not rechecked in this round.
