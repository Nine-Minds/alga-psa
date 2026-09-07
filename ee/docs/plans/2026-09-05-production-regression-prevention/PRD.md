# Production regression prevention

- Slug: `production-regression-prevention`
- Date: 2026-09-05
- Status: Implementation in progress in draft PR #3343; see tracking files for verified scope
- Audit baseline: `origin/main` at `457654d6f0`; implementation rebased onto `a90cd88edc`
- Scope authority: user's request to implement the preceding testing-audit recommendations
- Tracking: [features.json](features.json), [tests.json](tests.json), [SCRATCHPAD.md](SCRATCHPAD.md)

## Summary

Make a passing release mean that selected critical customer workflows executed successfully against the code and service artifacts being released. First close test-discovery and enforcement gaps, then exercise real authentication, database hydration, browser actions and asynchronous delivery. Add targeted mutation and property-based testing to improve assertion strength after those foundations work.

This is a phased engineering backlog. Complete individual work packages with their evidence; do not wait for the whole program to start benefiting from required tests. Existing tests and tools should be extended where they already cover a journey.

## Problem and user value

The metrics sheet tracks substantial testing activity, but aggregate pass rates hide failing or unexecuted tests and do not prove that basic customer tasks work. The audit found:

- The current main commit's unit run had 34 failures despite a 99.76% pass rate. GitHub's effective required checks did not include unit, integration or browser suites.
- Infrastructure tests were non-blocking and had five failing tests on four successive inspected nightlies.
- A real-DB month-end regression test was outside every inspected CI execution path.
- The fresh-install browser job checked login and the dashboard URL, while broader customer workflows lived outside that job.
- Recent fixes crossed boundaries hidden by isolated tests: authenticated tenant context, PostgreSQL Date hydration, and the deployed email-service bundle.

Preventing these failures protects MSP ticket handling, time/usage capture, billing and client communications. A failed run must provide an actionable cause and a clear owner; a high percentage must never override a failing critical journey. Audit evidence and source links are preserved in the scratchpad. These are baseline observations, not claims about future main or every external deployment system.

## Goals

1. Every test file has an explicit CI execution path or a reviewed, owned exclusion.
2. Required gates cannot pass when mandatory work fails, does not run, or produces incomplete results.
3. Critical browser and service journeys exercise production builds with real request identity and persisted outcomes.
4. Releases promote the image digests that passed validation, including worker/email components.
5. Escaped defects become proven regression tests and inform the next coverage investment.
6. Metrics distinguish execution completeness, failures, flakes, measured scope and customer-journey coverage.

## Non-goals

- Rewrite the test framework, replace Google Sheets, or purchase a test platform as a prerequisite.
- Target an arbitrary repository-wide coverage or mutation percentage.
- Exhaust every browser, locale, role, feature flag and provider combination on every PR.
- Treat source-string checks, mock call counts or a dashboard URL as sufficient proof of a customer journey.
- Run financial transactions or contact real customers during synthetic tests.
- Change application behavior except where a real failing test establishes a defect; track those fixes with their reproducer.

## Users and primary flows

- Contributors: change code, see selected suites and omissions, reproduce failures, attach regression evidence.
- Reviewers: see stable required checks and the critical journey results for the candidate revision.
- Release operators: promote a validated artifact set, detect component-version drift, stop on a failed deployment smoke.
- QA/domain owners: select representative escaped defects, maintain journey expectations and review exclusions.
- MSP/client users: create tickets, exchange replies, submit portal requests, log/approve time, add usage, generate/finalize invoices and receive email.

## Delivery order and accountability

Roles are proposed accountabilities; assign actual people when starting a package. No calendar delivery commitments are assumed. Features carry work-package and dependency IDs; tests map back to feature IDs.

