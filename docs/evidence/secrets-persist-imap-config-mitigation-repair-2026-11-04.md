# IMAP credential scope mitigation repair

## Revision and specification

The committed design specification is `docs/plans/2026-11-03-secrets-persist-imap-config-design.md`. No round-specific `PLAN.md` was present in the worktree or the private card directory. The fixture handoff is `/home/robert/alga-review-private/3276c089/public-fixture-setup.md`.

The application revision exercised here was `456e5678dcf7a474c97de5605ec0e092e9a1d3c0`. This repair round made no product-source changes; the committed change in this round records the deployment and evidence status. The implementation already on the PR branch contains credential-generation scoping, generation-aware worker restarts, fallback-secret isolation, and conditional OAuth refresh writes.

## Dev server and real UI

The previous `dev-server` service pointed to `/home/robert/alga-psa` and ran its root checkout. I concluded only this card-owned service, leaving other root-checkout processes alone, then registered the card service from:

- cwd: `/home/robert/alga-copies/feature-security-secrets-in-persistimapconfig/server`
- command: `PORT=3948 npm run dev`
- registration: card service session `card-service:3276c089-8da6-589b-b32c-dd2045b14002:dev-server:12`

Process evidence showed PID `469237` running the server's Next.js launcher from the worktree `server/` directory and listening on `0.0.0.0:3948`; `/proc/469237/cwd` resolved to that worktree path. The card origin returned HTTP 200 for `/auth/msp/signin` and HTTP 307 for the authenticated `/msp/settings/email` route. Using the dossier's canonical QA account in the real card browser reached the email settings page, and the Inbound Email tab showed the scoped `Scope Smoke 3276 renamed` provider.

The actual UI rejected an attempted save with IMAP host `127.0.0.1` and port `993`, displaying `IMAP destination is not allowed: Host resolves to a non-public address`. The edit was canceled after capturing the result, so the provider was not changed by this check. Screenshot: `/tmp/ghostty-pane-ide/screenshots/secrets-persistimapconfig-public-destination-policy-block.png`.

## Validation

All commands ran against the application revision above:

- `npm test --workspace=@alga-psa/integrations -- src/actions/email-actions/emailProviderActions.security.test.ts` — 60 passed. This includes fallback secret provider behavior and an in-flight OAuth refresh race.
- `npm test --workspace=email-service -- src/emailService.credentialGeneration.test.ts` — 51 passed, including generation-triggered worker replacement and unchanged-generation listener retention.
- `npm run build --workspace=email-service` — passed.
- `npm run typecheck --workspace=@alga-psa/integrations` — passed.
- `npm run lint:migrations` — passed; zero violations, annotations, undecided rules, or stale annotations for the PR change set.
- `npm --prefix server run typecheck` — the default Node heap aborted at 4 GB without diagnostics; the 8 GB retry also aborted at the heap limit without TypeScript diagnostics. This is a resource-limit failure, not a reported type error.

These checks cover the built email-service and its behavioral worker tests. No built service was run against a public recipient because the required recipients and isolated public fixture environment were unavailable.

## Public recipient blocker

No controlled direct-public IMAPS recipient or managed raw-TCP ingress was available on this host. The existing GreenMail listener is private, and port `23950` is its management API. Its public-auth role cannot be substituted for the required IMAPS recipient proof. The available Tailscale address is private and rejected by the shared outbound-address policy. `cloudflared` is installed, but there is no dedicated authorized TCP tunnel plus the email-service has no tunnel client; shared tunnels were not changed. `cf` is not installed, the available `dev-host` SSH endpoint timed out, and the listed CloudLab peers were offline.

The exact missing prerequisite is an organization-controlled public VM or managed direct raw-TCP ingress with DNS/firewall control and trusted TLS certificates for two IMAPS names, plus recipient-side redacted event logs and scoped reset access. The OAuth fixture also needs an HTTPS authorization endpoint, code and refresh token exchanges, and accepted synthetic IMAP bearer tokens. An isolated `smoke_imap_public_*` database and external secret directory are not provisioned. The previous local GreenMail simulator does not satisfy these requirements.

Consequently, the following remain unproven in this round: successful password authentication and replacement at the recipient; OAuth reconnect, code exchange, refresh and replacement-token IMAP auth; recipient-side proof that old credentials were not delivered after a public destination change; successful authentication following a harmless rename; and successful UI/service scenarios beyond the local policy rejection. No `security-finding-resolved` result was observed or claimed.

## Evidence-runner follow-up

The follow-up repair replaces the old closed-port/static-export preconditions with a tracked two-phase runner at `scripts/security/run-public-email-service-evidence.sh`. The prepare phase scopes a protected fixture reset to a unique run ID; after the real UI scenario, capture runs the built email-service against the isolated database, waits for `/ready`, adds the run ID to structured state logs, exports recipient JSONL, and validates both sources together. The validator rejects stale or out-of-run recipient events, window-only exports, missing worker/listener evidence, unready service, old credentials observed after scope change, and missing OAuth grant/auth evidence. It creates redacted metadata and hashes for captured evidence. The private wrapper and handoff now point to this runner and no longer require the app to be stopped.

