# Microsoft coverage boundaries

Mailbox/calendar provider integration, Teams integration, and user SSO linking are separate claims. A pass in one does not establish the others. This inventory is grounded in the current product and emulator sources; it is not a live Microsoft protocol certification.

| Surface | Existing evidence | Remaining requirement |
| --- | --- | --- |
| Mailbox OAuth, webhook ingestion and reply | `e2e-tests/tests/microsoft-mailbox.spec.ts`; `evidence/host-microsoft-mailbox-real-worker.json` exercises the actual email worker | Current-source native CI result with every consuming process configured for the same emulator |
| Personal calendar OAuth, remote event import, UI edits and recovery | `e2e-tests/tests/microsoft-calendar.spec.ts`; `evidence/host-calendar-iana-delta.json` covers 503, permission and throttling recovery | Current-source native CI result; Windows time-zone names, ambiguous DST times and recurring-series behavior remain outside this evidence |
| Teams meeting and bot wire routes | `packages/emulators/msgraph/tests/smoke.test.ts` exercises meeting artifacts, signed inbound activities, connector replies and activity notifications | development-tests/teams-profile.spec.ts covers setup recovery plus calendar meeting creation and retained join links; see evidence/host-teams-calendar-meeting.json. A signed ticket-search product journey now covers bot tenant/user resolution, persisted conversation references and foreign-tenant exclusion; see evidence/host-teams-product-bot.json. Current-source CI validation remains incomplete. |
| Teams endpoint and bot trust policy | `ee/packages/microsoft-teams/src/lib/teams/__tests__/microsoftEndpoints.test.ts` and bot OpenID/service-URL trust tests; 28 native tests passed during this audit | Keep the production endpoint guard; these tests are not an exception that enables production-config emulator testing |
| User Microsoft sign-in/account linking | Actual NextAuth callback with synthetic canonical-authority transport: native success persists the correct tenant/user/Microsoft OID; invalid state is rejected before token exchange and preserves the link. See [CLI evidence](evidence/native-microsoft-nextauth-callback-cli.json). | Separate development callback lane is registered; CI execution is pending. Observed one token request, zero JWKS requests and no nonce. No live consent, application signature-verification, issuer/audience rejection, or nonce-rejection proof. |

`ee/packages/microsoft-teams/src/lib/teams/emulatorMode.ts` denies every Teams emulator override when `NODE_ENV=production`. In other environments it still requires `TEAMS_EMULATOR_MODE=true` or `1`. This is a credential-routing and token-trust boundary. Do not weaken it to make the production browser lane pass.

The Teams implementation uses an explicitly labeled development-configuration lane with the real product flow and stateful emulator. It reports that configuration and does not satisfy the production-artifact requirement. A separate supported Microsoft sandbox run would be needed to establish live-provider behavior; no sandbox credentials or account provisioning are currently established by this plan's evidence.

The callback lane below adds real sign-in/account-linking evidence independently of the prelinked Teams and mailbox OAuth fixtures. Broader SSO coverage still requires distinct evidence for issuer/audience rejection and any signature/nonce guarantees actually enforced by the application, plus a supported Microsoft sandbox for live consent behavior.

F034 and T028 are not completed by this callback evidence. The earlier F037 guard audit remains separate. Native guard-test log: `/tmp/alga-teams-guard-audit-native.log`. The initial sandbox run failed to bind its loopback identity server (`EPERM`); it is not counted as a pass.

Run the draft Teams setup journey with `E2E_EDITION=enterprise E2E_TEAMS_DEVELOPMENT=true` and `playwright.teams-development.config.ts`. The app must run with `NODE_ENV=development` and `TEAMS_EMULATOR_MODE=true`, plus the shared Graph endpoints and isolated database/secret-store settings described in host-provider-testing.md. One development case passed with real UI and provider requests; it is not production-artifact evidence. The test checks that the emulator actually receives the failed and recovered token requests, so a flag declaration alone cannot produce a pass.

The enterprise CI job now has a separate development startup phase with read-only package/EE source mounts and a direct Next.js entrypoint. `teams-development-execution` is an additional readiness requirement; parent readiness rechecks raw collection/results and the runner exit status, including clean source and `releaseValidation:false`. It does not replace the production browser artifact. This CI composition is implemented locally but has not yet passed on GitHub.

The EE runtime image now takes dependencies from its full-workspace builder install. The earlier deps-stage install omits `@microsoft/teams-js`, required by the Teams tab sign-in and popup-completion pages; source mounts alone do not repair that omission. Manifest-only npm resolution reproduced the omission without a Docker build. The corrected image still requires native CI validation.

