# PR #4149 sender authentication repair

Review this guide against the commit SHA linked from the PR after publication. This guide contains repository-local checks for the repaired HEAD; earlier screenshots and smoke recordings are historical and are not evidence for this revision.

## Read first

1. Legitimate Microsoft replies use the authenticated Graph message `sender` mailbox. The end-to-end database test verifies the selected co-managed actor and exactly one persisted comment, including replay.
2. Legitimate Gmail and generic IMAP replies remain supported through an expiring confirmation to the matched active user's registered mailbox. The confirmation is signed and bound to tenant, intended actor, reply token, provider/message identity, exact content digest, and a 15-minute expiry. Approval re-runs tenant, relationship, audience, and permission admission. Replay uses the existing idempotent comment operation.
3. Forged MIME `From`, `Authentication-Results`, `AuthSource`, or `AuthAs` never grants internal identity. Independently verified aligned DKIM is evidence for the signing domain and signed content only; it does not establish an exact mailbox.

## Evidence matrix

| Mode | Evidence used for actor | Result when evidence is insufficient |
|---|---|---|
| Gmail | OAuth-fetched Gmail message plus ordered receiver results for diagnostics; original RFC 822 bytes independently checked for DKIM. Gmail API does not expose the sender's authenticated mailbox. | Matched active internal user receives an owner confirmation; unmatched candidate is quarantined. |
| Microsoft | OAuth Graph `sender` property as provider-returned mailbox evidence, with sender identity resolved in the authorized tenant. MIME authentication and Exchange headers are diagnostics only. | No matching active authorized mailbox is admitted; tenant and permission gate refuses before comment write. |
| Generic IMAP | Authenticated account identifies the fetched mailbox, not the author. No configurable receiver assertion is trusted by default. | Matched active internal user receives owner confirmation; unmatched candidate is quarantined. |
| Intra-organization | Same Graph sender evidence or authenticated owner confirmation. Organization-looking headers are not trusted. | Confirmation or refusal. |
| Unsigned | Provider evidence may still identify a Graph sender; otherwise none. | Owner confirmation or refusal. |
| Forwarded | Original signature can be independently checked if preserved; forwarding changes may break it. Forwarded `From`, auth headers, and ARC do not grant identity here. | Authenticated provider mailbox or owner confirmation; otherwise refusal. |

Gmail's receiver-generated domain result can continue ordinary contact matching under its ordered receiver boundary. That signal is never used for internal-user attribution. Microsoft Graph sender evidence is independent of the MIME headers; it is not inferred from DKIM. Generic IMAP receiver assertions require an explicitly established receiver strip/prepend boundary before they can be used; this change does not assume one exists.

## Repository verification

Focused behavioral run (real DB admission/comment path; mocks around email-service boot and transport):

```sh
cd server
npx vitest run --config vitest.config.ts \
  ../shared/lib/email/__tests__/senderAuthVerification.test.ts \
  ../shared/services/email/__tests__/senderAuthenticationIngestion.test.ts \
  ../shared/services/email/__tests__/processInboundEmailInApp.coManagedTokens.test.ts \
  src/test/integration/emailServiceCoManagedInbound.integration.test.ts
```

Result: **9 files, 127 tests passed**. This combined run includes the four commands above plus `processInboundEmailInApp.test.ts`, `additionalPaths.test.ts`, `autoCreateContact.test.ts`, `inboundRules.test.ts`, and `emailServiceContactLookup.integration.test.ts`. It covers Graph actor success and replay, Gmail and IMAP confirmation then one comment, unsigned and forwarded IMAP confirmation, forged Gmail-looking headers, wrong approver, unrelated tenant, refusal with zero comment writes, and contact attribution. DKIM tests use generated signatures and an injected DNS-key resolver, including body tampering, From mismatch, and invalid signature.

Contact-attribution and adjacent inbound regressions: **5 files, 64 tests passed** (`processInboundEmailInApp.test.ts`, `additionalPaths.test.ts`, `autoCreateContact.test.ts`, `inboundRules.test.ts`, and `emailServiceContactLookup.integration.test.ts`). Fixtures now carry typed receiver evidence instead of asking runtime code to trust raw Authentication-Results text.

Additional local checks:

- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p shared/tsconfig.json` — passed.
- `npm run typecheck --workspace=@alga-psa/co-managed` — passed.
- `npm run test --workspace=@alga-psa/co-managed` — 19 files, 210 tests passed, including the confirmation-required admission outcomes.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p server/tsconfig.json` — not completed: the full server TypeScript project exceeded the 8 GB V8 heap. A retry at 10 GB also exceeded the heap. This was resource exhaustion, not a reported TypeScript diagnostic.
- `npm run build:shared` — passed.
- `npx nx build email-service --skip-nx-cache` — passed, including TypeScript compilation of the changed ingestion and contact-attribution code.
- `NODE_OPTIONS=--max-old-space-size=10240 npx nx build server` — passed; Next.js production compilation, static page generation, and trace collection completed. Existing warnings include conflicting star exports in scheduling and dynamic imports in workflow actions. The server app was not started.
- `npm run test --workspace=@alga-psa/emulator-msgraph` — 11 files, 115 tests passed. This exercises the repository Graph emulator itself; it is not a wire-level test of this repaired inbound adapter.

## Fidelity and remaining checks

The focused admission integration uses a real local test database and real co-managed admission/comment writer, but provider fetch and email delivery are mocked. The Microsoft emulator suite is not evidence that a live Graph tenant returns sender metadata in every delegation/on-behalf configuration. DKIM verification uses the maintained `mailauth` verifier; deterministic regression tests inject DNS keys, while runtime verification uses system DNS. No live DNS/provider interoperability test was run here. Gmail and generic IMAP owner-confirmation flows are exercised through the real durable admission and comment path, but delivery itself is not sent to an external mailbox.

The app server and browser/manual review were intentionally not started for this repair. Reviewers should inspect the new route's authenticated actor checks and then validate the sign-in/confirmation experience in the subsequent live verification step. No prior screenshots should be attributed to this HEAD.

## Publication record

- Exact PR head SHA and publication time are recorded in the PR description alongside this guide. The implementation commit preceding this documentation-only refresh is `31e4fd302d`.
- PR: https://github.com/Nine-Minds/alga-psa/pull/4149
- External CI: record exact run URL, revision, and status after push. Pending checks are not local verification.