| Package | Priority / owner role | Depends on | Deliverable and exit condition |
| --- | --- | --- | --- |
| WP1 Execution integrity | P0 / CI maintainer | None | Current failure baseline classified; package DB regression runs; discovery and selection cannot silently omit required tests; healthy suites rerun successfully. F001–F006. |
| WP2 Enforced gates | P0 / repository administrator + CI maintainer | WP1 | Unit, Tier-1 integration/infrastructure, discovery and the aggregate gate are required; failed/missing/cancelled jobs reject a representative candidate. F007–F009. |
| WP3 Customer journeys | P0 / QA automation + ticket/billing owners | WP1; enforce through WP2 as each journey lands | Real-login production-build harness; Add Usage, ticket/portal, then invoice/time journeys required on applicable candidates. Existing CE installation smoke retained; EE exercised. F010–F018. |
| WP4 Services and releases | P1 / platform + email owners | WP3 harness; WP2 for promotion enforcement | Built email-service journey, upgrade/runtime parity lane, artifact identity validation and deployed synthetic smoke. F019–F023. |
| WP4E Provider browser journeys | P1 / integration owners + QA automation | WP3 harness; WP2 for enforcement | Playwright drives real Alga services against algasim vendor endpoints; Stripe, QBO, Microsoft and Xero journeys verify both product results and provider state. Shared faults and emulator-contract checks keep results meaningful. F031–F037. |
| WP5 Better signals and assertions | P1 / QA lead + domain owners | Baseline from WP1; journey inventory from WP3 | Release-oriented metrics, regression evidence process, targeted mutation and property-testing pilots. F024–F030. Metrics/process can start alongside WP3; tools follow stable selected suites. |

Start with F001–F003: refresh CI failures and fix the concrete orphaned billing DB regression path. Do not enable every historically red suite as a required check in one step. Repair and require coherent suites incrementally; publish any remaining exclusion explicitly.

## Requirements

### R1 — Execution integrity

- Refresh live GitHub checks/rules, recent metrics, failing jobs and deployment entry points. Classify failures as product defect, harness defect, flaky behavior or intentional exclusion; record owner and resolution evidence.
- Restore selected unit, Tier-1 and infrastructure baselines without deleting behavioral assertions, swallowing failures or increasing skips merely to obtain green.
- Add a database-backed workspace lane that discovers colocated package/shared DB suites, including `calendarMonthEndCloseActions.db.test.ts`. Use real migrated schema and explicit required DB availability. Establish deterministic setup/cleanup and separate DBs before adding file parallelism.
- Generate a test inventory from actual runner collection plus tracked test candidates. Map each candidate to suite, owner, runtime requirements and mandatory/optional status. A moved/new unmatched file or empty required collection fails discovery. Manual tools require a reason, owner and review/expiry date; expired exclusions fail.
- Align outer workflow filters with suite-selection rules. Root dependencies, schema, seeds, test harness, selection scripts, services and EE packages must reach the appropriate suites. Unknown changes, unavailable base or failed diff/collection select a conservative superset or fail clearly; never silently narrow to nothing.
- Preserve fast affected selection where sound. Publish selection reasons and compare expected file/test identities to execution results; intentional skips and todos remain distinguishable from missing or incomplete execution.

### R2 — Merge and release gates

- Add a stable aggregate check that always reaches a decision and reads prerequisite outcomes plus required execution manifests. All mandatory jobs must succeed and be complete. Reject failure, cancellation, missing artifacts, zero required collection and unexpected skipping. Legitimate docs-only selection must be explicit and explainable.
- Register stable checks in effective GitHub protection/rulesets; preserve existing required guards. Verify app identities, branch freshness/merge-queue behavior if used, and explicit administrator/release-bot bypass policy. Do not assume a red job is required because a README calls it a gate.
- Remove infrastructure `continue-on-error` for repaired mandatory coverage. Any temporary quarantined cases have owners, reasons, expiry and a separately visible outcome; no quarantined P0 journey can satisfy release readiness.
- Enable enforcement after representative branch success and deliberate failure validation. Add browser and service gates as their packages land. Release automation must verify success for the selected artifact set; a green result from a different revision cannot authorize promotion.

### R3 — Real browser journeys

- Reuse Playwright with a dedicated production-build smoke configuration. Real sign-in, session cookies, withAuth, RBAC and request tenant resolution remain active. Seed preconditions using supported fixtures, then drive the operation under test through its real UI/API boundary.
- Each run creates isolated tenants/users/data. Include administrator, ordinary technician and portal identities as applicable; assert another tenant/client cannot see or mutate the created data.
- Package the existing generated CE login test as a maintainable spec; verify dashboard content, not only navigation. Exercise an EE build with representative enabled features. Expose exact edition/flag configuration in results.
- First journeys: (1) Add Usage with overlapping eligible usage/bucket lines, persistence after reload and accurate invoice preview; (2) ticket create/assign/reply/reopen; (3) portal submission → MSP handling → portal-visible response and client isolation.
- Next journeys: time log → submit → approval → invoice; recurring/manual invoice generation → finalization → document download with invoice identity and expected amounts. Reject unapproved time and duplicate financial effects where relevant.
- Assert saved state after reload or a fresh session, visible result content and business invariants. UI toast success or an internal mocked callback alone is insufficient.
- Capture first-failure traces/screenshots, selected network/server failures and revision/configuration context without secrets. Keep retries for diagnosis; a retry-only pass is reported as flaky and does not silently satisfy the critical release gate. Verify installed Playwright capability before using new CLI options.
- Use Playwright plus wire-level provider emulation as the default for integration-facing browser journeys (R6). Keep Alga authentication, server actions, provider clients, database and workers real. In-process provider substitution remains useful for narrower Vitest tests, but cannot substitute for these browser journeys.