`packages/emulators/msgraph/tests/teamsMeetingAdapter.test.ts` now exercises the real application token client and meeting create/update/delete adapters over HTTP. It verifies provider state and throttling recovery with no duplicate event; the full native Graph suite passed 62 tests. Tenant configuration and background artifact subscriptions are mocked, so this adds adapter coverage without establishing database, browser, bot or SSO behavior.

The development browser journey now creates a calendar entry and Teams meeting through the real UI, checks the provider event against the saved online_meetings row, then saves and reloads to verify the join link survives without a duplicate meeting. One native run passed in about 2.2 minutes (evidence/host-teams-calendar-meeting.json). An active integration/organizer is a fixture precondition. The host required a 20 GiB heap after Next restarted at its 12 GiB threshold; a subsequent clean-source run passed with a 12 GiB heap and Node source maps disabled; CI now uses that configuration and still needs native validation. That recorded meeting-only run did not cover bot commands, SSO or background artifact jobs; later bot and callback evidence below has its own scope.

The validated host configuration now uses `NODE_OPTIONS=--max-old-space-size=12288` and `next dev --webpack --disable-source-maps`. The full Teams gate passed at a clean revision with no memory restart (evidence/host-teams-memory-budget.json). This disables Node source-map stack-trace mapping; Playwright traces remain available. An 8 GiB heap failed both in source and prebuilt-package modes. CI uses the 12 GiB configuration and stops the completed email/collaboration services before the final development phase, but Linux CI memory usage has not yet been validated.

`packages/emulators/msgraph/tests/teamsBotAdapters.test.ts` adds six wire cases using the real inbound route guard, JWKS verification and outbound connector. Signed activities produce replies, expired outbound tokens refresh without duplicate messages, and card updates retain their activity identity. Wrong audience, expired inbound tokens, untrusted reply destinations and forged sender/tenant identities are rejected without replies. The full native Graph suite passed 68 tests in 7 files (evidence/host-teams-bot-adapters.json). A minimal HTTP receiver composes these adapters; it does not establish business-command dispatch, linked-user database behavior, or user SSO.

The development journey now also calls the actual `/api/teams/bot/messages` endpoint with emulator-signed activities. Real tenant/user lookup and ticket search produce one provider reply containing the own-tenant match and excluding an equally matching foreign ticket; a foreign-tenant account link receives only the sign-in card. Conversation-reference persistence is checked in PostgreSQL. This product command journey passed locally (evidence/host-teams-product-bot.json); it supersedes the earlier absence of any full-handler evidence, while the earlier adapter-only evidence retains its original scope. OAuth links are preseeded and do not establish SSO.

Unimplemented `/v1.0` Graph routes now fail with the emulator-specific `501 EmulatorUnsupportedOperation` diagnostic; known-route missing resources retain 404. A red/green test through the actual meeting deletion adapter proves unsupported URLs no longer masquerade as successful idempotent deletion. This improves coverage honesty without claiming Microsoft returns that diagnostic (evidence/graph-unsupported-operation-regression.json).


## Real NextAuth callback lane

`packages/auth/test-harness/run-microsoft-callback.mjs` starts an owned Next development process and a loopback identity authority. The test-only preload routes canonical Microsoft discovery/token requests to that authority without changing the production provider or callback options. The driver uses the real CSRF, sign-in, callback and session HTTP endpoints; it does not prelink the fixture user. The authority enforces client credentials, the exact callback URI and S256 PKCE. The successful callback must persist the Microsoft object ID, distinct from the token's pairwise subject, for the exact fixture tenant and user. A second sign-in with invalid state must stop before token exchange and leave that account link unchanged.

The [native CLI evidence](evidence/native-microsoft-nextauth-callback-cli.json) records one full pass with scoped fixture removal, owned process shutdown and disposable database removal. Its four harness files were untracked at execution; the evidence includes their hashes and the preceding setup failures. Installed dependencies and the Next cache were reused. The subsequent signal-cleanup repair has separate validation and was not part of that successful execution.

The observed callback requested no nonce and made zero JWKS requests. The authority signs a JWT, and its independent fixture tests verify that signature, but neither fact establishes application signature verification. Issuer/audience rejection and nonce rejection were not exercised by this callback run. The fixture tests also check discovery, client/redirect/PKCE rejection and transport isolation; those checks validate the fixture rather than substitute for the full callback/DB run.

The enterprise workflow registers `scripts/run-microsoft-callback-ci.mjs` after the Teams phase, using the existing candidate image with read-only source mounts and a separate writable cache. It publishes `microsoft-callback-execution`; the evidence validator checks execution, cleanup, source and runtime binding. This registration is pending actual CI execution. Its `releaseValidation:false` result remains development evidence, separate from the production browser lane. It does not prove live Entra consent, tenant provisioning, or the Teams embedded sign-in popup flow.

