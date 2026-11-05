# PR #4149 sender authentication repair

Review this guide against the commit SHA linked from the PR after publication. This guide contains repository-local checks for the repaired HEAD; earlier screenshots and smoke recordings are historical and are not evidence for this revision.

## Read first

1. Legitimate Microsoft replies now use an expiring authenticated confirmation to the matched active user's registered mailbox. A Graph emulator-backed ingestion test fetches forged `Sender`/`From` and success-claim headers, runs MIME mapping and real DB admission, confirms that no comment exists before approval, then verifies Alice authored exactly one persisted comment.
2. Gmail, Microsoft, and IMAP co-managed internal replies use the same confirmation path. Approval is bound to tenant, intended actor, reply token, provider/message identity, exact content digest, and 15-minute expiry; it re-runs tenant, relationship, audience, grant, and permission admission. Concurrent redemption is atomically claimed. A claim interrupted before or after the idempotent comment write becomes retryable after a 60-second lease, while an active claim remains protected.
3. Forged MIME `From`, `Sender`, `Authentication-Results`, `AuthSource`, or `AuthAs` never grants internal identity. Independently verified aligned DKIM is evidence for the signing domain and signed content only; it does not establish an exact mailbox.

## Evidence matrix

| Mode | Evidence used for actor | Result when evidence is insufficient |
|---|---|---|
| Gmail | OAuth-fetched Gmail message; ordered duplicate Authentication-Results retained for diagnostics; original RFC 822 bytes independently checked for DKIM. Gmail API exposes headers without provenance, so `mx.google.com` and first-header position alone are not trusted. | Matched active internal user receives an owner confirmation; unmatched candidate is quarantined. Aligned verified DKIM can support contact attribution only. |
| Microsoft | Graph `sender` derives from incoming `Sender`, falling back to `From`; Graph OAuth authenticates access to the receiving mailbox only. Neither is author proof. | Matched active internal candidate receives authenticated confirmation; no candidate, expiry, mismatch, or revoked authorization means no comment. |
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

Result on the repaired worktree: **12 files, 153 tests passed**. It covers Graph emulator ingestion and confirmation to one comment, Gmail adapter and IMAP MIME ingestion followed by confirmation then one comment, unsigned and forwarded IMAP confirmation, forged Gmail-looking headers, Microsoft-looking `AuthSource`/`AuthAs` and duplicate auth-result headers, wrong approver, unrelated tenant, refusal with zero comment writes, and contact attribution. DKIM tests use generated signatures and an injected DNS-key resolver, including body tampering, From mismatch, invalid signature, DNS lookup failure, fully covered signatures, and `l=` signatures with attacker-appended unsigned body bytes. Only fully covered aligned signatures support contact attribution.

Broader webhook regression: `cd server && npx vitest run --config vitest.config.ts src/test/integration/inboundEmailInApp.webhooks.integration.test.ts --reporter=dot` — **1 file, 47 tests passed**. Positive contact fixtures pass typed evidence from independent original-byte DKIM verification; raw DMARC claims cannot establish an internal author or reopen a ticket. This suite covers the ordinary native inbound webhook rules and is separate from the co-managed confirmation scenarios above.

Follow-up for this review revision: the replaced Graph-trust fixture is now a provider-to-persistence emulator scenario. It seeds a message with forged `Sender`/`From`, provider-looking `AuthSource`/`AuthAs`, duplicate success-claim headers, and a forged RFC `Message-ID` in the Graph emulator, fetches its RFC 822 source through the production `MicrosoftGraphAdapter`, maps the MIME with the production ingestion mapper, and passes that result to real DB co-managed admission and comment persistence. It asserts zero comments before authenticated confirmation and exactly one comment by Alice after confirmation. The same DB admission test drives Gmail through `GmailAdapter.getMessageDetails` with a stubbed Gmail API and IMAP through the production RFC 822 MIME mapper; these exercise provider mapping plus real admission, not a live Gmail service or IMAP server. The separate Graph emulator smoke suite exercises actual Graph HTTP fetch and MIME conversion.

