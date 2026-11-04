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