### R4 — Services, upgrade state and artifact identity

- Drive raw MIME through the built email-service's real intake/queue/parser/persistence path using the existing GreenMail/IMAP harness, then verify ticket content and threaded outbound reply in a test sink. Include inline quotation preservation, correct history trimming and duplicate-delivery handling. In-process parser success does not substitute for the container journey.
- Define an immutable release manifest mapping each deployed component to image digest, source revision and build identity. Components may have distinct revisions when explicitly intended. Run smoke against that exact set; promote by digest and verify deployed identities match the tested manifest.
- Create a synthetic existing-tenant fixture from the previous supported release schema, upgrade through the actual migration path, then execute usage/invoice/ticket checks. Keep this separate from clean-install coverage.
- Add an EE runtime validation lane using Citus, beyond migration/distribution checks. Exercise representative tenant-scoped reads/writes and billing behavior against the upgraded schema. Record remaining differences from production topology; a single-node fixture does not prove multi-node behavior.
- Provision a dedicated deployed smoke tenant and test mailbox/sink. Run bounded checks after deployment and on a scheduled cadence defined during platform wiring. Reject promotion on failed post-deployment validation where deployment supports staged promotion; notify the owner on meaningful failures. Never send to customer recipients or charge live payment methods. Cleanup and recovery must be idempotent.

### R5 — Metrics and feedback

- Preserve existing scorecard columns and history. Add versioned/additive suite metadata or dedicated tabs for expected/collected/executed results, critical journey identity, first-attempt/retry outcome, edition/configuration, tested SHA, artifact manifest and gate status.
- Record cancelled, missing and partial runs as explicit non-green outcomes rather than disappearing from the readiness view. Make execution completeness use the declared required set, not a percentage-of-collected heuristic alone.
- Separate main, PR and nightly trends. Lead with readiness/failure counts and critical journey completion; keep pass percentage as a diagnostic. Publish source inventory alongside measured coverage; never present measured-only percentages as whole-repository coverage. Version coverage methodology and reconcile source exclusions.
- Pilot StrykerJS with the installed Vitest version on a small selection of billing eligibility/date normalization and tenant/authorization predicates. Inspect survivors and equivalent mutants; fix meaningful assertion gaps. Establish a scoped baseline before setting a ratchet. Do not add repository-wide mutation runs to the initial PR gate.
- Pilot fast-check on date boundaries and an independent financial state model. Cover tenant-calendar month-end/DST cases and valid finalize/pay/credit/void/retry sequences; assert conservation of balances, exactly-once effects and isolation. Save shrunk counterexamples and replay seeds. Use real DB checks for persistence/driver behavior; a pure model alone cannot prove those boundaries.
- Add an escaped-defect record linking incident, failed customer journey, missing boundary, permanent test, before/after evidence and owning CI suite. Reproduce the bad behavior by narrowly reverting the fix or constructing the minimal defect; distinguish intended assertion failure from unrelated setup failure.
- Review escape categories and exclusion age regularly. Add the next journey based on observed escapes and customer impact; assign an owner and record the decision. Update testing documentation to match actual runners and protections.

### R6 — Playwright with stateful external-service emulators

The standard integration test architecture is:

`Playwright → Alga UI → real server actions / API / DB / workers → algasim vendor endpoint`

`Test fixture → algasim control API (seed, inject events/faults, inspect state, reset)`

Provider callbacks travel from the emulator back into the real Alga webhook route and queue. Browser route interception or mocking Alga server actions would remove precisely the wiring this layer is intended to verify.

- Reuse `packages/emulators` and its host/control API. Start only required providers on isolated ports or isolated container networks. Seed vendor state through the control API; perform the Alga operation under test through the UI. Reset state/faults per scenario and isolate parallel runs. Use bounded polling of observable completion, not fixed sleeps.
- Configure endpoint overrides on every Alga process making the request, including workers/email-service; use addresses reachable by both browser redirects and containers. Validate that test provider traffic reached the emulator and no accidental live-vendor requests occurred. Build emulator dependencies from the candidate source to avoid stale dist.
- Each journey asserts three outcomes where applicable: user-visible result after reload, persisted Alga state, and actual vendor-side records/requests. A successful toast or accepted request is insufficient when an asynchronous operation has not completed.
- Capture emulator version, seed/scenario, configured endpoints, fault history and observed provider requests alongside browser traces. Redact credentials and tokens. Reuse scenario definitions for local reproduction.