Confirmation edge coverage: expiry and payload/content tampering are refused; revoked work grants are rechecked at redemption; concurrent redemption returns one successful result and creates one comment. Recovery integration cases expire a claim before writing and after a persisted idempotent write, then verify retry completes with exactly one comment; a fresh active claim remains non-redeemable. Route tests check authenticated intended-user session and same-origin POST, preserve the original confirmation callback through the `/auth/msp/signin` destination, and make the callback usable for approval. Route persistence is mocked; the approval service and both recovery windows use the real-database integration test. Middleware behavior tests send requests through the actual middleware: the exact confirmation path reaches the route, while an unrelated API remains 401-protected. Provider assertions remain ordered diagnostics; legacy serialized boolean trust flags are accepted during queue transition but ignored by admission.

Confirmation API route: **1 file, 3 tests passed**. Co-managed package suite: **19 files, 210 tests passed**. Graph emulator suite: **11 files, 116 tests passed**. These runs cover the route's intended-user/same-origin checks, callback return path, stale versus active confirmation rendering, admission and writer behavior, and the emulator's Graph message flow.

Additional local checks:

- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p shared/tsconfig.json` — passed after final evidence-type changes.
- `npm run typecheck --workspace=@alga-psa/co-managed` — passed.
- `npm run test --workspace=@alga-psa/co-managed` — 19 files, 210 tests passed, including the confirmation-required admission outcomes.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p server/tsconfig.json` — not completed: the full server TypeScript project exceeded the 8 GB V8 heap. A retry at 10 GB also exceeded the heap. This was resource exhaustion, not a reported TypeScript diagnostic.
- `npm run build:shared` — passed.
- `NX_DAEMON=false npx nx build email-service --skip-nx-cache` — passed; an earlier concurrent attempt hit an Nx daemon failure, so the successful retry disabled the daemon.
- `NODE_OPTIONS=--max-old-space-size=8192 npx nx build server --skip-nx-cache` — did not complete: Next.js production build worker exhausted the 8 GB V8 heap. No source diagnostic was produced. The app server was not started.
- `npm run build --workspace=@alga-psa/emulator-msgraph` — passed. `npm run test --workspace=@alga-psa/emulator-msgraph` — 11 files, 116 tests passed. This exercises the repository Graph emulator itself; the provider-to-persistence test separately exercises the repaired adapter against that emulator.

## Fidelity and remaining checks

The focused admission integration uses a real local test database and real co-managed admission/comment writer. Graph source fetch uses the in-process wire emulator, not a live tenant. Gmail adapter API responses and outbound confirmation delivery are test stand-ins; IMAP exercises production raw MIME mapping but does not connect to GreenMail. The Microsoft emulator's generated Graph sender follows the modeled incoming `Sender` with fallback to `From`; it does not reproduce all Exchange transport normalization. DKIM verification uses maintained `mailauth`; cryptographic verification tests use generated signatures and injected DNS keys (or DNS failure), while runtime verification uses system DNS. No live DNS/provider interoperability test was run here.

Compatibility tradeoff: co-managed internal replies from all three integrations require an authenticated mailbox confirmation before a comment is written, so delivery is delayed. Unsigned or forwarded messages without usable aligned DKIM cannot receive automatic contact-domain attribution; when no authenticated confirmation candidate is available they remain quarantined. This preserves a usable confirmation path while rejecting automatic attribution that the provider evidence cannot establish.

Boundary fixes on this repair revision: the exact confirmation API route is exempt from middleware's API-key presence check, while handler actor/session and same-origin checks remain active. The anonymous sign-in link targets `/auth/msp/signin` and carries the original callback. DKIM `l=` signatures that leave body bytes unsigned are rejected for contact attribution even when cryptographic verification and domain alignment pass. Both service and confirmation-page loader allow stale redemption retry only after the shared 60-second claim lease.

The app server and browser/manual review were intentionally not started for this repair. Reviewers should inspect the new route's authenticated actor checks and then validate the sign-in/confirmation experience in the subsequent live verification step. No prior screenshots should be attributed to this HEAD.

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