## Current-source CI inventory

Run `34339167571` (candidate `a9efecc`) closes the "current-source CI result"
requirement that most rows above were still waiting on. Every Microsoft case
below passed on its first attempt, against the emulator, in the candidate's own
CI run.

Production browser lane, enterprise, production build:

| Spec | Cases | What it establishes |
| --- | --- | --- |
| `microsoft-calendar.spec.ts` | 4 | OAuth import of vendor events and export of UI edits, each recovering from provider outage, permission denial, throttling and all-day throttling without losing remote linkage |
| `microsoft-mailbox.spec.ts` | 1 | Receives a ticket, sends a UI reply through Graph, deduplicates callbacks |
| `microsoft-oauth-rejection.spec.ts` | 4 | Missing code, missing state, malformed state and unsigned state rejected through the popup result |
| `microsoft-webhook-validation.spec.ts` | 4 | Opaque validation token echoed by the calendar, email, Teams-recordings and telephony endpoints |

Callback lane: `microsoft-callback-execution`, 2 cases.

Wire level, in the unit lane against the emulator: `calendar` 45, `smoke` 15,
`callRecords` 12, `teamsBotAdapters` 6, `teamsOrganizerRouting` 4,
`teamsMeetingAdapter` 3, `tokenIdentity` 1 — 86 cases.

101 Microsoft cases in total.

### Where the line sits

This split is the PRD's own doctrine rather than an accident: one representative
recovery journey per provider in the browser, the wider protocol matrix in
faster wire-level tests, and no attempt to route every API case through a
browser. Mailbox and calendar are the representative browser journeys. Teams bot
and meeting behavior is protocol-matrix work and lives at the wire level, where
it runs on every candidate.

So the deferred item is the Teams **browser** journey specifically, not Teams
and not Microsoft. `development-tests/teams-profile.spec.ts` is quarantined to
2026-10-21 under F034/T028 for the development-server chunk truncation recorded
in `evidence/native-teams-12gib-chunk-failure.json`. Teams wire coverage is
unaffected and keeps running.

### Recurrence and timezone expansion

Recurring-series delta expansion and non-UTC timezone delta expansion are not
modelled. That exclusion is enforced rather than assumed: `calendar.test.ts`
asserts the emulator answers `400 Request_UnsupportedQuery` for both, so an
unmodelled case fails loudly instead of returning data that looks real. Windows
timezone names and a genuine DST transition date are exercised directly —
`W. Europe Standard Time` across 2026-10-25, and `Pacific Standard Time`
all-day boundary rejection.

Live-provider parity is still not established by any of this. Emulator success
is not a Microsoft certification, and no sandbox credentials exist in this
plan's evidence.

## The development-server failure is a bundler problem, not a Teams problem

The chunk truncation recorded above is gone under Turbopack. The lane had pinned
`next dev --webpack`, and every mitigation tried against the failure stayed
inside webpack: 8GiB failed, 12GiB was marginal, source maps were disabled, and
`webpackMemoryOptimizations` was investigated and rejected as build-path only.
Turbopack was never tried, despite being the Next 16 default, despite
`server/next.config.mjs` carrying a maintained `turbopack.resolveAlias` map, and
despite `ee/server/next.config.mjs` stating that its webpack block is kept only
"for fallback compatibility when Turbopack isn't used".

Under Turbopack, run 34367564576 shows no `SyntaxError`, no `ChunkLoadError` and
no memory restart. The lane starts, captures credentials, passes its
authentication check and warms the authenticated dashboard, then runs the
journey for 74.8s.

So the 81.7MB single-chunk behavior was a dev-webpack artifact. The heap tuning
in the sections above describes a problem that no longer applies to this lane,
and should be read as history rather than current configuration.

What the infrastructure failure had been hiding is ordinary: the Microsoft
profile dialog overflows the 1280x720 Desktop Chrome window instead of scrolling
internally, so the first capability checkbox is below the fold and Playwright
reports it visible, enabled and stable but "outside of the viewport". Only this
lane is affected because it forces `release-v1-6-feature` on an enterprise
development build and therefore renders more capability rows than the production
lane, where the same fixture passes. The lane now runs at 1280x1200. Forcing the
click was rejected: it would assert on an element a user at that window size
also could not reach.

Whether that overflow affects real laptop users is a separate product question
and is tracked as such, not answered from a CI log.

The quarantine entry remains until a run reports the lane passing. A quarantined
requirement that passes is reported as `quarantined-passing`, which is the signal
to remove the entry rather than an assumption that it can be removed.