| Provider / existing emulator | Representative browser journey | High-impact failure / recovery |
| --- | --- | --- |
| Stripe | Open invoice payment link, complete simulated hosted Checkout, receive signed webhook, reload invoice balance/status | Declined/cancelled checkout does not mark paid; duplicate webhook cannot apply payment twice |
| QBO | Connect through supported OAuth flow, select company/mappings, export an invoice, verify QBO record and Alga sync result | Expired token refresh; stale SyncToken or transient failure remains actionable and retry does not duplicate the invoice |
| Microsoft Graph / Teams | Configure supported provider profile, exercise mailbox reply and calendar meeting create/update/delete, verify provider state and refreshed UI | Missing permission, expired token and throttling produce correct recovery or visible action; reopened calendar retains remote linkage |
| Xero | Connect/select organization and mappings, export invoice, verify provider invoice and persisted sync result | Connection expiry or rejected export produces visible failure; successful retry preserves tenant/organization identity and avoids duplicates |

- Start with Stripe and QBO where the suite already exposes hosted checkout/OAuth and accounting state, then Microsoft and Xero. Audit existing Playwright specs before adding tests; promote/extend useful scenarios into CI. The raw MIME/SMTP journey in F019 remains the email-container transport test.
- Add a compact deterministic fault matrix: token expiry, insufficient permissions, 429 with retry semantics, 5xx and duplicate/out-of-order callbacks where supported and relevant. Keep one representative recovery journey per provider in the browser; exercise the wider protocol matrix in faster wire-level tests. Do not route every API case through a browser.
- Emulator virtual time controls vendor state only; it does not automatically advance the application's scheduler or clocks. Use supported application job triggers/clock seams and observable completion for time-dependent recovery, documenting both clocks.
- Inventory protocol capabilities before claiming coverage. Current emulator documentation reports incomplete Microsoft SSO/OIDC account linking and denies Teams emulator overrides under `NODE_ENV=production`. Treat these as explicit coverage gaps: implement a reviewed narrowly scoped test mechanism or supported emulator protocol, or label the scenario as a separate non-production-config lane. Do not remove production security guards or claim prelinked fixture setup tests real SSO linking.
- Maintain a provider-contract/parity check for the fields, error envelopes, auth flows and callbacks used by these scenarios, grounded in official provider specifications and sanitized captured examples. Unsupported routes should fail explicitly. A small vendor-sandbox check can validate drift when test accounts are available; credentials and account provisioning are separate requirements. Emulator success alone does not prove live-provider parity.
- Record suite selection and provider/edition/configuration in readiness metrics. Landed core provider journeys become mandatory for affected integration candidates and the release set that ships them; broader failure matrices run in the appropriate slower lane. A documented gap remains visible until covered.

## UX / UI notes

No customer-facing product screens are added. CI summaries and the existing metrics workbook are the user interfaces: display required journey status, missing work, failure evidence and rerun command before aggregate percentages. Readiness is explicit: passed, failed, incomplete or intentionally not applicable, with the reason shown.

## Data / API / integrations

- GitHub Actions reports/artifacts and GitHub branch/rules APIs provide execution and enforcement evidence.
- Google Sheets receives additive metrics with stable existing columns; check readers/charts before evolving the schema.
- Use existing Vitest, Playwright, Docker Compose and email/provider emulators. Add StrykerJS and fast-check only in scoped later packages after compatibility checks.
- Test databases use migrated CE/EE schema and synthetic fixtures, not production dumps. Artifact manifests identify the whole deployed component set rather than just the web server.
- Release pipeline location, deployment environments, rollback controls and scheduled execution host require discovery in WP1/WP4; they were outside the original repository-only pipeline audit.

## Validation strategy

`tests.json` is the executable-evidence backlog, including CI experiments and operational readbacks where a unit test would add little confidence. Prefer behavioral tests of selection/gate decisions and actual collected/executed identities. Never add assertions on source strings or import presence as substitutes for runtime behavior.

Use one representative happy path plus high-impact guard cases for DB-backed functionality. Prove discovery with an unmatched/moved test in a disposable fixture and gate enforcement with controlled failed/cancelled/missing runs. Prove new regression tests reject their historical defect. Required browser tests include persisted-state and cross-identity checks.

