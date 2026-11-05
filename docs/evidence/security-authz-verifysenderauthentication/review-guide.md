# PR #4149 sender authentication repair

Review this guide against the commit SHA linked from the PR after publication. This guide contains repository-local checks for the repaired HEAD; earlier screenshots and smoke recordings are historical and are not evidence for this revision.

## Takeover repair: scheduled recovery

Review the native maintenance registration and the CE/EE schedule catalogs first. The previous revision defined the recovery handler after CE schedule convergence and only inside the server process. CE therefore never installed its cron, and the separate EE Temporal scheduler never saw its schedule registration. Directly calling recovery in a test did not establish automatic delivery.

`inbound-sender-confirmation-recovery` now runs every five minutes through the existing native maintenance catalog. CE installs its pg-boss schedule during convergence. The EE worker creates its Temporal schedule from the shared catalog and forwards execution to the registered server handler. Neither scheduling nor tenant selection requires co-managed participation. The selector limits work to active tenants holding pending, failed, or interrupted confirmation deliveries.

The CE converger and EE `setupSchedules` behavioral regressions both failed before this repair. They now assert the actual scheduler calls, including repeat setup. A real-database case creates a separate PSA tenant without co-managed participation, maps unsigned Microsoft MIME through the production mapper, observes a failed confirmation send, runs the registered maintenance fan-out, confirms mailbox possession, and verifies one comment attributed to that contact. Forged organization/authentication headers remain untrusted. The contact concurrency case pauses the first worker after message dedupe but before persistence, advances beyond its lease, starts a replacement, and verifies they still persist one comment.

Current verification:

- Server: **15 files, 240 tests passed**. This is the 12-file focused command below plus `src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`, `src/test/unit/jobs/ceMaintenanceSchedules.unit.test.ts`, and `src/test/unit/maintenanceJobFanout.unit.test.ts`.
- EE scheduler: `cd ee/temporal-workflows && npx vitest run --config vitest.no-docker.config.ts src/schedules/__tests__/setupSchedules.contract-cadence-replenishment.test.ts` — **3 tests passed**. Temporal schedule operations are stand-ins; this does not create a live Temporal schedule.
- Shared and co-managed typechecks, types and shared builds, and email-service build passed.
- Full server TypeScript check again exhausted its 8 GB V8 heap without a source diagnostic. The production build (`NODE_OPTIONS=--max-old-space-size=8192 NEXT_DIST_DIR=.next-review NEXT_BUILD_CPUS=1 NX_DAEMON=false npx nx build server --skip-nx-cache`) also exhausted its 8 GB heap and exited with SIGABRT after about seven minutes; no source diagnostic was emitted. Neither full-project check passed.

The app server was not started. These checks establish scheduler registration and handler behavior through stand-ins and the local database. Live provider, DNS, browser, and deployed scheduler operation remain unverified. Human Review Approval is still required.

## Earlier repair: native contact confirmation recovery and redemption

The unsigned Microsoft requester-contact path no longer depends on the optional `coManagedInboundCommentSeam`; native ingestion queues the contact confirmation directly when that seam is absent. Its five-minute delivery-recovery job is registered independently of the co-managed capability and scans only tenants with pending/failed/sending sender-confirmation intents. Contact lookup excludes inactive contacts; the registered contact is checked again before sending and during redemption, and `TicketModel.createComment` rejects an inactive contact at persistence.

Contact redemption holds a PostgreSQL transaction advisory lock for the confirmation source across claim, native admission, and comment persistence. Concurrent/stale retries serialize and re-run normal message dedupe; if a process stops after the comment transaction commits but before confirmation finalization, the retry resolves the existing comment instead of inserting another. The lock prevents a slow original redemption and stale replacement from persisting concurrently.

