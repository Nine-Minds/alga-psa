# Security: delivery provider notification projection

Ticket: `alga-2026-0003078`

This spec records the mitigation already prescribed by the security review on PR #4024. It does not expand the review's design.

## Findings

1. Sponsor notifications authorized the recipient but discarded the returned `redactedFields`, allowing routing, email, and in-app messages to disclose fields hidden from interactive reads.
2. Recovered sponsor routing email used the address captured in the outbox even if the authorized sponsor user had changed addresses.

## Required behavior

- Keep the notification recipient's read authorization result, including per-recipient redactions, with the ephemeral delivery projection. Do not store that projection in the outbox.
- Build sponsor routing, ticket email, and in-app notification content from canonical field aliases and the current redaction projection. Suppress comment body, previews, and related conversation content when conversation fields are hidden.
- Recompute authorization and redactions on each delivery attempt, including recovery and retries.
- Resolve sponsor users from `payload.principalId` in `payload.sponsorTenant` at delivery time, batch-load current users, and require an active internal identity before delivery.
- Use normalized current `users.email` for sponsor email only after authorization succeeds. Skip email if the current address is unavailable while retaining the captured `ledgerRecipient` for claiming and finishing the original outbox row.
- Preserve customer-recipient behavior.

## Verification

Behavioral regression coverage should exercise recipient-specific redactions, conversation suppression, fresh policy evaluation on retry, changed sponsor email recovery, unavailable or inactive sponsor identities, and correct completion of the original ledger row. Run the co-managed regression tests and typecheck/build applicable to changed packages.

### Mitigation-round results (2026-11-03)

- The workflow card records PSA ticket `alga-2026-0003078`, link state `linked-existing`, and ticket ID `cd315622-39a9-4ec1-92a6-62c7e2771dd2`. The exact `psa-ticket-linked` and `psa-ticket-id-recorded` template commands returned exit 0 when run with these current card values. The workflow board note records that these were rendered command reruns; its verifier cannot attach a new attempt to the earlier Link PSA Ticket step while Draft Implementation is current.
- `packages/co-managed` focused regression tests passed: 52 tests across `admitReplyToken.test.ts`, `routingDeliveryReauth.test.ts`, and `sharedWorkProjection.test.ts`. Its `npm run typecheck` passed.
- Four targeted cases in `server/src/test/integration/ticketCommentAttachmentsIntegration.test.ts` passed, covering delayed sponsor email retry after attachment reconstruction, independent per-recipient comment email, and routing email recovery. The persisted in-app payload suite `internalCommentMentionAudience.test.ts` passed all 6 tests.
- Server typecheck passed with `NODE_OPTIONS=--max-old-space-size=12288`; the 8192 MiB attempt exhausted the heap.
- No repository or workflow-template mechanism named `security-finding-resolved` was available on this card, so external finding acceptance remains unverified.

### Draft implementation rerun (2026-11-03)

- Current-checkout package regressions passed: 39 tests across `routingDeliveryReauth.test.ts` and `sharedWorkProjection.test.ts`; the routing suite now separately rejects missing and non-internal sponsor identities in addition to inactive and addressless users.
- Current-checkout server integration coverage passed: 4 selected cases in `ticketCommentAttachmentsIntegration.test.ts` (including both recipient orders, delayed email policy tightening after attachment reconstruction, and routing recovery); persisted in-app payload coverage passed all 6 `internalCommentMentionAudience.test.ts` cases.
- `packages/co-managed` typecheck passed. Server typecheck passed with `NODE_OPTIONS=--max-old-space-size=12288`; the default 4 GiB run exhausted the heap before diagnostics.
- Code inspection found the `/msp/co-managed` overview action correctly enforces capability, admission, role, and then calls the authorized overview reader. No source-level defect or independent reproduction of the reported POST 500 was found; no isolated smoke fixture was applied because the available shared fixture layers do not define finding-specific sponsor/customer identities.
- `browser.recordStart` could not be invoked: the browser-control/recording tool is not exposed in this session, and the `algadev` command is unavailable. The app server remained stopped, so required video and live comment delivery remain unverified.
- `security-finding-resolved` is unavailable in this checkout/tooling session. External finding acceptance remains unverified.

### Isolated fixture and production recovery follow-up

- Added the fixture-owned `notification` layer with a dedicated customer workspace, sponsor/customer clients and boards, two active sponsor identities, an active relationship, escalated shared ticket/reference, and separately assigned user-targeted read bundles. One recipient hides ticket title, conversation, and assignee fields; the other has no redactions. `--only notification` verifies the base prerequisite without depending on L1a disposable-client state, and supports layer-owned apply/reset.
- Applied, reset, reapplied, and verified the notification fixture against the configured database. Verification reported all four fixture areas present. The app server remained stopped.
- Added a migrated-PostgreSQL regression using the production `createCoManagedDeliveryProvider().pendingRouting` and `deliverRouting` path: a rate-limited attempt leaves the original row failed; the test changes the real sponsor user's email and assigned bundle policy; recovery sends to the normalized current email with current redactions rendered, and completes the original captured ledger row after two attempts.
- Live comment delivery and required browser video remain pending. `browser.recordStart` is not exposed by the available browser tooling in this session. The `/msp/co-managed` POST 500 was not independently reproduced and no related code defect was established. `security-finding-resolved` remains unavailable.

### Final checkout verification (2026-11-03)

- No implementation gap was found in the checked-out mitigation: routing recovery batch-loads sponsor identities by sponsor tenant and `payload.principalId`, rejects missing/inactive/non-internal users, normalizes current sponsor email, reauthorizes on each recovery read, and retains `ledgerRecipient` for claim/finish. Comment sends reauthorize again after attachment reconstruction; queued retries persist the original serializable parameters and re-render after reauthorization rather than replaying rendered mail.
- `npm -w packages/co-managed test -- --run src/__tests__/routingDeliveryReauth.test.ts src/__tests__/sharedWorkProjection.test.ts` passed (39 tests), and `npm -w packages/co-managed run typecheck` passed. `NODE_OPTIONS=--max-old-space-size=12288 npm -w server run typecheck` passed.
- Full `ticketCommentAttachmentsIntegration.test.ts` plus `internalCommentMentionAudience.test.ts` passed (69 tests) against the migrated PostgreSQL test database. Coverage includes both sponsor recipient orders, redacted and unredacted content, delayed attachment reconstruction with tightened policy, routing recovery after identity/address and policy changes, captured-ledger completion, persisted in-app payloads, and live PgBoss recovery to the SMTP emulator. The dedicated routing recovery regression captures a MIME message via Nodemailer's stream transport; it does not claim a live external SMTP delivery.
- `npm run fixtures:co-managed -- --only notification --verify` passed for the isolated customer/shared-ticket fixture and the two independent user-targeted sponsor policies. The fixture was only verified in this run; it was not reset or altered.
- `/msp/co-managed` displays “Could not load co-managed clients.” when `getCoManagedClientOverviewAction` rejects. The action gates capability, sponsor admission, role permission, actor construction, then the overview read. With the app server intentionally stopped there are no request logs or HTTP reproduction to identify which step produced the earlier POST 500; repository inspection does not establish a code defect. Live reproduction remains an external dependency.
- `browser.recordStart` and any browser recording command were absent from the available tool catalog and `alga-dev` command help; this is a tooling limitation, not a repository implementation failure. No live browser/video validation or live co-managed comment delivery is claimed. No `security-finding-resolved` command/template was found in this checkout or available tooling, so external finding acceptance remains unverified.