Initial performance targets are budgets to validate, not promised existing timings: keep the initial three-journey browser execution near 15 minutes excluding image build, report build and test durations separately, and keep full upgrade/Citus/property lanes off ordinary unrelated PRs unless risk selection requires them. Profile or split isolated workloads rather than hiding failures behind retries or timeouts.

## Rollout and risks

1. Establish actual execution coverage and fix current red baselines.
2. Validate stable gate logic, then turn on effective required checks for repaired suites.
3. Add browser journeys incrementally to the required set; retain the initial three as the P0 floor.
4. Gate service artifacts and upgrade/EE behavior, then connect deployed smoke.
5. Add metrics and assertion-strength ratchets with measured baselines.

Risks: serial DB recreation can inflate CI duration; auth fixtures can accidentally bypass the failing path; provider emulators can diverge from providers; dynamic imports/flags can evade affected selection; ruleset bypasses can weaken enforcement; baseline repairs can turn into assertion weakening. Mitigate through isolation, explicit mock boundaries, conservative selection, live effective-rule readback and defect-replay evidence.

Repository changes and external configuration changes are separate deliverables. Do not mark GitHub/Sheets/deployment features complete until their real readback/behavior is verified. Roll back faulty harness configuration explicitly and record the temporary protection gap; do not silently remove a required gate to restore throughput.

## Open decisions to resolve at implementation

- Assign named owners for CI, GitHub administration, domain journeys and release operations.
- Identify each release pipeline and the supported previous-release upgrade fixture; inventory administrator/bot bypass requirements.
- Choose production-representative EE flags, role fixture and tenant timezone set with domain owners.
- Choose synthetic tenant/mailbox, notification destination and cadence; default proposal is post-deploy plus every 15 minutes for a small non-financial smoke.
- Benchmark isolated DB/browser execution before choosing shard counts or expanding per-PR coverage.

These decisions do not block WP1. Resolve them before the dependent operational change; do not invent credentials, recipients or production deployment targets.

## Acceptance criteria / definition of done

- All planned feature/test items have implementation or verification evidence; items remain false until shipped/verified.
- The concrete orphaned billing regression runs in CI and rejects the pre-fix Date hydration behavior.
- Effective GitHub checks reject representative failed, cancelled, missing and empty mandatory runs while preserving legitimate narrow selection.
- Critical journeys pass using real login, production builds and persisted outcomes; negative tenant/client access is denied.
- The email journey covers actual built service containers, and a mismatched artifact manifest blocks promotion.
- Integration browser journeys use real Alga provider clients against stateful wire-level emulators, verify vendor and persisted product outcomes, and demonstrate representative failure recovery without duplicate effects. Emulator capability/configuration limitations and parity evidence are explicit.
- Existing-tenant upgrade and representative EE/Citus runtime behavior are validated beyond fresh install.
- Release readiness and scorecard distinguish failures, flakes, skipped/incomplete execution and unmeasured code.
- Mutation/property pilots produce reviewed findings and reproducible failures, with an owned regression record for each chosen escaped-defect exemplar.
- Deployed smoke is operational in isolated test resources, and a controlled failure reaches the designated owner without affecting customer data.

### Development feedback and final release validation

Use targeted host-run unit/component/integration tests and a host-run application for iterative Playwright feedback, reusing existing isolated database and emulator services. Defer full Docker/Colima image builds and installation checks to final validation, preferably native CI. Development browser results must be labeled and stored separately from production artifact evidence; they do not satisfy packaging, installation, or immutable promotion requirements. This execution policy follows the user’s request to reduce repeated Mac image builds.

Apply this order within each work package:

1. Run the smallest relevant behavioral unit/component suite directly on macOS; use watch mode when iterating on the same behavior.
2. Run affected integration suites as host Node processes against migrated, isolated databases and reusable emulator services. Rebuild a service only when its changed behavior requires it; batch such validation at the final checkpoint.
3. Run the affected Playwright journey against the host development server with `npm run test:local -- tests/<journey>.spec.ts` from `e2e-tests`. Verify persisted outcomes and failure recovery using the real application clients and emulator endpoints.
4. At final validation, run the required production builds, CE/EE installation, worker/service packaging, upgrade and Citus checks. Prefer native CI for this checkpoint; host development results do not close these acceptance items.

The current Mac is ARM64 and both inspected Colima profiles are configured as aarch64. Architecture conversion is unnecessary. Record build time separately from test time so infrastructure startup does not obscure the cost of the tests themselves.