Additional behavioral cases in `server/src/test/integration/emailServiceCoManagedInbound.integration.test.ts` cover Microsoft MIME ingestion with the comment seam absent for a PSA tenant, a persisted comment followed by simulated process interruption and successful deduped retry, overlapping confirmations, and contact deactivation between request and approval with no comment or watch-list mutation. `server/src/app/api/co-managed/inbound-confirmation/route.test.ts` exercises anonymous contact confirmation page/POST behavior and same-origin rejection. These tests use the local DB and provider stand-ins; they are not live Microsoft interoperability or browser tests.

Latest focused rerun after this repair: `cd server && npx vitest run src/test/integration/emailServiceCoManagedInbound.integration.test.ts src/app/api/co-managed/inbound-confirmation/route.test.ts` — **2 files, 17 tests passed**. `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p shared/tsconfig.json`, co-managed package typecheck, and `npm run build:shared` passed. The full server typecheck exhausted the 8 GB V8 heap after about 253 seconds without a TypeScript diagnostic. `NX_DAEMON=false npx nx build server --skip-nx-cache` reached the Next.js production build worker, which exhausted the 8 GB V8 heap after about six minutes; no source diagnostic was emitted. The app server was not started.

## Read first

1. Review [the native requester contact gate](../../../shared/services/email/processInboundEmailInApp.ts) and [contact confirmation redemption](../../../packages/co-managed/src/inboundSenderConfirmation.ts) first. A valid reply token alone cannot authorize an arbitrary From; unsigned contact replies wait for a one-time link to the matched ticket contact's registered email, then re-run native admission and persist with contact attribution.
2. Legitimate Microsoft internal replies use an expiring authenticated confirmation to the matched active user's registered mailbox. A Graph emulator-backed ingestion test fetches forged `Sender`/`From` and success-claim headers, runs MIME mapping and real DB admission, confirms that no comment exists before approval, then verifies Alice authored exactly one persisted comment.
3. Gmail, Microsoft, and IMAP co-managed internal replies use the same confirmation path. Approval is bound to tenant, intended actor, reply token, provider/message identity, exact content digest, and 15-minute expiry; it re-runs tenant, relationship, audience, grant, and permission admission. Concurrent redemption is atomically claimed. A claim interrupted before or after the idempotent comment write becomes retryable after a 60-second lease, while an active claim remains protected.
4. Forged MIME `From`, `Sender`, `Authentication-Results`, `AuthSource`, or `AuthAs` never grants internal identity. Independently verified aligned DKIM is evidence for the signing domain and signed content only; it does not establish an exact mailbox.
5. An unsigned Microsoft requester reply matching an active ticket contact is held without a comment and confirmed through a one-time link sent to that contact's registered email. Redemption re-runs normal native admission and persists as the contact. This works for PSA tenants without co-managed participation, and delivery recovery is registered independently of that capability. Contact inactivity is rechecked before send and redemption and at comment persistence. Delivery failures are retryable; stale `sending` claims recover after 60 seconds with attempt fencing. A provider-accepted send can produce a duplicate email if finalization was interrupted, while comment persistence remains idempotent.

## Evidence matrix

| Mode | Evidence used for actor | Result when evidence is insufficient |
|---|---|---|
| Gmail | OAuth-fetched Gmail message; ordered duplicate Authentication-Results retained for diagnostics; original RFC 822 bytes independently checked for DKIM. Gmail API exposes headers without provenance, so `mx.google.com` and first-header position alone are not trusted. | Matched active internal user receives an owner confirmation; unmatched candidate is quarantined. Aligned verified DKIM can support contact attribution only. |
| Microsoft | Graph `sender` derives from incoming `Sender`, falling back to `From`; Graph OAuth authenticates access to the receiving mailbox only. Neither is author proof. | Matched active internal candidate receives authenticated confirmation; no candidate, expiry, mismatch, or revoked authorization means no comment. |
| Microsoft unsigned requester contact | Message claims only; contact candidate is selected from the ticket's tenant/client and registered contact address. | Confirmation link goes only to that registered address. Until POST redemption, no attributed comment exists; altered content, wrong contact, expired/replayed token, and unmatched contacts cannot write. |
| Generic IMAP | Authenticated account identifies the fetched mailbox, not the author. Receiver assertions are not trusted without a configured, verified strip/prepend boundary. Original MIME is independently checked for DKIM. | Matched active internal user receives owner confirmation; unmatched candidate is quarantined. Aligned verified DKIM can support contact attribution only. |
| Intra-organization | Provider fetch plus message claims; no independent author mailbox signal. Organization-looking headers are not trusted. | Confirmation or refusal. |
| Unsigned | From/Sender claims only; no DKIM proof or independent mailbox signal. | Owner confirmation or refusal. |
| Forwarded | Original signature can be independently checked if preserved; forwarding changes may break it. Forwarded `From`, auth headers, and ARC do not grant identity here. | Owner confirmation for a matched active user; otherwise refusal. |