Behavioral validator tests pass (including stale run, out-of-window, window-only, unready/missing worker, fail-closed scope change, OAuth reconnect/refresh, replacement auth, and raw-secret rejection). The focused built-service credential-generation suite passes all 51 tests, and the email-service build passes with run-scoped state logging. The public runner itself remains unexecuted because the exact missing prerequisites above are not present. No UI authentication or recipient-side scenario evidence is claimed by this follow-up.

## Current deployment and validation check

On 2026-11-04, the board registry and live health probe both reported `dev-server` as live with cwd `/home/robert/alga-copies/feature-security-secrets-in-persistimapconfig/server`, command `PORT=3948 npm run dev`, readiness port `3948`, and session `card-service:3276c089-8da6-589b-b32c-dd2045b14002:dev-server:12`. The Node process had that cwd, `PORT=3948`, and listened on `0.0.0.0:3948`. The exact card origin rendered the Email Configuration page in the card browser; an unauthenticated HTTP request to `/msp/settings/email` redirected to sign-in. No application instance was started or replaced during this check.

The published baseline at the start of this follow-up was `059eb3c6a0a0e6203f493b5251ddda6310fb26ea`, matching PR #4187. Source review confirmed that `persistImapConfig` checks both OAuth URLs and the IMAP hostname against the shared outbound policy, binds secrets to `credential_generation`, clears current and prior-generation secret keys on scope change, and conditionally writes refresh tokens only for an unchanged scope. The connection test uses generation-scoped secret reads and fails closed when no replacement credential exists; OAuth refresh writes are conditional on the row's unchanged generation. The built service includes generation in its worker signature and records worker/listener state events.

Commands run for this follow-up (working tree based on the published baseline plus the listed local evidence changes):

- `npm test --workspace=@alga-psa/integrations -- src/actions/email-actions/emailProviderActions.security.test.ts` — passed, 60 tests.
- `npm test --workspace=email-service -- src/emailService.credentialGeneration.test.ts` — passed, 51 tests across 9 files selected by the workspace runner.
- `node --test scripts/tests/public-email-service-evidence.test.mjs` — passed, 10 tests.
- `npm run lint:migrations` — passed, 0 violations, 0 undecided rules, 0 stale annotations.
- `npm run build --workspace=email-service` — passed.
- `npm run typecheck --workspace=@alga-psa/integrations` — passed.

These results establish local regression and build status only. They do not establish public endpoint protocol, DNS, TLS, recipient-log, UI credential-change, or public OAuth behavior. The tracked runner was reviewed but not invoked because no controlled fixture endpoints, fixture admin token, public fixture service environment, or `smoke_imap_public_*` database were provisioned. The old local GreenMail service remains private and cannot satisfy the public-recipient requirement. `security-finding-resolved` remains unobserved.

## Review first

Inspect the tracked evidence validator, its behavioral tests, and the two-phase runner first. Then read the private fixture handoff for the exact provisioning and API contract. The reviewer should withhold closure until controlled public endpoints and recipient-side logs are available and the required UI/service scenarios are captured. The security finding check remains unobserved.

## Evidence runner repair at `e7b5a066f5a7edb6d4fd8bc2e30f2e8627f58ad5`

The runner and validator repair was committed at the revision above. It addresses the remaining evidence-integrity defects:

- Recipient events now span fixture reset, real UI work, service execution, and export. OAuth authorization-code exchange is allowed during the UI phase, while worker IMAP authentication and OAuth refresh must occur during the bounded service phase.
- Runner timestamps retain ISO millisecond precision around process start and shutdown. The validator accepts an event at the exact shutdown boundary and rejects an event one millisecond later.
- Scope-change validation rejects prior credentials in both IMAP authentication and OAuth token exchanges. OAuth events must identify the expected logical IMAP host and port and persisted OAuth client.
- Scope-change evidence requires a successful old-scope positive control, persisted before/after generation and scope fingerprints captured from the database, a fail-closed worker result, and the configured minimum observation interval.
- The runner checks that the registered UI server and built email service share the isolated database and external filesystem secret store. It captures the actual provider row before and after UI edits and fails closed when the process binding differs.

Behavioral and local validation at `e7b5a066f5a7edb6d4fd8bc2e30f2e8627f58ad5`:

- `node --test scripts/tests/public-email-service-evidence.test.mjs` — passed, 15 tests.
- `npm test --workspace=@alga-psa/integrations -- src/actions/email-actions/emailProviderActions.security.test.ts` — passed, 60 tests.
- `npm test --workspace=email-service -- src/emailService.credentialGeneration.test.ts` — passed, 51 tests across 9 files.
- `cd server && NODE_OPTIONS=--max-old-space-size=4096 SKIP_DB_TESTS=1 VITEST_RECYCLE_FORKS=1 ../node_modules/.bin/vitest run src/test/unit/email/imapOAuthCallback.scope.test.ts src/test/unit/email/imapOAuthInitiate.policy.test.ts src/test/unit/email/imapOAuthTokenHttp.redirect.test.ts src/test/unit/email/imapOauthToken.scope.test.ts src/test/unit/unifiedInboundEmailQueueJobProcessor.fetch.test.ts --coverage.enabled=false --maxWorkers=1` — passed, 26 tests across 5 files.
- `npm run build --workspace=email-service` — passed.
- `npm run typecheck --workspace=@alga-psa/integrations` — passed.
- `npm run lint:migrations` — passed with zero violations, undecided rules, or stale annotations.
- `bash -n scripts/security/run-public-email-service-evidence.sh`, TypeScript no-emit check for `scripts/security/capture-imap-provider-state.ts`, and `git diff --check` — passed.

These checks validate the runner and application behavior locally. They do not substitute for public-recipient evidence.

## Remaining public fixture and runtime blockers

The registered `dev-server` remains at the required worktree path and port. Its live process has `PORT=3948`, and the card-origin `/msp/settings/email` route responds with HTTP 307. The same process currently lacks `DB_NAME_SERVER`, `SECRET_FS_BASE_PATH`, `SECRET_READ_CHAIN`, and `SECRET_WRITE_PROVIDER`. The protected runner therefore cannot establish that UI edits and the built service share an isolated database and external secret store; it now rejects this setup before fixture reset.

No controlled public IMAPS endpoints, trusted fixture DNS/certificates, HTTPS OAuth fixture, fixture admin API/token, isolated `smoke_imap_public_*` database, or external secret filesystem were available. The available GreenMail service is private and remains unsuitable as public-recipient evidence. No public evidence run was attempted, and no credential was sent to a fixture. The exact provisioning contract and access gap are recorded in the private handoff at `/home/robert/alga-review-private/3276c089/public-fixture-setup.md`.

Password replacement, OAuth reconnect/refresh against a public recipient, old-credential non-delivery after UI scope changes, and the complete scope-change matrix remain unproven. Do not mark `security-finding-resolved` successful based on this local validation. Review the updated runner and validator first; close the finding only after the required runtime bindings and recipient fixtures produce correlated evidence at the published revision.

## Evidence validator corrections at `abb4d1eabcf34ab40bce87e528a4e964b298b90b`

This code revision corrects three validator/snapshot issues and ties scope-change observation to a real current-generation listener:

- Provider snapshots derive the HTTPS OAuth token recipient host and effective port from the persisted `oauth_token_url`. OAuth event fields are `recipientHost` and `recipientPort`, and must match that persisted endpoint. They describe the OAuth server, separately from IMAP auth `destinationHost` and `destinationPort`.
- Scope-change validation rejects an old credential ID or the previous generation in either IMAP auth or OAuth token events after save, at any endpoint and for either success or failure. It continues to reject authentication at the changed IMAP destination.
- Scope fingerprints use a private per-run HMAC key over the complete persisted scope, including the OAuth client-secret value. Snapshots contain only the keyed fingerprint. The key is stored with mode 600 in the private evidence directory and removed after a successful capture.
- The email-service listener-start event now includes its worker ID and credential generation. The validator binds the listener to the current-generation worker and measures observation from that listener's start through service shutdown, so startup delay does not count.

Checks rerun against `abb4d1eabcf34ab40bce87e528a4e964b298b90b`:

- `node --test scripts/tests/public-email-service-evidence.test.mjs` — passed, 17 tests, including valid OAuth at a separate `oauth.example:443` endpoint, old credential rejection at the original IMAP host, delayed listener startup, and client-secret-only scope rotation through snapshot creation and evidence validation.
- `npm test --workspace=@alga-psa/integrations -- src/actions/email-actions/emailProviderActions.security.test.ts` — passed, 60 tests.
- `npm test --workspace=email-service -- src/emailService.credentialGeneration.test.ts` — passed, 51 tests across 9 files.
- OAuth initiation/callback/token redirect/scope and inbound worker suites — passed, 26 tests across 5 files.
- `npm run build --workspace=email-service` — passed.
- No-emit TypeScript check for `scripts/security/capture-imap-provider-state.ts` — passed.
- `bash -n scripts/security/run-public-email-service-evidence.sh` and `git diff --check` — passed.

These are local behavioral and build results. The public recipient scenarios and isolated UI/worker runtime remain unresolved. The registered dev-server still lacks the isolated database and external secret-store settings, and no authorized public IMAPS/OAuth fixture and controls are available. No public evidence run or `security-finding-resolved` success is claimed. The private fixture contract at `/home/robert/alga-review-private/3276c089/public-fixture-setup.md` now documents the token-recipient fields, keyed secret fingerprint, and listener-based observation window.