No raw Authentication-Results, AuthSource, or AuthAs header is used as evidence, even when its authserv-id appears provider-like. Gmail duplicate fields remain ordered and visible for diagnostics, but Gmail API does not provide provenance that lets this worker distinguish a receiver assertion from a copied header. The production MIME verifier checks DKIM over original bytes against DNS; an aligned signature can support contact attribution only, never an internal actor. Microsoft Graph sender is message-derived per [Microsoft's MIME conversion specification](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcmail/07da79f6-8d3f-4021-b9fc-ee89af0fabad); receiving-mailbox OAuth does not attest to the message author. No current provider path establishes an independent author mailbox identity. This supersedes all earlier guide and fact statements that Graph sender was authenticated mailbox proof.

## Repository verification

Focused behavioral run (real DB admission/comment path; mocks around email-service boot and outbound confirmation transport):

```sh
cd server
npx vitest run --config vitest.config.ts \
  ../shared/lib/email/__tests__/senderAuthVerification.test.ts \
  ../shared/services/email/__tests__/senderAuthenticationIngestion.test.ts \
  ../shared/services/email/__tests__/processInboundEmailInApp.coManagedTokens.test.ts \
  ../shared/services/email/__tests__/processInboundEmailInApp.test.ts \
  ../shared/services/email/__tests__/processInboundEmailInApp.additionalPaths.test.ts \
  ../shared/services/email/__tests__/processInboundEmailInApp.autoCreateContact.test.ts \
  ../shared/services/email/__tests__/processInboundEmailInApp.inboundRules.test.ts \
  src/test/integration/emailServiceCoManagedInbound.integration.test.ts \
  src/test/unit/email/GmailAdapter.listMessagesSince.test.ts \
  src/app/api/co-managed/inbound-confirmation/route.test.ts \
  src/test/unit/middleware.apiKeyAuth.test.ts \
  src/test/unit/T010.serviceSessionGates.test.ts
```

Result on the repair worktree: **12 files, 155 tests passed**. It covers Graph emulator ingestion and confirmation to one comment, Gmail adapter and IMAP MIME ingestion followed by confirmation then one comment, unsigned and forwarded IMAP confirmation, forged Gmail-looking headers, Microsoft-looking `AuthSource`/`AuthAs` and duplicate auth-result headers, wrong approver, unrelated tenant, refusal with zero comment writes, contact attribution, failed confirmation delivery followed by recovery, and concurrent stale-send recovery. DKIM tests use generated signatures and an injected DNS-key resolver, including body tampering, From mismatch, invalid signature, DNS lookup failure, fully covered signatures, and `l=` signatures with attacker-appended unsigned body bytes. Only fully covered aligned signatures support contact attribution.

Broader webhook regression: `cd server && npx vitest run --config vitest.config.ts src/test/integration/inboundEmailInApp.webhooks.integration.test.ts --reporter=dot` — **1 file, 47 tests passed**. Positive contact fixtures pass typed evidence from independent original-byte DKIM verification; raw DMARC claims cannot establish an internal author or reopen a ticket. Previously unauthenticated unmatched reply-token fixtures now quarantine before comment/watch-list writes; valid contact fixtures continue to test threading, attachments, and idempotency. This suite is separate from the co-managed confirmation scenarios above.

Follow-up for this review revision: the replaced Graph-trust fixture is now a provider-to-persistence emulator scenario. It seeds a message with forged `Sender`/`From`, provider-looking `AuthSource`/`AuthAs`, duplicate success-claim headers, and a forged RFC `Message-ID` in the Graph emulator, fetches its RFC 822 source through the production `MicrosoftGraphAdapter`, maps the MIME with the production ingestion mapper, and passes that result to real DB co-managed admission and comment persistence. It asserts zero comments before authenticated confirmation and exactly one comment by Alice after confirmation. The same DB admission test drives Gmail through `GmailAdapter.getMessageDetails` with a stubbed Gmail API and IMAP through the production RFC 822 MIME mapper; these exercise provider mapping plus real admission, not a live Gmail service or IMAP server. The separate Graph emulator smoke suite exercises actual Graph HTTP fetch and MIME conversion.

Confirmation edge coverage: expiry and payload/content tampering are refused; revoked work grants are rechecked at redemption; concurrent redemption returns one successful result and creates one comment. Recovery integration cases expire a claim before writing and after a persisted idempotent write, then verify retry completes with exactly one comment; a fresh active claim remains non-redeemable. Route tests check authenticated intended-user session and same-origin POST, preserve the original confirmation callback through the `/auth/msp/signin` destination, and make the callback usable for approval. Route persistence is mocked; the approval service and both recovery windows use the real-database integration test. Middleware behavior tests send requests through the actual middleware: the exact confirmation path reaches the route, while an unrelated API remains 401-protected. Provider assertions remain ordered diagnostics; legacy serialized boolean trust flags are accepted during queue transition but ignored by admission.

Confirmation API route: **1 file, 3 tests passed**. Co-managed package suite: **19 files, 210 tests passed**. Graph emulator suite: **11 files, 116 tests passed**. These runs cover the route's intended-user/same-origin checks, callback return path, stale versus active confirmation rendering, admission and writer behavior, and the emulator's Graph message flow.

Additional local checks:

- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p shared/tsconfig.json` — passed after final evidence-type changes.
- `npm run typecheck --workspace=@alga-psa/co-managed` — passed.
- `npm run test --workspace=@alga-psa/co-managed` — 19 files, 210 tests passed, including the confirmation-required admission outcomes.
- `npm run build:shared` — passed.
- `NX_DAEMON=false npx nx build email-service --skip-nx-cache` — passed.
- Final-revision `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p server/tsconfig.json` — not completed; the full server TypeScript project exhausted the 8 GB V8 heap after about 90 seconds without a TypeScript diagnostic.
- Final-revision `NODE_OPTIONS=--max-old-space-size=8192 NX_DAEMON=false npx nx build server --skip-nx-cache` — not completed; the Next.js production build worker exhausted its 8 GB V8 heap after about 10 minutes. No source diagnostic was produced.
- `NODE_OPTIONS=--max-old-space-size=8192 npx nx build server --skip-nx-cache` — did not complete: Next.js production build worker exhausted the 8 GB V8 heap. No source diagnostic was produced. The app server was not started.
- `npm run build --workspace=@alga-psa/emulator-msgraph` — passed. `npm run test --workspace=@alga-psa/emulator-msgraph` — 11 files, 116 tests passed. This exercises the repository Graph emulator itself; the provider-to-persistence test separately exercises the repaired adapter against that emulator.

## Fidelity and remaining checks

The focused admission integration uses a real local test database and real co-managed admission/comment writer. Graph source fetch uses the in-process wire emulator, not a live tenant. Gmail adapter API responses and outbound confirmation delivery are test stand-ins; IMAP exercises production raw MIME mapping but does not connect to GreenMail. The Microsoft emulator's generated Graph sender follows the modeled incoming `Sender` with fallback to `From`; it does not reproduce all Exchange transport normalization. DKIM verification uses maintained `mailauth`; cryptographic verification tests use generated signatures and injected DNS keys (or DNS failure), while runtime verification uses system DNS. No live DNS/provider interoperability test was run here.

Compatibility tradeoff: co-managed internal replies from all three integrations require an authenticated mailbox confirmation before a comment is written, so delivery is delayed. Unsigned or forwarded messages without usable aligned DKIM cannot receive automatic contact-domain attribution; when no authenticated confirmation candidate is available they remain quarantined. This preserves a usable confirmation path while rejecting automatic attribution that the provider evidence cannot establish.

The prior statement above that unsigned messages without aligned DKIM have no contact confirmation option is superseded for requester contacts: Microsoft replies that match the active ticket contact can be confirmed at that contact's registered email. This is a manual mailbox-possession step and may delay comments; arbitrary From addresses do not receive a confirmation or create a comment even if they possess a reply token. Confirmation delivery result failures stay retryable. Stale send claims are retried after 60 seconds; if the provider accepted mail before interruption, the same expiring link may be delivered twice.

Boundary fixes on this repair revision: the exact confirmation API route is exempt from middleware's API-key presence check, while handler actor/session and same-origin checks remain active. The anonymous sign-in link targets `/auth/msp/signin` and carries the original callback. DKIM `l=` signatures that leave body bytes unsigned are rejected for contact attribution even when cryptographic verification and domain alignment pass. Both service and confirmation-page loader allow stale redemption retry only after the shared 60-second claim lease.

The app server and browser/manual review were intentionally not started for this repair. Reviewers should inspect the contact route's mailbox-link/same-origin POST boundary, the active ticket-contact re-resolution, and the existing authenticated internal-user callback path, then validate both experiences in a later live review step. No prior screenshots should be attributed to this HEAD.

## Publication record

- Exact PR head SHA and publication time are recorded in the PR description alongside this guide after publication.
- PR: https://github.com/Nine-Minds/alga-psa/pull/4149
- External CI: `gh pr checks 4149` reported no checks for the pushed repair when queried. Recheck the PR for later runs; no external CI was awaited as part of this assignment.

## Draft Implementation rerun

At the starting revision `dc3735ab943e16e1bfb78b631c076039a671c61d`, the focused commands above were rerun:

- Provider/admission/confirmation/middleware: **12 files, 153 tests passed**.
- `src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`: **47 tests passed**.
- `npm run test --workspace=@alga-psa/co-managed`: **19 files, 210 tests passed**.
- `npm run typecheck --workspace=@alga-psa/co-managed`, `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p shared/tsconfig.json`, `npm run build:shared`, `npm run build --workspace=@alga-psa/emulator-msgraph`, and `npm run build --workspace=email-service`: passed.

The confirmation flow covers successful Gmail adapter, Microsoft Graph emulator, and IMAP MIME ingestion followed by authenticated confirmation and exactly one persisted comment. The integration tests include intra-organization, unsigned, and forwarded cases; they use generated DKIM signatures with controlled DNS-key fixtures, a Graph emulator, Gmail API stand-ins, and production IMAP MIME mapping. They are not live provider, live DNS, or browser interoperability evidence. Raw provider claims remain diagnostics only, and aligned DKIM supports contact-domain attribution only when the complete body is signed.

`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p server/tsconfig.json` was attempted and exhausted the 8 GB V8 heap without a TypeScript diagnostic. `NODE_OPTIONS=--max-old-space-size=8192 npx nx build server --skip-nx-cache` produced no build progress for over 13 minutes while the host had exhausted swap; it was interrupted. Treat the full server build as incomplete due to environment resource pressure, not a source failure. The app server was not started.
