# Production regression prevention — scratchpad

## Scope and decisions

- 2026-09-05: User requested an actionable repository plan for the preceding testing audit. The audit recommendations establish the scope; create all four planning artifacts without another scope-confirmation round. This task creates the plan only.
- Baseline checkout: `457654d6f0`; detached HEAD, clean before planning. Repository files and GitHub settings cited below were inspected during the preceding audit and must be refreshed during implementation.
- Prioritize execution/discovery and required gates, then real browser/service boundaries, then assertion-strength tools. Reuse existing journeys and emulators.
- Keep all checklist items false until implementation and verification are complete. Planning does not count as shipping these capabilities.
- No fixed delivery dates or named assignees have been agreed. PRD uses accountable roles and dependency-ordered work packages.

## Evidence from the audit

- Spreadsheet: https://docs.google.com/spreadsheets/d/1eKcgRVSwd3bDBSbbwyj-WYb8jhqSEDOG8FPO9--O21M/edit#gid=145756868
- Main unit run https://github.com/Nine-Minds/alga-psa/actions/runs/33983692658: 14,306 passed, 34 failed, 112 skipped, 22 todo; 99.76% pass rate; 34.98% measured line coverage; 4,277 / 5,731 source files measured. Both unit jobs failed. Do not infer that every failing assertion represents a distinct production defect.
- Infrastructure nightlies September 2–5 each recorded five failures. The job has `continue-on-error: true` in `.github/workflows/integration-tests.yml`.
- Live classic main protection had no required status contexts. Applicable rulesets required only `Run ext-v2 guard and ESLint` and `Check for new circular dependencies`. Administrators were not enforced by classic protection. No settings were changed. Re-read effective rules and bypasses before implementing gates.
- Fresh-install workflow builds CE images and generates one login-to-dashboard browser test. Broader Playwright suites exist but were not invoked by the inspected workflow set. External deployment pipelines were not audited.
- `packages/billing/src/actions/calendarMonthEndCloseActions.db.test.ts` is excluded by server coverage's SKIP_DB_TESTS, absent from billing's package include list, and outside the server integration/infrastructure directory filters.
- `scripts/run-tier1-integration.mjs` widens on root dependency changes, but the outer integration workflow filter omits root package manifests/lockfile, scripts, services and ee/packages. Missing diff/base handling also needs conservative selection.
- Existing server integration journeys provide useful real-DB coverage, but some mock tenant context, withAuth, provider transport and event publication. Keep their scope explicit.

## Regression exemplars

- Usage tenant-context / date hydration: https://github.com/Nine-Minds/alga-psa/commit/60c844f567389b8464b763ed8104696766d2bbd8
- Month-end pg Date hydration: https://github.com/Nine-Minds/alga-psa/commit/c9f993c6dc5386344a0724937f686d4187b8bc6b
- Inbound MIME / stale email-service bundle / parser discovery: https://github.com/Nine-Minds/alga-psa/commit/de88eb6f7274a25cee1fdd4105ea0aa959d0aa5e
- Calendar callback test replaced with composed behavior coverage: https://github.com/Nine-Minds/alga-psa/commit/8fd3fd1c3ba9b275d9db88c3f2db6834f05af020

## Implementation starting points

- `.github/workflows/unit-tests.yml`, `.github/workflows/integration-tests.yml`, `.github/workflows/e2e-fresh-install-tests.yaml`, `.github/workflows/citus-migration-smoke.yml`
- `scripts/run-tier1-integration.mjs`, `scripts/record-test-metrics.mjs`, `scripts/check-skip-budget.mjs`
- `server/vitest.config.ts`, `packages/billing/vitest.config.ts`, `server/src/test/integration/tier1.manifest.json`
- `server/src/test/integration/journeys/README.md`, `server/playwright.config.ts`, `ee/server/playwright.deploy.config.ts`
- `docs/reference/test-metrics.md` is partially stale: it says PR runs are not recorded, but the sheet contains PR unit rows. Correct docs with the implementation.

## Tools and constraints

- Playwright: https://playwright.dev/docs/test-cli (retry/flake reporting and fail-on-flaky support; verify installed version first).
- StrykerJS/Vitest: https://stryker-mutator.io/docs/stryker-js/vitest-runner/ (pilot only; resolve compatibility before adding dependencies).
- fast-check: https://fast-check.dev/docs/advanced/model-based-testing/ (independent model, shrinking, reproducible sequences).
- DB suites currently recreate a shared test database and serialize. Do not enable parallelism without per-worker database isolation.
- Auth bypass is present in local Playwright setup. Release smoke must use actual sign-in and request tenant resolution.
- Git metadata is outside this worktree's writable root. GitHub reads needed network escalation during the audit. Plan creation requires neither Git mutations nor external writes.

## Validation log

- Plan schema validation passed with `python3 scripts/validate_plan.py ee/docs/plans/2026-09-05-production-regression-prevention`: 30 features and 24 verification items.
- Additional validation passed: unique IDs, every feature mapped to verification, valid PRD requirement references, acyclic dependency graph, all items pending, and no trailing whitespace.
- Only this new plan directory was added. No application tests were run for the documentation-only task; no source, workflow, GitHub, deployment or spreadsheet settings were changed.

## Follow-up: Playwright plus integration emulators

- User endorsed Playwright with emulated external services. Added R6/WP4E, F031–F037 and T025–T031 to make this an explicit implementation stream.
- Read alga-emulator-testing skill and current `packages/emulators/README.md`. Existing suite includes Microsoft Graph, QBO, webhook/SMTP sinks, Stripe hosted Checkout and Xero. Prefer the current repository inventory over the skill's shorter provider list.
- Keep real Alga UI, authentication, clients, workers and persistence. The control API seeds/faults/observes vendor behavior; assertions inspect both sides of the integration.
- Recorded current Microsoft SSO/OIDC and Teams NODE_ENV=production override limitations. Do not bypass security guards or imply that prelinked accounts validate SSO. Vendor virtual time does not automatically move application time.
- Prioritize Stripe/QBO then Microsoft/Xero, reuse existing specs, and retain faster protocol tests for the wider fault matrix. Provider-contract parity remains an explicit deliverable.

## Implementation underway (2026-09-06 UTC)

- User expanded scope to full implementation, a PR containing the tests, successful execution and green checks, including incidental fixes. The earlier plan-only scope above is historical. Goal remains active; no checklist capability is yet claimed complete.
- Branch `codex/production-regression-prevention` starts at refreshed `origin/main` (`457654d6f0`). Commit `86a27f4d90` reuses reviewed baseline repairs from existing PR #3340, with attribution. All 34 unit failures reproduced before the patch; afterward all 124 assertions in those 15 files passed. JSON/logs are `/tmp/alga-regression-unit-{repro,fixed}.{json,log}` (local evidence, not CI proof).
- Added a conservative shared integration-selection policy, workspace DB runner/config, and collection/execution evidence reconciliation. Seven behavioral Node tests pass. Workspace CI lane is present but not yet verified remotely. Full per-test inventory, aggregate gates and remaining work packages are still pending.
- First targeted workspace DB execution passed all six month-end checks. First full 28-file run terminated with 80 passing, 54 failing and 87 skipped assertions; the new reconciler rejected it. Results were in `test-results/workspace-db`, logs `/tmp/alga-regression-workspace-db-full.log`. Skips include explicit hour-block/accounting opt-ins; added runner environment wiring and migrated global bootstrap so these execute. Schema-name defaults caused two additional failed suites; explicitly select test_database.
- Repairing obsolete `clients.credit_balance` fixtures in four workflow suites; prepaid settings tests still expected a release flag intentionally removed by `dba55c91ab`, so retain runtime permission-denial/read/write assertions without that obsolete flag. QBO unlink/export fixtures need real invoice rows because the adapter now locks invoices before remote writes. Client pulse closed-ticket fixtures need canonical closed status rows.
- Infrastructure targeted reproduction: 16/18 assertions passed. Three historical billing-cycle failures already fixed on current main. Remaining client-pulse fixture issue and a real bucket-overage service-period linkage failure are being investigated; do not remove infrastructure continue-on-error until repaired/verified.
- Locked dependencies installed, nine shared libraries built. Local runtime uses `/opt/homebrew/opt/node@25/bin` (25.5); CI uses Node 22. Nx data/cache redirected to `/tmp/alga-regression-nx-{data,cache}` to avoid shared worktree cache writes.
- Isolated Colima profile `alga-regression` runs `alga-regression-pg` (pgvector/pgvector:pg16, host 55432) and `alga-regression-redis` (redis:7-alpine, host 56379). Always use explicit Docker context `colima-alga-regression`. Default Colima profile was stopped before setup. Colima changed current Docker context; restore when cleanup is appropriate. No production database used.
- Reproduction environment: CI=1, DB_HOST=127.0.0.1, DB_PORT=55432, DB_USER_ADMIN=postgres, DB_USER_SERVER=app_user, both test DB passwords=test_password, REDIS_HOST=127.0.0.1, REDIS_PORT=56379, REDIS_PASSWORD empty, APP_ENV/NODE_ENV=test, SECRET_FS_BASE_PATH=/tmp/alga-regression-secrets, VITEST_SEED=20260610, NODE_OPTIONS=--max-old-space-size=8192. Run `node scripts/run-workspace-db-tests.mjs [file filters]` serially; helpers recreate test_database. No concurrent DB runners on that instance.
- PR has not yet been created. Effective GitHub required checks remain the two pre-existing guards from the audit; no protection/deployment/Sheets changes have been made.

### PR and baseline follow-through

- Draft PR: https://github.com/Nine-Minds/alga-psa/pull/3343. Initial push was rejected by automatic approval review for missing destination/payload trust evidence. Verified origin is public `Nine-Minds/alga-psa`, active account `RobertAtNineMinds` has ADMIN access, and reviewed payload consists of testing code/config/plan only. Retry was approved; no permission block remains.
- Main advanced to `96a8f56492` and incorporated stronger versions of the baseline fixes. Rebased the PR with `git rebase --onto origin/main 86a27f4d90`, omitting the superseded baseline commit. Pushed with lease; PR CI then started. Current foundation commits before subsequent repairs: `e9bd361ef4`, `dee0587145`.
- Full workspace run #2 executed all 28 files / 221 assertions with **207 pass, 14 fail, 0 skipped**. Saved report/evidence `/tmp/alga-regression-workspace-db-full2{,-evidence}.json`. All remaining failures were in time-workflow tests, initially stale service-type/catalog fixture columns. Hour-block opt-in and schema-name setup repairs are verified locally.
- Time suite then exposed two real runtime bugs: delete omitted `end_time` from its SELECT but consumed it; update adapter added undefined patch fields, clearing notes and timesheet association. Existing T003 reproduced deletion failure; strengthened T003 reproduced notes loss before the fix. Fixed runtime behavior and retained explicit-null semantics. `/tmp/alga-regression-time-red-preservation.json` proves failure; `/tmp/alga-regression-time-green{,-evidence}.json` proves all 14 assertions passed after fixes.
- Other time fixture repairs: use canonical permission resource names (`time_entry`, `time_sheet`), include April 8 in the half-open open-period fixture, and seed billable minutes for a missing-work-item billing blocker. Assertions remain behavioral; no source-string tests added.
- Execution evidence now collects individual test names before execution and compares identities/cardinality, including duplicate parameterized names. Mandatory skipped/todo assertions fail. Runner distinguishes dirty local work from committed revision evidence. Nine Node behavioral tests pass, and real Vitest collection/execution reconciliation passed on the 14-test time suite. Full 28-file run with this new collector remains to verify.
- CI for PR head `dee0587145`: integration run `34008941094`, unit run `34008941057` confirmed in progress. Infra full and workspace DB jobs run; initial guards pass. Later local fixes have not yet been pushed at this log entry. No claim of all-green CI.

### Invoice linkage regression

- Client-pulse fixture fix verified: all eight infrastructure assertions passed (`/tmp/alga-regression-client-pulse-fixed.{json,log}`).
- Fixed bucket-overage persistence: carry the selected recurring timing through engine loading and the normalized charge-domain adapter into bucket computation; reject mismatched period boundaries; claim the period once across fixed and non-fixed details on the same invoice. The previous set was scoped separately inside fixed groups and non-fixed persistence, so a fixed fee and its overlay could not share a claim.
- Expanded the existing DB regression to cover 0-cent and 10,000-cent fixed fees plus five hours of overage, asserting invoice totals and persisted period/detail linkage. Fixture now uses `hourly` for hours; `usage` represents catalog units under current semantics. All four tests in usageBucketAndFinalization pass (`/tmp/alga-regression-bucket-fixed2.{json,log}`). First attempt still failed both bucket cases because the normalized adapter dropped timing; final run covers the complete path.
- Added a compute behavior test for preserving selected record identity and refusing an unrelated usage period. Existing fixed/time persistence and compute/golden suites: 61 assertions passed (`/tmp/alga-regression-bucket-compute.log`), including failure to claim previously billed/unlinkable periods.
- Additional investigation lead: bucket loader supplies `serviceContributions`, but normalized charge facts currently omit that field. This can discard weighted service attribution; investigate with a composed behavioral regression before fixing. Do not treat the unit compute tests alone as proof of the production adapter path.
- PR workspace DB job `101421249567` completed with 217 pass / 4 fail / 0 skipped on pre-fix `dee0587145`; failures exactly match the four time-workflow cases subsequently repaired locally. Log `/tmp/alga-regression-pr3343-workspace-db.log`. Retrieved via jobs/logs API because gh run view refuses job logs until the entire workflow ends.

### Complete local workspace execution and contributor follow-through

- Full workspace run #3 passed **28 files / 221 tests / zero skipped**, with all 221 expected and executed identities matched. Evidence `/tmp/alga-regression-workspace-db-full3-evidence.json`, results `/tmp/alga-regression-workspace-db-full3.json`, collection `/tmp/alga-regression-workspace-db-full3-collected-tests.json`. The report honestly flags local dirty work; this is not immutable-artifact or latest-head CI proof. The test runner records the HEAD it started from (`41474dc995`).
- Negative harness check: deliberately invalid isolated-test admin password returned exit 1 with `auth_failed` and `Test collection failed` evidence, not a skip. Saved `/tmp/alga-regression-db-unavailable{,-evidence}.{log,json}` as applicable. This negative run overwrote ignored test-results/workspace-db; the passing full run remains in the /tmp copies above.
- Confirmed the contributor-loss lead with two composed domain regressions (live and simulate): normalization collapsed taxable and exempt service contributions to one aggregate. Both tests failed before the adapter fix; after carrying optional camel-case periodContributions through both boundaries, independent expected amounts (1500 taxable + 500 exempt, 150 tax) pass. Red/green logs `/tmp/alga-regression-bucket-attribution-{red,green}.log`.
- Seeding the actual hourly work behind the bucket allowance then exposed double billing: all 45 hours were charged normally as well as the five-hour overage. Reuse the shared explicit-member/catch-all pool resolver in the hourly loader and exclude explicitly assigned covered work from hourly pricing. Preserve the existing path for unassigned work and project-driven billing. Do not infer broader usage-pool lifecycle coverage from this hourly fix.
- Invoice regressions now seed five real nine-hour entries plus the allowance aggregate. Both fixed-fee+overage cases and ordinary fixed/hourly/usage/finalization pass: seven DB assertions (`/tmp/alga-regression-bucket-attribution-invoice2.{json,log}`). First attempt proves the duplicate hourly charge (`...invoice.json`). Bucket resolution, period, timing, domain and compute checks pass all 75 assertions (`/tmp/alga-regression-bucket-validation.log`).
- Integration workflow now uses full-selection output for the displayed job/step and full metrics classification as well as execution, matching infrastructure's behavior.
- Latest published head before the contributor fix: `41474dc995`, CI integration run `34009472143`, DB job `101422685264`; last inspected in progress. Earlier `dee0587145` Nx affected unit job succeeded, full server coverage job still running. Existing gate scope and the rest of the implementation plan remain pending.

### Verified database CI milestone

- F003 and T003 verified: job https://github.com/Nine-Minds/alga-psa/actions/runs/34009472143/job/101422685264 succeeded at 2026-09-06 03:47:36 UTC. Downloaded `workspace-db-evidence` to `/tmp/alga-regression-ci-41474` and inspected all four artifacts. Runner success=true; 28 expected/executed files, 221 expected/executed test identities; 221 pass, 0 fail/skip/todo/pending; evidence.failures empty. Repeated isolated local runs and the explicit invalid-password failure check substantiate setup/isolation behavior. No parallel sharing is configured; each CI job owns Postgres/Redis and files serialize.
- CI tested PR head `41474dc995` through GitHub's synthetic merge commit `59306d427c11c4bb43c34f8e872d8d9d93da5dc8` (the artifact's revision). It records workingTreeDirty=true. Investigate/report changed paths when implementing immutable artifact evidence; npm ci locally changed migration-cli executable mode, but CI's exact dirty paths have not been captured, so do not claim a pristine checkout/artifact. F020 remains pending.
- Contributor/double-billing corrections are committed/pushed at `08c2f03147`. Latest integration run https://github.com/Nine-Minds/alga-psa/actions/runs/34009892325 was confirmed in progress. No local test processes remain live at this checkpoint. The prior integration runs may still have full infrastructure/integration jobs live; inspect their exact handles before deciding they stopped.
- All other plan features/verification items remain pending. The full goal is not complete: no required aggregate gate, comprehensive browser/provider journeys, upgrade/deploy/Citus enforcement or reporting/assertion-strength rollout is yet claimed.

### Discovery and source evidence follow-through

- Current pushed `08c2f03147` workspace CI also passed: job `101423805827` in run `34009892325`, synthetic merge revision `549fc965ad14e6e27b22eda7006fb5fed80c396d`. Downloaded/inspected `/tmp/alga-regression-ci-08c2`: all 28 files / 221 identities matched, 221 pass, no skips/failures. Prior `dee0587145` full server coverage and Nx unit jobs completed successfully; latest Nx unit also passed.
- Added reusable runner-derived discovery reconciliation and independent Git candidate enumeration. Wired it into the full workspace DB invocation; no exclusions allowed in that lane. The library rejects uncollected/moved files, empty or failed collections, stale/expired/unowned exclusions and identities outside the workspace. Exclusions, when another caller supplies them, remain visible rather than counting as executed tests.
- Fourteen harness behavioral assertions passed, including an installed-Vitest test in a disposable Git workspace that adds and moves files outside configured collection, repairs config and executes/reconciles both tests. Found/fixed macOS symlink-canonicalization in test identity normalization during this verification. Pure checks run in the existing skip-budget job; installed-runner check runs after npm ci in workspace DB CI.
- Full local workspace run #4 passed all 28 files / 221 tests, zero skipped and no missing identities, with the new independent discovery check. All five artifacts saved under `/tmp/alga-regression-workspace-db-full4/`; log `/tmp/alga-regression-workspace-db-full4.log`. Runner now records full vs filtered selection and before/after revision/changed paths, fails if HEAD changes mid-run, and writes failed evidence for collection/parse errors. This local run is explicitly dirty; upcoming CI will show its exact dirty paths. Do not infer image provenance from it.
- Developer guide: `docs/reference/test-execution-evidence.md`. It explicitly limits current enforcement to workspace DB; global inventory/other runner adapters/aggregate readiness remain unfinished, so F004/F006 stay false.
- Full infrastructure baseline run `34008941094` job `101421249422` finished with 479 pass / 4 fail (61 files). Log `/tmp/alga-regression-infra-baseline-ci.log`. One failure is the already-fixed bucket linkage; three are in `contractQuantityUsageSemantics.test.ts`: two independent-connection tests currently mock away withTransaction, and omitted usage is swept into billed recurring periods. Targeted reproduction underway before fixes. No CI assertion weakening or infrastructure continue-on-error removal yet.

### Infrastructure usage baseline repairs

- Reproduced all three remaining usage-semantics failures locally (`/tmp/alga-regression-usage-semantics-red.{json,log}`). Removing the suite's passthrough transaction mocks made both real-connection concurrency checks pass, while the omitted-usage failure remained (`...-transactions.{json,log}`, 2 pass / 1 fail among the three selected cases). Production transaction code was already correct; the tests were defeating row-lock and rollback semantics.
- Actual product defect: the final recurring-window sweep claimed an intentionally omitted usage line as billed. Pass unreported usage diagnoses to the sweep and exclude exact usage line/service-period identities, converting inclusive diagnosis ends to half-open stored boundaries. Fulfilled zero-dollar obligations still claim normally. Existing full-path test proves the omitted line can later be reported and invoiced once; new DB helper regression also proves other lines/periods remain claimed.
- Complete usage-semantics + grouped-claim suites passed 72 tests / zero skips (`/tmp/alga-regression-usage-semantics-green.{json,log}`). Restored real admin and tenant wrappers throughout the suite. Revised lock-test cleanup to drain pending work before destroying its pool; reverified that one test afterward (`/tmp/alga-regression-usage-lock-cleanup.log`, explicit name-filtered run, not full-suite evidence).
- Invoice generation/persistence unit checks: 60 initially passed and one existing exact-call expectation needed the new empty omittedUsagePeriods argument. Re-ran its two-test file successfully (`/tmp/alga-regression-invoice-zero-claim-unit.log`); other results `/tmp/alga-regression-invoice-claim-unit.log`. No assertions removed.
- Discovery/provenance foundation is committed as `763f759e42`. The added grouped-claim case increases the workspace DB lane from 221 to 222 expected tests on the next full run. All plan deliverables beyond F003/T003 remain pending; current repairs are not proof of global release readiness.

### Selection verification and generated calendar coverage

- Previous goal turn is progress: `763f759e42` and `7fcc6d1d2f` published discovery/provenance and invoice baseline fixes. The latest inspected `7fcc6d1d2f` workspace CI job `101426039760` in run `34010734789` passed all 222 tests, with 28 matched files and no skipped/missing identities. Artifacts `/tmp/alga-regression-ci-7fcc`; synthetic merge SHA `9a8bd6cca345e26c2db9c27ef4f0aad64d143bcf`.
- Exact dirty paths are now visible: only `packages/migration-cli/bin/alga-migrate.mjs` before and after CI execution. The tracked CLI entry has a Node shebang/bin declaration but mode 100644. Set it executable (100755); verify clean CI source evidence on the next run rather than claiming image provenance now.
- F005/T005 verified with actual entry-point execution in a disposable Git repository. The selector's GITHUB_OUTPUT and the runner's real Vitest JSON reports agree for lockfile, harness, schema, scripts, services and EE changes; source-only changes select manifest+affected; unavailable base/head, a failed git diff and failed affected graph select full; docs-only skips outer workflow but direct runner retains the floor. Empty/moved mandatory entries fail. Logs `/tmp/alga-regression-selection-runtime.log`, four passing Node tests including the installed-runner test. Runner now invokes the same locked Vitest binary for collection/execution and validates every manifest entry collects files. Full integration workflow also uses this runner with an empty base to force full selection and retain floor validation. New self-test is wired into workspace DB CI after npm ci.
- Added pinned fast-check 4.9.0 to billing devDependencies (npm registry engine >=12.17; current project Node25 local/22 CI). Lockfile adds only fast-check and pure-rand. Primary runner docs: https://fast-check.dev/docs/core-blocks/runners/ . Property tests exercise years 2000–2100, month ends, leap/century years, tenant date changes across UTC and selected extreme/fractional/DST offsets. Date.UTC/Intl supply the expected calendar day independently of the production Temporal policy. Actual DB date hydration and tenant timezone settings are read; invoice creation/auth remain mocked at this layer.
- The 64-run property campaign plus explicit boundary examples and invalid-window guard pass inside the actual workspace DB command: eight calendar tests, zero skips, all identities matched (`/tmp/alga-regression-calendar-final/`). Earlier alternate seed 42 passed the seven-test version before the separate invalid-window test was added (`/tmp/alga-regression-calendar-restored-seed42/`).
- T002/T021 verified: a narrow replay replaces only the three canonical row mappings for service_period_start/end and invoice_window_start with the historical String(date).slice behavior. Real hydrated service periods fail the month-end policy, including the existing positive regression. Fast-check shrank twice to `{year:2000,month:1,dayOffset:0,hour:0,minute:0,zone:UTC}` at seed20260906/path0:0:0. Replaying that seed/path reproduced the same failure; restoring source passed all eight. Source was restored in finally blocks and git diff confirms no remaining change to clientCadenceWindowMaterialization.ts. Compact evidence is `evidence/month-end-hydration-replay.json`; raw logs/artifacts `/tmp/alga-regression-calendar-hydration-replay/`, `/tmp/alga-regression-calendar-counterexample-replay/`, `/tmp/alga-regression-calendar-final/`. A preliminary broader helper mutation also affected assignment dates; do not use that broader run as the narrow service-period evidence.
- F027 remains pending until generated cases run in the containing PR's CI. Next workspace full count should be 224 (222 + property + invalid-window tests). All local commands above are terminal. Latest full infrastructure and integration jobs (`101426039872`, `101426039776`) and oldest integration baseline (`101421249522`) were confirmed live; do not restart or assume completion from elapsed time. The latter runs 274 integration files. Broader global inventory, aggregate/protection enforcement, browser/provider journeys and all remaining work packages remain active.

### Maintained production browser harness and clean calendar CI evidence

- `d6cc980850` workspace DB job `101428260164` in run `34011573162` passed all 28 files / 224 tests, zero skipped/missing identities. Downloaded and inspected all five artifacts under `/tmp/alga-regression-ci-d6cc/`. Source revision is GitHub synthetic merge `8ac8b13f46b7347f4f89e288c43a27f8c98d92f3`; before/after source are both clean. The migration CLI executable-mode correction removed the previously observed npm-install dirtiness. This proves source execution attribution, not release image provenance.
- F027 is now verified: the containing PR's CI executed all eight calendar cases, including the 64-run fast-check campaign and invalid-window rejection. Narrow historical replay/shrinking proof remains in `evidence/month-end-hydration-replay.json`. F015 browser invoice coverage is still pending; this action-level property pilot does not stand in for it.
- Replaced the fresh-install workflow's generated package/config/spec with a tracked standalone `e2e-tests/` package, exact Playwright 1.57.0 lockfile, reusable real-credentials fixture and maintained login specs. The specs assert CE/EE dashboard content, user/tenant session identity, persistence after reload, anonymous browser separation and rejected-password feedback. The workflow provisions CE production containers only; representative EE and multi-tenant/role fixtures remain pending. F010 remains false until its full required scope runs successfully.
- Production browser config runs headed, captures first-attempt trace/screenshot/video on failure and sets failOnFlakyTests with one CI retry. A disposable-suite check launches actual Chromium through this config and proves a first pass exits 0 while a failed-first/passed-retry test exits 1 with all three original failure artifacts. Local probe passed, including the intended assertion failure (not a setup failure), in `e2e-tests/harness-results/`. It is wired before the customer journey command in CI; its fixtures do not count as product coverage. F017 remains pending until production CI coverage and full diagnostics scope are verified.
- Standalone npm ci, Playwright collection (two customer tests), TypeScript validation and workflow YAML parse pass locally. Actual application journey execution against the changed harness remains pending CI. The existing fresh-install run `34011573116` was still building the server image; other images completed. Avoid cancelling that run with an early push. Full infrastructure and integration baselines remain live on the latest revisions; no all-green claim or goal completion.

### Browser execution accounting and infrastructure partitioning

- Previous goal turn made concrete progress: local commit `962a5ef35f` maintains production browser tests and marks the calendar property pilot verified. This turn extended the implementation; no blocked condition exists.
- Production CE baseline at `d6cc980850` completed successfully: run `34011573116`, fresh-install job `101430561606`, with all six production image builds successful. It exercised the previous generated login spec, not the new tracked harness. The full infrastructure job `101428260166` in run `34011573162` also genuinely passed: 61 files / 484 tests, no failures, 1209.54 seconds. Verified its underlying steps and full log (`/tmp/alga-regression-infra-d6cc.log`), rather than trusting the non-blocking check label. Server unit/coverage, Nx unit/typecheck, mobile, translations and guards were green; full integration `101428260172` was still live.
- The previous `7fcc6d1d2f` infrastructure job `101426039872` timed out after its 35-minute step budget with 43/61 files and 353 assertions completed, all observed cases passing. This is variable runtime, not a new assertion regression; full log `/tmp/alga-regression-infra-7fcc.log`. Partition full coverage over three independent CI jobs, each with separate Postgres/Redis and serial files. Tier-1 remains the same four required files in one job. The old job-level continue-on-error is removed; F009 stays pending until the new CI structure is verified green.
- `scripts/run-infrastructure-tests.mjs` independently inventories the whole infrastructure directory, verifies the four-file floor, assigns explicit deterministic file partitions, checks the actual filtered collection, and reconciles individual execution identities. Actual Vitest 3.2.7 `--list --filesOnly --shard=1/3` returned all 61 files, so native shard flags cannot be used as collection evidence here. `scripts/verify-infrastructure-shards.mjs` requires every partition, matching revision/selection/source, no overlaps and complete raw assertion evidence. It produces one combined full-suite metrics row, explicitly partial when a shard is absent, preventing 100% over only observed tests.
- Local real-DB partition 1/3 passed all 21 assigned files / 185 tests, zero skips/missing identities (`/tmp/alga-regression-infra-shard1-evidence/`, `/tmp/alga-regression-infra-shard1.log`). This is dirty local subset evidence, not a full CI result. Node behavioral checks passed 21 tests across selection/discovery/Vitest/browser/sharding accounting. Installed-runner partition exercise passed all three disposable partitions, detected stale/missing evidence, ran the Tier-1 floor and rejected a newly uncollected spec (`/tmp/alga-regression-infrastructure-runner.log`). Metrics unit suite passed 16 tests, including explicit incompleteness despite all observed tests passing (`/tmp/alga-regression-metrics-shards.json`).
- `e2e-tests/run.mjs` now performs independent file discovery and reconciles Playwright project/nested-title/repeat identities before accepting results. It rejects missing, skipped, interrupted, expected-failure and retry-only cases, and records raw results/source context in execution-evidence/. Five browser-adapter behavioral tests and actual headed policy probes passed. The real production wrapper with missing credentials exited 1 and reported both required cases failed, with no application journey attempted (`/tmp/alga-production-browser-missing-credentials.log`). This verifies failure handling, not login success.
- Fresh-install selection now shares the conservative Git selector with integration CI, so changes to wrapper/fixture scripts and unknown paths cannot skip production testing. The already verified selector covers failed/missing diffs and documentation-only selection; browser collection/typecheck, all workflow YAML parses and diff whitespace checks pass locally.
- All broader plan items remain active. New browser application execution, all infrastructure partition CI artifacts and aggregate decisions require the next PR run; global inventory/all runner evidence, effective GitHub protections, EE/customer/provider/service/upgrade journeys and operational release/metrics rollout are not claimed complete.

- Rebased all ten implementation commits onto refreshed `origin/main` `a90cd88edcc2b76e49852b14036c4afb38b8d2a4`; range-diff confirms every patch is unchanged. New infrastructure/browser commit is `b504314672`, following tracked harness `f66518b3b3`. Post-rebase behavioral checks pass. The infrastructure aggregate also consumes the matrix job outcome and rejects failed/cancelled/skipped/missing prerequisites even if artifacts were uploaded before cancellation. No GitHub protection or deployment configuration has been changed.


### Production identities and separate CE/EE execution

- The preceding question-only goal turn made no implementation progress. Revalidated the worktree and specific CI/local handles; this turn adds concrete fixture, browser, and edition execution work. No blocker exists.
- On PR head `fa6740c1c4`, integration run `34013148739` passed every infrastructure partition and the aggregate (jobs `101432349546`, `101432349611`, `101432349592`, `101433484701`). Downloaded raw reports and independently reran assertion and partition reconciliation: 61 files / 484 passed, no skipped/missing assertions. Workspace DB job `101432349563` also passed 28 files / 224 tests. Both use clean before/after merge revision `6bd5a31f91156f32ff3b2ef0ddf950d564f0cbee`. Local artifacts: `/tmp/alga-regression-infrastructure-ci-fa674/` and `/tmp/alga-regression-workspace-ci-fa674/`. F009 remains pending broader gate/quarantine scope; no exclusions were introduced.
- Added worker-owned transactional browser actors: two tenants, each with canonical administrator, technician and two client users linked to separate customers. Uses production migration permission reconciliation and the isolated installation's initialized password hash; all browser authentication still submits the real product form. Synthetic identity attachments omit hashes/passwords. Fresh worker/retry data remains until the disposable database is removed for failure investigation.
- Added client-detail reload/cross-tenant reads and technician identity specs, plus portal identity/reload/MSP-route boundaries and wrong-tenant-slug login rejection. Nine tests now collect across three files; TypeScript check passes. The three real-DB fixture tests pass, including ambiguous source-account rejection and rollback of the first tenant when the second fails (`/tmp/alga-production-browser-fixtures2.json`). These are fixture proofs, not evidence that the new browser journeys have passed.
- Fresh-install workflow now builds a separate actual EE server image, runs CE/EE on isolated runners, downloads only the appropriate server artifact plus shared images, and uploads edition-specific reports. All compose operations use the complete configured override set, so EE selection also applies to migration setup. The stable `fresh-install-e2e` check requires both edition outcomes and image builds. Exercised its actual shell with 375 result combinations; only complete success or explicitly selected documentation-only non-applicability passes. `actionlint` passes, and resolved Compose configs agree on production image/runtime/migration edition.
- The Ubuntu setup image previously omitted EE migrations; added them so the existing enterprise entrypoint can actually apply them. The production EE Dockerfile now consumes the configured build heap limit like CE. A disposable local PostgreSQL database applied all 1,053 combined CE/EE migrations successfully, including Teams table creation (`/tmp/alga-ee-fresh-migrations2.log`, database `browser_ee_migrations_1788672908117`). Initial probe lacked a sibling invoice-template source path; corrected the probe layout and reran from a fresh database. This is fresh single-node schema evidence, not Citus, upgrade, or built-image execution evidence.
- Latest published production run `34013148769` finished all six image builds and started job `101434727740` using the two tracked login tests. Its actual browser outcome remains pending. Keep that run alive until terminal before pushing the new identity/edition revision. F010/F016/F017 and broader plan scope remain unclaimed until their full requirements are proven.

- Published fresh-install run `34013148769` is now terminal **failure**: the policy probe produced the intended fail/pass retry and trace, but no screenshot/video attachment. Product login tests were skipped by normal step dependency semantics. Raw reports/traces are in `/tmp/alga-browser-fa674/`; full job log `/tmp/alga-browser-job-fa674.log`. The next workflow retains this policy failure as blocking while allowing independent customer journeys to run afterward; browser launch diagnostics are now preserved by the probe. A reproduction is pulling the official Playwright 1.57.0 Noble image in Docker context `colima-alga-regression`, command handle `47827`, container name `alga-browser-policy-probe`, log `/tmp/alga-browser-policy-linux.log`. It is still live and has not yet executed the harness; do not restart merely on a polling timeout.
- Nx unit job `101432308343` failed in `automaticInvoices.poOverageDialog.test.tsx` first test at 20,093 ms, with remaining nine cases passing under a second. The first helper lazily imported the large component graph inside the test. Local baseline passed all ten, with the first taking 3.7s and the others around 24–46ms. Moved that import into an explicit 60s beforeAll; retained all assertions and existing per-test/poll budgets. Afterward all ten pass, first case 48ms (`/tmp/alga-po-overage-after.json`). CI confirmation remains required. The full integration and server unit-coverage jobs are still live, so there is no all-green claim.


### Linux diagnostic readiness and portal ticket round trip

- Previous goal turn made concrete progress in pushed commit `6e54118c0b69cf9fee986637c430e7c3d7d24490`. Current CI: fresh-install `34014663395` (server CE `101436308840`, EE `101436308832` still building), integration `34014663409`, unit `34014663473`. No goal blocker; full scope remains active.
- Reproduced the artifact failure with official `mcr.microsoft.com/playwright:v1.57.0-noble` (digest `sha256:3bed4b1a12f2338642f3d8cba28e291deef3c66bd4a964bbeb3e57bbff511dbd`) in isolated Docker context `colima-alga-regression`. The first container's xvfb-run was PID 1 and waited indefinitely for its already-ready X server's SIGUSR1; confirmed ready socket/process state, delivered that signal, and the existing command completed with missing video. Subsequent runs use Docker `--init` so Xvfb's wrapper has an ordinary parent and starts normally. All these containers are now terminal and removed; original handle `47827` must not be treated as live.
- Linux ffmpeg logged `Output file does not contain any stream`: the about:blank/setContent probe completed before a recorded frame. Immediate screenshot after navigation also raced the Xvfb surface (`Page.captureScreenshot: Unable to capture screenshot`). The policy probe now navigates, polls for an actual screenshot within 10 seconds, and awaits two animation frames before the deliberately failing assertion. All retention/flaky/skip/expected-failure assertions remain intact. Linux verification passed twice (`/tmp/alga-browser-policy-linux3.log`, `/tmp/alga-browser-policy-linux4.log`), and headed macOS verification passed (`/tmp/alga-browser-policy-mac-fixed2.log`). First macOS attempt was sandbox-denied at Chromium startup; escalation resolved it. No product coverage is inferred from these probes.
- Added a portal request-to-technician-to-portal browser journey. It submits through the actual form, verifies a single persisted ticket with client/contact/board/status/priority/default assignment, posts separate public/internal technician comments, reloads to verify persistence, shows only the public reply in the portal, and rejects direct access from another client and another tenant. This is collected/typechecked but awaits production runtime validation; F013/F016 remain pending.
- Browser actor fixtures now seed a support board, open/closed statuses, and a normal priority for each tenant, with the canonical technician as default assignee. Real-DB tests still pass all three cases including rollback and permission/client linkage (`/tmp/alga-production-browser-fixtures-ticketing.json`).
- CI circular-dependency job `101436267148` found `alga-production-e2e-tests -> server -> alga-production-e2e-tests`: the new server fixture test imported the browser package, which imported server migration helpers. Moved the shared actor implementation to `server/test-utils/productionBrowserFixtures.ts`; browser auth imports it, and the server test remains within server. The actual Nx graph and unchanged cycle checker now pass (three existing cycles only), without changing the baseline (`/tmp/alga-regression-project-graph-fixtures.json`). Relocated real-DB tests pass all three again (`/tmp/alga-production-browser-fixtures-relocated.json`). Ten browser tests collect in four files, and the updated TypeScript check passes. These changes need the next CI revision; do not mark the plan complete.

### Emulator request evidence and production build memory

- The preceding question-only goal turn was no progress. Revalidated the worktree and recovered the prior host run from its terminal JSON report: all 26 tests passed. Continued implementation; no goal blocker exists.
- Added a bounded HTTP vendor request journal to the emulator host, exposed at `GET /control/:emu/requests`. It observes actual traffic before transport-fault middleware and records arrival sequence, method, path, virtual start time, elapsed wall time, status or aborted connection. It excludes query strings, headers and bodies. Truncation and in-flight requests make evidence incomplete; non-HTTP protocols explicitly report unsupported. Reset advances the generation so late responses cannot contaminate the next journal. This does not cancel outstanding application jobs or vendor state mutations; callers must drain them before reusing provider state.
- All 27 host tests pass, including six new behavioral scenarios covering successful/429 traffic, credential omission, truncation, reset/fault cleanup, in-flight completion, late old-generation responses, connection resets and unsupported protocols (`/tmp/alga-emulator-request-history-final.json`). Host typecheck and build pass. The all-provider suite initially could not resolve unbuilt msgraph artifacts; compiled all six providers and reran: both real suite scenarios pass (`/tmp/alga-emulator-suite-with-history-built.json`). F031 remains partial: production fixture wiring and provider journeys are still required.
- Published head `6e54118c0b` now passes Nx affected unit tests (`101436267016`), typecheck (`101436266672`), all three infrastructure shards and the infrastructure aggregate (`101437875305`), plus workspace DB tests (`101436315840`). Full integration and server coverage jobs were still live at the last check. This is check-status evidence, not a fresh independent reconciliation of their raw artifacts.
- EE workflows guard `101436266627` exhausted heap while `nx build-deps server` traversed the erroneous server/browser cycle into `server:build`. The already-local fixture relocation fixes that graph: `/tmp/alga-server-build-deps-fixed.json` has 57 tasks and only `server:build-deps` as a server task, with no `server:build`. Next CI must verify the guard outcome.
- EE image job `101436308832` is terminal failure (`/tmp/alga-ee-image-6e541.log`). It first completed an unnecessary server build through the same cycle, then the actual `npm run build:ee` was SIGKILLed with `ResourceExhausted: cannot allocate memory`. The next workflow adds 8 GiB of swap on disposable server image-build runners while preserving the production webpack build and Node heap limit. This is a mitigation awaiting CI evidence; it is not yet a verified EE build fix. Fixed existing shell quoting findings in the touched workflow; full `actionlint` now passes.
- CE image job `101436308840` was still live at the last observation, but the terminal EE failure prevents this run's build matrix from enabling customer journeys. Publishing the verified local changes supersedes that failed revision; it is not a restart caused by an observation timeout. Full F010/F013/F016/F017 and broader release/metrics/provider scope remain unproven.

### Candidate emulator image and isolated production fixture wiring

- Previous goal turn made concrete progress and pushed `8d475419d374e417ab588aa6dc44c0a5b066ee2f` to PR #3343. Current fresh-install run `34015804723` has completed its five shared-image builds; CE `101439348299` and EE `101439348300` are still building. Circular-dependency run `34015804639` passed, confirming the fixture relocation in CI. EE workflows guard `34015804586` remains live. No failed checks were reported at the last snapshot; this is not all-green evidence.
- Added a candidate-source algasim image to the fresh-install build matrix. `build-image.sh --stage-only` compiles/stages all eight packages for Buildx; `.dockerignore` sends only that runtime context. CI runs host behavior tests and the new browser control-client tests before exporting the image. Both edition stacks load this run's emulator image, retain its local image ID and capability catalog, and start a fresh instance without a persisted volume.
- Added a reusable Playwright provider fixture with explicit selected providers, isolated-instance requirement, single-worker enforcement, per-scenario reset, and final request/control-operation diagnostics. Seed payloads, credentials and response bodies are omitted from default diagnostics. Reset refuses observable unfinished HTTP requests; application jobs must still be awaited/drained by the journey. The three real HTTP control-client tests pass, covering seeded Stripe state and 429 faults, error redaction/provider boundaries, and in-flight reset rejection (`/tmp/alga-emulator-control-client.log`). Fixture/config/spec TypeScript compilation and full workflow `actionlint` pass.
- Endpoint overrides are applied to server, email-service, and workflow-worker. Microsoft login uses `algasim.test` because the same base serves browser authorization and server token exchange: CI adds the host entry, and the container gets a matching network alias. QBO/Xero authorization uses host localhost URLs while token/API calls use container addresses. Stripe's public Checkout URL and container callback base are supplied to browser fixtures; provider-specific setup/journeys must actually seed those values.
- The Docker isolation rehearsal caught that an internal network removes published ports. Added a small fixed-destination TCP ingress, the only service connected to a routable network, to expose application/PostgreSQL/provider ports to the host runner. Application, workers, and emulator remain exclusively on the internal network. Local runtime proof verified host control and Stripe requests through ingress while the emulator's external HTTP attempt remained blocked (`/tmp/alga-internal-ingress-evidence.json`). Both final CE/EE resolved Compose configs have the expected network membership, endpoint overrides and ingress ports (`/tmp/alga-emulator-{ce,ee}-compose-final.json`).
- Built and started the actual staged local emulator image: image config `sha256:de7b625287c5a960f0a6c56814b8f7e01b2b850354099da7e9e9be63bef73d41`, build log `/tmp/alga-emulator-production-image.log`. It serves all six providers and passed real Stripe customer readback, injected 503, and request-history assertions (`/tmp/alga-packaged-emulator-evidence.json`). This is local architecture/runtime packaging proof, not the CI Linux/amd64 image or application/provider journey proof.
- Added a CI routing probe executed inside the real server and email-service containers. It verifies all four API destinations respond through their emulator journals, the shared login alias resolves, and external fallback is blocked. The exact probe passed locally in the internal Docker network against Graph/QBO/Xero/Stripe. All disposable probe containers and both dedicated probe networks were removed after verification; no local Docker build/probe command remains live.
- F031 remains partial until real production provider journeys and callbacks execute. SMTP/MIME, dedicated workflow/Temporal workers, Microsoft SSO/Teams production limitations, provider parity, and the rest of the original plan remain outstanding. Keep the already-running production builds alive to obtain portal/browser evidence before publishing another revision where practical.

### Stripe production journeys and callback redelivery

- Previous goal turn made concrete progress in local commit `783787ed09` (not yet pushed, to preserve the existing production build run). Current work adds the first provider browser journeys; F031/F032 remain unverified at production runtime, with no narrowed completion claim.
- Added three EE Playwright cases: real portal sign-in and hosted Pay through a signed callback, reload and invoice/payment/ledger checks, redelivery of the same event with exactly one financial effect; decline then cancel with no settlement; and a persistent Checkout creation fault followed by explicit disarm and UI retry for the same invoice. CE collects a distinct real API assertion for its 404 enterprise-payment boundary. Actual runner collection now finds 13 EE cases / 11 CE cases in five files, with no conditional skipped cases (`/tmp/alga-stripe-browser-{ee,ce}-collection.json`). Collection output labels unexecuted cases skipped internally; their `expectedStatus` remains passed. This is collection, not execution evidence.
- Each payment scenario seeds fresh actors to avoid stale external-customer IDs across provider resets. The invoice, matching charge, and enabled provider configuration are inserted in one transaction. A real migrated EE schema probe passed and rolled back all data (`/tmp/alga-payment-fixture-probe2.log`, database `browser_ee_migrations_1788672908117`). The first probe had an ESM/CommonJS import mismatch before connecting to the DB; corrected the probe import without changing product exports. TypeScript compilation of all browser config/fixtures/specs passes.
- Added Stripe `redeliver-event`, preserving event identity/payload and recording per-target attempt numbers. Found and fixed an emulator bug: signatures were stamped with `event.created`, so an old event or virtual-clock scenario could fail the application's timestamp tolerance. Delivery signatures now use delivery wall time. The new HTTP behavioral test preserves a historical event and verifies its signature timestamp and repeated-delivery bookkeeping; unknown events return 404 without delivery.
- Demonstrated the regression: temporarily restoring the original `event.created` signing behavior made the new targeted test fail on the stale timestamp (`/tmp/alga-stripe-old-signature-replay.json`); the source was restored in a finally block. All 22 Stripe tests then passed with no skips (`/tmp/alga-stripe-redelivery-final.json`). Stripe typecheck/build also pass. The candidate emulator CI build now requires this suite in addition to host/control-client tests.
- Published `8d475419d3` CE image job `101439348299` has completed successfully. EE image job `101439348300` in run `34015804723` and full integration `101439280861` remain live. Do not restart them due to an observation timeout. The built server/browser suite still needs to execute; none of the new Stripe cases has run against production yet.
- EE guard `101439227009` is terminal failure. Log `/tmp/alga-ee-guard-8d475.log` confirms the repaired dependency graph built only upstream tasks, then the actual webpack build compiled and reached page-data collection. The runner received a shutdown signal; check annotations say only `The operation was canceled`, so an OOM cause is not proven for this run. Updated that guard to supported Node 22, strict `npm ci`, and the same 8 GiB swap headroom used by production image builds; retained assertions and build behavior. Added missing EE workflow/package/dependency trigger paths. Full `actionlint` passes for both touched workflows; the guard changes await CI validation.

### First CE portal runtime evidence and EE startup correction

- All seven production image builds in run `34015804723` succeeded. CE browser job `101442330030` executed the tracked suite: nine passed; the new portal round-trip failed on both attempts because it targeted the former conversation layout. The captured staff screenshot and trace show the actual default Grid layout, Timeline tile, and Add Comment control. Updated the test to the observed Timeline root and accessible Client/Internal visibility buttons and Send control; retained database persistence and cross-client/tenant assertions. No application reply defect has been established. Browser fixtures/specs typecheck; the corrected journey awaits production execution. Failure evidence is in `/tmp/alga-browser-ce-8d475-artifacts/`.
- EE browser job `101442330066` failed before credential capture: startup's credential-vault guard rejected a missing encryption key. CI created the secret file, but the EE override inherited the CE service's secret list, which did not mount it. Added the existing `credential_encryption_key` secret to the EE server. Resolved Compose confirms `/run/secrets/credential_encryption_key` and all eleven previous secrets remain mounted (`/tmp/alga-ee-secret-compose.json`). This is configuration validation; actual EE startup is pending. Both changed workflows pass actionlint.
- Found QBO emulator company-info reads returned the default realm identity for every company. Added actual HTTP assertions to the existing multi-company test, which failed before the fix (`/tmp/alga-qbo-company-before.json`). The handler now returns the selected simulator's realm ID and company name. All eight QBO tests, typecheck, and build pass after the fix (`/tmp/alga-qbo-company-after.json`, `/tmp/alga-qbo-company-build.log`). This supports correct connection identity for forthcoming real OAuth browser journeys.
- Infrastructure partitions/aggregate and workspace database tests on `8d475419d3` are green. Full integration and server unit coverage remain running; the EE build guard has the previously diagnosed terminal runner shutdown. The overall PR is not green and the full plan remains active. No completion flags were promoted from collection/configuration-only evidence.

### QBO browser export and recovery implementation

- Published `0401654c164b1727163ce0475e45f133aa7e98f1` to PR #3343. Fresh-install run `34017777484` has successfully built and tested its candidate Linux emulator image (job `101444601653`); CE/EE server builds remain live. Keep this run intact to obtain actual emulator routing and Stripe/portal runtime evidence.
- Added `e2e-tests/fixtures/accounting.ts`: fresh canonical actors, service/type, finalized manual invoice and matching charge, plus an existing realm-scoped customer linkage as an explicit precondition. Does not seed service mappings, OAuth tokens, or export results. Real migrated EE schema validation passed inside a transaction with all rows rolled back (`/tmp/alga-accounting-fixture-probe.log`). No Stripe configuration is added by this fixture.
- Added a QBO production browser case: real admin sign-in; save tenant credentials; actual provider authorize/code/callback; selected company survives reload; live service/item selection and persisted mapping; create and execute a filtered export batch; deterministic provider 500 without a remote invoice/mapping; disarm, expire access tokens, and retry; verify delivered batch, exact vendor invoice amount/customer/item, durable remote ID, no invoice in the other company with colliding entity IDs, and refusal to export the same invoice again. CE collects a separate real API 501 capability assertion. Vendor company-picker choice is controlled by the emulator; customer linkage is fixture setup, not customer-mapping UI coverage.
- Collection finds 14 EE / 12 CE cases across six independently discovered files with no exclusions (`/tmp/alga-qbo-browser-{ee,ce}-collection.json`). All browser TypeScript checks and actionlint pass. Added QBO emulator's behavioral suite to candidate-image CI requirements, covering the company-info defect fixed previously. The new QBO browser case has not yet executed against the production application, and F033 remains false.

### Ticket lifecycle and mutation pilot

- The prior goal turn made concrete progress by publishing `0401654c16`, committing QBO journey `01d00c8ae3` locally, and correcting the PR description. Current work continues the full plan; there is no blocker. The current production run `34017777484` is still building CE/EE servers; shared images including algasim are successful.
- Extended the existing portal ticket journey with technician-driven reassignment through the current Grid hero, resolution plus closure, and reopening. Assertions require reload-visible status and assignee, recorded closure actor/time, clearing closure metadata after reopen, retained replies/resolution, and portal/cross-client visibility. All browser TypeScript checks pass; the extended journey still needs production execution. F012/F013 stay false.
- Installed version-pinned Stryker core/Vitest runner 10.0.0 after checking published Node >=22 / Vitest >=2 compatibility. The mutation pilot uses installed root Vitest 4.1.10; both behavioral suites also pass under the existing server Vitest 3.2.7 (31 tests, no skips). The only existing lockfile version change is ajv 8.18.0 -> 8.20.0, required by Stryker core's ~8.20.0 dependency; other additions belong to the pilot dependency tree.
- Scoped mutation targets are the real calendar month-end close policy and authorization scope intersection. First run: 83 mutations, 70 killed, seven survived, six uncovered across 23 tests (`/tmp/alga-mutation-first.json`). Found the empty-scope test used a circular mutable constant oracle; changed it to explicit behavioral expectations. Added rejection of first-of-month periods longer than one month, legacy ISO boundary handling, invalid/missing timezone fallback, invalid instant refusal and boolean caller boundary assertions.
- Final command `npm run test:mutation:pilot` passed: 79/83 killed, three behaviorally equivalent survivors and one uncovered fallback outside the typed constraints contract, 31 tests, about three seconds locally. No exclusions or disabled mutation operators. Reviewed source-hashed baseline is `evidence/mutation-pilot-baseline.json`; runtime artifacts in `reports/mutation/`, local logs `/tmp/alga-mutation-{first,second,final}.log`. Added a scoped PR/manual workflow that requires valid execution evidence and reports the score without a score-based release gate. F026/T020 await publication/CI verification.
- Older unit coverage job `101439227123` in run `34015804613` is now terminal cancelled at its 60-minute job limit. It stopped reporting file completions at 06:35:04 after BentoTimelineTile.composerHeading.test.tsx, then was cancelled at 07:10:38. About 2481 completed/skipped file entries appear in the log; current collection has 2695 files with 214 absent from that older log (includes revision differences). This is not evidence of a coverage-only slowdown or of all assertions passing. Raw log `/tmp/alga-unit-8d475.log`, current collection `/tmp/alga-unit-all-files.json`. Next diagnostic work should identify the active module at the stall and preserve partial execution evidence rather than merely extending the timeout or excluding tests.

### Durable progress evidence, production results and Add Usage

- Published candidate `0401654c16` now has a successful full server unit/coverage run `34017777479`, job `101444553279`: 2,676 files passed, 19 skipped; 14,393 assertions passed, 112 skipped, 22 todo; 27.4 minutes. Coverage: statements 34.5%, branches 31.07%, functions 34.29%, lines 34.93%. Raw log `/tmp/alga-unit-040165.log`. These exclusions remain visible; a passing process is not a claim that every collected case executed. All affected unit, workspace DB and infrastructure jobs also passed. Full integration `34017777500` remains live.
- Production run `34017777484` built all eight images. CE job `101447416431` passed all 11 browser cases; EE job `101447416442` passed ten and failed the three Stripe cases. Real credentials, edition dashboard content, reload/session isolation, tenant/client boundaries and the existing portal round-trip passed in both editions. Both diagnostic harness steps passed and EE preserved first-attempt artifacts. F010/F017/T009 now have actual production evidence. The extended assignment/closure/reopen version and new QBO case are still awaiting their first published execution.
- Stripe's first real EE run never reached the provider. Server logs report `Stripe payment configuration not found for tenant`. The Compose override supplied `STRIPE_PAYMENT_WEBHOOK_SECRET`, but the real EnvSecretProvider reads the lowercase app-secret name verbatim and Stripe has no uppercase webhook fallback. Corrected the disposable stack to `stripe_payment_webhook_secret`. A direct run of the actual provider reproduces the missing value with old wiring and resolves it with the corrected parsed Compose environment. Browser validation is still pending. Artifacts: `/tmp/alga-ee-browser-040165-artifacts/`; log `/tmp/alga-ee-browser-040165.log`.
- Added a coordinator-side JSONL Vitest progress reporter and always-upload artifacts for unit and Tier-1/full integration jobs. It records queued/collected/started/completed modules and ready/result test identities, excludes console/error/environment payloads, and clears stale run evidence. It is diagnostic only; skipped test readiness and an absent final report cannot imply readiness. Real installed Vitest 3.2.7 and 4.1.10 tests verify pass/fail/skip identities and kill a deliberately stuck import worker to prove partial evidence survives without completion. Both pass. Documentation includes reproduction and interpretation.
- All 214 files absent from the older cancelled unit log completed locally: 1,169 assertions passed, no skips (`/tmp/alga-unit-missing-results.json`). Full local coverage diagnostic then completed without the stall; it found five macOS-only repair-script failures caused by GNU-only stat flags. Added GNU/BSD metadata probing. Existing secret-provider/repair tests now pass (36 passed, six existing platform/privilege skips), and an ephemeral Linux container verified dry-run refusal, repair, clean recheck, content preservation and symlink refusal. No assertions were weakened. Local full report before this correction: `/tmp/alga-full-unit-results.json`; progress `/tmp/alga-full-unit-progress.jsonl`; focused after-fix report `/tmp/alga-secret-repair-mac-results.json`. The initial sandboxed diagnostic was intentionally replaced after a direct loopback probe proved EPERM; the complete diagnostic used required local socket access.
- Added standalone Add Usage fixture and browser journey with a canonical non-admin Finance actor, overlapping usage/fixed-bucket lines, last complete UTC month, four units at $10/unit, reload identity/date/quantity checks and exact $40 invoice preview without invoice/charge mutation. Shared billing setup helpers now accept their actual structural dependencies and import the pure tenant query facade plus Node UUID generation, avoiding connection/secret startup in browser collection. Existing scheduled periods are explicit fixture preconditions using production identity builders; period materialization itself is not claimed as browser coverage. Real migrated EE fixture probes pass with all rows rolled back, and the existing `usageAddFlowOverlappingBucket.test.ts` passes against dedicated disposable DB `regression_usage_fixture_20260906` after the helper change. Collection: 15 EE cases across seven files. The 13 changed/browser TypeScript files have no diagnostics; three other transitive diagnostics remain outside this focused check. F011/T010 remain false pending actual production execution and the full cross-tenant mutation boundary.
- All touched workflows pass actionlint; repair script passes shellcheck. No GitHub protection, release, deployment or shared Sheets settings changed. The full goal remains active and the PR is not green.


### 2026-09-06 — Additional workspace execution paths and mutation CI proof

- Continued WP1/F004 inventory work. A raw 70-config Vitest collection probe found
  3,891 conventional tracked test/spec candidates and 108 unmatched files. This is
  a discovery lead, not execution proof: some broad configs collect files belonging
  to another runner. F004 remains false until every actual CI path and reviewed
  exclusion is accounted for.
- Added `server/src/test/unit/**/*.db.test.*` to the dedicated workspace DB lane,
  with independent candidate classification. The previously omitted hour-block
  notification migration rollback suite executed all five assertions successfully
  against the isolated migrated local database (filtered invocation, no skips).
  Full workspace DB collection now includes 29 files; full expanded execution is
  still required. Local log: `/tmp/alga-hour-block-migration-db-run.log`.
- Added explicit workspace-unit and workspace-runtime configs and a launcher using
  the existing file/test identity reconciliation and durable progress reporter.
  Full local unit evidence: 21 files, 91 passed assertions, no skips/todos. Full
  local runtime evidence: 2 files, 7 passed assertions against real MinIO and a
  Temporal SDK test server, no skips/todos. These are dirty-worktree local results;
  the new GitHub Actions workflow must still pass on the published candidate.
- Fixed package-working-directory assumptions in SDK WIT resource paths and worker
  validation fixtures. The validator's nominally valid AI graph also pointed out
  of its fixture and lacked two imported modules; restored a complete resolvable
  fixture without weakening import-validation assertions. Temporal path tests now
  explicitly model the worker package launch directory and restore environment
  overrides and spies afterward.
- Renamed the actual S3 bundle-store integration suite with `.integration.test.ts`,
  removed its missing-configuration skip path, provisioned the dedicated test
  bucket, and used 5 MiB multipart parts. Unit success cannot count this real-service
  coverage. The runtime workflow starts and removes disposable MinIO storage.
- The actual launcher behavioral test uses a disposable Git repository and the
  installed Vitest runner. It verifies a successful assertion, then proves a new
  omitted file, skipped assertion, failed assertion and empty collection all fail
  the launcher, replacing stale successful evidence. Additional discovery and
  execution-accounting self-tests passed 12 assertions.
- CI mutation run 34020091615 / job 101450948855 completed successfully for PR head
  `12c880cccc` on merge revision `3327375f396fd81d18969f708690566bc3b52717`.
  Downloaded summary reports Node 22.23.2 and a clean checkout. Both selected source
  hashes match the local files and reviewed baseline: 79 Killed, 3 Survived, 1
  NoCoverage. Existing baseline classifies the four remaining cases; job elapsed
  time including install is 138 seconds. F026/T020 are now verified, scoped pilot
  work; no repository-wide score or merge enforcement is claimed.

- Earlier full integration CI run 34017777500 / job 101444597237 is now terminal
  success. Its actual report shows 264 files passed, 14 files skipped; 1,915
  assertions passed, 134 skipped (2,049 total), with a 3,565.21-second test duration.
  This resolves the suspected hang for that run; it does not prove skipped suites
  executed or satisfy global inventory completeness. Current-head integration
  validation remains a separate result. Log saved at
  `/tmp/alga-full-integration-040165.log`.
- Fresh `git fetch origin main` still resolves `a90cd88edc`; verified it is an
  ancestor of this worktree HEAD. The requested origin/main base is preserved.

- Expanded workspace DB execution subsequently completed: all 29 files and 229
  assertions passed, no skips/todos/missing identities, full selection. Vitest
  duration 191.39 seconds. Evidence is in `test-results/workspace-db/evidence.json`;
  log `/tmp/alga-workspace-db-29files.log`. New workspace unit/runtime launcher
  behavioral self-test passed in 3.78 seconds; workflow actionlint and the existing
  skip-budget check passed. Mutation execution itself took 11 seconds in CI (31
  baseline assertions), in addition to the recorded whole-job duration.
- Publication is deferred while production validation run 34020091589 is live on
  head `12c880cccc`: its workflow cancels in-progress PR runs on a new push. Seven
  images have completed successfully; the CE server image remained live at the
  last readback. Preserve this run to obtain the first complete evidence for the
  latest usage/QBO/Stripe/extended-ticket candidate before pushing the new lanes.


### 2026-09-06 — Production browser findings and unit import isolation

- PR head `12c880cccc` production run 34020091589 is terminal failure, so it is now
  safe to publish the queued workspace-lane commit. All eight candidate images
  built successfully. Actual browser evidence: CE 12 passed/1 failed; EE 13
  passed/2 failed, no skipped or flaky cases. CE and EE both failed the usage
  comments assertion; EE also failed saving a QBO item mapping.
- The three Stripe scenarios passed on their first attempt in the production EE
  build: hosted Checkout plus signed webhook/redelivery, decline/cancellation
  without payment, and creation-failure retry. Extended ticket/portal assignment,
  resolution and reopen also passed. F032/T026 now have actual browser evidence;
  F031/T025 concurrency coverage and the other provider journeys remain incomplete.
- Usage comments were accepted by the form and create/update interfaces but absent
  from the database schema and action writes; the edit form also did not preload
  them. Added nullable text migration `20260906123000_add_usage_comments.cjs`,
  create/update/read typing, comment-aware request replay validation, and controlled
  Add/Edit form values. Browser regression retains its original persistence
  assertion and now reopens/edits saved comments after reload before invoice preview.
- Expanded the real-DB overlapping usage/bucket test: comment creation, identical
  replay, changed-comment rejection without a duplicate, unrelated quantity edit,
  explicit comment edit and clear. Before fix: original preview test passed and
  new regression failed on `undefined` comments. After fix: both passed against
  fresh migrations. Existing related usage unit/UI suites: 13 assertions passed.
  Evidence: `/tmp/alga-usage-comments-before.json`,
  `/tmp/alga-usage-comments-after.json`, `/tmp/alga-usage-unit-after.json`.
- Verified the exact migration on disposable PostgreSQL and Citus 12.1 schemas,
  including a preexisting row distributed by tenant before upgrade, nullable
  legacy readback, comment write/read, rollback and reapplication. Added a durable
  `.db.test.ts` regression to the workspace DB lane; it also distributes its
  isolated fixture when Citus is installed. No production database was changed.
- QBO UI error was `SIM_UNSUPPORTED` for GET `/v3/company/<realm>/item/<id>` while
  validating a newly selected service mapping. Added the already-modeled Item
  store to the wire endpoint map. New HTTP regression proves two companies with
  colliding item IDs return their own item, missing ID yields code 610, and an
  unsupported entity still fails explicitly. Before fix: 8 passed/1 failed (400
  instead of 200). After fix: all 9 emulator protocol tests passed. Evidence:
  `/tmp/alga-qbo-item-before.json`, `/tmp/alga-qbo-item-after.json`.
- Intuit reference for this protocol boundary:
  https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/item
  and the Intuit-owned Postman Accounting API collection's Item-ReadById operation.
  Live provider parity remains a separate work item; this is a targeted endpoint fix.
- Full unit job 101450948845 was cancelled by its 60-minute deadline. The durable
  journal stopped at 08:10:03Z while queuing InvoicePreviewPanel.test.tsx, before
  module-started/test-ready, after ~20 minutes of successful work. Individual and
  immediate-predecessor replays both passed; no product defect in that component
  has been established. Replace shared-process reuse in this CI lane with Vitest's
  per-file worker recycling, keeping serial execution, all existing filters and
  coverage, and the existing deadline. A real-runner PID test proves the override
  creates distinct workers. A 40-file surrounding-scope probe with coverage passed
  152 assertions in 49.36 seconds. Full-candidate CI must still establish the
  mitigation's effectiveness and total runtime; do not claim the unit gate fixed
  from the subset. Diagnostics: `/tmp/alga-unit-12c-artifacts/test-progress.jsonl`,
  `/tmp/alga-unit-isolation-results.json`, `/tmp/alga-unit-isolation-progress.jsonl`.

- Final pre-publication verification: the permanent migration test passed through
  the workspace DB launcher on PostgreSQL and directly on local Citus (one
  assertion scenario each, no skips). QBO's own Vitest 4 package command also
  passed all nine protocol tests, alongside the server Vitest 3 run. Production
  browser collection remains 15 EE cases across seven files; these are collection
  results, not a claim the repaired usage/QBO journeys have executed successfully.
  `origin/main` remains `a90cd88edc` and an ancestor after a fresh fetch.

### Node runner discovery and CI repairs (2026-09-06)

- F004 remains incomplete: the global inventory must still reconcile all Vitest,
  Playwright, Node and specialized suites. Added a concrete mandatory Node tooling
  lane rather than treating Vitest collection of a Node file as execution proof.
  `scripts/run-node-tooling-tests.mjs` inventories tracked/untracked candidates,
  captures actual Node registrations/results/file summaries, rejects missing,
  empty, failed, skipped, todo and cancelled execution, and retains evidence in
  `test-results/node-tooling`. Node's dynamic subtests are explicitly labeled as
  registrations observed during execution, not a fictitious static collection.
- Verified the real protocol on Node 22.23.2 (matching current CI runtime) and
  Node 25.5.0. Reference: https://nodejs.org/api/test.html#event-testsummary.
  Self-tests execute real child runners with nested/dynamic cases, omitted files,
  lost result events, empty files, skips, todos, premature process.exit(0), load
  failures and cancellation. The cancellation fixture uses an explicit abort:
  Node 25 waits for unawaited children where Node 22 cancels them, so that old
  implicit-parent fixture was not portable evidence of cancellation.
- One documented manual exclusion: tools/i18n/tests/baseline.test.mjs depends on
  optional gitignored baseline files. Existing validate-translations.yml already
  excludes it in favor of zero-regression gates. Record reason/owner/tracking and
  review by 2026-12-06; do not count its seven skipped cases as executed coverage.
- Full local Node 22 lane passed 33 files / 417 tests, no skips/todos/cancellations,
  47.50 seconds. Evidence: test-results/node-tooling/{events.jsonl,evidence.json,
  discovery.json,runner.log}; console log /tmp/alga-node-tooling-full2.log. This is
  local dirty-worktree evidence; the new workflow still requires candidate CI.
- Failures exposed by this lane and repaired without deleting behavior:
  * ESLint 9 RuleTester needs languageOptions; wire describe/it to node:test so
    the 14 rule cases appear as cases rather than a single passing file wrapper.
  * Template evidence tests hardcoded a different checkout; derive repo root
    from import.meta.url. All 78 existing checks now execute here.
  * Microsoft capture/verifier entrypoint detection compared canonical module
    paths with uncanonicalized argv paths. A symlinked parent silently returned
    exit 0 without invoking the CLI. New two-case subprocess regression failed
    before the fix; realpath comparison repairs both commands. Existing bundle
    sealing and tamper-verification suites pass with the fix.
  * Eight workflow fixtures referenced tenant SQL helpers from ./_lib rather
    than ../_lib; three had the same error for email settings. Existing golden
    harness scenarios now pass all 16 cases.
  * The 139-entry catalog had been converted to notification/callWorkflow
    fixtures but its tests still stubbed an event-only scaffold. Model observed
    notification results, verify event identity, branching, repeated dedupe keys,
    child publishing and cleanup; explicitly label these harness unit tests, not
    workflow-engine execution. All 139 plus three failure-injection checks pass.
  * runner-stubbed.test.cjs accidentally declared five tests inside T005 while
    T005's own harness body was below them. Move that body back into T005 and
    keep all seven cases top-level. Node 22 no longer cancels the nested cases.
- Broader Node probe found 47 appliance files: 239 tests, 231 passed and 8 failed,
  no skips. This is not yet an assigned/green CI lane. Diagnostics are in
  /tmp/alga-appliance-node-events.jsonl and /tmp/alga-appliance-failure-detail.log.
- Published c3a candidate CI: workspace-unit, workspace-runtime, mutation and
  Citus migration lanes passed. Workspace DB failed its newly included five
  hour-block migration cases because the app role could not CREATE on public.
  Change only that migration connection to DB_USER_ADMIN/DB_PASSWORD_ADMIN;
  application action suites retain the app role. CI log:
  /tmp/alga-workspace-db-c3a.log (job 101487801847).
- Nx affected libraries passed, but server:test terminated incomplete without a
  useful terminal failure report (job 101487744561). Apply the same fresh-worker
  override already used by the full-coverage lane to the server npm test target,
  stream the Nx app log, and preserve its progress journal as a CI artifact.
  Effectiveness requires full execution; do not call this fixed from collection
  or the earlier small PID proof. Full local npm test is running with journal
  /tmp/alga-npm-server-full-progress.jsonl and log /tmp/alga-npm-server-full-after.log.
- One local DB rerun omitted CI=1 and was redirected by wireLocalTestDbEnv to
  127.0.0.1:5472; it failed. The documented CI environment prevents that local
  override. Current full DB rerun uses the disposable 55432/56379 services and
  /tmp/alga-workspace-db-c3a-repair2.log; wait for its actual final result.

- Full DB rerun completed successfully: 30 files / 230 assertions, no skips or
  missing identities, 236.06 seconds. All five hour-block migration checks passed
  using migration credentials. Evidence: test-results/workspace-db/evidence.json.

- Final Node command now rebuilds emulator-host and emulator-stripe before tests;
  these packages export ignored dist files, so npm ci alone would not prove
  candidate-source behavior. Rebuilt-source full run is recorded at
  /tmp/alga-node-tooling-full3.log.
- Local full server target provided a concrete additional Nx failure cause:
  src/test/unit/migrations/usageComments.db.test.ts entered the database-free
  npm unit command because only coverage CI previously set SKIP_DB_TESTS=1.
  Its beforeAll requires real database credentials and failed as intended. The
  dedicated workspace DB lane already executed it successfully. Set SKIP_DB_TESTS=1
  in the server unit command, retaining the independent DB assignment. Stopped
  the known-failing local run after observing that failure (not for a timeout)
  and restarted the corrected full target: /tmp/alga-npm-server-full-after2.log,
  journal /tmp/alga-npm-server-full-progress2.jsonl. CI must verify the final fix.

### Production rerun findings and local unit completion (2026-09-06)

- Full corrected server npm test target completed with exit 0: 1,055 files
  passed, two skipped; 5,531 assertions passed, four skipped and 22 todo, 542.51
  seconds. No failed modules. This is the server target used by Nx, not the
  larger server-plus-workspace coverage command. Existing skips/todos remain
  separately visible; no additional tests were skipped to repair this target.
  Log /tmp/alga-npm-server-full-after2.log and its progress2 journal.
- c3a production CE browser job 101490701262: 12 passed, one failed; EE job
  101490701240: 13 passed, two failed. Previous comments persistence and QBO item
  wire errors were passed, revealing the next harness assumptions. Usage's saved
  row had the correct service/quantity, but DataTable hid the contract-line column
  and exposed its Show all control. The QBO mapping row was visible in the trace,
  but the spec searched for an HTML id while DataTable exposes data-automation-id.
  Correct both table selectors (including the later invoice due-work table), use
  Show all before asserting the selected line, and accept numeric decimal display
  of quantity 4.00. Keep DB linkage, saved comment edits and invoice amount checks.
  These browser edits require real execution; collection alone is not completion.
  Logs /tmp/alga-{ce,ee}-browser-c3a.log; downloaded EE browser and container
  artifacts under /tmp/alga-production-c3a-artifacts.
- Appliance first-boot smoke now captures child startup errors, polls bounded
  health readiness and waits for cleanup rather than sleeping 350 ms. The actual
  failure was SupportSessionManager's default write to /var/lib/alga-appliance;
  pass its existing state-directory override into the disposable fixture. The
  real token/password/session/setup HTTP scenario passes (one test, 0.50 seconds).
  The broader appliance lane remains unassigned with other stale assumptions;
  do not mark it green based on this one repaired scenario.
- Fresh fetch still resolves origin/main to a90cd88edc, an ancestor of this branch.

### Coverage completion and production artifact replay (2026-09-06)

- Published `35bd290b1b` and `a38c7aea9e` to PR #3343 after verifying the public repository and explicit PR implementation goal. The first combined commit/push approval was rejected based on private-source/no-authorization premises; authoritative GitHub and goal readbacks established PUBLIC, ADMIN, Robert-authored PR and explicit publication scope, and the separate push was approved.
- Previous candidate c3a full coverage completed in 2,882.94 seconds: 2,675 passed files, one failed file, 19 skipped; 14,399 passed assertions, three failed, 112 skipped, 22 todo. All failures were the existing recurring timing inventory including generated `server/test-progress.jsonl`. Moved the CI journal and upload path to root `test-results/server-coverage/progress.jsonl`, outside searched source roots. Existing inventory replay with the real progress reporter passes all 66 tests; actionlint passes. Full candidate rerun remains required.
- Current a38c CI Node tooling and workspace database lanes passed (jobs 101494335451 and 101494384171).
- Imported the exact c3a enterprise production image from run34033672330 and built candidate algasim locally. Production server/emulators run on the internal-only `alga-regression-browser` network, with fixed ingress and disposable PostgreSQL/Redis. The EE Add Usage journey passed (1.7 minutes): real Finance login, overlapping bucket selection, persisted comments/edit, quantity and contract identity, and $40 preview with no persisted invoice. Application image c3a, browser selectors a38c; this is not current-head image or CE evidence.
- Local QBO reproduction remains incomplete. A legacy settings navigation crashed with React #310 in Next's router; direct canonical navigation rendered settings. The local replay initially omitted the credential-encryption key and filesystem secret read chain and used port53000 despite the image's built-in port3000. Correcting those local-only settings before attributing further failures to product behavior. No legacy navigation assertion was removed from the committed browser test.
- Existing appliance staging/preflight test exposed a macOS portability issue: unsupported `realpath -m` made both path strings empty, skipping console service copy. Replaced it with Bash's same-file `-ef` check. The actual stage + preflight test passes on Node22 (3.1 seconds) with Docker access. Initial unprivileged run failed Docker socket access before staging and is not behavioral evidence.

- Expanded the usage browser journey with another tenant's real login, absent record in its loaded usage table, and replay of the actual UI update request under that tenant's session. The application returns the expected not-found action result; original comments/quantity/line/invoiced state remain intact and the other tenant receives no usage/invoice. Full expanded EE case passed in 35.4 seconds against c3a production image (`/tmp/alga-local-production-usage-isolation.log`).
- Legacy integration settings navigation still crashes after matching local CI configuration. The new permanent browser regression proves c3a streams HTTP200 rather than redirecting before rendering; the separate real navigation trace reports React #310 in the Next App Router. Middleware now redirects authenticated GET requests for known migrated settings tabs before the shell renders, preserves repeated non-tab query values, and retains the page fallback. Authentication and POST handling are unchanged. Eight real NextRequest/NextResponse tests pass; the related middleware suites pass 31 cases. Production after-fix browser verification remains pending.
- Updated stale appliance assertions to generation-two behavior already present on main: interactive identity, actual local-path role bindings, concurrent bootstrap Job with bounded PostgreSQL-startup retries, no automatic Flux remediation, and legacy-service masking. Replaced obsolete bootstrap helper-name checks with execution of the rendered script against a synthetic initialized database; fresh mode rejects it before mutation. Targeted behavior passes. The synthetic psql probe initially matched nested SELECT1 before SELECT EXISTS; corrected its response dispatch and reran. Full 47-file appliance verification in progress.

- Full appliance verification passed all 47 files/239 tests, no skips/todos/cancellations (36.96 seconds). Added the `Appliance Node execution complete` CI lane with Node22, Docker, Helm and explicit status-UI dependency installation. Its launcher rebuilds status UI and shares the established Node event/discovery reconciliation. The actual new launcher passed 47 files/239 tests (44.67 seconds after UI build), while the existing tooling launcher still passed 33 files/417 tests after extracting the shared runner. Evidence lives under `test-results/appliance/` and `test-results/node-tooling/`. Official Azure setup-helm v4 and Helm v3.17.3 references were verified; actionlint passes. These are packaging/host tests, not VM boot or upgrade proof.

- The canonical-route diagnostic with corrected CI-like local config completed QBO OAuth but failed after returning through the legacy settings URL, at connection-card rendering. The temporary canonical entry URL was restored; the permanent journey still exercises the legacy bookmark/callback route. This confirms later QBO export assertions remain unexecuted locally until the production redirect fix is built.

- a38 production CI is terminal: CE passed all 13 cases (1.8 minutes, job101497346906); EE passed 14/15 (3.7 minutes, job101497347012). Usage passed both editions. EE QBO now created the correct one-line pending export batch; its screenshot shows the open Accounting Export Batch dialog, but the test incorrectly looked for an HTML id that Dialog represents as an automation attribute. Changed the locator to the accessible dialog role/title. Export failure/retry/deduplication assertions still require successful execution. Local legacy settings crash is timing-dependent and was not seen in this CI run; its permanent early-redirect regression remains necessary.

- a38 affected-unit job101494335393 ran every step successfully, including the server target (1,055 files / 5,531 tests passed), artifact upload and post-job cache cleanup, but GitHub marked the job cancelled exactly 30 minutes after start (13:26:25–13:56:25 UTC). This was the job deadline, not a failing test or a superseding push. Raised its bounded budget to 45 minutes to include the measured roughly 12-minute setup/library pass plus 18-minute server pass and cleanup. The completed command is behavioral evidence; the cancelled job still does not satisfy the green gate. The next candidate must establish a successful terminal job.

### Tenant boundaries and deterministic appliance startup (2026-09-06)

- Published timeout correction `1395604423` after another auto-review rejection questioned publication scope. Reverified the public repository, ADMIN permission, Robert-authored PR and active goal's explicit PR requirement; the scoped retry was approved. Fresh origin/main remains `a90cd88edc` and is an ancestor. Production run34038246949 is building both editions; it superseded/cancelled the previous5bf image builds, so those browser jobs provide no after-fix evidence. Avoid another push until the current production run completes.
- Extended the portal roundtrip with a fresh authenticated browser context, persisted public replies/resolution, absent internal notes, and a real portal acknowledgment. Captured its actual server-action request and replayed it under both a sibling client and another tenant's own cookies. Both receive the expected not-found result; ticket/comment records remain identical, and neither unrelated user creates a comment. The first local probe used the MSP submit label Send; the portal screenshot showed Add Comment. Corrected the selector and reran successfully.
- Added a real role-management boundary: Admin adds a Technician role using the shipped user drawer, then a technician replays that action to request its own Admin role. The server returns the explicit role permission error; every role assignment is unchanged. The admin removes its temporary extra role through the UI. These scenarios and existing tenant read checks pass together: five cases,1.9minutes, against the exact c3a production image (`/tmp/alga-portal-role-isolation-after.log`). Current-candidate CE/EE execution is still required; F012/F013/T011 remain incomplete until acceptance is verified.
- Both5bf Node CI jobs passed (tooling101499210820,appliance101499211005). The139 appliance job101500169639 failed its first-boot readiness deadline while all other238 tests passed. The captured startup log reported missing standalone Kubernetes client dependencies; code inspection also showed awaited support reconciliation invoking runner-installed kubectl before listening. CI now installs the host service's own locked dependencies. The first-boot fixture supplies an absent isolated kubeconfig and an explicit external kubectl probe that returns an empty support-pod list and records every command; any unexpected command fails assertions. The real server's HTTP/authentication/persistence flow remains unchanged. This avoids depending on developer/runner cluster state.
- Full appliance launcher after installing host dependencies passes47files/239tests, no skips/todos/cancellations,51.8seconds, with fresh status-UI build (`/tmp/alga-appliance-isolated-full.log`, `test-results/appliance/evidence.json`). The isolated first-boot case itself passes0.49seconds with dependencies installed. Workflow actionlint and git diff check pass. CI rerun remains required.

### Invoice generation and current production-browser results (2026-09-06)

- Candidate139 production browser jobs are terminal: CE13passed/1failed (101503442596), EE15passed/1failed (101503442558). Add Usage including real cross-tenant mutation denial passes in both current production images; F011/T010 are now implemented. EE QuickBooks OAuth, UI mapping, export transport failure, expired access-token recovery, vendor readback and duplicate protection pass (22.2seconds); stale SyncToken coverage remains outstanding, so F033/T027 remain incomplete.
- The only browser failure in each edition is the new legacy settings regression: status307 is correct, but the test constructed a URL without a base from a valid relative Location header. Resolve it against the response URL; preserve exact destination/query, actual navigation/reload and no-page-error assertions. Current candidate after-fix execution is required.
- New recurring/manual invoice browser journeys exercise actual Finance login, generation/finalization, persisted amounts and source billing, downloaded PDF identity/content, and exact authenticated request replay with unchanged invoice/charge/transaction records. PDF content is parsed from downloaded bytes with pinned test-only pdfjs-dist6.3.289. Collection sees19EEtests; this does not prove execution. Local recurring generation/finalization passed against the c3a image, but PDF download failed because amd64 Chromium subprocesses crash under ARM Colima/QEMU (direct launch reproduces unknown type=utility and PulseAudio abort). No product Chromium flags changed; native x86 CI must prove the PDF path.
- The new manual journey exposed two product defects: optional sales_order read rejection discarded authorized billing client/service options, and the entered invoice number was never sent to the action. GenerateTab now loads required options independently of optional sales orders, surfaces a translated warning, and clears stale refresh state. The manual action accepts the trimmed entered number, retaining generated numbering for blank input and existing tenant uniqueness handling. No role privileges expanded.
- Before-fix focused regressions failed4of17cases. After fixes,21tests across4files pass; the complete migrated-database manual invoice suite passes16tests (26.46seconds), including custom-number persistence and duplicate retry rollback with identical invoice/charge/transaction rows. Billing typecheck passes. Translation key validation and locale quality checks pass with zero missing keys, untranslated additions or warnings. Logs: /tmp/alga-manual-invoice-regressions-{before,after}.log, /tmp/alga-manual-invoice-realdb.log, /tmp/alga-billing-typecheck-invoice.log. Full new browser journeys remain unverified until the new image runs; F015/T013 stay incomplete.
- Candidate139 affected-unit job101500169445 is SUCCESS with the measured45minute budget. Older c3a full integration job101487801838 completed successfully:264filespassed/14skipped,1915testspassed/134skipped,5855.39seconds. This older result does not establish current-head readiness. Candidate139 full coverage remains running; avoid cancelling it through an early push.

### Current-main invoice changes (2026-09-06)

- Fresh origin/main advanced to a81661446e (invoice ticket presentation). Merged it into this worktree. Bucket timing conflicts retain main's full cadence resolution and exclusive service-period query boundary, together with the regression branch's explicit null fallback for absent service-period identity. Removed a duplicate timing property introduced by the automatic merge. The focused billing/timing/compute/manual-form set passes83tests across6files; billing typecheck passes. The real migrated-database manual invoice suite passes all16tests again against the merged schema (25.99seconds). Logs /tmp/alga-main-merge-{billing,typecheck,manual-realdb}.log.
- Current main introduced36missing translation keys across de/es/it/nl/pl/pt (invoice time-detail fallback text and two designer presets). Added translations in each language and regenerated both pseudo locales. Translation consistency now passes0errors/0warnings. These are required-check repairs, with no product behavior changes.
- Added the versioned regression ledger and reusable fixture guidance. Records distinguish observed product assertions, simulated defect replay, local focused verification and pending production-browser execution; unknown incident identifiers remain null and must not count as confirmed production escapes. The test-only PDF parser requires Node22.13+, now reflected in the package engine and local guide.

### Reusable time-billing journey and approval remediation (2026-09-06)

- Extracted recurring billing preconditions shared by usage and hourly journeys. The existing usage journey passed after extraction (33.6 seconds). Added technician time entry/submission, manager approval, Finance invoicing and unchanged-state generation replay. The original full journey passed twice against the older c3a production image; this is not current-candidate proof.
- Strengthening the unapproved-time assertion exposed a product defect: the server correctly refused generation with "Blocked until approval: 1 unapproved entry.", but the grouped action replaced it with a generic failure. Added a typed, localized TIME_APPROVAL_REQUIRED result through generation, grouping and UI translation. Focused generation, grouping, translation and preview tests pass: 47 tests across 4 files, 2.82 seconds (/tmp/alga-approval-remediation-after.log). Billing typecheck completed successfully (/tmp/alga-time-approval-typecheck.log).
- Corrected the journey expectation: approval refusal is an explicit failure, not successful zero-invoice generation. Finance now holds its eligible selection open before time is entered/submitted, exercising the server guard against stale UI state. The test waits for the rendered approval reason instead of awaiting completion of a streaming server-action response. Collection succeeds; the strengthened journey still needs execution against a new production image. F014/T012 remain incomplete.
- Added reusable named browser actor sessions with fixture-owned cleanup and failure screenshots/videos. Playwright owns tracing for these contexts; starting another trace causes a real harness error. The harness now intentionally fails a manager assertion, verifies its trace and actor attachments, then runs a passing case and verifies extra attachments are discarded (/tmp/alga-actor-diagnostics-harness2.log).
- Candidate a8de production images all built successfully; CE job101510775594 and EE job101510775598 were still running at latest readback. Node, typecheck and translation checks have passed. Do not claim current release readiness or publish another candidate before collecting the outstanding browser results.

### Native production browser verification and follow-up repairs (2026-09-06)

- Candidate a8de browser execution is terminal: community16passed/1failed (job101510775594), enterprise18passed/1failed (job101510775598), run34040912085. Recurring usage generation/finalization/PDF download and duplicate protection pass in both native production builds (22.1/26.6 seconds). Portal creation, assignment, public/internal replies, resolve/reopen, fresh portal identity and cross-client/tenant mutation denial pass in both editions, alongside technician self-elevation refusal. F012/F013/T011 are now verified. F015/T013 remain incomplete because manual invoice execution has not passed.
- Both manual invoice attempts fail at an incorrect exact accessible-name selector. Captured UI contains the authorized client, but its option name also contains avatar initials and client type. Select the existing client-specific automation ID. This is a test locator repair; the screen confirms optional sales-order rejection no longer discards required client options. Full manual-to-PDF execution is still required. Logs /tmp/alga-browser-a8de-{ce,ee}.log; community diagnostics /tmp/alga-browser-a8de-ce-artifacts.
- Affected-unit job101507379687 fails one historical service-period inventory assertion, with5576passed/4skipped/22todo. Three origin/main invoice-ticket presentation files were not classified as post-snapshot consumers. Added those explicit historical classifications without changing the inventory assertion. The complete inventory plus invoice-ticket presentation tests pass99assertions (/tmp/alga-main-inventory-after.log). Full coverage and full integration remain live; their results are not assumed.
- QBO browser OAuth/mapping/export/transient-failure/token-refresh/duplicate-protection passes again (24.4 seconds). Stale SyncToken coverage remains outstanding: normal export excludes already-mapped invoices; the product's deliberate re-export goes through the accounting sync queue. The existing emulator wire test proves stale rejection but does not prove application recovery. Keep F033/T027 incomplete until that application path is exercised.

- The strengthened time browser test now fails at exactly the intended assertion on the c3a image: Finance's alert says Failed to generate invoice for this billing cycle rather than Blocked until approval: 1 unapproved entry. Tenant/user setup, stale selection, real time entry and submission all completed. This is valid before-fix browser evidence (/tmp/alga-time-approval-explicit-before.log), replacing the earlier response-stream timeout as the reproducer. Added a regression ledger record; full current-image after verification remains pending.

- A standalone TypeScript check of all production browser files found a pre-existing shared TestContext mock typing issue. Replaced its broad module cast with the actual DB module type plus an explicitly checked legacy test helper; retained all runtime mock behavior. Browser/fixture typecheck now succeeds (/tmp/alga-production-browser-typecheck-after.log). The actual manual-invoice migrated-DB suite using this context passes16tests in22.71seconds on its own disposable database (/tmp/alga-manual-context-types-after.log).

- Full coverage a8de job101507379827 completed with4failed/14452passed/112skipped/22todo across2700files (2925.21seconds). One failure is the already-repaired historical service-period inventory. The other three are stale invoice-template expectations after origin/main's new by-ticket layout: the pinned identifiers, removed line-items/heading nodes, and a label check covering only the original localization migration. Updated the designer roundtrip expectations to preserve the new ticket coverage/summary layout; regenerated and reviewed the identifier manifest changes (new collection binding, updated ticket paths/labels, removed duplicate-charge table); the label check now executes the actual later ticket-template migration on old-shaped nodes and includes its persisted labels. No historical migration changed. Initial30template tests pass; a follow-up without manifest-update mode is required.
- The exact a8de enterprise image is now running locally (image5804ee43c0ef750d635990185626e21ee3c2d3d279a10c6bb6754007ab73565d). The prior c3a container remains stopped/disconnected as alga-regression-browser-server-before-a8de. Applied the two new invoice-ticket migrations to the owned browser database; first reconciled the earlier directly-applied usage-comments migration with its ledger after verifying nullable text schema. This local harness maintenance is not proof of the planned previous-release upgrade lane.
- Combined browser policy/actor diagnostics harness passes (/tmp/alga-browser-harness-f417.log). The corrected manual client selector now proceeds through real Finance entry, custom invoice number persistence and finalization on the a8de image; the currently running local test has reached PDF download. Full native after-fix execution is still required.

- Follow-up template/inventory execution without UPDATE_STANDARD_TEMPLATE_MANIFEST passes129tests across4files (/tmp/alga-a8de-failures-after.log). All four a8de full-coverage failures now have passing focused follow-up evidence; a new full CI run remains necessary.
- Local manual replay completed with a PDF-download timeout after successfully entering the Finance form, persisting the custom number/amount and finalizing (/tmp/alga-manual-browser-a8de-local.log). This attempt is not a full browser pass. Unlike the earlier c3a renderer probe, its captured server log does not establish a Chromium crash: it shows repeated unavailable Temporal initialization, and the download action has not logged entry. The local harness lacks the EE Temporal service; retain native CI as required evidence and do not attribute this particular failure solely to QEMU.

### Inventory execution and tax-reference repair (2026-09-06)

- The a8de unit report exposed 18 inventory suites whose DB assertions always skipped in CI. Renamed them to .db.test.ts, removed conditional skips/early returns, excluded them from package unit collection, and assigned them to the existing workspace DB runner. The helper now requires explicit disposable test configuration and creates fresh tenant prerequisites per file. See packages/inventory/TESTING.md.
- Initial setup failed because service_types no longer has billing_method; aligned the synthetic fixture with migrated schema. The first attempt also rejected test names changed during collection; subsequent collection/execution used stable names. This initial attempt is not passing evidence.
- Once setup worked, 104/109 assertions passed. Two kit tests incorrectly expected exceptions instead of current translated validation results; updated them to verify errors and unchanged persisted state. Two drop-ship cases needed the real tenantDb facade preserved in their mock; action transactions now use nested transactions so rollback is exercised. Replaced the ghost-usage source-text permission assertion with a denied action invocation.
- The fifth failure expected a tax FK explicitly omitted by 20260701092000_inventory_schema_hardening.cjs for Citus. Application validation was also missing. Three new create/add/update regressions failed before the fix because unknown tax IDs were persisted (/tmp/alga-inventory-tax-before.log). Added tenant-scoped validation using the existing localized invalid-reference error. Moved the obsolete raw-FK assertion to action coverage, including foreign-tenant rejection, no header/line changes on refusal, valid same-tenant rates and clearing rates.
- Filtered workspace DB execution passes18files/117assertions, zero skips/todos/missing execution (/tmp/alga-inventory-db-after.log; test-results/workspace-db/evidence.json). Package unit execution independently passes15files/104assertions (/tmp/alga-inventory-unit-after.log). Fixed a TypeScript-only randomUUID inference issue with an explicit string annotation; follow-up typecheck log is /tmp/alga-inventory-typecheck-after.log. Full workspace discovery/execution and new-candidate CI are still required; F002/F004/F006 remain incomplete.
- Published4841202472 has no failed checks at latest readback; full integration, one infrastructure shard, unit jobs and CE/EE builds remain running. Do not claim PR readiness or cancel these through a premature push.
- Full workspace execution with the inventory renames now passes48files/347assertions, zero skips/todos/missing execution (/tmp/alga-workspace-db-with-inventory-redis.log). Initial full run passed346 and timed out in clients.update because REDIS_PORT was omitted locally; its log proves connection refusal. After pointing the runner at owned Redis56379, the complete run passed239.27seconds. Inventory typecheck passed. This verifies the local integrated lane; current-candidate CI remains required.

### Colocated server execution and enterprise discovery (2026-09-06)

- Activated `server-colocated` in the additional workspace runner and CI. The main server unit command selects `src/test/unit`, so existing route/component/lib/service tests needed a positive execution assignment. Full local run passed **76 files / 381 assertions / zero skipped** (`/tmp/alga-server-colocated-final.log`, `test-results/server-colocated/`). This is a scoped inventory, not completion of F004/F006.
- The initial server run exposed 32 failures. Repaired mocks at their current import boundaries (Teams EE modules, extension gateway access/audit context), jsdom iframe setup, event-bus fake-timer setup, translation and request-audit fixtures, and tenant-facade query chains. Preserved meaningful route denial/forwarding, iframe origin, timeout reset, SLA event and UI interaction assertions. Existing source-string contracts were minimally aligned with the tenantDb migration and the intentionally retired release flag; these structural tests do not establish runtime behavior.
- Added an EE unit-only config with the actual EE aliases followed by shared server package aliases. It collects **246 files / 1,973 assertions** from EE unit/services/components. Three deterministic partitions receive separate report directories; aggregate checks reject incomplete, stale, overlapping, skipped or mismatched evidence. Database/integration/Playwright suffixes remain assigned separately, and the repository-wide inventory remains incomplete.
- Initial EE runs revealed environment issues as well as stale tests: public Google/Microsoft OIDC discovery passes all 11 assertions with network access; the local JWKS server also requires permission to bind localhost. Node 25 experimental webstorage conflicts with jsdom, so local reruns use `NODE_OPTIONS=--no-experimental-webstorage`. CI remains Node 22. Do not change application code or skip tests to mask these local limitations.
- Repaired EE Hudu mocks using the real typed error class and safe user-facing error envelopes; retained audit-failure denial and non-disclosure assertions. Updated the Temporal existing-schedule fixture to the real action/args shape and asserted tracker repair without duplicate schedule creation. Credentials UI now asserts released functionality independent of the retired flag while keeping tier/permission checks. Expression-editor smoke asserts insertion through its current textbox/onChange behavior; the palette tooltip test scopes duplicate label text to the tooltip content. Workflow task inbox uses real Knex query construction with a mocked execution seam to verify bindings, projection, sorting and pagination; it does not claim real PostgreSQL predicate evaluation.
- Focused repaired EE subset: **8 files / 136 assertions passed**, followed by **3 inbox assertions passed**. Complete repaired shard 1 then passed **82 files / 765 assertions**, including live public OIDC (`/tmp/alga-enterprise-shard1-green.log`). Latest complete other partitions: shard 2 **598 pass / 23 fail / zero pending**, shard 3 **551 pass / 28 fail / 8 skipped**. Combined current baseline: **1,914 pass / 51 fail / 8 skipped**. Aggregate correctly fails. Remaining failures span managed-domain, Tanium, Hudu, Stripe, workflow authoring, extension settings and a DB-facing Temporal fixture; investigate each rather than removing it. Logs: `/tmp/alga-enterprise-network-shard-{2,3}.log`; raw reports under `test-results/enterprise-unit/shard-N`. No all-green EE or PR claim.
- Found a real infrastructure evidence bug: internally consistent passing reports from shard 2 could accompany shard 1's manifest and still satisfy the existing infrastructure aggregate. The new installed-runner regression fails before the fix (`/tmp/alga-infra-report-mismatch-red.log`). Added shared `compareExecutionEvidence` and bound both aggregators' partition/test/count claims to recomputed raw reports. The complete metrics flag also refuses mismatched raw evidence. All **8 shard/runner harness tests pass** (`/tmp/alga-shard-framework-green.log`); **13 discovery/execution tests pass** (`/tmp/alga-evidence-discovery-final.log`). The tests execute disposable actual Vitest repositories, including missing/new files, skips, failures, missing/duplicate/stale shards, cancelled jobs, altered counts and substituted raw reports.
- Updated developer evidence documentation and regression ledger with sales-order tax-reference and shard-report defects. `actionlint` for the changed workflow, plan validation (37 features / 31 tests) and whitespace checks pass. No additional plan feature marked complete; complete global discovery, release gates/protections, remaining browser/provider coverage, release provenance/upgrades/synthetics and financial model work remain active.
- Published PR head remains `48412024729db14b7f40fc6828f4d8c90c538e44` while its expensive native browser/full integration/full coverage jobs finish. Local inventory fix is already committed as `7e11ffc7ba`. Do not cancel still-running older native verification by pushing without first inspecting its terminal results. At the last read, all completed published checks were successful; two browser jobs, full integration and full server coverage were still running.


### Native browser milestones verified (2026-09-06)

- Published PR head `48412024729db14b7f40fc6828f4d8c90c538e44`, production workflow `34044016832`: community job `101521391434` passed **18/18** and enterprise job `101521391417` passed **20/20**, with no skipped or retried journey reported. Retrieved completed logs `/tmp/alga-native-{ce,ee}-484.log`; this is native Linux production-build execution, not local ARM emulation.
- Both editions pass real time entry, submission, actionable unapproved-time rejection, manager approval, invoice generation at the expected hours/rate/amount, persisted billed state and duplicate-request protection. Both pass recurring/manual generation, finalization, actual PDF identity/amount checks and retry without duplicate financial effects. Existing portal/client/tenant/technician boundaries also pass. Marked F014/F015/F016 and T012/T013 implemented from this verified evidence; the complete plan remains active.
- Server unit/coverage job `101515730119` also finished successfully: **14,458 pass / 112 skipped / 22 todo** across 2,700 files (2,681 passed / 19 skipped). The successful job does not mean mandatory skip cleanup is complete. Local inventory activation removes many of these skips but is not in this published revision yet. Full integration job `101515800996` remained running at the last read.
- Updated the time-approval regression ledger with native browser after-fix evidence. No claim that this older published revision includes the newer server/EE lanes or inventory fix.

### Enterprise activation and database isolation repairs (2026-09-06)

- Complete enterprise execution now passes **246 files / 1,965 assertions / zero skipped**. Shards pass 765, 621 and 579 assertions; the raw-report aggregate passes. Logs: `/tmp/alga-enterprise-repaired-shard-{1,2,3}.log`; reports under `test-results/enterprise-unit/shard-N/`. This is local execution on a dirty checkout based on `953300293c`, not current-candidate CI.
- Extracted eight Hudu persistence cases from mixed unit files into two `.db.test.ts` files and assigned that EE root to the workspace database lane. They use the owned migrated test database instead of developer database defaults, secret-file fallback or conditional schema setup. The conflict case now provokes an actual PostgreSQL unique violation with a deterministic competing insert after pre-checks. Both extracted files pass all eight cases independently (`/tmp/alga-hudu-db-final.log`).
- Repaired stale unit fixtures at current translation, auth/tier, tenant-query and structured-error boundaries. Retained denied actions, sanitized errors, tenant predicates and component interactions. Minimal updates to inherited source-text tests do not count as behavioral assurance. Stripe pricing fixtures model composable query behavior for unit tests; they do not prove SQL or tenant isolation.
- Found and fixed two application defects exposed by existing behavioral tests: Solo checkout incorrectly required a per-seat price despite its flat base pricing; it now uses the existing tier line-item builder. An empty workflow Until config reset fixed-date authoring to expression mode; blank values now retain the date picker. Before/after results are recorded in the regression ledger. All 20 Stripe pricing cases and workflow editor cases pass in the full enterprise run.
- Full published integration execution at `4841202472` finished with **1,911 pass / 4 fail / 146 skipped**. All four failures expected thrown approval errors while the application now returns a structured translated error. Updated the tests to assert the exact refusal result; the ticket/time journey also checks unchanged invoices and an uninvoiced entry before real approval. Focused execution of the two affected files remains required before publishing this checkpoint.
- First expanded workspace database run collected 50 files and failed two cases. Randomized ordering reused a cached empty mapping scope across tests that directly seeded SQL; each test now has a unique connected realm. Hour-block allocation used tied millisecond timestamps and therefore a legitimate UUID tie-breaker; the fixture now uses explicit FIFO purchase dates and asserts the actual allocation target before reversal. The complete database rerun is in progress (`/tmp/alga-workspace-db-50-repaired.log`).
- Fifteen discovery/execution/sharding behavioral harness tests, plan validation and whitespace checks pass. The latest published PR has no running checks; its full integration job failed as described above, so publishing a new checkpoint will not cancel unfinished native browser evidence. Global inventory/skip cleanup, full release enforcement and the remaining plan work are still incomplete.
- Complete repaired database execution now passes **50 files / 355 assertions / zero skipped or todo**, with matching collection/execution evidence (`/tmp/alga-workspace-db-50-repaired.log`, `test-results/workspace-db/evidence.json`). Both previously failing fixtures pass in the randomized full run.
- Focused approval integration execution passes **2 files / 64 assertions** using CI seed `20260610`, owned PostgreSQL and Redis (`/tmp/alga-approval-integration-repaired.log`, `/tmp/alga-approval-integration-repaired.json`). This includes the four previously failing approval assertions plus the real submit/approve/invoice journey. It does not replace a new full CI integration run.

### EE package, migration and AI gateway inventory expansion (2026-09-06)

- Previous goal turn was progress: published `d604264c181b78a813a8aa13f13e206753acf4fc` after enterprise, database and approval integration verification. Current CI is authoritative for that revision. At latest read, all three EE unit jobs and their aggregate, server-colocated and workspace database jobs passed; full integration/typecheck/build work remained live. Do not push merely to restart or cancel those jobs.
- Preliminary discovery compared 3,906 conventional JS/TS test/spec candidates to ten actual Vitest file collections and identified unassigned EE package, migration, service, legacy browser/API and other runtime groups. Node-tooling/appliance candidates were classified separately; this preliminary scan is not a global collection or execution guarantee. Initial diagnostics under `/tmp/alga-inventory-*.json` used SKIP_DB_TESTS for server integration/infrastructure collection and therefore omitted four DB-suffixed files already owned by those lanes; do not count those four as new CI gaps. Dedicated production Playwright collection succeeds using its own `e2e-tests/node_modules` CLI; the root CLI has a different installed Playwright and cannot collect that workspace.
- Extended the existing enterprise unit lane to all EE package tests, with explicit exclusion of database/integration/browser suffixes outside its config root. The newly assigned package subset passes **49 files / 268 assertions** (`/tmp/alga-ee-packages-network.log`). The first sandboxed run passed260 but could not bind the Teams OIDC/JWKS localhost server; no tests were skipped to hide that environment error. Full expanded partitions pass **295 files / 2,233 assertions**, partition counts674/844/715, zero skipped; raw-report aggregate passes (`/tmp/alga-enterprise-expanded-shard-{1,2,3}.log`). Four package files also have coverage in the main server lane; these counts must not be summed into unique repository coverage.
- Assigned three `server/migrations/__tests__/*.integration.test.ts` files to the workspace database lane. Initial execution passed7/8 but the prepaid rollback test incorrectly expected shared notification categories to be removed. Later replenishment notification migrations legitimately share those categories. The test now proves replenishment subtype/category preservation while still checking low-balance template/subtype and schema removal, and restores schema in finally so assertion failure cannot strand subsequent tests. Full expanded database execution passes **53 files / 363 assertions / zero skipped**, including all eight migration cases (`/tmp/alga-workspace-db-53.log`, `test-results/workspace-db/evidence.json`). No product migration was changed.
- Activated `ai-gateway` in the shared evidence runner and added a dedicated CI PostgreSQL service database. All service unit and integration tests are mandatory; missing/malformed/non-test DB URLs fail before collection. The HTTP gateway, persisted credit ledger, automatic top-up and signed Stripe webhook tests execute against service-owned migrations and disposable HTTP fixtures. Full local execution passes **11 files / 58 assertions / zero skipped**, using supported Node20.20 and database `alga_ai_gateway_test` on the owned PostgreSQL container (`/tmp/alga-ai-gateway-activation.log`, `test-results/ai-gateway/evidence.json`). Service provider/payment effects remain simulated; this is not live-provider verification.
- Installed-runner harness now covers AI gateway discovery, missing database configuration, omitted files, zero collection, skipped assertions and failures alongside existing lanes and enterprise aggregation. **11 combined harness/discovery tests pass** (`/tmp/alga-expanded-runner-harness.log`). Workflow actionlint and whitespace checks pass.
- Refreshed main protection, effective branch rules and all four repository rulesets. Durable sanitized snapshot: `evidence/github-enforcement-baseline.json`. Only ext-v2/ESLint and circular-dependency checks are enforced; classic required contexts are empty, two other rulesets are evaluation-only, and active rulesets have an always-bypass integration actor. No settings changed. Stable test aggregates and controlled enforcement verification remain required; F001/F004/F006/F008 and broader plan items remain incomplete.

### Enterprise integration activation and legacy browser collection (2026-09-06)

- Previous goal continuation produced implementation/evidence progress; the intervening user question was answered without declaring the goal complete. Work resumed from terminal process handles and current PR checks, not inferred liveness.
- Published `d604264c` now has green native production browser jobs: community **18/18**, enterprise **20/20**, workflow `34048360430`, jobs `101530543283`/`101530543246`. Retained logs `/tmp/alga-native-{ce,ee}-d604.log`. Full integration and server coverage remain live at the latest read; no push was made to interrupt them.
- Published Nx typecheck failed five untyped generic mock calls. Replaced generic invocations with typed result casts in Hudu layout/mapping, Temporal job-record, workflow inbox and SLA timer tests. Focused runtime checks passed 64 EE and two server assertions; full local EE typecheck passed both before and after the integration edits (`/tmp/alga-ee-typecheck-current.log`, `/tmp/alga-ee-typecheck-lane.log`). Native rerun is still required.
- Added `enterprise-integration` runner/config and CI job, collecting 32 non-browser files with a dedicated `alga_ee_integration_test` database and real Redis. The runner requires explicit admin/application connection settings, constructs test URLs, overlays EE migrations on CE using production order, and supplies the combined directory to every per-file database recreation. Temporary overlays remain under server so relative migration helpers resolve; cleanup runs on both success and failure. No skips or exclusions were added.
- Installed-runner behavioral harness passes **12 tests** (`/tmp/alga-ee-integration-runner-harness-v3.log`), including required credentials, runtime overlay precedence, relative helper loading, cleanup, omitted files, empty collection, skipped assertions and failures. Workflow actionlint passes.
- Initial CE-only execution was 191 passed/68 failed/69 pending; combined-schema execution was 204 passed/33 failed/91 pending. Repairing local-port assumptions, dotenv precedence, obsolete DB/auth mock targets, schema fixtures and migration reapplication increased execution to **276 passed/26 failed/26 pending**. Full diagnostic logs and snapshots: `/tmp/alga-enterprise-integration-{32,combined,repaired}.log`, `/tmp/alga-ee-combined-first-results.json`, `/tmp/alga-ee-repaired-first-results.json`. These are diagnostic dirty-worktree runs, not successful complete evidence.
- Extension schedule and workflow schedule focused suites now pass. Tests retain atomic rollback, persisted rows, permission refusal and runner effects while asserting current sanitized/structured errors. Tenant/version fixtures now use real tenant records and the migrated tenant-scoped version identity. Managed-domain invalid inputs now assert structured field errors, no persisted domain and no enqueued workflow. Client-comment fixtures seed the contact/client association required by actual authorization.
- Renamed the misclassified onboarding-provider Playwright file to `.playwright.test.ts`. EE Playwright now sets its workspace tsconfig explicitly; public `@alga-psa/db/tenantDb` imports avoid eagerly loading the unrelated Turbopack shim in test helpers. The public export also preserves built appliance compatibility for tenant-creation helpers. Full legacy EE browser collection now succeeds: **60 files / 428 cases / zero errors** (`/tmp/alga-ee-browser-full-collection-v4.json`). This is collection only, not browser execution or a global CI assignment claim.
- Corrected a recurring-period fixture from the removed client-contract-line identity to `contract_line`; the invoice parity assertion then exposed simulator double charging of bucket-covered hours. Production excludes attributed bucket work from ordinary hourly charges; the simulator had included both hourly and bucket charges. A focused fix and explicit covered/overage/uncovered assertions are under verification. Do not claim regression resolution until the focused and full lane results are read.
- Final complete EE integration execution passes **32 files / 328 assertions / zero failed, skipped, pending or todo**. Collection/execution reconciliation passes with 328 expected identities and `selection.mode=full`. Log `/tmp/alga-enterprise-integration-final.log`; raw reports in `test-results/enterprise-integration/`; execution duration 218 seconds. This is local dirty-worktree evidence based on `1dbb16306c`, not native CI for the pending checkpoint.
- Focused simulator, managed-domain and client-comment verification passed **3 files / 62 assertions** before the full run (`/tmp/alga-ee-integration-focused-v3.log`). The simulator regression ledger now records the observed pre-fix extra 5000-cent hourly charge plus 500-cent tax, the repaired invoice parity, and explicit overage/uncovered-hourly checks.
- Server legacy Playwright collection also succeeds **15 files / 32 cases / zero collection errors** (`/tmp/alga-server-browser-collection.json`); this does not mean those journeys execute in CI. Remaining inventory includes server API/runtime E2E, visual manual tooling, Nx tooling and extension samples. Four DB tests in the earlier unassigned snapshot were already assigned but hidden by SKIP_DB_TESTS during that diagnostic collection.
- Published server unit/coverage job `101527382692` is now SUCCESS (`34048360599`); retained log `/tmp/alga-server-unit-d604.log`. Published full integration job `101527437186` remains IN_PROGRESS; avoid canceling it with a push. The published typecheck failure is repaired locally but not yet verified in a new CI run. No additional feature or test completion flags were changed; global inventory, enforced gates and all remaining work packages retain their original scope.

### Nx, extension showcase and prepaid subscriber activation (2026-09-06)

- Added `nx-tooling` and `ui-kit-showcase` to the shared runner and CI matrix. Both reconcile actual collection/execution against independently discovered files. The showcase installs its own lockfile, uses its own Vitest binary, and builds the iframe before testing. Installed-runner/discovery harnesses pass **15 tests** (`/tmp/alga-tooling-discovery-harness.log`), including missing files, empty collection, skips and execution failures.
- Nx execution passes **5 files / 11 assertions / zero skipped**, including real project graphs, affected selection, builds/cache reuse, edition resolution and module-boundary linting. Replaced the removed ESLint `defineRule` API with flat configuration. A final run after all showcase configuration changes also passes (`/tmp/alga-nx-tooling-final-config.log`).
- Showcase execution passes **8 files / 117 assertions / zero skipped** (`/tmp/alga-showcase-verified.log`); its locked Vite build passes (`/tmp/alga-showcase-build.log`). Repaired obsolete selectors/style expectations and fake-timer handling. Root React, renderer and testing-library aliases keep the linked source UI kit and native dependencies on one React instance. No product UI-kit behavior changed. Existing source/build checks are retained but do not count as browser or extension-installation assurance. Durable local evidence: `evidence/tooling-showcase-activation.json`.
- Assigned the previously orphaned prepaid alert subscriber integration file to the workspace DB lane. Initial execution passed46/48 and failed cleanup. Added tenant-scoped billing-profile cleanup before deleting clients. The two old flag assertions conflicted with the intentional v1.5 rollout-flag retirement in `dba55c91ab788523566dd7ae48283fdf42915745`; do not restore that retired gate. Replacement cases execute the real scan with disabled/unavailable flag infrastructure and verify persisted alert/delivery/notification state plus one email. Focused execution passes **48/48**, including cleanup (`/tmp/alga-prepaid-alerts-repaired.log`). Full expanded database verification is pending below.
- Published `d604264c` full integration is now terminal SUCCESS: **264 passed files / 15 skipped files**, **1,915 passed assertions / 146 skipped**, zero failures, 3715.72 seconds. Retained raw CI report `/tmp/alga-integration-d604-artifact/test-results-integration.json` and log `/tmp/alga-full-integration-d604.log`. `evidence/server-integration-d604-baseline.json` records all146 unexecuted identities; they are unresolved coverage gaps, not approved exclusions. The current job's success does not satisfy complete mandatory execution.
- At terminal readback, the only failed published check is Nx typecheck (the five mock typing repairs are committed locally); all other checks passed except the intentionally unselected Docker parity job. No published checks remain live, so a verified checkpoint can now be pushed without canceling native evidence. Global inventory, skip cleanup, aggregate/release enforcement and the remaining work packages are still incomplete; no checklist flags changed.

- Final expanded workspace DB execution passes **54 files / 411 assertions / zero skipped, pending or todo**, with full discovery/execution reconciliation (`/tmp/alga-workspace-db-54.log`, `evidence/workspace-db-54-activation.json`). Duration282.68seconds. Workflow lint, plan validation and whitespace checks pass. These are local results; new-candidate native CI remains required.

### Required financial, notification, bucket and retry coverage (2026-09-06)

- Previous goal turn made implementation progress: published `22c7016a09d099d190276126f64bb85dc914ec2c` with the Nx/showcase/prepaid checkpoint and the two previously verified EE/AI commits. PR3343 remains draft. Revalidated current CI before editing; no active native run was canceled or restarted.
- Renamed three genuinely DB-backed suites to `.db.test.ts` and assigned them through the existing workspace lane: money-story invoice COGS/QBO vendor-bill export (2), deferred-revenue rollforward (3), and ticket-assigned notification priority (4). Removed developer secret parsing, hard-coded database ports, fixed tenant/user/reference IDs and opt-in skips. Billing uses a newly seeded disposable database; reporting uses rollback-isolated scratch tenants. Notification tests retain real authentication context, permission checks, writer actions and subscriber dispatch, with only DB routing and transport effects substituted. Writer results and persisted notification priorities are asserted.
- Focused financial/reporting execution passes5tests (`/tmp/alga-money-report-activation.log`); notification passes4 (`/tmp/alga-notification-priority-activation.log`). Complete workspace execution passes **57 files / 420 assertions / zero skipped, pending or todo**, with full collection/execution reconciliation, in311.92seconds (`/tmp/alga-workspace-db-57.log`, `evidence/workspace-db-57-activation.json`). Billing/reporting actual unit collections remain nonempty (286/16files) and contain no `.db.test` files after explicit package exclusions. Historical service-period inventory references follow the report test rename; all66existing assertions pass (`/tmp/alga-db-rename-inventory.log`). Six discovery harness cases pass.
- Native Nx lane job101537800128 failed despite11passing assertions: a91.6-second synchronous graph export blocked Vitest's RPC result reporting (`Timeout calling onTaskUpdate`). Replaced synchronous subprocess calls in graph/affected/cache tests with awaited subprocesses, preserving assertions and bounded child execution. Full local run with a fresh project-graph cache passes **5files/11tests/zero errors** (`/tmp/alga-nx-async-cold.log`, `evidence/nx-async-execution.json`). Native follow-up is still required; do not treat the earlier11passing assertions as a successful job.
- Activated eight server bucket/pool integration suites by removing `RUN_DB_TESTS` skips and developer connection defaults; each now uses migrated disposable fixtures. Coverage includes weighted burn, catch-all membership, per-service overage tax, overlays, report totals, pool listing, wizard/template round trips, simulator snapshots and time-entry draw adjustment. The existing assertions are retained. Two Redis recovery tests now use the integration lane's normal Redis configuration (or explicit TEST_REDIS_URL), fail on absent service configuration, and clean up only random owned keys.
- First bucket execution was28passed/1skipped due a bootstrap failure: simultaneous migrations in different databases collided on global `app_user` role settings (`pg_db_role_setting_databaseid_rol_index`). The databases were isolated but the PostgreSQL instance was shared. No product migration changed. Serialize local bootstraps or use separate PostgreSQL instances (as CI already does); documented the constraint. Fixed cleanup to preserve the original setup error while still closing a created connection. Serialized eight-suite execution passes **29/29**, zero skips,112.34seconds (`/tmp/alga-bucket-serial.log`, `/tmp/alga-bucket-serial.json`). Redis recovery separately passes2tests (`/tmp/alga-retry-redis-activation.log`).
- Full EE typecheck passes (`/tmp/alga-db-activation-types.log`). A targeted check of15changed test files found the legacy ambient `server/src/types/vitest.d.ts` shadows real Vitest exports; the temporary check config excludes that stub and uses installed Vitest types without changing repository-wide declarations. Corrected stale fixture types (unused entryDate, explicit pool service identity, typed bucket charges, null client-contract identity for profile snapshots). Final combined runtime/type verification is recorded below when terminal.
- Native new-lane verification on22c: enterprise integration **32files/328tests** passes (job101537800087, `/tmp/alga-ee-integration-native-22c.log`); showcase **8files/117tests** plus iframe build passes (job101537800127, `/tmp/alga-showcase-native-22c.log`). AI gateway, expanded enterprise unit aggregate, workspace database and the previously failing Nx affected typecheck also pass. Full integration job101537861108 remains live in run34052241187, and native build/browser work remains unfinished. Keep new edits local until current native evidence is terminal.
- No plan completion flags changed. Remaining server skips include attachment/publication recovery, live SMTP/production invoice tooling, Temporal email/redaction tests that target the deleted in-process interpreter, collaboration/survey/RMM cases and unit TODOs. Port Temporal tests to the real worker runtime; do not simply unskip them or seed their expected snapshots. The original global inventory/enforcement/provider/release/metrics/model scope remains active.

- Final bucket/pool plus Redis verification after fixture typing corrections passes **9files/31assertions/zero failed, skipped, pending or todo**,111.54seconds (`/tmp/alga-bucket-retry-final.log`, `/tmp/alga-bucket-retry-final.json`, `evidence/bucket-retry-integration-activation.json`). Targeted15-file typecheck with installed Vitest declarations passes (`/tmp/alga-activated-tests-real-types-repaired.log`). The checkpoint activates40previously skipped assertions in total (9workspace DB +31integration). Plan validation and whitespace checks pass. No additional local processes remain running.

### Attachment recovery and SMTP receipt evidence (2026-09-06)

- Resumed after a discussion-only turn; verified both outstanding local handles were terminal. The two attachment/publication suites pass **58 assertions across 2 files, zero failures/skips/todos**,36.75seconds (`/tmp/alga-attachment-activation.log`, `/tmp/alga-attachment-activation.json`). They now bootstrap migrated disposable databases through the standard integration lane instead of requiring developer databases or opt-in environment flags.
- The previously manual PgBoss recovery case starts an owned SMTP emulator on ephemeral ports. It executes the actual worker/discovery and delivery ledger, verifies recovery after publication failure, and receives one PDF email with exact bytes. Storage download, auth and publication dispatch seams remain substituted; this is not F019 built-service or browser evidence. Removed its dependency on developer GreenMail ports3025/8080 and added billing-profile cleanup before tenant clients.
- Extended SMTP sink receipts with parsed attachments (binary base64, size, MIME type, disposition and Content-ID) and threading headers. A new wire regression failed against the prior capture implementation while the three original tests passed. After the implementation and correction of an invalid MIME part-order assumption, **4/4 tests pass** under both server Vitest3 and the package's own Vitest4 runner (`/tmp/alga-smtp-attachment-final.log`, `/tmp/alga-smtp-native-runner.log`). CI now explicitly runs `npm test --workspace=@alga-psa/emulator-smtp-sink` during candidate emulator validation. Package typecheck passes. Receipt semantics documented in the emulator README. Durable execution evidence: `evidence/attachment-recovery-activation.json`.
- Targeted test typechecking found an existing untyped empty draft array inferred as never[]; added its actual upload-result type. Final targeted typecheck result follows below. No application runtime change was needed for these58cases.
- Revalidated published22c checks: full integration101537861108, CEbuild101537856824 and unit/coverage jobs101537800089/101537800234 remained live. Nx tooling failure101537800128 is repaired in localb4f but awaits publication/native verification. Do not cancel existing work with a push.
- Remaining skips are not equivalent: collaboration needs an owned service and real persistence proof; RMM Temporal needs a real broker; the project-completion survey case documents missing product/schema support; two manual attachment smoke cases still require UI-created fixtures. None were silently relabeled as complete. Global inventory, effective gates, provider parity, built email-service, release/upgrade/synthetic and metrics/model requirements remain incomplete. No plan completion flags changed.

- Final targeted attachment-test typecheck with installed Vitest declarations passes (`/tmp/alga-attachment-types-final.log`); workflow lint, plan validation and whitespace checks pass. At final readback Nx affected unit tests are terminal (no longer live); full integration, CE image build and full server coverage remain IN_PROGRESS. All local test/typecheck handles are terminal.

### Collaboration service activation and persistence assertions (2026-09-06)

- Previous turn made progress in committedc0c9784fe2. Revalidated a clean worktree and live published22c runs before starting. Activated the five Hocuspocus cases that previously depended on `RUN_HOCUSPOCUS_TESTS` and an unspecified developer server. Moved them into the owning DB fixture scope; the previous top-level persistence group could access an already destroyed connection.
- Tests instantiate the real Hocuspocus2.15.3 server from the service's locked dependencies on an ephemeral loopback port, with the production room validator and persistence extension. An owned HTTP bridge forwards received requests into the actual internal persistence route, which writes through the real persistence core to migrated PostgreSQL. The actual snapshot action connects to the same WebSocket endpoint. CI now runs `npm ci --prefix hocuspocus --ignore-scripts`; no new unlocked dependency or developer service is required.
- Cases verify bidirectional edits, awareness, rejected tenant synchronization, live snapshot save, and durable ProseMirror content after final disconnect and room eviction. Reconnecting to an empty room via the snapshot action must not overwrite that saved content. Added one HTTP guard case proving an invalid shared key returns401 and a wrong tenant returns404 while stored content remains unchanged. Removed cleanup error swallowing. Providers/documents, WebSocket server and HTTP listener are closed by fixture hooks; all waits poll observable state with bounds.
- Initial17cases pass (`/tmp/alga-collaboration-activation.log`). With the HTTP guard and strict cleanup, **18/18 pass**, zero skipped/todo/errors (`/tmp/alga-collaboration-guards.log`). Targeted typecheck with installed Vitest declarations passes (`/tmp/alga-collaboration-types.log`).
- Assertion-strength experiment temporarily removed the persistence extension from the test server and selected the eviction case. It failed at the persisted-content assertion (expected Persisted content, actual undefined), not during setup; the other17cases were deliberately unselected (`/tmp/alga-collaboration-oracle.log`). Restored the exact original source and reran the entire suite: **18/18 pass**,15.81seconds (`/tmp/alga-collaboration-final.log`, `/tmp/alga-collaboration-final.json`). Durable evidence: `evidence/collaboration-activation.json`. This is a controlled fault experiment, not a historical incident replay.
- Updated testing standards with the exact dependency/test command and scope. Browser auth/DB routing remain fixture seams; this does not close built-service, Redis fanout or browser coverage. Workflow lint, whitespace and plan validation pass. No feature/test completion flags changed. All local test/typecheck handles are terminal.
- Native22c CE/EE builds are now terminal and production browser jobs101542504596/101542504599 are live. Full integration101537861108 and server coverage101537800234 remain live; Nx tooling failure101537800128 remains repaired only in localb4f. Preserve these runs before publishing new commits.

### Required RMM Temporal schedules (2026-09-06)

- Previous goal turn made progress in9f8424a436. Revalidated clean local state and live native PR checks. The remaining three RMM schedule cases used a broker reachability probe and conditional skip; replaced that with an owned SDK development-server fixture. The entire15-case suite now requires its normal migrated test database and no longer reads developer connection files or fixed tenant identity.
- Temporal uses installed `@temporalio/testing`1.14.1, pinned CLI release`v1.5.1` (server1.29.1), a dedicated namespace and random task queue. The actual TemporalJobRunner receives the fixture address explicitly, starts, and closes on teardown before the SDK server is stopped. Only ScheduleNotFoundError is ignored during schedule cleanup; connectivity/permission failures remain visible. No production runner behavior changed.
- First execution passed12cases but failed Temporal startup because the unprefixed download tag`1.5.1` returned404 (`/tmp/alga-rmm-temporal-activation.log`). Verified official GitHub release`v1.5.1`, corrected the tag, and reran the full file: **15tests passed, zero failed/skipped/todo**,31.67seconds (`/tmp/alga-rmm-temporal-pinned.log`, `/tmp/alga-rmm-temporal-pinned.json`). Targeted typecheck passes (`/tmp/alga-rmm-temporal-types.log`). Durable evidence: `evidence/rmm-temporal-activation.json`.
- Temporal cases verify real schedule payload, idempotent reconciliation and cancellation on disable. PgBoss delivery and forwarded dispatch are separate cases; no claim is made that these three cases execute a Temporal worker or real RMM provider. The testing standards now document the pinned download and reproduction command. All local test/typecheck handles are terminal. No plan completion flags changed.
- Published22c production browser checks are now terminal SUCCESS: CE job101542504596 **18passed** in3.1minutes (`/tmp/alga-browser-ce-22c.log`); EE job101542504599 **20passed** in3.7minutes (`/tmp/alga-browser-ee-22c.log`), both run34052241152. Full integration101537861108 and server coverage101537800234 remain IN_PROGRESS. Native Nx tooling failure101537800128 is repaired locally but awaits the next publication. Preserve those expensive live runs before pushing.

### Aggregate workspace execution gate (2026-09-06)

- Previous turn made progress in939a12de51. Current worktree was clean at resumption. Added stable `Workspace execution gate` to the additional-workspace workflow with always-run dependencies on all matrix/EE/AI groups and the EE shard aggregate. It downloads raw artifacts from its own run and emits `test-results/workspace-gate/aggregate.json` even for failed/missing inputs. It needs no npm install or external write permissions.
- The shared evaluator requires all eight suites and all three EE unit shards, successful prerequisite outcomes, candidate SHA matching a clean checkout, clean matching before/after source evidence, full unfiltered execution, and independent tracked candidate coverage. It recomputes counts and file/assertion identities from raw collection/execution reports before comparing producer manifests. Missing/malformed/stale artifacts, changed files, skips/todos, partial reports, false partition claims and cancellation reject the aggregate. Matrix job failure does not mislabel otherwise passing sibling suite reports.
- **20behavioral checks pass**, including eight gate tests (`/tmp/alga-workspace-gate-final-tests.log`). The CLI test creates a disposable clean git checkout and artifact files, verifies successful exit/evidence, then checks wrong candidate SHA, malformed needs JSON, broken report JSON and missing report failure. This tests runtime decisions, not source strings. Workflow lint and whitespace checks pass.
- Downloaded actual native reports from completed workflow34052241154 to`/tmp/alga-workspace-native-22c`. Every producer reports clean before/after source at merge095ad7124f91aa2012b5e8aef2fb21d9d9e7d766. The new evaluator rejects the candidate for the known Nx failure even though that raw report contains11passing assertions; the other seven suites reconcile. Final replay takes23.70seconds and reports exactly the expected failure (`/tmp/alga-workspace-native-gate-final-22c.json`, `evidence/workspace-gate-validation.json`).
- Native report replay initially spent over2.5minutes repeating filesystem canonicalization. After identifying the owned read-only process, terminated it explicitly (exit143) and reran with a per-reconciliation normalized-path cache. No process was restarted merely because observation timed out. The cache retains existing identity/symlink validation and never crosses report boundaries; all execution/discovery checks remain green.
- Published22c full server unit/coverage is now terminal success: **2,678passed files,4skipped files;14,450passed assertions,11skipped,22todo**,2901.42seconds (`/tmp/alga-server-unit-22c.log`). Nine of those unit skips are already activated locally in the workspace DB lane. Full integration101537861108 is the remaining live native job, so queued commits have not been pushed.
- This is the workspace portion of F007, not completion of repository-wide aggregation, effective protections, exclusions, release validation or the full plan. F004/F006/F007 and related test flags remain false. All local replay/test handles are terminal.

### QuickBooks drift and re-export browser journey (2026-09-06)

- Added company-scoped `rename-invoice` emulator control through the existing state machine. The wire regression verifies CDC discovery, stale SyncToken rejection (5010), live-token update, preserved amounts/identity, and an untouched second company.
- Extended the existing real-sign-in, OAuth, UI mapping/export and transport/token recovery browser journey: change the remote DocNumber, run Sync Now through settings, assert stored-token drift, use the actual invoice Re-export and Sync buttons, then assert one restored invoice, matching new token, correct company and no drift action after reload.
- The first browser execution failed at drift detection: wire simulator timestamps were fixed in January while the app used current time. Added an optional clock callback to the pure simulator and wired every company/reset to the emulator host clock. Pure tests retain their logical clock. A current-time CDC wire assertion prevents this mismatch returning.
- Final local results: headed browser **1 passed in47.2seconds**; QBO wire **10 passed**; pure simulator **23 passed in2files**. QBO package build/typecheck and production browser typecheck pass. Evidence: `evidence/qbo-drift-browser.json`. The browser reused the existing production app image and a locally replaced emulator dist; native candidate evidence remains pending. Initial sandbox wire execution could not bind its owned server; authorized rerun passed. All handles terminal.
- Published22c full integration job101537861108 finished SUCCESS at19:47:37UTC: **264passed files,15skipped;1,915passed assertions,146skipped**,4038.02seconds (`/tmp/alga-integration-22c.log`). The local activation commits address97 of those skips. Only published Nx tooling remains failed and its tested async fix is queued. No expensive job remains live, so this checkpoint can be pushed.
- No plan completion flags changed. Provider parity, remaining journeys, required protections and release-wide evidence remain open.

### Xero browser journey and native dependency repairs (2026-09-06, validation in progress)

- Previous turn made progress in e23148e286, pushed after22c CI was terminal. Current published candidate e231 uses merge904c0fcaa4299b06c188b73124a88cac246668ec. No further push while native full integration101549077374 and server coverage101549019970 remain live.
- Added `e2e-tests/tests/xero-export.spec.ts`: real sign-in, tenant-owned OAuth credentials, selected default organisation, service mapping, export failure, visible failed row, expired-token recovery, vendor/mapping readback and duplicate exclusion. Local headed EE production browser **1passed in38.9seconds**, no retries (`/tmp/alga-xero-browser-initial.log`). Xero wire **8passed**, build/typecheck/browser typecheck and workflow lint pass. CE collects a501 enterprise-only assertion; native CE execution remains pending. Added explicit Xero wire-suite invocation to candidate emulator CI build. Evidence: `evidence/xero-browser-journey.json`.
- New Xero control `select-organisation` reorders existing connections and rejects unknown IDs without mutation; Alga uses its shipped first-connection default. It does not model a separate Alga picker or real provider consent UI. Local browser reused app image5804ee43c0ef... and emulator base image d84d082a5f... with Xero dist replaced. Provider parity, credentials/PKCE enforcement and sandbox drift remain gaps.
- Native additional-workspace aggregate now PASSES (job101550141507, run34056413260); all8suites reconcile, including Nx11assertions. Raw artifact9996210199 is `/tmp/alga-workspace-gate-native-e231/aggregate.json`; summary `evidence/workspace-gate-native-e231.json`. This is not repository-wide readiness.
- Native circular guard101549020168 failed because the newly activated reporting/billing suites imported server/test-utils/dbConfig. Replaced those imports with a lower-level `packages/db/test-utils/workspaceConnection.ts`. Recomputed Nx graph passes unchanged baseline:3knowncycles,0new. Actual `nx build-deps server --graph` now has57tasks, includes opportunities:build and excludes server:build (onlyserver:build-deps). Logs `/tmp/alga-reporting-cycle-guard-fixed.log`, `/tmp/alga-build-deps-fixed.log`; graph `/tmp/alga-build-deps-fixed.json`.
- CE/EE image jobs101549079427/101549079410 launched server:build inside build-deps and failed to resolve unbuilt opportunities exports. Browser jobs then failed their build prerequisites, so they did not execute the new QBO scenario. EE workflow guard101549020332 exited130 after also launching server:build. Dependency fix addresses that task planning; fresh native builds still required. Logs `/tmp/alga-ce-build-e231.log`, `/tmp/alga-ee-build-e231.log`, `/tmp/alga-browser-ee-native-e231.log`, `/tmp/alga-ee-workflows-native-e231.log`.
- Added real Nx task-graph regression to nxWorkspace.test.ts. Installed suite **5files12passed** in44.71sec (`/tmp/alga-nx-task-plan-guard.log`). It checks planned build targets, not source text. Targeted typechecking including the new DB regression passes (`/tmp/alga-workspace-connection-types.log`).
- Native workspace DB101549077391 failed3deferred-revenue assertions with tenant-table permissions. Root cause: workflow model fixtures switch DB_NAME_SERVER/DB_USER_SERVER to a suffixed database/role; the old helper combined that role with TEST_DB_NAME (base DB). Shared connection now keeps the active pair and requires the database be the declared test base or a suffixed worker database. No privilege escalation or assertion removal.
- Added `packages/db/test-utils/workspaceConnection.db.test.ts`, creating an owned suffixed DB and checking actual current_database/current_user plus write/read. Pre-fix run failed at the intended database identity: expectedtest_database_scope_..., receivedtest_database (`/tmp/alga-workspace-connection-before.log`). The probe drops its owned DB after closing its connection.
- Full local57suite run initially reported419pass/1timeout because I incorrectly set a Redis password for the owned no-auth Redis; `redis-cli ping` returnsPONG without auth. Corrected environment (REDIS_PASSWORD empty) produced **57files420passed** in327.62sec (`/tmp/alga-workspace-db-shared-fixture-final.log`, `/tmp/alga-workspace-db-shared-fixture-57-pass.json`). That random order did not reproduce native role drift; it is not final evidence for the subsequent connection-pair fix.
- Final **58suite** run is LIVE via exec session **24230**, exact CIseed20260610, log `/tmp/alga-workspace-db-58-final.log`. It uses ownedPG55432/Redis56379, DBpasswordtest_password, emptyRedispassword, SECRET_READ_CHAIN=env. Do not bootstrap another local DB suite concurrently or commit while this run is collecting source-revision evidence. All other local sessions are terminal. No process was cancelled/restarted on an observation timeout.
- Changes remain uncommitted pending that run. No completion flags changed. Next: inspect final58suite result, record durable DB/graph evidence, commit Xero and dependency/DB fixes, then keep working on full remaining plan while expensive native runs finish before publishing.

### Final validation of Xero and workspace fixture repairs (2026-09-06)

- Session24230 is terminal SUCCESS: **58files421assertions passed**,0skips/failures,331.66seconds at the nativeCI ordering seed20260610. The new actual-database regression passes along with all unchanged financial assertions. Evidence: `evidence/workspace-db-58-fixture-scope.json`; raw runner outputs remain under`test-results/workspace-db` and `/tmp/alga-workspace-db-58-final.log`.
- All local browser/wire/DB/Nx/typecheck handles are terminal. Changes are ready for a local checkpoint commit. Native full integration and server coverage remain live at e231, so do not push merely to restart failed image jobs.
- Initial F019 assessment: candidate CI already builds email-service and starts it with GreenMail. The built email-service owns unified inbound queue consumers, so basic raw-MIME processing does not require substituting a workflow interpreter or calling handlers from the test. Local browser server has no mounts, stores secrets in its writable layer, and needs shared credential storage plus IMAP webhook secret/routing before adding a separate email-service container. Existing network`alga-regression-browser` is internal with server alias`server`. Follow the inbound-email skill's SMTP→IMAP→webhook→queue→ticket verification path and keep original F019 scope including attachments, dedupe and threaded outbound reply.

### Native infrastructure setup failure and built email transport (2026-09-06)

- Native infrastructure shard 1 on e231 completed with 20 files/189 passing assertions and one suite setup failure. `billingInvoiceGeneration_consistency.test.ts` overrode the shared 120-second bootstrap allowance with 60 seconds; its single financial assertion never ran. Removed the override. Targeted real-DB run at CI seed 20260610 passed 1/1 with no skips, 19.578 seconds overall. Evidence: `evidence/invoice-consistency-bootstrap.json`. Full native rerun remains required.
- F019 is in progress: downloaded CI email-service artifact 9996165125 (run 34056413263), loaded image 15fb60a9f047; started GreenMail 2.1.8 plus the actual image and real unified queue consumer. New owned application instance uses fresh shared synthetic-secret volume; existing browser-server container retained stopped. Automatic review rejected copying existing container secrets to host; no export occurred.
- Owned Docker VM filled during image import. PostgreSQL logged `No space left on device` and shut down; first browser attempt failed before setup. Removed only obsolete stopped `alga-regression-browser-server-before-a8de` (5.96 GB writable layer), retained all DB volumes/current browser server, restarted PostgreSQL successfully. Both email consumer and full app event/notification initialization are now running. New inbound browser scenario is unfinished and is not F019 completion evidence.

- F019 local complete journey now passes: final dedicated-tenant headed EE run **1 pass / 0 fail / 0 skipped / 0 flaky**, 46.3 seconds (`/tmp/alga-inbound-browser-final.log`). Earlier successful 50.7-second run also verified the same transport before tightening per-scenario tenant ownership. Evidence: `evidence/inbound-email-built-journey.json`. Actual email-service logs show both replay jobs with processedCount=0, dedupedCount=1, followed by queue acknowledgments.
- New `e2e-tests/tests/inbound-email.spec.ts` configures IMAP via UI, feeds raw MIME through SMTP/IMAP/built consumer, checks sender and ticket content/inline quote, downloads attachment bytes, sends an agent comment and captures real SMTP headers, returns a customer reply with Gmail-style history trimming, then replays the original UID/MIME pointers through the actual webhook and waits for Redis queue completion while asserting unchanged business records/mail. No app route interception or direct parser/handler calls. GreenMail authentication and upstream authentication results are explicitly simulated; different SMTP deliveries have different provider identities/source hashes and are not the replay claim.
- CI overlay shares `/run/secrets/tenants` and `/data/files` between app/email-service, pins GreenMail 2.1.8 with unique synthetic mailboxes, exposes SMTP/Redis via fixed ingress, and removes direct service publications for server/Postgres/Redis/GreenMail. Both CE/EE Compose models validated. TypeScript, actionlint, plan validation and diff check passed. Native CE/EE run still required; F019/T014 stay false.
- Native e231 server unit+coverage completed successfully at 20:46:22 UTC: 2678 files/14452 assertions passed, 1 file/2 assertions skipped, 22 todo. Evidence `evidence/server-coverage-native-e231.json`; exclusions remain incomplete work. Full integration job 101549077374 remained live on its original run step at the last check, so do not push until terminal.

### Real contract-selection assertions and terminal integration evidence (2026-09-06)

- The preceding question-only turn made no implementation progress. Revalidated clean local HEAD with two unpublished commits, then re-polled native integration job101549077374: terminal SUCCESS at21:05:35UTC, 275files/2013assertions passed,4files/49assertions skipped,3936.10seconds. Evidence: `evidence/integration-native-e231.json`. Publishing no longer interrupts this run.
- Replaced four self-mocked passing assertions in billingPlanSelection.test.ts with eight cases running the real contract eligibility helper and UI projection. Only database I/O is substituted. They cover labels/identity, Date hydration, explicit-member precedence over catch-all buckets, absent/legacy overlays, unnamed labels, missing services, missing tenant context and database failure without stale results. Retained the existing missing-client TODO; no claim that input validation or SQL eligibility is proven here.
- Both contract-selection/disambiguation suites pass:20assertions,zero failures,one existingTODO. A controlled source mutation forcing hasBucketOverlay=false failed exactly two output assertions; restored the source and reran successfully. Evidence: `evidence/contract-selection-assertions.json`. No application behavior changed. No completion flags changed.

### Ticket permission assertions use actual role grants (2026-09-06)

- Previous turn made progress: published76235f800b with the three checkpoint commits and refreshed PR3343. This turn revalidated clean state and live candidate full integration101559861578/server coverage101559799569. Native circular-dependency guard101559799799 now passes; builds and EE workflow guard remain live. No push while expensive candidate jobs run.
- Ticket infrastructure previously made permission decisions by username. Replaced that stub with production hasPermission and real user/role/permission records in PostgreSQL. Session and event publishing remain explicit fixture seams. Admin updates now change/assert the title and updater rather than assigning the existing status; denied updates assert unchanged title/updater and denied creates assert unchanged ticket records.
- Added administrator read, live role revocation, client-only role rejection and permission revocation. All seven cases in the obsolete self-mocked describe.todo unit file now have executing infrastructure equivalents; removed that file rather than retaining misleading duplicate placeholders. Case mapping is preserved in `evidence/ticket-permissions-real-rbac.json`. Nine actual-DB cases pass, zero skipped/todo. This does not close the rest of F002.
- Controlled fault: temporarily changed real RBAC's no-matching-grant return to true. All five denial cases failed because the operation succeeded. Restored production source automatically; the full nine-case suite passed again. Targeted typecheck exposed and repaired fixture types plus the shared typed-mock adapter signature without changing its runtime behavior. Final installed-type tsc passes.
- Initial sandbox DB run failed in setup before assertions; authorized access to the owned PostgreSQL environment passed. Final raw reports/logs: `/tmp/alga-ticket-permissions-final.json`, `/tmp/alga-ticket-permissions-final.log`; fault reports use `-fault`; typecheck log `/tmp/alga-ticket-permissions-types.log`. All local execution handles terminal. No production authorization behavior or plan completion flags changed.

### Financial state-model pilot and cash/credit defect (2026-09-06, full lane running)

- Previous turn made progress in localf2209bc1be. Published76235f800b still runs full integration101559861578 and coverage101559799569; do not push while these are live. Native workspace DB101559861561 and infrastructure aggregate101561336882 now PASS.
- Added uncommitted `packages/billing/tests/financialStateModel.db.test.ts`: independent expected balances, real finalization/grant/apply/payment mapping/reversal/void, two fresh tenants per rollback transaction, persisted-state checks after every command and duplicate delivery. Real transaction helpers are preserved; auth and remote delivery are seams. Final version has three deterministic cases plus100generated sequences of up to25commands; explicit seed/path replay and saved shrunk fixture are documented. No F028/T022 completion flag changed pending final/native evidence.
- Real reproducer failed before the fix:10000-cent invoice,6000paid,10000credit request applied10000 rather than4000. Corrected applyCreditToInvoiceInternal to read net invoice_payments under its existing invoice row lock and cap by unpaid balance as well as eligible charges.
- Initial three-case model (20generated runs) passes. Temporarily disabling only the new balance cap made the generated model fail on its first example and shrink20times to100-cent total,1cent paid,100credit requested (expected99). Fix restored automatically. Exact seed20260906/path and counterexample saved in `packages/billing/tests/fixtures/financialStateCounterexample.json`; evidence `evidence/financial-state-model.json`.
- Real concurrent application/reversal suites pass14assertions in2files,43.32seconds; targeted installed-type TypeScript check passes. All focused test/typecheck handles terminal.
- Full local workspace DB lane is LIVE via exec session14488, log `/tmp/alga-workspace-db-financial-model.log`, CIseed20260610 and ownedPG55432/Redis56379 with emptyRedispassword. Expected59files and425assertions if discovery includes the four new cases. Do not bootstrap another DB suite or commit while this run gathers revision evidence. Durable financial evidence currently labels this final broad run pending; update it after reading terminal results, then commit the fix/model/docs.

- Full workspace session14488 is terminal SUCCESS:59files425assertions,zero skipped/todo/failures,328.11seconds. The final four-case financial model ran100generated sequences and the saved counterexample. Durable evidence: `evidence/workspace-db-financial-model.json`.
- Added one infrastructure race: a pending cash row holds the invoice lock, a real credit application is observed waiting in PostgreSQL, then payment commit releases it and only4000of10000credit applies after6000paid. The final targeted typecheck including this new case passes. All credit infrastructure tests are now RUNNING in exec session79211; `/tmp/alga-credit-regression-final.log` and correspondingJSON. Wait for that result before committing. No other local DB test is running.

- Native762 candidate EE workflow build guard101559799477 is now SUCCESS. Production browser jobs are live: enterprise101562895873 and community101562895880, run34060406094. This demonstrates the dependency-build repair reached browser execution; it is not yet a browser success claim. Full integration101559861578 and coverage101559799569 remain live.
- Current local credit-folder run79211 is still live, progressing with passing suites and no observed failures. Full workspace report is already terminal/preserved. Financial source/model/docs and the new cash-lock race remain uncommitted until this17-file credit validation finishes; continue polling79211 rather than restarting/bootstrap overlap.

### Financial checkpoint final validation (2026-09-06)

- Previous turn made progress: recorded the full59file425assertion workspace success and added the cash-lock race. Revalidated live credit session79211 rather than restarting it. It is now terminal SUCCESS:17files78assertions,zero skips/failures,302.86seconds. This includes the11-case concurrent apply suite and the new in-flight payment scenario, plus all existing credit eligibility, policy, expiration, permission and reversal cases.
- Updated `evidence/financial-state-model.json` and regression ledger with final broad validation. Both independent model and existing financial suites pass; target typecheck, whitespace and plan validation pass. No local execution handles remain live. The fix/model/docs are ready for a local checkpoint commit; native revalidation is still required before F028/T022 completion.
- Native browser jobs101562895873/101562895880 were still loading/validating candidate images at latest detailed readback, with no failed steps. Published full integration101559861578 and coverage101559799569 remain live; keep the new checkpoint local until long jobs finish.

### Microsoft calendar protocol checkpoint (2026-09-06)

- Progress after financial checkpoint a93030d805: shared/EE calendar adapters, authorization helpers and EE callback now honor existing shared Microsoft endpoint configuration. Emulator now models delegated primary-calendar metadata and event CRUD, preserving location/privacy/availability/extended properties. Unsupported filter/order/timezone semantics fail explicitly; UTC wall-clock filtering is independent of host timezone.
- New real-adapter suite passes10cases over live isolated HTTP OAuth/Graph. This discovered and fixed shared getEvent catch-without-binding ReferenceError on404. Only provider persistence and EE stored-profile resolution are substituted; no browser/callback/database-persistence claim. All34emulator cases in4files pass with TZ=America/New_York, including5new calendar guard cases. Both relevant typechecks and emulator build pass. Added msgraph tests to candidate emulator CI validation. Evidence: evidence/microsoft-calendar-adapter.json. F034 is still incomplete (calendar sync/delta/webhooks, Microsoft browser paths and Teams restrictions remain).
- Native762 browser evidence is now terminal: community job101562895880 succeeded; enterprise101562895873 failed because Xero passed only on retry. Other enterprise cases, including new inbound email and QBO, passed first attempt. Aggregate101564504425 correctly failed. Do not hide flakiness with timeouts/retry acceptance.
- Xero failure was first Save Mapping at e2e-tests/tests/xero-export.spec.ts:55; error-context shows Alga Service reverted to placeholder while the external Item remains selected. Suspected form-reset race: AccountingMappingDialog initialization effect depends on externalEntities/targetConfig/module.metadata and clears all draft fields when catalog/reference changes. Needs deterministic behavioral reproduction and fix; no Xero code modified in this checkpoint. Downloaded artifact9997804919 to /tmp/alga-browser-enterprise-762.zip; extracted error-context and screenshot under /tmp/alga-browser-enterprise-762/alga-psa/alga-psa/e2e-tests/test-results/xero-export-Xero-OAuth-and-0466b--without-duplicate-invoices-enterprise-chromium/. Full log /tmp/alga-browser-enterprise-762.log.
- Published full integration101559861578 and coverage101559799569 are still live. Hold push to avoid cancelling evidence; two preceding commits f2209bc1be/a93030d805 are local only. Calendar checkpoint also remains local until those jobs terminate. No goal or feature completion changes.

### Accounting draft fix and native email acceptance (2026-09-06)

- Previous goal turn made progress: committed calendar protocol groundwork395193f81b; no local process remained live. This turn revalidated full integration101559861578 and coverage101559799569 as running on published762. Keep holding push while those expensive jobs finish.
- Reproduced a genuine form-reset defect consistent with native Xero failure: real Dialog/CustomSelect choices plus metadata are cleared when externalEntities gets a fresh catalog array, and Save never calls persistence. Original source failed the intended submission assertion (after resolving missing jsdom scrolling shim), not setup. Source now initializes per open/mapping/module/organization identity and preserves drafts plus isSaving on background catalog changes. Removed provider targets are cleared with a visible re-selection requirement; other fields survive.
- Added5behavioral cases (8total in target-kind file), covering refresh preservation, removed item replacement, pending-save disabled state, reopen and organization changes. Entire accounting mapping folder passes20cases in3files under BOTH package runner and the server CI runner, zero skips/failures. Targeted installed TypeScript check passes. No browser mocks/timeouts/retry policy changed. Native browser revalidation remains required; do not claim Xero/F035 complete. Evidence: evidence/accounting-mapping-draft-refresh.json; regression ledger records an unknown production incident as null.
- Downloaded native community artifact9997802386 and inspected it alongside enterprise9997804919. Tested merge28db477a49607f6d0df45e539a32dbb7d00ad4c8 is clean before/after. Community20passed,0flaky; enterprise21passed,1flaky(Xero). Inbound email passed first attempt in both:41579msCE/42501msEE. QBO EE39989msfirstattempt; CE enterprise-only endpoint rejection14ms. Durable native evidence: evidence/production-browser-native-762.json. F019 and T014 now implemented based on actual built-container acceptance, not overall PR readiness. QBO/F033 remains unchanged pending its broader dependencies; Xero remains incomplete.
- Raw reports: /tmp/alga-mapping-draft-before.log (actual failed assertion), /tmp/alga-mapping-draft-final.json/.log (package runner), /tmp/alga-mapping-draft-server.json/.log (CI runner), /tmp/alga-mapping-draft-types.log (empty/pass). All local exec handles terminal. Next: preserve this as local checkpoint, then continue Microsoft browser/sync work or inspect remaining native results. Full integration started21:17:09UTC; last confirmed live around22:06UTC. Coverage also remains live. Do not restart or push merely because observation elapsed.

### Microsoft calendar delta and notifications (2026-09-06)

- Previous goal turn made progress in a375a88364 (mapping draft fix plus F019/T014 native acceptance). Current turn implemented primary-calendar delta and notification protocol prerequisites for F034. No feature completion flags changed.
- MsGraphCore now stores per-run client-bound snapshots/cursors and frozen pages. calendarView/delta honors initial windows, overlapping events, pagination, updates/deletes/window exits, invalid/reset cursors and UTC wall-clock windows. Unsupported query options, recurrence and non-UTC conversion fail explicitly. Cursor state resets/restores deliberately invalidate old links. These limits are documented in packages/emulators/README.md against Microsoft's primary docs.
- Both real calendar adapters traverse101events, reuse returned cursors, observe updates/deletion and recover from SyncStateNotFound.12adapter cases pass via server runner;46emulator cases in4files pass under America/New_York. Final emulator build/typecheck and targeted adapter typecheck pass. Control calendar-change creates/updates/deletes vendor state and returns callback delivery status; primary-calendar HTTP writes deliver matching notifications. Delivery honors resource/changeType/expiry, does not follow redirects and has a bounded10second callback timeout. No automatic callback retry.
- Found and fixed existing mailbox notifier delivering to calendar resources. Narrowly restoring only its old subscription filter makes the intended assertion fail (calendar/created-only/other-organizer recipients got mail); restored source passes entire46case suite. Raw fault log /tmp/alga-calendar-mail-scope-before.log; final suite /tmp/alga-msgraph-sync-tests.log; real adapters /tmp/alga-msgraph-calendar-sync-adapter.json/.log. Evidence: evidence/microsoft-calendar-sync-protocol.json.
- Native coverage101559799569 completed SUCCESS22:04:08UTC:2678files14456assertions passed,1file/2assertions skipped,22TODO. Recorded exact count/coverage/log hash in evidence/server-coverage-native-762.json. Full integration101559861578 still live (started21:17:09UTC; last confirmed around22:19UTC), so keep pending commits local. Do not restart it or push until terminal.
- Calendar browser still needs real provider configuration, HTTPS callback wiring/trust and DB/worker synchronization. Existing adapters require HTTPS; do not remove that guard. Emulator tests use an isolated HTTP callback receiver only for protocol validation. Teams production emulator restrictions remain unchanged. Existing /users event HTTP mutations do not yet emit the newly modeled calendar notifications (control actions and /me/calendar writes do). All local handles are terminal after final readbacks.

### HTTPS calendar callback and publishing checkpoint (2026-09-06)

- Previous goal turn made progress in c4010d04e0 (calendar delta/notification protocol). This turn added fresh test TLS certificate generation, a fixed HTTPS calendar callback proxy, Compose trust/alias wiring and actual TLS/forwarding tests. All5Node tests pass, including rejection of untrusted/wrong-host certificates, exact Graph validation echo and notification forwarding, route/method restriction and unavailable-upstream failure. Both CE/EE Compose configurations validate private-key isolation, certificate-only emulator trust, HTTPS endpoint and internal network; actionlint passes. Initial Compose read failed only because local validation env lacked NEXT_PUBLIC_BASE_URL; adding the synthetic URL made both pass.
- CI generates owned temporary TLS files before its first Compose config call, passes E2E_CALLBACK_TLS_DIR, waits for the proxy's trusted HTTPS healthcheck and probes it from algasim. Local users must generate/set this directory as documented. Proxy listens internally on3443 and forwards POST /api/calendar/webhooks/microsoft only; the application still requires HTTPS. Browser/provider/persistence journey remains outstanding. Evidence: evidence/calendar-callback-tls.json.
- Full integration101559861578 is now terminal SUCCESS22:22:33UTC:275files2013assertions passed,4files49assertions skipped,3883.52seconds. Raw /tmp/alga-integration-native-762.log; durable evidence/integration-native-762.json. Coverage already succeeded; expensive prior-candidate jobs are all terminal, so publishing the accumulated local checkpoints is now safe. No local test/process handles remain live.
- Publish upcoming TLS/evidence checkpoint together with f2209bc1be, a93030d805,395193f81b,a375a88364,c4010d04e0; update PR3343 description to describe the actual new diff and distinguish prior762native evidence from pending new-candidate runs. Then continue Microsoft browser configuration/worker validation while CI runs.

### Native msgraph source resolution and calendar browser draft (2026-09-06)

- Previous goal turn made progress: committed and PUSHED9b12c5fa638a6757b990b3894d8f8c1682cddb19, including all earlier local checkpoints. PR3343 description now reflects actual diff and prior762native evidence. New full integration job101569754975/run34064092834 and coverage101569699630/run34064092646 are running; hold another push while those expensive jobs execute. Workspace DB101569754955 will validate the financial model.
- Native emulator build101569759710/run34064092749 failed during newly required msgraph validation:44casespassed,2existing mail-adapter smoke cases could not resolve @alga-psa/db because that image-validation job has no application dist. Added vite-tsconfig-paths using root tsconfig.base.json to packages/emulators/msgraph/vitest.config.ts. Tested with12application dist directories temporarily renamed:46casespass,zero skips; every directory restored in finally. Package typecheck passes. This is a runner dependency repair, not a behavior mock. Evidence: evidence/msgraph-clean-workspace-resolution.json; native log /tmp/alga-algasim-native-9b12.log; local log /tmp/alga-msgraph-clean-source.log.
- New UNTRACKED draft e2e-tests/tests/microsoft-calendar.spec.ts: CE hides personal calendar UI; EE configures a manual calendar-capable Microsoft app and binding through UI, completes OAuth popup, asserts real HTTPS subscription persistence, injects @alga vendor event through calendar-change, checks schedule/mapping/UI, edits in UI under persistent503, retries through Sync Now with expired stored deadline, verifies preserved remote ID, then vendor-updates/deletes with UI/DB readback. Fresh tenant owns setup; finally disarms fault and deactivates its provider. Enterprise collection and targeted installed-type TypeScript pass; community collection also passes (one expected CE case). NO runtime acceptance claim; keep draft out of the checkpoint commit until executed.
- Browser path/constraints grounded in source: /msp/settings?tab=integrations&category=providers, Microsoft workbench tab→advanced manual app; calendar in /msp/profile?tab=calendar; scheduling in /msp/schedule. Calendar import requires @alga marker. Sync/webhooks use setImmediate in the server, no Temporal worker necessary for this path. Current local app image predates calendar endpoint overrides, so don't run OAuth against it; use the candidate EE image when available. Server image job101569759721 is still building (started22:28:44UTC), independently of failed algasim matrix entry.
- Local owned Docker stack is unchanged: email-app, email-service, old browser-ingress, algasim, GreenMail/SMTP ingress, PG55432, Redis56379, MinIO and Citus running. New TLS files exist at /tmp/alga-calendar-callback-tls, but the running local stack has not been wired to the new proxy/trust. Old browser ingress may lack published4010: inspect before new browser run. Candidate image import/wiring needs fresh synthetic configuration; never export existing provider secret volumes.
- Next: commit only msgraph config/evidence/scratchpad repair locally. Leave Microsoft calendar spec draft untracked until actual browser validation. Inspect current EE image completion/artifacts and new financial/native tests while CI runs; do not rerun the old failed job expecting it to pick up unpushed code.

### Native financial model acceptance (2026-09-06)

- Revalidated local repair commit dafd6d5e0d; Microsoft calendar draft remains untracked and unexecuted. Published full integration101569754975 and coverage101569699630 remain live; no further push. Prior conversational-only goal turn was no progress; this turn resumed authoritative checks and implementation.
- Native workspace DB101569754955/run34064092834 completed SUCCESS. Downloaded artifact9998527708 and reconciled59expected/executed files,425passed assertions,zero exclusions/failures,full unfiltered selection,clean source before/after at merge275bb4f0b708caab40e79c6948510b05a27f3acc (head9b12). All4financial model cases passed, including100generated sequences and saved counterexample replay. Evidence: evidence/workspace-db-native-9b12.json. F028/T022 now implemented; global baseline/dependency and release gaps remain open.
- Candidate server EE101569759721 remains building. Owned Docker VM has only743MB available; check specific obsolete test images before importing. Current emulator packages were rebuilt/staged successfully in /tmp/alga-calendar-emulator-stage.log. Calendar TLS files remain /tmp/alga-calendar-callback-tls. Host algasim.test mapping is absent locally; browser test will need an explicit Chromium resolver rule (CI config already maps it).

### Local calendar transport readiness (2026-09-06)

- Financial native evidence/plan acceptance committed locally as cac341457c. Revalidated full integration101569754975 and coverage101569699630 as LIVE around22:51UTC; no push. Candidate server EE101569759721 also remains building, active Build and export server-ee from22:28:44UTC. No local test/build/exec handles remain running.
- Updated owned local algasim to bind all8current staged emulator dist directories; recreated browser ingress with published4010 and HTTPS callback alias. Stopped predecessors retained as alga-regression-browser-algasim-before-calendar and alga-regression-browser-ingress-before-calendar. Current containers retain original active names. First startup failed because Colima sees host/tmp bind sources as empty VM directories; generated fresh TLS under ignored workspace node_modules/.cache/alga-calendar-callback-tls and recreated both mounts. Private key stays only in proxy; emulator receives certificate only. Added local shared-directory guidance to e2e-tests/README.md.
- Verified from algasim: trusted https://calendar-callback:3443/probe returns404; POST calendar webhook with synthetic validationToken returns200 and exact token through real old application. Host Graph4010 responds401 without credentials; control catalog responds successfully. This proves transport/validation, not calendar OAuth or synchronization. Removed only unused mcr.microsoft.com/playwright:v1.57.0-noble image from isolated Docker context; disk now4.1GB free (85% used). Existing app image is still old and must be replaced with current candidate before OAuth browser execution.
- Next: use current server EE artifact when available; inspect sufficient disk before importing, use existing fresh synthetic app secret/file volumes, never export old secrets. Browser spec remains untracked and unexecuted. Local Chromium needs resolver rule for algasim.test (host hosts file lacks mapping). Current emulator and TLS transport are ready.

### Microsoft mailbox notification controls (2026-09-06)

- Previous turn made progress in cac341457c/fbee456666. Current turn found mailbox notifications ignored subscription changeType. New real HTTP test reproduced deliveries to /mail AND /updated instead of /mail only. Fixed creation filter; added deliver-message control that reuses an existing message ID and returns per-callback HTTP/connection outcomes, bounded by10s and no redirects. Added3behavioral assertions covering filtering, two replays preserving one mailbox message,202/503/302 outcomes, and connection reset. All49tests in4files pass, zero skips,1.14s; package typecheck/build pass. Initial sandbox run could not bind loopback; authorized run provided the actual before-fix failure. Initial final test used unsupported /me/messages collection; corrected to existing inbox collection, then entire suite passed. Evidence: evidence/microsoft-mail-notification-replay.json. No F034/F037 completion claim.
- Built msgraph and copied current dist into the already mounted .stage/msgraph/dist; restarted owned algasim. Current local emulator now includes replay control; other staged providers unchanged. Server EE101569759721 completed SUCCESS with config digest6e9eace7ae30c8e632cfe29ede1b6ee47a9ac3196e7c9d15d734f1f55dedbe72. Artifact9998737503 (fresh-install-server-enterprise) downloading via live exec48546 to /tmp/alga-server-ee-native-9b12.zip; do NOT restart download on observation timeout. Build log /tmp/alga-server-ee-build-9b12.log.
- Prepared local browser config /tmp/alga-calendar-browser.config.ts with headed existing Playwright config, isolated output /tmp/alga-calendar-browser-results and Chromium resolver MAP algasim.test 127.0.0.1. Browser draft still untracked/unexecuted. New app must preserve fresh synthetic volumes alga-regression-email-secrets→/tmp/alga-email-secrets and alga-regression-email-files→/data/files; use /tmp/alga-local-production.env with last overrides EMAIL_ENABLE=true,SECRET_FS_BASE_PATH=/tmp/alga-email-secrets,STORAGE_LOCAL_BASE_PATH=/data/files,IMAP_WEBHOOK_SECRET=regression-imap-only,CALENDAR_MICROSOFT_WEBHOOK_BASE_URL=https://calendar-callback:3443. Do not export old secret data.

### Candidate image and calendar browser execution (2026-09-06)

- Mailbox replay checkpoint committed locally0be4bd2020; no push while full integration101569754975/coverage101569699630 remain live. Native9b browser jobs101572930605/101572930623 stopped at BUILD_RESULT=failure because algasim image validation failed; no browser cases ran. Repair remains local dafd6d5e0d.
- Candidate download48546 and archive scan61409 are terminal success. Artifact /tmp/alga-server-ee-native-9b12.zip contains server-ee.tar.gz. Archive manifest2d3f0db9b006857afd4b5977a39e39e5c9bf29ec703201cf7d9d12a1abe4e88d and config6e9eace7ae30c8e632cfe29ede1b6ee47a9ac3196e7c9d15d734f1f55dedbe72 match native build. Most layers changed; expanded owned colima-alga-regression disk30→50GiB via stop/start (session29630 terminal), preserved volumes and restarted named active infrastructure. No local DB tests were running. Disk17GBfree after image materialization.
- Docker import19234 completed, /tmp/alga-server-ee-load-9b12.log. This Docker store identifies image by OCI manifest2d3f, not config6e9; first launch using config digest failed before container creation. Relaunched by verifiedmanifest successfully (20710 terminal). Current alga-regression-email-app runs9b candidate, networkaliasserver, fresh synthetic secret/filevolumes preserved. Old app retainedSTOPPED as alga-regression-email-app-before-calendar, along with olderbrowser-server. No provider secret export. AppEMAIL_HOST=algasim,EMAIL_PORT4040,EMAIL_FROMsupport@example.test; current calendarHTTPSoverride included. All earlier emulator/ingress names and TLS mounts remain.
- Headed calendar browser now LIVE session32985, /tmp/alga-calendar-browser-first.log, output/tmp/alga-calendar-browser-results, tempconfig/tmp/alga-calendar-browser.config.ts. It uses candidate9b and locallybuilt currentMicrosoftemulator; do not claim nativebrowsercoverage. Initial readiness53053 completed200 via/auth/msp/signin; actual/auth/signin curl80224 completed307 (normalredirect), browser usesexistingreal signIn helper. App registeredcalendar eventhandlers. Browser draft remainsuntracked until actualvalidation.

### Calendar browser progress and native credit fixture repair (2026-09-06)

- First browser32985 terminalFAILED44.8s: draft used non-existent calendar_providers.name in read/cleanup, masking original error. UI did complete profilebinding andOAuth. Corrected toprovider_name; deactivatedexactownedtenantc6b17f71-1a3a-48c9-9847-3017c5006a5c/provider4a2ed197-e48e-4866-b7e1-8dd813532bf5. Artifacts retained/tmp/alga-calendar-browser-results-first. Second93762 terminalFAILED20.6s: raw DB column isstatus, not APIprojectionconnection_status. Correctedallrawreads; cleanupnowworks. Artifacts-second.
- Third26754FAILED57.2s andfourth37696FAILED52.9s at firsteventeditorfill. Both alreadyprovedUIOAuth,realHTTPSsubscription,callbackHTTP200,singlepersistedmapping,scheduleentryandvisibleevent. Thirdclicked.rbc-event container;fourthclickedvisibletitle; neitheropenedEditEntry. Artifacts-third/-fourth and correspondinglogspreserved. No productfixyet. SuspectEventComponentidentitychangesonhover causinginnerDOMremount; ScheduleCalendar.tsx EventComponent useCallback depends onhoveredEventId AND nonmemoizedhandleSelectEvent. Needproverootcausebeforechanging.
- Diagnostic57349 inserted explicithover+oneanimationframebeforetitleclick; entirecalendarjourneyPASSED34.0s (35.2total), including503error/recovery,expiredstoreddeadline,remotelinkpreservation,vendorupdate/delete. /tmp/alga-calendar-browser-results-hover and /tmp/alga-calendar-browser-hover.log. Its originalNodeConnected:true measurement wasOUTER.rbc-event; itdoesNOTdisproveinnercomponentremount. Furtherdiagnostic61541 is LIVE in/tmp/alga-calendar-browser-title-hover.log andnormal/tmp/alga-calendar-browser-results, measuresoriginalTitleConnectedalso. Afterresult,RESTOREuntrackedbrowserdraftfrom/tmp/microsoft-calendar-without-hover.ts so explicit-hover workaroundisnotpermanentacceptance. KeepF034false; defaultfirstclickmustwork.
- NativeNxunit101569699429 terminalFAILED:server1055files5581assertionspass,2fail,15TODO. Failuresareoldcreditfixturemissinginvoice_paymentsandbrittlesource-textselectassertion. Fixedfixtureemptyledgerandremovedonlyexactselect-listassertion (no replacementtextassertion). Focused2files5casesPASS1.38s,zeroexclusions; fourarelegacy sourcecontracts, notbehavioralcoverage. Evidence:evidence/native-credit-fixture-repair.json; /tmp/alga-nx-units-native-9b12.log and/tmp/alga-credit-native-fixture-repair.log. Fullintegration101569754975andcoverage101569699630stillLIVEaround23:15UTC,holdpush.

### Calendar diagnostic terminal handoff (2026-09-06)

- Furtherdiagnostic61541 is TERMINAL FAILED: UIeditpersistedbutproviderstatusremainedconnectedthrough60s. CompletecapturedGraphjournalhas9requests (OAuth,subscription,delta,getevent) andNOoutboundPATCHafterUIedit. No active local tool/test/build sessions remain. Artifacts/tmp/alga-calendar-browser-results-title-hover; log/tmp/alga-calendar-browser-title-hover.log. Prioronefullpasswithhover retained/tmp/alga-calendar-browser-results-hover.
- Inner-node diagnosticconfirmed originalNodeConnected:true,originalTitleConnected:false afterhover+animationframe. This supports ScheduleCalendar EventComponent remount onhover as lostfirstclickcause, but no productfixhasbeenmade. RemoveddiagnostichoverfromUNTRACKEDe2e-tests/tests/microsoft-calendar.spec.ts byrestoring/tmp/microsoft-calendar-without-hover.ts;rawprovider_name/statusfixesandvisibletitleclickremain. Diagnosticvariant saved/tmp/microsoft-calendar-with-title-hover.ts. Do notmarkF034completeorretainthehoverdelayasacceptance. Evidence:evidence/calendar-browser-diagnostics.json.
- Next: fix/behaviorallyverifyScheduleCalendar eventrendereridentity acrosshover; investigate missingoutboundeventbusdelivery (localreusedRedisconsumerstatevsrealapplicationbug) ratherthanlengtheningtimeout. Currentcandidateimageisstill9b andoldappstopped; anyproductfixneedsnewbuild. Nativefullintegration101569754975andcoverage101569699630werestillrunningatlatest23:15check; revalidatebeforepush. Nativeunitfixturefixcommitted14622ac5b4 andmailboxfix0be4bd2020arelocalonly.

### Calendar interaction and bundled event delivery repair — 2026-09-06

- Reproduced lost first-click and keyboard focus with two behavioral React tests. ScheduleCalendar now uses a stable context renderer; no hover delay was added to the Playwright journey.
- Root cause of missing outbound calendar PATCH: independently bundled event buses registered calendar and search handlers separately (each handlersCount:1), competed in the same Redis group, and acknowledged each other’s work. Real Redis regression reproduced 3 deliveries to calendar / 0 to search before repair. A process-wide registry now delivers the same three unique events to both handlers. Close/reopen and stale-handle monitoring are covered.
- Final local validation: server runner 8 files / 11 tests pass (4.46s), event-bus package runner 6 files / 8 tests pass, targeted TypeScript and plan validation pass. Evidence: evidence/calendar-event-delivery-repair.json. Built-browser acceptance remains outstanding; F034 stays false.
- Native coverage job 101569699630 completed failure: 2677 files / 14476 tests pass; the same two fixture/source-contract failures already repaired in local 14622ac5b4. Full integration job 101569754975 remains in progress at the last check; preserve it and hold publishing until terminal. Published head remains 9b12c5fa638a6757b990b3894d8f8c1682cddb19.

### Microsoft mailbox integration and behavioral repairs — 2026-09-07

- Added shared Microsoft profile UI fixture and mailbox Playwright journey for both editions. It uses actual OAuth, HTTPS webhook setup, email-service processing, Graph MIME reply capture, forced token expiry and duplicate callbacks with queue/business-state checks. Calendar now shares profile setup. F034 stays false pending normal fresh-build CE/EE execution.
- Fixed two application defects found through the browser: callback helpers ignored APPLICATION_URL, and ManagedEmailSettings enabled dependent sender saves before a provider change returned its mailbox configuration. The latter now serializes outbound operations and recovers after failure. Behavioral before/after tests cover the race; nullable settings input types are corrected without changing runtime behavior.
- The real worker exposed missing Graph Inbox lookup/parentFolderId. Added opaque Inbox identity and unknown-folder 404s. Initial contact assertion then correctly failed for unauthenticated MIME; explicit fixture authentication headers preserve attribution policy. Refresh testing exposed lost granted scopes and resource-qualified strings leaking into scp; normalized delegated permissions now survive refresh. Actual outbound MIME previously vanished from the capture surface; both sendMail routes now capture text/plain bytes, and browser assertions parse them with mailparser.
- Final local Graph suite: 4 files / 53 tests pass, zero skips; typecheck/build pass. Managed settings 17 tests pass; email actions/URL consistency 9 pass; HTTPS callback proxy 6 pass; existing Teams production guard 8 pass. Targeted types and plan validation pass. One extra proxy run failed only because sandbox denied loopback bind; authorized rerun passed. Evidence: evidence/microsoft-mailbox-repair.json.
- Diagnostic headed mailbox run 91171 TERMINAL PASS: 1 case, 46.8s / 48.3s total. It proves OAuth, ticket/contact/default persistence, UI reply, renewed token, parsed MIME recipient/content, duplicate callback deduplication and reopened UI. Log /tmp/alga-mailbox-browser-mime-final.log, artifacts /tmp/alga-mailbox-browser-results. Diagnostic spec saved /tmp/microsoft-mailbox-diagnostic-passed.ts. Removed temporary provider-response wait from checked-in spec. Earlier failures/logs and artifacts remain in /tmp.
- Current owned app is still published 9b12c5 with APPLICATION_URL and diagnostic NGROK_URL=https://calendar-callback:3443. REMOVE NGROK_URL on newly built repaired candidate; Compose has APPLICATION_URL only. Owned email-service also uses APPLICATION_URL. Proxy now allows exact calendar and mailbox routes. Current staged Graph emulator contains all mailbox repairs. No secret export; previous app/service containers retained stopped.
- Native full integration 101569754975/run34064092834 completed SUCCESS: 276 files / 2025 tests passed, 4 files / 49 tests skipped, 6525.84s. Evidence: evidence/integration-native-9b12.json. Expensive old-candidate runs are terminal, so accumulated repairs can now be published.
- origin/main advanced one commit to a588388222 (v1.6 discovery gate); this branch still includes a81661446e as its base. Inspect that new gate when refreshing main; do not assume new production UI visibility. Event-bus shared-instance repair also needs actual built validation: calendar/search subscriptions currently omit explicit subscriber IDs, so confirm minification cannot collide handler names.

### Refresh main to unblock native CI — 2026-09-07

- Previous goal turn made progress and published 9efc27860f; all local handles finished. Fresh GitHub inspection reports PR3343 mergeStateStatus DIRTY and no check runs for that commit, rather than a live CI wait. Fetched origin/main and merged a588388222 (release-v1-6-feature UI gate).
- Resolved workflow conflicts by retaining quoted revision variables, main's stream output and its 45-minute timeout. Retained this branch's readable pseudo-localized document labels instead of placeholder digits; complete translation validation passes. actionlint passes. No tests or assertions removed.
- Main's release gate hides selected new authoring controls. Current invoice browser journeys use seeded contract data, ordinary generation and existing invoice templates; the new gate does not require a global flag bypass. Native CE/EE execution will validate the merged behavior. Release-flag scenario coverage remains part of readiness scope.

### Legacy event bus and stable subscriber identity — 2026-09-07

- Main merge published af96daf0bfe1a905f856249d748241f14bfbe89a. GitHub now reports BLOCKED (no merge conflict) and native runs started. Full-SHA run filters are required; a short SHA returned an empty run list. Fresh-install run34070160177 has algasim101585958194 and email-service101585958276 SUCCESS, CEserver101585958195 and EEserver101585958232 LIVE. Integration run34070160256 has full101585957827, DB101585957828 and infrastructure shards LIVE. Hold another push while expensive current runs execute.
- Actual search subscriber imports server/src/lib/eventBus/index.ts, which remained a separate 892-line bus implementation; the earlier package-only global-registry test missed it. Expanded Redis regression reproduced [3,3,0] across package copies and legacy server import. Replaced legacy implementation with a shared package re-export. Expanded test now passes [3,3,3], identical event IDs and close/reopen monitoring.
- Actual calendar/search registration test forces equal minified handler names while retaining real Redis and actual business handlers. It reproduced calendar sync1/search upsert0; explicit stable IDs now produce both effects once. External provider service and search writes are effect probes, not live provider/database proof.
- Final validation: two real Redis tests pass (4.88s total); six existing eventbus/calendar/search files25tests pass; targeted EE-aware TypeScript passes. No exclusions. Evidence: evidence/legacy-calendar-search-delivery.json. All local test/typecheck handles terminal. A first attempted legacy rewrite used the wrong working-directory-relative path and did not edit the file; the subsequent correctly rooted edit and after-test are the actual validation.
- F034 remains false. The current native candidate predates this legacy-entry/identity repair, so calendar export may still fail there. New mailbox UI/application repairs are in that native candidate and should now execute. Local owned app remains old9b12c5 with diagnostic NGROK_URL; remove that workaround when swapping to a new image.

### Built HTTP API baseline and asynchronous storage routes — 2026-09-07

- Prior explanatory goal turn produced no implementation evidence. Resumed by inspecting worktree and exact live CI handles; current origin/main a588388222 is an ancestor of local HEAD4bbc0c7c4c. Existing published candidate remains af96. Both CE and EE image builds now SUCCESS; production browser community/enterprise jobs and full integration101585957827 remain LIVE. Workspace DB, all infrastructure shards and aggregate infrastructure are SUCCESS. Hold push while expensive native jobs execute.
- Preserved and validated previous uncommitted API harness changes: explicit owned database connection, no schema relaxation or destructive bootstrap; rich-text/storage suites use built app; versioned missing-key error envelope and schema-derived board sorting repaired. Added readiness check to common fixture plus behavioral healthy/503/unreachable tests proving no replacement Express process is spawned.
- Actual API runner collects 18 files / 327 cases. Full baseline56951 TERMINAL FAILED, 67.84s, against OLD9b image2d3f0db9b006857afd4b5977a39e39e5c9bf29ec703201cf7d9d12a1abe4e88d and owned browser_ee_migrations_1788672908117. Reporter: 15 files failed / 3 passed; 236 assertions passed, 66 failed, 27 skipped. Two explicit time-entry approval skips are omitted from Vitest list but included in run totals329; remaining25 skips are setup failures (priorities12/services10/ticket-statuses3). Raw report/log /tmp/alga-api-built-baseline.{json,log}. Some reported passes are empty permission/tenant-isolation bodies in tickets.e2e.test.ts and MUST NOT be claimed as coverage.
- Storage actual built requests all400 namespace undefined. Changed existing storageHandlers.test.ts contexts to Promise.resolve: real PostgreSQL regression24643 failed8/passed2. All five HTTP handlers now await params; after39318 PASS10/10,15.48s. Logs /tmp/alga-storage-async-{before,after}.log. Dedicated disposable storage_async_params_82cc used; browser DB was not recreated. Removed unused withTenantConnection helper whose withSchema QueryBuilder did not match its Knex callback type.
- Final API boundary18248 PASS7files37tests2.32s; corrected one initially mislocated CLI filter (the first run only executed6files28). Targeted EE-aware types50570 PASS after fixing fixture count result types, using an environment map instead of globally augmented ProcessEnv, and specifying coverage provider. Ambient vitest declarations excluded only in temporary typecheck config so real installed types apply. Collection84733 terminalPASS. Plan validator and git diff --check PASS.
- New runbook documents explicit connection and candidate readiness. API config remains UNASSIGNED to native CI; development Xero access-log suite needs its separate lane. Fresh-install CI still uses DBname server while draft API guard requires dedicated test name; resolve ownership/naming before wiring. No global inventory or provider feature toggled complete.
- Evidence: evidence/api-built-boundary-repairs.json. Remaining runtime failures include stale service_types.billing_method fixtures, missing ticket client_id fixtures, API authorization/default errors, empty ticket guard tests, and additional endpoint defects. Baseline app predates all current source repairs; successful rebuilt API acceptance is still required.

### API fixture recovery, real authorization cases, and native browser findings — 2026-09-07

- Previous goal turn was progress: local checkpoint b8677872a0, actual API baseline and database reproducer. Current turn started with clean worktree and revalidated exact CI handles. Published candidate remains af96; local accumulated changes have not been pushed because full integration101585957827/run34070160256 is still live.
- Replaced all four empty ticket permission/tenant-isolation bodies with actual HTTP requests, explicit role grants, positive read/assignment controls, denied create/update/delete, cross-tenant reads/writes and persisted state checks. createTestUserWithPermissions now honors resource:action grants transactionally instead of ignoring them. Four actual cases initially passed but teardown failed on ticket_audit_logs; tenant-scoped audit/resource cleanup fixed this. Rerun41416 PASS4selected/59filtered,3.12s (/tmp/alga-api-ticket-guards-final.{json,log}).
- Repaired stale fixtures: priority description removed and required created_by supplied; service types no longer read/write removed billing_method; ticket-status fixture no longer creates a second board default; eight direct ticket fixtures now supply client_id; internal comment fixture uses comment_text; comment list creates threads through the actual API. Existing time conflicts use documented409/CONFLICT, with persisted unchanged approved records and no duplicate overlap. Asset-ticket case now creates a real asset, asserts persisted association and reopened ticket, and checks unknown asset denial without an extra ticket.
- Service suite now10/10 passes against built app. Ticket-status actual board filtering passes2cases; auth-envelope case still fails on old candidate. Priority suite nowexecutes12cases (previouslyallskipped) and reveals real search500 on removeddescription column plus defaultordering. Added real-controller+PostgreSQL lookup regression: initial fixture collided with seeded status order; corrected to max+1/max+10; before67150 FAILED2/2 (prioritySQL/statusorder), after54341 PASS2/2,14.95s. Removed priority description search and added ascending order_number query defaults for priority/status. Disposable lookup_regression_82cc used; browser database not recreated.
- Ticket/time full subset59993 terminalFAILED9/104,93passed,2existingapprovalskips,23.42s versus prior39failures. Remaining work_date response is a real API defect: timestamp2024-07-01T00:00:00.000Z violates timeEntryResponseSchema date-onlystring; assertion retained. Ticket stats omitted average_resolution_time despite public schema/servicecontract; real-method schema regression24192 FAIL, repaired authorized-row stats to returnnull, after39772 PASS2includingexistinglistdefaults. Explicit asset link payload construction fixes preexisting optional-property typing exposed by this controller import.
- Final selected behavior21391 PASS16/16executed (88filtered),6.14s, /tmp/alga-api-behavior-repairs-final.{json,log}. Includes actualtime-entrypermissiontests; no source assertions. Initial overly-long-comment assertion incorrectly assumed nativeZodmaxmetadata; now verifies the actual custom validation issue path/message without weakening400/VALIDATION_ERROR. API targetedtypes59678 PASS after removing ignored tenantId properties from ApiTestClient configs; browser focused types PASS /tmp/alga-browser-fixture-repairs-types.log. One attempted e2e-tests-local tsc command failed because that package has no compiler/tsconfig; correct existing focusedrootconfig used instead. Planvalidator37features31tests anddiffcheckPASS.
- Native browser run34070160177 TERMINALFAILED. CE101589558859:22passed1failed, Microsoftprofile helper required EE-onlyadvancedtoggle. Saved native context confirms community has Newappregistrationdirectly; fixture now waits for either button and opensdisclosureonlywhenneeded. CE artifacts /tmp/alga-community-browser-af96; log /tmp/alga-ce-browser-af96.log. EE101589558811:21passed2failed, calendarstatus remainedconnectedafterUIedit (knownpendinglegacybus/identityfix4bbc), portalfullcommentrowcomparison raced with scheduled_publish_dispatched_at workerack. Portal snapshot now excludes only two asynchronousdispatchacktimestamps; all other fields, ticketstate and noforeign-authorcomments checks retained. These two browser edits await actualnativeexecution.
- Native EE Microsoftmailbox journey PASS37.7s at01:11:31UTC, proving OAuth→email-service→ticket→UIreply→GraphMIME→duplicatecallbackbehavior on af96. Does notcompleteF034 (calendarandotherrequiredscope remain). Native logs also show CE pendingcommentpublication errors requiring payload.userId; investigate whether pendinglegacybus unification resolves that mismatch; do notassume.
- Full API post-fixture run96694 started against unchangedold9b ownedimage; /tmp/alga-api-fixtures-full.{json,log}. Finish/reconcilebefore committingfinalevidence. No feature/test checklist markedcomplete by focusedpartialresults.

- Final full API96694 TERMINALFAILED61.69s:293passed34failed2explicitapprovalskips,14filesfailed4passed. All25previoussetupskips execute now. Report /tmp/alga-api-fixtures-full.json; remaining assertion names recorded in evidence/api-fixtures-and-native-browser.json. Client/project teardown FK errors remain, plus other API failures; no greenfull-suiteclaim. Microsoftprofile and portal browser fixture types pass; actualnative reruns pending. All local execution/typecheck/download handles are terminal.

### Time-entry date-only response repair — 2026-09-07

- Prior goal turn was progress (34f9af69a9 committed fixture/lookup repairs and native browser evidence). Started with clean worktree and revalidated full integration101585957827/run34070160256 LIVE. Accumulated source/browser repairs remain unpublished while that job executes.
- Built API baseline returned work_date as timestamp despite date-only response schema. Added real migrated PostgreSQL regression for UTC/Pacific-Auckland/America-Los-Angeles Node timezones. Before30043 TERMINALFAILED3cases15.87s; actual read/export/timer results were hydrated Date objects. Fixture uses an owned new internal user, actualservicefixture and ad_hoc entries in disposable time_date_response_82cc; it does not touch browser database.
- TimeEntryService now projects DATE as to_char(...,'YYYY-MM-DD') on five read SELECTs, active-session lookup and timer INSERT RETURNING. This prevents host-timezone Date hydration without recalculating the business date or altering timestamps. Create/update/stop already reload getById/getWithDetails. Expanded test also covers direct search and requires a present date on started sessions. Existing HTTP timezone case now reopens the entry and verifies work_date/work_timezone plus originalstart_time.
- First scripted edit aborted before writing because an unscoped session-query search found two occurrences; an already-launched after command40321 therefore reran unchanged code and failed. Confirmed terminal, scoped edit to getActiveSession and reran. Actual repaired run5615 PASS3/3,15.20s /tmp/alga-api-time-date-after-v2.log. Related units36429 PASS2files5tests; targeted types37919 PASS. All local handles terminal. Evidence: evidence/time-entry-date-response.json. Built HTTP after-proof stillpending; current owned app is old9b.
- Read-only followup diagnosis for remaining API failures: legacy withApiKeyAuth/withAuth in server/src/lib/api/middleware/apiMiddleware.ts call @alga-psa/auth ApiKeyService.validateApiKey without a tenant. That service requires createTenantKnex-derived tenant and returnsnull when absent; API key-only user search therefore401. Existing ApiKeyServiceForApi supports explicit-tenant or any-tenant lookup and gates inactive/client/suspendedowners; consider reusing it in both wrappers with real identity regression, preserving NMstore and client-owner rejection.
- packages/users/src/services/userService.ts still aliases ForbiddenError/ValidationError/NotFoundError to bare Error; ensurePermission also throws plainError. This explains a likely500 instead of403 for another user's password. handleApiError already maps explicitstatusCode/code. Prove and replace stubs with package-appropriate typed errors, without importing server internals into packages. Existing createValidationError helper is one useful precedent.
- Client fixture teardown needs client_billing_profiles deleted after referencinglocations but beforeclients; project fixture teardown still leaks projects withchildren because ProjectService.delete is a bareDELETE (documentedTODO), while packages/projects/src/models/project.ts ProjectModel.delete already handles childcleanup. Investigate actual dependency semantics and test behavior; do not disableconstraints or blindly force-delete product records. These are pendingdiagnoses, notrepairs.

### API request identity and native calendar refresh repair — 2026-09-07

- Revalidated full integration run34070160256/job101585957827: terminal FAILURE,275 files/2023 tests passed,1 file/2 tests failed,4 files/49 tests skipped. Both failures were Microsoft calendar credential refresh assertions. Previous hold on pushing while this exact job was live is now satisfied. Workspace DB and infrastructure jobs succeeded.
- Added real migrated-DB request-identity regression for both legacy auth wrappers, with absent/matching/mismatched tenant header, expiry/revocation, inactive/client owner, tenant suspension and exhausted usage. Dedicated api_key_request_identity_82cc only; browser database untouched. Before70696 FAILED4positive/14negativepassed,15.06s. Replaced ambient-session ApiKeyService with existing REST ApiKeyServiceForApi lookup selected by request tenant header. After19666 PASS18/18,14.70s. User loading and key validation SQL are real; avatar and rate-limit external boundaries substituted. Related unit47289 PASS4files20tests, including NM Store; reset mocks per test to prevent stale validator returns. Targeted types45685 PASS. Evidence: evidence/api-key-request-identity.json. Built HTTP after-proof remains pending.
- Calendar native failure was a real emulator collision: access JWTs contained only common claims and second-precision expiry, so refresh within the same second returned the same token and cross-client grants could overwrite stored ownership. New deterministic fixed-clock regression failed token uniqueness and original-client identity before repair. Added host-seeded jti per grant. Real shared/EE calendar wire suite22569 PASS12/12,1.51s; emulator types44714 PASS. Microsoft emulator suite97645 PASS5files54tests,1.09s.
- First broad emulator run3590 had9call-record failures/45passed. Exact failed suite passed in isolation and full unchanged rerun passed54. Initial control port59500 overlapped existing IPv4 SSH listener (lsof confirmed PID44342); app.listen without an explicit family versus fixture IPv4 URLs is suspected local routing cause. Recorded the failure rather than treating a retry as first-attempt green. Evidence: evidence/msgraph-token-identity.json. Native after-results remain pending. All local test handles terminal.

### User/client API behavior and support authority fixture — 2026-09-07

- Previous goal turn was progress: committed/pushed3464c562ee and started native workflows. Current turn began clean on that exact published head. Revalidated integration34074426143/job101597733451: still LIVE. WorkspaceDB101597733466, all infrastructure shards and aggregate101599303067 are SUCCESS. Fresh-install34074426154 remains live before production-browser jobs. Hold further push until the full integration handle is terminal.
- UserService bare Error aliases and plain permission denial produced500 for password errors. New dedicated user_password_errors_82cc real-DB test2085 reproduced5failed/1positivepassed,15.02s. Typed400/403/404 package errors repair contract without server dependency; after23156 PASS6/6,15.42s. Real RBAC, PBKDF2 verification and unchanged/replacement stored hashes are exercised. Existing2FA validation now uses the same typedValidationError. Added real HTTP owner-key password changes instead of the old test that only asserted failure while claiming success. Explicit internal user type prevents random client-key rejection. Rejected HTTP paths await rebuilt app.
- Client inactive/reactivation tests never reached behavior because their user payloads omitted required fields; use createUserTestData with explicit contact/client values. All3client-state scenarios now pass against owned old9b build; own-password case also passes. Common cleanup now deletes tenant-owned billing profiles after locations, fixing teardownFK failures. Final81713 PASS4/4executed,44filtered; /tmp/alga-client-user-fixture-repairs-final.{json,log}. First combined32627 had4passed/1client-deletefailed, diagnosing retainedprofile; isolated77323 reproduced400 withactualFKdetail. No browser DB recreation.
- ClientService API deletion omitted profiles already cleaned by UI clientActions. Extended realDB currency lifecycle suite with successfuldelete, unchangedneighbor and contact-blocked preservation. Dedicated client_profile_delete_82cc before83541 FAILED1/5passed,18.67s (profileFK); after adding profilecleanup afterlocations69648 PASS6/6,18.48s. Actual repaired-client-delete HTTP after-proof pending newimage.
- Node tooling34074426026 completedFAILURE:238pass1fail, support-session startup cleanup rejected fake central authority. Fixture readDate twice, occasionally extendingexpiry beyond exactmaximum. Deriveexpiry fromsingleactivationtimestamp and share injectedmanagerclock; productionvalidationunchanged. Nativebeforeevidence + localNodePASS16/16 preserved in evidence/support-session-clock-fixture.json. Earlier commentary misstated27tests and was corrected to16.
- Related unit35835 PASS2files14tests. Focusedtyping first exposed lowercaseUserService import on Mac (actualgitpathuppercase), stale ApiTestClient constructors/ignoredtenantId, then EEstrictNullChecks mismatch for server sources. Finalconfig mirrorsserver strictNullChecks=true; fixedunusedarrays andduplicatebaseUrl default that was overwritten. PrivatePaymentService finder annotation now matches actualKnex undefined (runtimeunchanged). Final36496 typesPASS, diffcheckPASS. Evidence: evidence/user-client-api-repairs.json. All local testhandles terminal; nativeheadunchanged untilfullintegrationfinishes.

### Project API lifecycle and full server-colocated lane — 2026-09-07

- Previous goal turn made progress: local checkpoint178230dc45, password/client fixes andsupportclockfixture. Current turn started clean/ahead1; publishedhead3464 unchanged. Fullintegration34074426143/job101597733451 still live at last observation. Freshinstall34074426154 built all images successfully; CEbrowser101601381552 and EEbrowser101601381575 now live. Preserve these runs before anotherpush.
- APIcreateProject never called its unused status-initialization helper, producing no mappings. Added realDB lifecycle cases for custom and standardstatuses. Firstfixture64834 incorrectly insertedtenant into now-globalstandard_statuses; corrected to read seededglobalreference data, no cleanup ofglobalrows. Actualbefore16052 FAILED2mappings/3passed,15.43s. Create nowinitializes mappings in its enclosingtransaction usingProjectModel methods, customstatuspreference andstandardfallback matchingUI. No separateconnection that would miss/uncommittedparent.
- Extended cases reached realtaskcreation aftermappingrepair, thenreproduced bareprojectDELETEforeignkeyfailure onphases:58096 FAILED2/3passed,15.89s. APIdelete nowchecks tenant-scopedexistence, routes throughdeleteEntityWithValidation, cleans ownedmetadata anddelegates toProjectModel.delete. Shared projectdependencyconfig nowcounts tasktime_entries alongside schedule_entries via commonqueryhelper. Contact/material/link safeguardsremain; neighboringproject andmappingspreserved; trackedworkreturns409 andwrongtenant404 withgraphunchanged.
- Added transactionfailure test injecting onlymappingwritefailure; actualprojectinsert andnumbering mustrollback. Firstexpandedrun90711 had6pass/1fixtureassertionfailure because pg last_number isstring0; numericcomparisoncorrected. Final81621 PASS7/7,17.01s in dedicatedproject_task_mapping_82cc, /tmp/alga-project-lifecycle-final-v2.log. No browserDBrecreation. Added strictHTTPproject-phase-task-reopen-deletejourney and surfacedteardown failures; rebuiltHTTPexecutionpending.
- NativeAdditionalworkspace34074425999 failedlegacyEventBus hardtimeouttest: clientwasdisconnected butsecondclientnotcreatedbyfake-timernexttick. After sharedbusconsolidation it mockedobsolete ../utils/getSecret, allowing realfilesystemlookup to racefaketimers. Mocknowtargetsactual@alga-psa/core/secrets; timeouts/assertionsunchanged. Targeted12673 PASS1/1. Fullscript95517 terminalSUCCESS:76/76files and381/381tests, no skips/todos/failures, discovery unmatched0. Evidence explicitlyworkingTreeDirty=true on178230dc45 (localrepairs), notnativeproof. Rawtest-results/server-colocated/{evidence,discovery,results}.json and /tmp/alga-server-colocated-after-legacy-mock.log.
- Shareddeletionunit3files47PASS. Finaltype76123 PASSforpriorconfiguration; newprojectHTTPfixture revealedoutdatedFaker precision option, replacedwithfractionDigits:2; servicefactory nowrequiresresolvedtypeid. FinalfocusedtypecheckaftertheseeditsPASS /tmp/alga-project-lifecycle-types-final.log; diffcheckPASS. Alllocalhandles terminal. Evidence: evidence/project-api-lifecycle-and-legacy-bus.json. Nativeafterproof andfullplanstillpending; do not togglecompletionitems merelyforlocalpatches.

### API environment ownership and native browser acceptance — 2026-09-07

- Previous conversational turn made no implementation progress. Revalidated native full integration run34074426143/job101597733451 as live; retain hold on push. Fresh-install run34074426154 is now terminal SUCCESS: community22 passed (5.4m), enterprise24 passed (7.4m), aggregate101603863787 success. This is published3464 evidence, not acceptance for later local commits. See evidence/native-browser-3464.json.
- API CI assignment encounters the real fresh-install default database name `server`. Preserve production-name restrictions; add explicit UUIDv4 identity and loopback prerequisite for that default name. Async connection verifies a pre-provisioned public ownership marker tied to current_database before fixture setup. A supplied ID is verified even on a dedicated database name; missing/wrong markers fail closed and destroy the connection. Production/postgres/template names remain forbidden.
- Real PostgreSQL regression in disposable api_environment_attestation_82cc checks absent table (including no self-provisioning), empty marker, stale identity, wrong database and matching-marker fixture writes. Session54830 terminal PASS:2files4tests,13.22s; /tmp/alga-api-ownership.log. API fixture setup now awaits verification. CI marker provisioning, runner discovery/execution assignment and rebuilt API acceptance remain next work; no checklist completion claimed.

### Assign API execution to fresh-install CI — 2026-09-07

- Previous goal turn made progress via ac0b3cf9c0. Revalidated full integration34074426143/job101597733451 as LIVE twice this turn; keep push held.
- Added api-e2e to the shared runner and independent file inventory. Fresh-install CE/EE jobs install root dependencies, attest owned compose PostgreSQL identity, execute API suite against the same built app/database, and upload collection/results/discovery/evidence/progress and child-server diagnostics. API steps still run after a browser failure when setup succeeded. Timeout increased45->60 minutes for added install/execution. All skipped assertions remain gate failures. Xero dev access-log test is included, with its distinct dev-server subject explicitly documented.
- Exact ownership-provisioning workflow shell executed successfully against fresh temporary postgres in owned colima context, project alga-e2e-test. Verified marker true/current_database/non-null identity; removed container/network afterwards. No exposed ports, persistent volumes, provider secrets, or browserDB reset. YAML parse and all workflow Bash syntax checks pass.
- Actual full runner62408 terminal failed on old9b application image:19files,332collected cases before skip removal,334report assertions,297passed35failed2skipped, discovery unmatched0. This captures real baseline failures rather than bypassing strict reconciliation. Raw test-results/api-e2e and /tmp/alga-api-assigned-baseline.log. Shared runner contracts68005 PASS15/15,40.55s, including omitted files/skips/failures/empty collections.
- Enabled2approval cases, initially both403 due missing time_entry/approve fixture permission. Added approval-only permission setup and persisted APPROVED assertions. After75142 PASS2/2 executed with39filtered,1.65s against actual app; removed explicit skips. Fixed strict TypeScript empty-array inference in time-entry and sharedticket fixtures; focused3115 PASS.
- Xero realdev regression initially500. Captured child logs exposed missing synthetic NEXTAUTH_SECRET and absent marketing sourcealias, then opportunities sourcealias. Added both packages to Next Webpack/Turbopack alias maps consistent with neighboring packages, explicit source mode/testsecret. Final59413 PASS1/1,23.45s. Devserver diagnostics now retained under test-results/api-e2e/diagnostics for CI artifacts. Production/Turbopack build acceptance remains pending.
- Final actual collection83071 PASS334cases in19files. All local handles terminal, plan validator37features31tests valid, diffcheck pass. Evidence: evidence/api-ci-assignment.json. No overall checklist completion claim: native assigned API acceptance and broad original requirements remain.

### Accounting API identity and native full-integration acceptance — 2026-09-07

- Previous turn was progress via92a23f15e2. Native full integration34074426143/job101597733451 is now terminalSUCCESS:279files/2048tests passed,4files/49tests skipped,3739.97s. Earlier live polls were valid; push hold lifted only after terminal proof. This covers published3464, not newer local changes. Raw /tmp/alga-full-integration-3464.log; skips remain explicit plan gaps.
- AccountingHTTP baseline403 was missing exports_execute capability. Shared grantTestUserPermission now grants explicit tenant-scoped capabilities, reused for approval-only fixture setup. Aftergrant64951 FAILED3at500; diagnostic40235 and ownedapp logs identify AuthenticationError User not authenticated. Accountingcontroller calls withAuth serveractions under onlytenantcontext. All10operations nowreuse existingrunWithApiKeyContext. Concurrent actualALS regression33266 before1pass1fail,73158 after2pass; checks per-calleridentity/tenant andcontextcleanup.
- Accounting fixture review found empty batches without matchinginvoices and append ofsameinvoicealreadyselectedbybatch. Extracted matchinginvoice/service/charge/transaction fixture, seededJan/Febmatchingdates, appenddifferentinvoice, cleanupbatchlinesbeforeinvoiceparents. Errors asserted byincludedcode instead ofordering. UpdatedHTTPacceptance remains pending.
- Contactcreate mismatch was formattedinput versus canonicalphoneFieldSchema output; preserve formattedinput and assert+15551234567 bothdefault/row. Actual6378 contactPASS (accountingfailed independently). Sharedpermissionhelper approval20231 PASS2executed39filtered1.53s.
- Temporary sourceHTTPattempts: server62124 diedonCommonJSrequire in ESMtailwindconfig; changedpluginimports tostaticESM. ActualNode25configload andPostCSS typography/container-query CSSgenerationPASS. Server98227 then diedV8ZoneAllocationOOM withincorrectRedispassword; correctedownedRedisnoauth, restarted onlyafterterminalproof91752 with8192MBheap, butcompilationagainOOM. HTTP61979 terminalfailure ECONNREFUSED; do notclaimsourceHTTPafterpass. Alltemporaryserversstopped; originalbuiltapp preserved. Focusedfinaltypes71731 PASS; diffcheckPASS. Evidence: evidence/accounting-api-identity.json. Nextpublishqueuedcommits andvalidatenativebuiltAPIlane.

### Real redaction behavior and enforced Temporal readiness — 2026-09-07

- Previous turn made progress by publishingdf9b928156 to same-repository PR3343. Initial pushauto-review incorrectly classifiedrepo asprivate/untrusted; read-onlyremote/PR/account checks provedpublicrepo, samehead, authorRobertAtNineMinds andADMINpermission. Reviewedretry succeeded; no workaround or userpermissionneeded. Current nativeintegration34078331083 andfreshinstall34078331062 verifiedLIVE. Hold furtherpush to preserve fullintegrationexecution.
- Audited49previousintegration skips:29legacyemail,5legacyredaction/snapshots,12productionfixturebilling,2SMTPsmoke,1projectcompletionsurvey. Legacy5suite explains removedinterpreter; unskipping alone cannotvalidateTemporal. ActiveTemporalactivitytest also mockedredactionwithitsown implementation. Replaced that mock with realsharedredaction functions; actualactivity82458 PASS7/7.
- Added3behavioral utilitytests: nestedreferenceformats, resolvedsecretpointerimmutability includingescapedkeys/arrays/sharedaliases, exactUTF8snapshotbyteboundary andvalidtruncationJSON. Before2fail1pass:maskResolvedSecrets mutatedlive nestedinput andsnapshotlimitscountedUTF16characters. Copyeachmodifiedancestor; useTextEncoderbyteLength. Relatedworkflow24235 PASS2files40tests,2.30s. FocusedtypesPASS /tmp/alga-redaction-types.log.
- FastTemporalreadiness nowdedicatedconfig/sharedrunner; inventoryconfigtests pluscurrentgenericjob/activitychecks, excludesunassignedruntime-dependentrestwithoutclaimingglobalcompletion. Rootscriptusesrunner, workflowNode22,strictnpmci,sharedworkflow/runnertriggerpaths,executionartifacts. Actual69167 PASS3files13tests,no skips/todos/missing,1.30s; runnercontract77116 PASSomissions/skips/failure/emptychecks,4.34s. Localworkingtree evidenceondf9b source, nativeafterpending.
- Important remaininglegacyport work: currentTemporalactionpersistencewritesrawinput/output andusespersistedoutputforidempotentreplay. Do not blindlyredactoutputandbreakreplay. Snapshotgeneration/retention/run-studioreferencesstillneedrealcurrent-runtimebehavioralcoverage. Utility/activitychecks arenotareplacementclaimforthe5skippedDBcases. Evidence: evidence/temporal-real-redaction.json. Alllocalhandles terminal.

### Reconcile full/Tier-1 integration execution — 2026-09-07

- Previous turn progressed via903e3d7d84. Publisheddf9b CI has no observed failures; integration34078331083 andfreshinstall34078331062 revalidatedLIVE. Latestfreshinstall6supportimagesPASS; CE101608799940 andEE101608799948 stillbuilding. Preserve these runs before anotherpush.
- Full/Tier-1 runner previouslyvalidatedmanifestcollection thenreturnedVitestexitcode, allowing49skipsinagreensuite. It nowcollectsselectedfile/testidentities, independentlyreconcilesrepositoryselection, validatesrawexecution, recordsrevision/selection/evidence, andrejectsskips/pending/todos/missingreports/missingtests. LegacyreportdestinationpreservedforGooglemetrics. Workflowuploadsnewtest-results/integration evidence. Clearstaleartifactsbeforeevenmanifestvalidation; earlyinvalidfloorcannotleavepreviousgreenmetadata.
- ExtendedrealVitesttemporaryGitcontracts preservefloor/affected/fullfallbackbehavior and testpassing+skippedrequiredfile, zeroexitwithoutreport, exactpassedcounts, staleevidenceonmovedmanifest. First43988PASS33s; expanded33355PASS4tests34.32s; final49437PASS4/4,no skips34.69s. No realDBdestructionorfullsuite rerunneededforrunnercontrolbehavior. Syntax/YAML/diffchecksPASS.
- Downloadedprior34074426143 server-integration-execution artifact to/tmp/alga-integration-3464-artifact. Replayedreportclassificationusingreport-derivedfileidentities (NOTindependentcollectionproof): originalsuccess=true, newgatefailed,2048passed49skipped and4fileswithzeroexecutedassertions,53diagnostics. Completeexplicitcaseinventory:evidence/integration-skipped-assertions-3464.json. Newstrictgatewillremainreduntilskipsarefixedorvalidownedtemporaryexclusionsareimplemented; no blanketwaiverorcompletionclaim. Evidence:evidence/integration-execution-reconciliation.json. Alllocalhandles terminal.

### Replace manual SMTP skips with repeatable transport tests — 2026-09-07

- Previous turn progressed via9689d3abb4. PublishedCIintegration34078331083 andfreshinstall34078331062 remainLIVE; no observedfailure. Preserve nativefullrun beforepush.
- Replaced COMMENT_ATTACHMENT_SMOKE_FIXTURE runIf dependency onmanuallypreparedUIrecords, .env.local override andforcedDB5472. Twoalways-runningcases nowcreateisolatedmigratedDBfixtures, persistSMTPsettings, useactualTenantEmailService/SMTPEmailProvider/GreenMail, parse receivedMIME, compareexactPDFbytes, assertonepublishedattachment/unrelateddraftexclusion, durablesentrow andreplaydeduplication. Subscriberentryrunswithoutambienttenantcontext. Storagebytes andDBconnectionrouting arefixtureadapters; noemailprovider/sender/subscriber mock. SecretfixtureonlyprovidesNEXTAUTHsigningsecret.
- AddedGreenMail2.1.8 service tothefull/Tier1integrationjob with33025SMTP/38080API, explicit COMMENT_SMTP_ISOLATED flag andports. No workstationconfig fallback. Localownedcontaineralga-regression-comment-smtp oninternalnetwork initiallydidnotpublishports (49839failedECONNREFUSED); connectedthisdedicatedsink tobridge (publishedportsremainloopbackonly). Second80916failedonGreenMail400missingmailboxresponse; nowmatchtheexactUsernotfoundpayload instead ofacceptinggeneric404.
- Final60798PASS2/2,no skips,16.91s in dedicatedcomment_smtp_repeatable_82cc. ExactMIMEproviderreceipt andpersistedledgerassertionspass. Focusedtypes72398PASS, YAML/diffchecksPASS. GreenMailstop20971terminalsuccess; existingbrowserDB/stackpreserved. Nativeacceptancepending; thisresolves2ofhistorical49skippedassertions, other47remain. UIuploadinteractioncoverage isseparate, notclaimedbyDBfixtures. Evidence:evidence/repeatable-comment-smtp.json. Alllocalhandles terminal.

### Project permission/filter assertions and native workflow deletion failure — 2026-09-07

- Previous goal turn answered a framework question but made no implementation progress. Revalidated native published df9b CI: Node, TypeScript, Additional workspace and EE workflows build passed. Full integration job 101608767833 remains live; fresh-install CE 101612274739 and EE 101612274786 reached Playwright execution. Preserve these runs before pushing.
- Found false-green project API assertions: create-permission test accepted either 201 or 403, read-permission test only exercised an authorized user, fixture POST failures were ignored, status test filtered the response before asserting, pagination allowed zero rows, and a purported project-type filter test merely listed projects (no supported schema field). Replaced with real grant removal/restoration and 403/no-mutation checks, successful fixture requirements, populated pagination, all-row status checks, and name/client matching plus empty-result behavior. Project-type coverage is not claimed.
- Local actual HTTP permission-only session 77617 passed 2 cases; expanded final 97368 passed all 7 targeted cases in 8.39s, with 17 explicitly filtered out. Existing local application image, synthetic isolated tenant fixtures, no browser DB recreation. Log: /tmp/alga-project-api-behavior-contract.log.
- Native workspace database job 101608768068 failed 1 of 425 cases: project workflow deletion T018 expected VALIDATION_FAILED, while the shared tracked-time deletion guard now returns DEPENDENCIES_EXIST. Direct completed-job log obtained through the GitHub jobs/logs API while sibling jobs remain live. Updated the expected structured contract and added persisted project/phase/task/time-entry preservation assertions.
- First local database run 82050 exposed the dependency type spelling (time_entry, not table name time_entries); corrected against the actual shared deletion configuration. Final 49920 passed all 22 project workflow action cases, no skips, 30.23s in dedicated workflow_project_deletion_82cc (worker suffix managed by harness). Log: /tmp/alga-workflow-project-deletion-final.log. Focused types for both modified files passed (97765); diff check passed. All local handles terminal. Evidence: evidence/project-behavior-contracts.json. Native acceptance and the rest of the plan remain pending; no completion flags changed.

### Remove API false greens and repair native database attestation — 2026-09-07

- Previous turn progressed via 4a2a0b2d75. Revalidated native full integration 101608767833 live; known workspace deletion failure is repaired locally. Do not push while the full run is live.
- Replaced client permission test accepting 201/403/500 with explicit allow/deny/restoration and persisted no-mutation checks. Extracted the project grant-revocation fixture into withoutTestUserPermission and exercised it for both resources. Permission list no longer returns green on 500; requires a populated page. Empty permission update case now executes HTTP update/reopen, verifies PostgreSQL state and stable role assignment. Foreign-tenant permission GET/PUT/DELETE return 404 and leave the row unchanged; resource/action filters now reject empty or unfiltered responses.
- HTTP session 95370 passed 19 cases across three files (43 explicitly filtered out), 7.39s. Expanded final permission suite 93223 passed 15/15 without skips, 2.91s. Existing isolated local built application and synthetic tenant fixtures, no browser DB reset. Type check exposed two pre-existing unsupported tenantId client options; removed those ignored options. Final types 88267 passed for all four changed TypeScript files. Logs and scope limits in evidence/api-permission-outcomes-and-attestation.json.
- Native CE browser job 101612274739 completed: 22 browser cases passed in 4.7m, but API ownership attestation failed because psql socket authentication required the workflow's synthetic password. API cases did not execute; subsequent no-files artifact failure does not indicate API results. Raw log /tmp/alga-browser-ce-df9b.log. EE sibling was still running at observation.
- Fixed attestation with docker exec -e PGPASSWORD=placeholder-password and psql --no-password. Reproduced using a temporary network_mode:none pgvector16 container, tmpfs data and --auth-local=scram-sha-256 (earlier trust-auth fixture had missed this). No-password connection failed with exit 2; exact extracted corrected workflow step succeeded, and persisted marker UUID matched GITHUB_ENV with database_name=server. Temporary fixture removed successfully. Local extraction initially found no system PyYAML, then used exact indented workflow block extraction; no fixture existed on that failed attempt. Native acceptance pending; no completion flags changed.

### Native browser flakes and stable Microsoft subscription identity — 2026-09-07

- Previous turn progressed via fe023f0fcf. Full integration job 101608767833 revalidated live; no push. Native enterprise browser job 101612274786 completed with 22 passed and 2 flaky cases (strict gate red): calendar vendor correction timed out first attempt, and administrator user-action Edit menu never opened first attempt. Both passed on retry. Same already-fixed API attestation failure followed. Downloaded native log /tmp/alga-browser-ee-df9b.log and traces /tmp/alga-ee-browser-df9b-artifacts.
- Calendar diagnostics show every manual sync creates a new Microsoft subscription; failing history ends at a new POST after successful event retry, without a subsequent delta fetch for vendor correction. Code resolves webhook provider by only its currently persisted subscription ID. Replacement can strand in-flight notifications for the prior ID. This is a concrete lifecycle defect and plausible cause of this native failure; rebuilt acceptance remains required.
- EE manual sync now renews an existing Microsoft webhookSubscriptionId, registers only when absent, and surfaces renewal failures without replacing the subscription. Added action regressions: before 81568 failed 2/passed 4; after 56104 passed all 6, 0.839s. Adapter/DB/sync-service boundaries are mocked in this unit scope. Browser spec additionally checks stable persisted subscription ID and exactly one successful vendor-update delivery; no browser-after-pass claim.
- Focused types found pre-existing mock Knex .raw property typing; attached through Object.assign. Final types 13820 passed; browser types 40791 passed. User-menu trace shows the menu remained closed; root cause remains open and was not hidden with retries. Evidence: evidence/calendar-subscription-preservation.json. Full plan completion remains unproven.

### Preserve table dropdown state across asynchronous refreshes — 2026-09-07

- Previous turn progressed via 5f2566f966. Revalidated native full integration job 101608767833 live; preserve before push. Investigated the enterprise user-menu failure trace: user-actions trigger was found, enabled/stable and clicked, but Edit never appeared; no test retry/delay workaround added.
- Found DataTable creates new cell function component types whenever columns/layout change, then mounts those through flexRender. UserList rebuilds column callbacks when asynchronous avatar state arrives, resetting child dropdown state. Added a behavioral regression using actual Radix DropdownMenu: open it, refresh copied data and fresh columns, then select Edit without reopening and require the refreshed callback (not stale one).
- Before session 84728 failed at missing menu item after rerender. DataTable now directly invokes its public column render callback as a node factory under the same keyed cell, preserving child component identity. Focused 2 files/6 tests passed; complete UI package session 18295 passed 79 files/416 tests, no skips, 5.69s. Focused strictNullChecks types session 8303 passed. Logs: /tmp/alga-table-menu-before.log, /tmp/alga-table-menu-after.log, /tmp/alga-ui-table-continuity-full.log, /tmp/alga-table-continuity-types.log.
- This proves the component reset defect locally and is consistent with the native trace; rebuilt native browser acceptance remains pending. No goal completion flags changed. Evidence: evidence/table-interaction-continuity.json. All local handles terminal.

### Require user API fixture and authorization outcomes — 2026-09-07

- Previous turn progressed via 055e1b19c8. Full integration job 101608767833 revalidated live, including after local verification; continue preserving it before push.
- Replaced user permission test accepting 201/403 with explicit grant removal/restoration, 403 denial, users/user_roles preservation, allowed create and reopened persisted identity. Removed ignored fixture-create errors in search/pagination/roles/filtering. Invalid contractor user-type counterexample is now supported client. Pagination and filters require actual populated results; search requires exact IDs for the unique fixture timestamp.
- Initial permission selection 4518 passed 4 (21 filtered); expanded 28397 passed 7/failed 1 (17 filtered), 6.81s. Failure is user search HTTP401. Final diagnostic 81807 confirms UNAUTHORIZED Invalid API key; required 200 and exact-result assertions retained. Local app image reverified as sha256:2d3f0db9b006857afd4b5977a39e39e5c9bf29ec703201cf7d9d12a1abe4e88d, predating current shared API-key middleware repairs. This does not prove the current source passes search; rebuilt native API execution remains necessary. No assertion was weakened to accept the old-image failure.
- Focused strictNullChecks tsc passed, including final search assertion. Evidence: evidence/user-api-required-outcomes.json. Existing browser DB preserved, isolated synthetic fixture tenants used; all local handles terminal. Full goal remains active and unproven.

### Repair native deletion query fixture failures — 2026-09-07

- Previous turn progressed via 0d27696dba. Revalidated integration job 101608767833 live (started 03:04:06Z), preserve before push. Unit run 34078331080 completed failed: Nx core lane and server coverage both hit project deletion mock-builder missing select(). Server coverage reported 14,509 passed, 3 failed, 2 skipped and 15 todo; skipped/todo completeness is still unresolved.
- Added chainable select() to existing deletionMigrations.test.ts transaction builder, retaining all assertions and production behavior. Existing real DB project action tests already prove tracked-time deletion prevention and data preservation (project-behavior-contracts.json).
- First restricted core suite 56745 repaired deletion tests but failed six unrelated filesystem-provider subprocess cases with missing result files. Escalated run 97332 passed all 29 files/271 tests, six platform-dependent macOS skips, 2.92s. Server Vitest 3 targeted run passed all 27 deletion tests without skips. Logs and limits: evidence/native-unit-deletion-fixture.json. No source-string tests added, no completion flags changed. All local handles terminal; next native run pending.

### Live merge enforcement and release entry-point refresh — 2026-09-07

- Previous turn progressed via 48360961af. Full integration job 101608767833 remains live; no push. Read effective rules endpoint, classic protection and both active ruleset definitions. Only required contexts are Run ext-v2 guard and ESLint and Check for new circular dependencies (GitHub app 15368). No mandatory unit/integration/browser/discovery gate yet. Classic checks have strict=true but empty checks; rulesets have strict=false. Freshness behavior is not inferred as proven from these mixed settings.
- Release bot integration 2787854 has always-bypass in both active rulesets and PR-review bypass; classic enforce_admins=false. One approving review required, no code-owner reviews, stale-review dismissal or last-push approval. No tracked/unignored CODEOWNERS found. Read-only audit; no protection changes or external assignments made.
- Inspected appliance Flux apply helper, worker tag-based deployment helper and mobile EAS distribution workflow. These are concrete checkout entry points, not proof of production SaaS deployment. Requested actual production pipeline link and previous supported release tag asynchronously; this information is required before dependent release/upgrade wiring, not a blocker to independent testing work.
- Recorded latest known failure classifications and local repair commits in evidence/live-enforcement-and-release-inventory.json, with live API source data minimized to relevant policy fields. PR author RobertAtNineMinds verified; named domain/release owners remain unconfirmed. F001/F008/F020/F021 not marked complete. Documentation-only audit requires no application test rerun.

### Native full integration completion and mention fixture repair — 2026-09-07
- Run 34078331083, job 101608767833 is terminal failure (completed 04:13:49 UTC), so the push hold is released. Full suite: 280 files passed, one suite failed collection, four files skipped; 2,059 tests passed and 51 skipped. Raw log: `/tmp/alga-full-integration-df9b.log`. These results supersede the prior live observation, not the historical 3464 baseline.
- Failure: `mentionNotifications.integration.test.ts` logger factory referenced a non-hoisted variable during core secret-provider import. Changed only logger fixture initialization to `vi.hoisted`; preserved both behavioral notification assertions.
- Local server Vitest 3.2.7: both mention tests passed, zero skipped, 3.08 seconds (`/tmp/alga-mention-fixture-final.log`). This uses existing mocked boundaries and does not prove live notification delivery. Native replay remains required.
- Inspected all twelve invoice-ticket opt-in cases: hardcoded local database routing, existing user/service/ticket dependencies, UI-authored templates, prior generated JSON, PDF tooling, and an alga-dev browser pane prevent simply enabling flags in CI. They require isolated fixture and browser journey ports; no flags/exclusions/assertions were weakened.

### Candidate 2de93 CI activation and defect ledger — 2026-09-07
- GitHub Actions creation lagged the push; repeated read-only checks ultimately verified PR-triggered runs at exact head 2de93c8492c6d7bac3792ecf2d5be94247606bc4. No duplicate dispatch was needed. Integration run 34082555507/full job 101620543698, browser run 34082555492, unit run 34082555455 are live. Hold further pushes while the full job runs.
- Classified the df9b raw report: 51 skipped consists of 49 opt-in assertions and two mention cases prevented by module-load failure. SMTP and mention repairs are on the new candidate; 47 opt-in assertions remain. Evidence: integration-native-df9b.json.
- Added calendar subscription and table interaction defects to the existing regression ledger, linking permanent tests, exact fixes, native discovery and local intended-assertion failures/passing repairs. Native after-fix verification remains pending; neither record is counted as a confirmed production escape. F029 remains incomplete.

### Prevent a failed suite lifecycle from publishing 100% — 2026-09-07
- Found a concrete metrics failure from the df9b native report: 2059 passed, zero failed assertions, and a failed mention suite could still be classified complete with 100%. Added failed-suite-without-failed-assertion detection, preserving raw counts and existing Sheet columns while emitting partial/blank percentage.
- Four behavioral report cases cover failed bootstrap, failed teardown, ordinary assertion failure and full success. Before: two intended failures/two passes. After: four passes, zero skips. Actual downloaded df9b report now yields partial and blank passPct. Evidence: metrics-suite-lifecycle.json. New Node test is under the existing scripts/tests discovery root.
- Documented legacy completeness limitations. F024/F025 remain false; this repair does not substitute for versioned required-set readiness, missing/cancelled run records, or live workbook changes. No push while native full job 101620543698 runs.

### Preserve missing report visibility — 2026-09-07
- Removed the metrics recorder early success exit for absent results/coverage. Explicit missing or malformed result files now produce a partial row with blank counts and percentage, even if coverage exists. Coverage-only callers without TEST_METRICS_RESULTS preserve their prior blank execution status.
- Added subprocess behavioral tests of the actual buildRow invocation in an isolated empty directory. Before: four passed/two failed. Final: seven passed/zero skipped in 143 ms. Existing legacy headers remain unchanged. Evidence appended to metrics-suite-lifecycle.json.
- This requires the metrics step to execute; cancelled-before-recorder reconciliation and versioned readiness schema remain open. F024/F025 remain incomplete.

### Append-only metrics header migration — 2026-09-07
- Existing Sheet header check read only A1, preventing older tabs from gaining appended managed headings and permitting values under reordered columns. Updated it to validate the complete managed prefix and write only missing suffix cells; matching user-added trailing columns remain intact.
- Before behavior: two intended failures/one pass. Final: five schema boundary cases and seven lifecycle cases pass (12 total, zero skips), covering legacy prefix, mismatched order, custom suffix, empty tab and AA expansion. No live Sheet writes performed. Evidence: metrics-header-migration.json. F024/F025 remain incomplete.

### Versioned metrics rows and event classification — 2026-09-07
- Appended schema_version=2, run_kind, event_name and coverage_methodology to summary and directory rows, preserving all existing positions. GitHub event context distinguishes PR/main/branch/nightly/manual/local/other without inferring readiness. Historical rows remain unversioned.
- Documented source-inventory-v1 restricted denominator (server/src, shared, packages/*/src), explicitly excluding whole-repository claims. This metadata does not silently expand coverage scope or enable currently disabled PR reporting.
- Before: seven pass/two intended failures. After: 14 combined lifecycle/schema cases pass, zero skips; subprocess cases exercise actual row generation. Evidence: metrics-versioned-rows.json. F024/F025 remain false pending remaining fields, comprehensive inventory, live workbook and cancellation reconciliation.

### Bind integration metrics to execution evidence — 2026-09-07
- Strict integration execution could reject skips/missing identities while the raw Vitest report still appeared green to the recorder. Added TEST_METRICS_EXECUTION to Tier-1/full recording and fail-closed diagnostic downgrading for missing, unsupported, failed or stale-revision evidence. Passing evidence does not override raw lifecycle checks.
- Behavioral failure reproduced before repair; final 16 metrics cases pass with zero skips, including a real subprocess loading an absent configured evidence file. Integration workflow actionlint passes. Evidence: metrics-execution-binding.json. These checks do not substitute for independent gate verification.

### Full Node tooling verification with accumulated metrics repairs — 2026-09-07
- Initial run session 52282 terminated failure due to sandbox EPERM on loopback servers and an owned generated Next debug directory being scanned by Graph endpoint guard. Preserved that directory at /tmp/alga-accounting-api-dev-82cc-preserved, outside source discovery.
- Escalated rerun session 21793 completed successfully: 37 required files, 456 passed assertions, zero failed/skipped/todo/cancelled, 117.45 seconds. Discovery and execution reconciliation passed, before/after revision 8e61f221a7 both clean. Existing one manual localization baseline exclusion remains visible. Evidence: node-tooling-metrics-full.json.
- Native candidate remains 2de93c8492; these newer metrics commits are not yet natively verified. Calendar browser source audit reconfirms outbound UI create/delete coverage is still missing; current test covers vendor create/delete and UI edit only.

### Microsoft calendar outbound browser expansion — 2026-09-07
- Extended the existing isolated Microsoft OAuth journey with UI create/delete, persisted mapping and schedule checks, vendor state readback, reload checks and successful POST/DELETE request evidence. No server-action interception or auth bypass added.
- Focused TypeScript check passed. Collection passed using the e2e-tests-local Playwright binary (the root binary initially produced a duplicate Playwright instance error). The expanded browser journey has NOT executed; native candidate 2de93 predates it. Evidence: calendar-outbound-browser-expansion.json. F034 stays incomplete.

### Credit expiration native bootstrap timeout — 2026-09-07
- Native infrastructure shard 2 job 101620543726 failed: 146 passed, four credit-expiration cases skipped because beforeAll exceeded 60000ms. Direct job logs are available through gh api actions/jobs/<id>/logs even while sibling full integration continues (gh run view refused until overall completion). Log showed the full migration/dev-seed bootstrap reaching final seeds at the deadline.
- Increased only the full database startup hook to 120000ms; per-test limits and all assertions unchanged. Local real-DB run session 22771 passed all four cases, zero skipped, 18.02 seconds, using isolated credit_expiration_effects_82cc. Evidence: credit-expiration-startup-budget.json. Native rerun still required.
- Browser builds are all successful; live production browser jobs: community 101624201400, enterprise 101624201410, run 34082555492. Full integration 101620543698 remains live; hold pushes.

### Versioned execution counts and lane status — 2026-09-07
- Appended expected_files, collected_tests, execution_gate_status and tested_sha to metrics rows (Y:AB), preserving existing fields and directory schema. Values come from current-revision lane evidence; unknown counts stay blank. Job summaries now lead with lane gate/counts.
- Passing evidence without declared collection is incomplete and suppresses percentage. Existing raw lifecycle checks still apply. Final 18 metrics behavioral cases pass, zero skips; evidence: metrics-execution-counts.json. This reports producer claims, not independent global readiness. Remaining browser metadata, workbook and cancellation requirements keep F024/F025 false.

### Browser journey metrics projection — 2026-09-07
- Added versioned metrics.json to the existing browser runner diagnostics, derived from raw collection/report and lane evidence. Preserves file/project/title identity, required/missing status, first attempt, retries, attempt statuses, edition and lane outcome. Omits raw errors/attachments; immutable artifactManifest remains explicitly null.
- Ten projection/reconciliation tests passed, including a subprocess of the actual browser runner that cannot start and must still emit incomplete metrics. Historical native df9b enterprise report replay correctly reports 24 collected/executed, 22 first-attempt passes and two flaky journeys with failed first attempts. This is not a new browser execution claim. Evidence: browser-metrics-projection.json.
- Existing Playwright diagnostic upload covers execution-evidence/. Live Sheets publication, artifact identity and other R5 requirements remain open; F024/F025 stay false.

### Publish browser diagnostics before API tests — 2026-09-07
- Both candidate 2de93 browser stages failed, but jobs 101624201400/101624201410 remain live in API execution. Direct log retrieval returns HTTP 404 until those jobs finish, and the workflow previously uploaded Playwright evidence only after API execution.
- Moved the existing Playwright diagnostic upload directly after browser execution, preserving its condition, name, paths and retention. This makes completed browser traces/reports available while the independent API lane runs; no duplicate artifact or weakened test gate introduced.
- Reviewed the reordered diff and actionlint passed. This YAML-only timing change has no synthetic source-string test. It does not make current-candidate diagnostics available retroactively; native after-change validation remains pending.

### Browser readiness Sheet recorder — 2026-09-07
- Added a dedicated browser_readiness recorder and CI invocation after browser diagnostics, before API execution. Run totals occur only on run rows; journey rows preserve identity/first attempt/retries. Missing/stale/wrong-edition evidence yields incomplete with unknown counts blank. Existing Sheet tables stay unchanged.
- Eight local row/projection tests passed; workflow actionlint passed. Historical df9b artifact dry-run yielded one failed run row and 24 journey rows with two flaky outcomes. Initial dry-run rejected an incorrectly supplied branch-head SHA; verified correct tested merge SHA 48a6b45a38b427b854d70889443c3598370238e8. No live Google write performed. Evidence: browser-sheet-recorder.json.
- Native publishing/live readback, cancellation reconciliation, run-attempt deduplication, artifact identities and global readiness remain outstanding; F024/F025 remain false.

### Native candidate 2de93 enterprise results — 2026-09-07
- Job 101624201410 is terminal failure. API ownership attestation passed; API execution: 332 passed, 2 failed across 19 files. Accounting export append scenario receives ACCOUNTING_EXPORT_EMPTY_BATCH (409 versus expected 201) at accountingExports.e2e.test.ts:261. Extension installation receives 401 versus expected 202 at extensions.e2e.test.ts:118. These require diagnosis, not relaxed assertions.
- Browser execution has three failed invoice journeys: invoice-generation, time-approval-invoice, usage-invoice-preview. Logs show checkbox.check reports the selection did not change; time approval retry also has a failed value assertion. Root cause remains unproven. Completed job log retained at /tmp/alga-browser-ee-2de93-final.log.
- Full integration job 101620543698 revalidated in_progress. Pushes remain held to preserve its execution. Browser Sheet recorder focused verification rerun: 8 passed, zero skipped/failed.

### Accounting export date boundary defect — 2026-09-07
- Traced native empty-batch failure to invoice_date being timestamptz while same-day end filters used <= midnight. Read-only local schema confirmed the type. Historical 20250208103014 migration constructs unawaited raw queries; no existing migration was rewritten.
- Selector now uses UTC calendar-day boundaries for date-only inputs, including the entire end date with an exclusive next-midnight bound. Explicit timestamp filters preserve their exact inclusive cutoff.
- New real-database regression failed before the fix (late-day invoice absent), then all seven invoiceSelection integration tests passed with no skips in isolated accounting_date_boundary_82cc. Evidence: accounting-export-date-boundary.json. Native API validation pending.
- Extension 401 diagnosis: CE forwarding route calls session-only assertSessionProductAccess before the enterprise API-key-authenticated handler. Fix and behavioral verification remain outstanding. Full integration 101620543698 remains live; pushes held.

### Extension install API-key forwarding — 2026-09-07
- Reproduced native 401 with the real forwarding route: a session-only guard ran before the EE API-key middleware. EE API-key requests now reach the existing authenticated product gate. CE and requests without API keys retain the session gate.
- Behavioral cases exercise the actual forwarding route, API-key middleware and product registry, with mocked key persistence/context construction and installation boundary. Valid PSA key succeeds; invalid key, AlgaDesk product, missing auth and CE/session cases remain denied. Related client-user and session-product checks also pass: 16 tests, zero failures/skips. Before fix, valid-key and product-denial cases returned the wrong 401.
- Native full installation, including downstream tier and permissions, remains pending. Evidence: extension-install-api-key.json. Full integration job 101620543698 revalidated live; no push.

### Native invoice checkbox activation — 2026-09-07
- Found a concrete test-fidelity defect: three AutomaticInvoices test files replaced checkbox event.preventDefault with a no-op, hiding the native activation rollback seen in CI. Replaced those checkbox mocks with the real component; the existing parent-selection test then failed (checked remained false).
- Removed click cancellation from parent checkbox handling, retaining propagation suppression and shift-range selection. Added a three-parent select/deselect range behavioral case. All 50 tests across grouped parent rows, PO overage and duplicate identity suites now pass without skips. Evidence: invoice-checkbox-native-activation.json.
- Native browser rerun remains required; do not claim the three invoice journeys green yet. The time-approval retry value assertion also remains unverified. Full integration 101620543698 was revalidated live during this turn; pushes held.

### Time entry asynchronous contract default overwrite — 2026-09-07
- Diagnosed a race consistent with native retry persisting 60 versus 120 minutes: eligible-contract lookup closes over the original entry and later overwrites duration and notes. A deferred-response component regression failed before the fix with both edited fields restored to old values.
- Default contract assignment now merges into the latest entry and cancels obsolete lookup effects on entry identity/service/date/selected-line changes or unmount. Four behavioral cases pass: preserve edits, ignore replaced-service response, preserve manual contract selection, no update after unmount. Evidence: time-entry-default-lookup-race.json.
- Native full browser journey remains pending; local tests exercise real component effects with mocked lookup and child widgets. Full integration job 101620543698 revalidated in_progress; hold pushes.

### Community API cleanup and accumulated Node verification — 2026-09-07
- Completed community job 101624201400 reports 332 API passes, 2 failures and 4 additional suite teardown failures. Accounting date failure is covered by f08529. The time-entry date-range failure and four suite failures are jobs_tenant_user_id_foreign during cleanup, not date-range assertion failures.
- Added real-database API fixture cleanup regression with two fresh tenants. It fails before the fix with the same FK violation; passes after deleting tenant-scoped job_details/jobs before users, verifying the other tenant's records remain. Native rerun pending. Evidence: api-job-cleanup.json.
- Full Node tooling session 42049 completed successfully: 39 required files, 466 passed, zero failures/skips/todo/cancellations, one existing manual exclusion. Started at clean 18487701f8; API fixture/helper edits occurred during execution, so evidence honestly marks workingTreeDirty=true. Node implementation was unchanged during the run; do not call this clean-final-tree attestation. Evidence: node-tooling-accumulated-metrics.json.

### Accumulated fixes compilation and tier hypothesis audit — 2026-09-07
- Targeted TypeScript compile passed at b4e0dba957 for the time-entry component/race test, extension forwarding regression, API cleanup regression and accounting selector plus transitive dependencies. Evidence: accumulated-fixes-typecheck.json. Plan validator passed (37 features, 31 tests); this validates structure, not implementation completion.
- Investigated session-based tier checks in extension installation. Authoritative FEATURE_MINIMUM_TIER currently permits extensions at solo (all tiers), so a speculative below-tier denial test was invalid and removed. No tier behavior was changed or claimed fixed. Native installation remains pending.
- Integration job 101620543698 remains authoritatively in_progress; pushes remain held. Working tree was clean before recording this evidence.

### Explicit CE extension availability and terminal native results — 2026-09-07
- Removed the CE extension API test's table-absence no-op. CI now supplies E2E_EDITION; CE executes the endpoint and asserts 501, while missing enterprise tables fail. CE API-key requests pass through existing authentication/product gating before unavailability. Seven route/middleware behavioral tests pass, including invalid-key and product denials; targeted TypeScript and actionlint pass. Native HTTP validation pending.
- Published 2de93 full integration job 101620543698 is terminal failure: 282 files and 2063 tests passed, 3 files/47 tests skipped. The execution gate correctly rejects those required skips. Server unit job 101620481292 succeeded: 2689 files, 14519 tests passed, 2 skipped/15 TODO. Evidence: native-2de93-completion.json.
- Full integration is no longer live, so the push hold is released. Remaining 47 integration opt-ins must be implemented; none are waived by these passing counts.

### Current Temporal engine mandatory coverage — 2026-09-07
- Legacy email integration tests rely on removed synchronous execution and snapshots. Before porting, found three existing current-engine suites missing from temporal-readiness: workflow-runtime-v2-interpreter, run-workflow and simulator-contract. Added them to positive candidate assignment and runner collection.
- Actual readiness runner collected/executed six files and 60 tests successfully, zero skips/failures. These use activity/transport doubles and do not establish live Temporal persistence or replace any of the 47 legacy required skips. Evidence: temporal-engine-readiness.json.
- New published candidate c5d608 is live: integration run 34087162034, browser 34087162072, unit 34087162013, types 34087162026, Node 34087162007. Keep subsequent local commits unpushed while this execution is live.

### Email definition port: current interpreter routing — 2026-09-07
- Added six cases executing the shipped inbound-email JSON through the current Temporal workflow loop and real registered node handlers: existing reply, missing defaults, new ticket/acknowledgement, optional attachment failure, optional acknowledgement failure, and required-action failure/manual-resolution path.
- Actual readiness runner passed six files/66 tests, zero failures/skips. External action outputs, persistence projections and Temporal transport remain mocked; this establishes branch and node behavior only. Evidence: temporal-email-definition-routing.json.
- The 29 legacy email tests and total 47 skipped integration requirements remain open. Input mapping/idempotency, real persisted action effects, live Temporal execution and explicit requirement mapping must be completed before claiming the port finished or removing skips.

### Email action mapping and replay port — 2026-09-07
- Added parameterized tests using shipped comment/create-ticket/attachment configs, the real mapping/expression resolver and current Temporal action activity. Assertions cover resolved business arguments, tenant-prefixed explicit keys and replay returning stored output without invoking handlers or creating another invocation.
- Readiness lane: six files, 69 passed, zero failures/skips. Initial create-ticket fixture omitted nullable target fields and failed expression serialization; corrected to explicit nulls matching registerEmailWorkflowActions output. No production behavior changed.
- Invocation persistence and action handlers remain mocks; real DB effects, concurrent duplicate behavior and live worker execution are still required. The legacy skip count is unchanged. Evidence: temporal-email-action-mapping.json.

### Workflow invocation database concurrency and isolation — 2026-09-07
- Added an integration test using actual migrated database and persistence models. Concurrent duplicate creation yields one row and one 23505; another tenant's key persists independently. Persisted input/output roundtrip, tenant-scoped lookup/list and cross-tenant update denial pass.
- One required integration case passed locally in disposable workflow_invocation_82cc (no skips). Evidence: workflow-invocation-persistence.json. This is database uniqueness/isolation coverage, not safe activity retry or live worker execution.
- Remaining activity risk to investigate: executeActionInvocation only replays SUCCEEDED; existing STARTED/FAILED rows lead back to insert against the unique key. Need behavioral retry/lease/attempt semantics before claiming robust recovery.
- Current c5d608 full integration job 101633362425 is live (run 34087162034); keep local commits unpushed.

### Failed workflow invocation retry claim — 2026-09-07
- Fixed failed invocation recovery: activity previously attempted a new insert against the existing unique key. New persistence claim conditionally changes FAILED to STARTED and increments attempt under the tenant scope; one claimant wins. Activity reuses that row and does not run a handler when the claim loses.
- Readiness 71 passed; real DB concurrency/isolation regression passed with simultaneous claims, wrong-tenant denial, incremented attempt and refusal to steal STARTED. Temporal build tsconfig no-emit compile passed. Evidence: workflow-failed-invocation-retry.json.
- This does not resolve stale STARTED after worker loss or guarantee provider exactly-once effects. Those require additional ownership/recovery and live Temporal tests. Legacy email/redaction skips remain open. Current native PR has no failed checks observed, with long lanes still running; keep local commits unpushed.

### Real Temporal activity/database failure recovery — 2026-09-07
- Extended workflowInvocationPersistence integration to exercise the actual Temporal activity with real expression/mapping and invocation persistence. Deterministic handler fails once, succeeds on retry, then is not called for the third replay. One row retains its invocation ID, resolved input, stable tenant key, SUCCEEDED output and attempt=2.
- Both DB tests passed, zero skips/failures, in workflow_invocation_82cc. Initial run failed due to an incorrect relative test import; corrected path and complete rerun passed. Evidence: workflow-activity-database-recovery.json.
- Activity registration/handler and admin connection are injected; this is not live Temporal or real email action coverage. Those and stale STARTED recovery remain open. No native failures were observed at turn start; local commits remain held while integration runs.

### Real registered email-comment activity persistence — 2026-09-07
- Added a test invoking the registered create_comment_from_parsed_email action through the real Temporal activity, real mapping and real DB models. Asserts one persisted comment, matching returned ID, preserved customer text, awaiting_internal ticket state and one invocation across replay.
- Final complete file rerun: three passed, zero failures/skips. Targeted TypeScript passed after adding an explicit invocation fixture array type and replacing a broad billing-helper import with direct ticket fixture insertion. Evidence: real-email-comment-activity.json.
- Admin DB/transaction are injected; event-bus publication is mocked, so delivery is not claimed. Live worker, real new-ticket/attachment paths and legacy skip replacement remain open. Candidate c5d608 browser builds 101633367988 (EE) and 101633368158 (CE) remain live; other six image builds succeeded.

### 2026-09-07 — Publish invoice ownership browser coverage for native validation

- Confirmed published revision `c5d608d6dee7b89f90dbe9e812ec2e639de52ac2` full integration job completed: 2,064 passed, 47 skipped. The execution gate failed on skips; no integration assertion failures were reported. Both production browser jobs also completed with failures already addressed by pending local follow-up commits.
- Added an unconditional browser journey for authenticated invoice generation, tenant-isolated reads with an injected foreign snapshot, mismatched-tenant rejection, and a real UI PDF download checked for identity, total and private-data exclusion. Shared source fixtures exercise the same billing inputs as restored integration cases.
- Revalidated collection with the e2e workspace Playwright binary and targeted TypeScript checking. Runtime remains unverified; retain the legacy manual case until execution and complete behavioral parity are established. Local temporary-account setup remains pending explicit authorization following automatic approval review rejection; no secret extraction or account creation was performed. Native CI uses its existing disposable installation setup.
- `git merge-base --is-ancestor origin/main HEAD` passed against the current local remote-tracking ref. This is not a claim that the remote main tip has been freshly fetched.

### 2026-09-07 — Combined invoice verification and project survey scope

- Executed the entire invoice production integration file at published revision `9a0ea31e57`: nine cases passed together in 108.39 seconds; three explicitly manual cases remain skipped. Evidence: `evidence/invoice-combined-9a0ea.json`.
- Audited the project survey skip through subscriber, invitation service, both storage tables, token resolution, response persistence and analytics. A dispatch-only fix is insufficient. Recorded the full restoration requirements in `evidence/project-survey-restoration-scope.json`; no requirement or skip was removed.
- Native integration run `34093073754`, full-suite job `101650631428`, was verified in progress. Keep it running; these local evidence updates need not cancel or replace the published execution.

### 2026-09-07 — Workflow step completion ownership regression

- While tracing skipped snapshot coverage, found that the real completion activity discovered a step by ID alone and used a separately supplied run ID for the run update; a missing step fell back to an unscoped update.
- Added a real database case covering absent step, wrong run, wrong path and successful owned completion. It failed before the fix (nonexistent step accepted), then passed with the full six-case persistence suite after matching all three identities before either update.
- Temporal readiness: 72/72 passed; targeted TypeScript passed. Evidence: `evidence/workflow-step-completion-ownership.json`. Snapshot and output-storage redaction remain unfinished; this incidental fix does not replace those requirements.

### 2026-09-07 — Restore Temporal diagnostic snapshot persistence

- Added optional scopes to the existing completion activity and supplied them from all workflow completion branches. Older activity inputs remain accepted. The transaction locks the verified step, writes one redacted/bounded snapshot, links it to the step, and prunes expired run-local history with reference cleanup.
- Snapshot limits: 256 KiB; retention defaults to 30 days, configurable with positive `WORKFLOW_SNAPSHOT_RETENTION_DAYS`. This is completion-triggered retention, not a global inactive-run sweep.
- Real database behavior: 7/7 passed; Temporal readiness: 72/72 passed; targeted TypeScript passed. Fixed mock state leakage exposed by shuffled test order. Evidence: `evidence/temporal-snapshot-persistence.json`.
- Keep legacy redaction skips visible until output storage and full run-studio parity are verified. Citus runtime and real Temporal-server replay verification remain outstanding.
- Native full integration job `101650631428` remains running; workspace DB and all three infrastructure shards completed successfully. Do not cancel it to publish these local changes.

### 2026-09-07 — Sanitize snapshots before the activity boundary

- Extracted a pure diagnostic snapshot builder and call it before each completion activity. The activity receives bounded/redacted diagnostic data rather than a raw duplicate of execution scopes; it still sanitizes at persistence and accepts older scopes-based inputs. This does not redact all Temporal history.
- Validated seven DB cases, 72 Temporal readiness cases, four utility cases and targeted TypeScript. Added the utility directory to shared Vitest collection after the normal config reported no matching test file. Evidence: `evidence/snapshot-activity-boundary.json`.

### 2026-09-07 — Fix regression-test ownership in the Nx build graph

- Native revision 9a0ea31e57 introduced a server -> temporal-workflows cycle via the workflow DB test. The cycle guard failed, Nx dependency-plan assertions failed, and CE build-deps attempted an inappropriate worker build with missing EE modules.
- Relocated the full seven-case suite to `ee/temporal-workflows/src/__tests__/integration/workflowInvocationPersistence.integration.test.ts`; updated full/affected integration selection, discovery reconciliation, direct scripts and mandatory Tier-1 floor. Worker standalone Vitest excludes this DB lane. No tests or cycle baseline entries were removed.
- Actual graph now has only the three existing cycles. Focused Nx workspace tests: 4/4; relocated database suite: 7/7; real runner selection test and targeted TypeScript passed. Evidence: `evidence/workflow-db-test-project-ownership.json`. Native image rebuild verification remains pending.

### 2026-09-07 — Built workflow executes in real Temporal sandbox

- Full `guard:temporal-readiness:fast` passed, including rebuilt workspace packages, worker TypeScript/alias emission, built worker imports and all 72 readiness cases.
- Added `npm run test:temporal-snapshot-runtime`: an isolated Temporal test server executes the built workflow with a return step; activity assertions verify redacted diagnostic data, no raw scopes argument, and unchanged live execution data. Test passed locally. Activity bodies are doubles; DB behavior remains independently tested.
- CI runs this command after compilation and uploads its running/passed/failed JSON evidence with the readiness artifact. Source: `scripts/temporal-snapshot-runtime-smoke.cjs`; evidence: `evidence/temporal-built-snapshot-runtime.json`.
- Native full integration job 101650631428 still reports its full-suite execution step in progress. Leave it intact before publishing queued commits.

### 2026-09-07 — Real Temporal regression exposes dropped redaction metadata

- Expanded the built runtime smoke to action output, oversized snapshots and meta.* assignment, with recorded-history replay. It failed before the fix: assigning action output discarded meta.redactions, exposing the resolved token in subsequent diagnostic activity payloads.
- assignToScopePath now preserves metadata/error state and writes meta.* values to metadata. Added readiness assertions for preserved metadata and error context.
- Rebuilt worker, 72 readiness cases, three real Temporal cases and three same-build history replays all passed. Evidence: `evidence/workflow-assignment-metadata.json`. Prior-release history compatibility and invocation output storage remain outstanding.

### 2026-09-07 — Verify worker integration floor and classify browser nonexecution

- Real-runner regression now proves worker-owned mandatory cases execute during docs-only direct invocation and stale worker manifest paths fail. Full/affected/fallback and skip-detection checks remain green. Evidence: `evidence/worker-integration-floor.json`.
- Published browser workflow 34093073839 completed: EE image succeeded, CE image failed on the known locally fixed project cycle. Browser jobs 101659290911/101659290969 rejected BUILD_RESULT=failure before setup; neither ran browser assertions. Do not describe these as runtime browser failures.
- Full integration job 101650631428 remains active on the published revision; its terminal report is still pending.

### 2026-09-07 — Explicit Citus workflow test bootstrap in progress

- Added TEST_DB_BACKEND=citus to the isolated DB helper, using the real extension and four-shard database setting. Workflow suite asserts actual hash distribution of runs, steps, snapshots and invocations.
- Temporary migration directory outside server failed relative dependency/template resolution. Switched to ignored server/combined-migrations, matching CI. That run reached migration 363 but hit the existing 180-second bootstrap limit; its process terminated and active-query count was zero.
- Restarted with a Citus-only 30-minute migration hook budget. Current live session: 52670; log: /tmp/alga-workflow-citus-runtime-full.log. Scratch DB workflow_citus_82cc and test-only role workflow_citus_82cc_admin are in owned alga-regression-citus; retain while validating.
- Default PostgreSQL regression suite still passes 7/7, and targeted TypeScript passes. Citus runtime and native-job wiring remain incomplete. Evidence: `evidence/workflow-citus-bootstrap.json`.

### 2026-09-07 — Publish queued fixes without interrupting active integration

- Corrected the earlier publication hold: integration-tests.yml and unit-tests.yml have no cancel-in-progress policy. Only e2e-fresh-install-tests.yaml auto-cancels prior PR runs, and that workflow was terminal. Future pushes need not wait for integration completion on that mistaken premise.
- Initial push auto-review rejected an unverified/private-destination assumption. Read-only verification confirmed origin is PUBLIC Nine-Minds/alga-psa, viewer ADMIN, and Robert Isaacs owns same-repository PR 3343 on this branch. Retry was approved and published through 23c841b44c. New CI was confirmed dispatched; prior job 101650631428 still remained in progress.
- Updated PR description to current candidate and explicit verification limits. Local Citus session 52670 remains active; latest read-only progress: 899 migrations complete and 198 hash-distributed tables. No Citus runtime assertion success is claimed yet.

### 2026-09-07 — Citus development seed compatibility and native Temporal evidence

- Resolved scalar INSERT subqueries in development fixtures after actual Citus bootstrap failures; notification upserts now bind a timestamp fetched from the database. Resumed execution reached the final numeric seed 89 successfully.
- PostgreSQL workflow persistence suite passed all seven cases with these seed changes. Fresh Citus rebuild is running in session 79257; no Citus runtime pass claimed yet.
- Added the workflow persistence suite to the Citus job and broadened relevant source/seed/harness path filters. Native execution of this new wiring remains pending.
- Published Temporal job 101662884343 passed 72 readiness tests and the built workflow smoke/history replays, verified from its log. Published cycle and Nx tooling checks passed; full integration/browser builds still pending. Evidence: evidence/citus-development-seeds.json.

### 2026-09-07 — Citus runtime exposes distributed row-lock bug

- Fresh combined migrations plus all development seeds completed. Workflow suite executed: five passed, two failed because step completion used FOR UPDATE without the tenant distribution predicate. This is runtime evidence, not a migration-only check.
- Step completion now resolves the parent run tenant before validating and locking the matching step. Existing invalid-step/run/path assertions remain intact.
- Added run-citus-workflow-tests.mjs using shared execution reconciliation: it collects test identities, executes the required file, rejects missing/skipped/todo/incomplete results and publishes raw results plus evidence. CI invokes this runner.
- Full fresh Citus gate rerun active in session 79980, log /tmp/alga-citus-workflow-gate.log. PostgreSQL regression rerun active separately in session 16455.

- Tenant-routed completion fix: PostgreSQL seven cases and targeted TypeScript passed; execution-reconciliation six tests passed. Read-only seed relation checks passed for nine fixture tables on PostgreSQL. Citus session 79980 remains active; keep its revision stable until the gate completes. Native EE build succeeded; CE build remains active in job 101662995102.

### 2026-09-07 — Fresh Citus runtime gate passes

- Session 79980 completed successfully: fresh combined migrations and development seeds, then seven workflow persistence cases passed in 312 seconds. Actual collected/executed identities match; zero skipped, failed, todo or pending cases.
- Tenant-routed FOR UPDATE fixes the two observed Citus runtime failures. PostgreSQL remains seven of seven; targeted types and six reconciliation tests passed.
- Nine seeded relation tables passed readback on both backends. Initial Citus readback selected a runtime test tenant via unordered fallback; corrected the checker to explicitly select seeded Oz, then both backends passed. No fixture change was needed.
- Native enterprise integration, affected typecheck and EE workflow build guard passed on published 23c841b44c. New Citus gate native execution remains pending publication; broader plan status stays unchanged.

### 2026-09-07 — Extend Citus runtime validation to invoicing

- Started the existing immutable invoice-generation regression against a separate fresh Citus scratch DB invoice_citus_82cc. Added actual billing-table distribution assertions and a Citus-only bootstrap time budget. Existing billing/PDF/credit/duplicate assertions remain intact.
- Filtered collection contains the intended single case. Live session 56282, log /tmp/alga-invoice-citus-runtime.log. Native Citus billing lane wiring depends on execution results; no completion claimed.
- Native production browser jobs 101670277218/101670277273 are still preparing images. Keep the completed Citus workflow commit local while these jobs run.

### 2026-09-07 — Complete invoice case gets its own mandatory file

- Moved the immutable invoice regression into invoiceTicketImmutable.integration.test.ts without removing billing assertions; added it to the Tier-1 floor. Actual collection retains nine enabled invoice cases across the two files. Extracted case passes PostgreSQL, including real PDF text checks.
- Renamed Citus runner to run-citus-runtime-tests.mjs and prepared workflow plus invoice execution with complete-file collection; CI installs Poppler. New combined gate remains unverified.
- Initial Citus invoice run failed the added topology assertion: invoices/charges/tickets are distributed, while time_entries and invoice_time_entries are local in the fresh migration chain. Corrected that unsupported expectation; the case records all five table states and requires core billing distribution. This does not establish production topology parity.
- Full extracted case rerunning from a fresh Citus database in session 80701; log /tmp/alga-invoice-citus-immutable.log. Prior run 56282 is terminal.

### 2026-09-07 — Citus invoice passes; native browser dependency failure reproduced

- Extracted invoice case passed from a fresh Citus DB in 319 seconds, with no skipped cases. PostgreSQL extracted case also passed. Mixed topology captured in evidence/citus-invoice-runtime.json. Combined Citus runtime runner remains to be verified.
- Native browser artifacts show collection failure in invoice-ticket-ownership.spec.ts due to transitive @js-temporal/polyfill dependency missing from standalone browser install. Browser assertions did not run.
- Replaced the application helper import with explicit API selector fixture data. Reproduced before-failure in /tmp without root dependencies; after-fix collection passes 23 CE and 25 EE cases across 14 files.
- Added standalone browser collection before image builds and required its success in the stable aggregate check. Native verification pending. Evidence: evidence/browser-standalone-collection.json.

### 2026-09-07 — Enterprise API identifies session-dependent tier check

- Completed enterprise job 101670277273: 334 API cases passed, extension install failed (expected 202, received 403). Direct jobs/logs API returned the terminal log while gh run view refused until the whole workflow ends.
- Extension API route uses browser-session assertTierAccess despite API-key identity. Changed to assertTenantTierAccess with req.context.tenant; added lower-tier denial with no install side effect before the Pro success assertion. Validation pending.
- Combined Citus runtime gate active in session 69541, log /tmp/alga-citus-combined-runtime-gate.log, committed revision 9f52acb702. Do not commit during its revision-consistency check.

### 2026-09-07 — Extension API fixture and tenant policy validation

- simpleRoleSetup does not grant extension:write; added that explicit grant and a revoked-permission denial assertion in the extension API case. Separately assert Essentials tier denial with TIER_ACCESS_DENIED before restoring fixture Pro plan and installing. Solo permits extensions, so it is not a valid denied-tier fixture.
- Four route behavioral tests pass with the API-tenant tier check; the original session-based route fails three, proving it can both borrow another tenant tier and deny a licensed API tenant based on an unrelated session. Null session resolves to Pro by existing policy, so missing-session alone did not reproduce the native 403.
- Both previous production browser jobs are terminal; community API result inspection pending. Combined Citus session 69541 still active.

### 2026-09-07 — Combined Citus gate verifies all eight cases

- Session 69541 completed: two required files, eight passed, zero failures/skips/todos/pending, and exact collected/executed identities. Duration 631.50 seconds; evidence/citus-combined-runtime.json.
- Community API job 101670277218 had 334 passes and one 20-second timeout in explicit client/contact/user reactivation. Parallelized its five independent final reads into one group and retained all active-state checks plus explicit response status assertions; no timeout increase. Native runtime verification still pending.

### 2026-09-07 — Native guard exceeds default subprocess buffer

- New native standalone browser collection passed in 13 seconds, confirming the browser dependency repair.
- Env-backup guard job 101678731400 failed with ENOBUFS because git ls-files exceeded the default 1 MiB buffer. Replaced buffered execution with streaming NUL-delimited filenames; no filename rules relaxed.
- Real 9000-entry Git index reproduces the old failure; new guard passes large clean index and catches a prohibited late entry. Git-error fail-closed coverage and actual worktree guard also pass. Evidence: evidence/env-backup-guard-large-index.json.

### 2026-09-07 — Native Citus execution verified

- Native run 34102126219, job 101678729376 completed successfully for PR head e55139a737; tested merge checkout df2c988ca0742d4d19d7048353dc4416703c4063 remained clean and unchanged.
- Downloaded artifact 10011134709 confirms both mandatory files and all eight collected/executed identities match, with eight passes and no incomplete cases. Durable evidence: evidence/citus-native-runtime.json.
- F022 remains incomplete: previous-release upgrade and production topology parity are still unverified. Production browser image jobs remain live; local env guard repair is awaiting publication without cancelling those builds.

### 2026-09-07 — Repository-wide discovery entry point

- Added scripts/verify-test-inventory.mjs. From the audited repository root, run `node scripts/verify-test-inventory.mjs <collection-manifest.json> [output.json]`. Manifest schemaVersion 1 contains collections with runner/status/files plus owner/runtime/mandatory metadata, and optional owned, expiring exclusions. Files must come from actual runner collection.
- The command reconciles the entire Git test-file inventory without prefiltering known suite directories, so a move outside all known lanes cannot vanish. It emits an explicit failed JSON report and nonzero exit for malformed input, orphaned tests, empty collections, missing ownership/runtime metadata, and expired exclusions.
- Extended the existing real Vitest fixture through the CLI, including additions, moves, repair, empty selection, metadata/schema rejection, and valid/expired exclusions. `node --test scripts/tests/test-discovery.test.mjs scripts/tests/test-discovery.vitest.test.mjs`: seven passed, zero skipped, 2.93 seconds. Actual repaired fixture executes both test identities.
- F004 remains incomplete: runner artifact aggregation and resolution of repository-wide unmatched files still need implementation. Discovery alone does not prove execution, and this command is not yet a required global CI gate.

### 2026-09-07 — Native artifact input for global discovery

- Inventory collections can now reference collectionFile relative to the manifest and an explicit absolute sourceRoot. Native absolute paths are normalized against their producer checkout. Missing artifacts, paths outside that checkout and ambiguous inline/artifact inputs fail closed.
- Expanded the real Vitest CLI fixture to exercise artifact reads, relocated CI paths, missing input, wrong roots and traversal rejection. Seven tests pass (3.05 seconds). Fixture path construction uses canonical normalization for macOS /var -> /private/var aliases.
- Downloaded ten workspace runner collection artifacts from run 34102126267, verified their evidence revision/status, and reconciled them against all 3944 current repository candidates: 451 accounted for, 3493 unmatched. This is deliberately incomplete input, not proof those 3493 files are orphaned. Other runners and individually confirmed owners are still needed. Evidence: evidence/repository-inventory-artifact-input.json; temporary input/result under /tmp/alga-partial-native-inventory*.

### 2026-09-07 — Node event collections and expanded native inventory

- Extracted artifact reading into scripts/lib/read-runner-collection.mjs and added format=node-events, using collectionFile=events.jsonl and evidenceFile=evidence.json. Recomputes file registrations/completions from raw events with reconcileNodeExecution; a producer-authored passed status cannot hide missing test:pass or test:summary events. Unknown formats fail closed.
- Actual Node runner fixture now verifies artifact-derived file identities and damaged-event rejection. Combined Node/discovery behavioral tests: 15 pass on Node 25.5.0 in 3.99 seconds. Default local Node 20.20.0 fails the existing event-summary requirement; CI uses Node 22. No assertions weakened for the older runtime.
- Reconciled 16 native artifact collections (workspace, DB, three infrastructure shards, Node tooling, appliance): 660 of 3944 current files accounted for; 3284 remain unmatched with partial input. Native DB evidence records 425 passes; infrastructure shards total 496 passes, all zero skipped. This is not a final revision-matched global readiness result. Evidence: evidence/repository-inventory-node-artifacts.json.

### 2026-09-07 — Server coverage job collection artifacts

- Server coverage job previously uploaded execution/progress only. Added actual Vitest file and test-name collection before execution, sharing the same Bash selection array with the run command. Empty collection fails; both artifacts upload even on failure. Assertion collection uses the same per-file worker isolation as execution.
- Local filesOnly collection passed: 2692 files. Combined with the 16 prior native artifacts, discovery accounts for 3348 of 3944 files, leaving 596 unmatched. This mixes local collection with older native results and is not final readiness evidence.
- YAML parsing and extracted bash -n passed. Test-name collection is still live in session 42692, log /tmp/alga-server-unit-collection-82cc.log; it started with existing default pool settings before the workflow isolation flag was added. Do not restart it just because observation timed out. Evidence: evidence/server-unit-collection-artifacts.json.

### 2026-09-07 — Server collection completes; mobile artifact gap

- Session 42692 terminated successfully (exit 0). Actual Vitest test-name collection contains 14539 identities, representing all 2692 files. Updated evidence/server-unit-collection-artifacts.json; no active local collection session remains.
- Mobile CI previously ran npm test without retaining raw execution or collection artifacts. Added generated-editor preparation before actual Vitest file/name collection, empty-collection rejection, and JSON execution reporting while retaining npm test. Always upload test-results/mobile as mobile-execution.
- Local mobile file collection found all 134 files using the root Vitest installation; emitted missing expo/tsconfig.base warning because mobile-local dependencies are absent. This proves file discovery only, not mobile execution. Native exact mobile collection/execution verification is pending. Workflow YAML parsed and Bash syntax checked.

### 2026-09-07 — Native browser prerequisite wiring repair

- Native browser jobs 101685165287 (CE) and 101685165359 (EE), run 34102126365, both failed before checkout/application startup. Their shell gate reads COLLECTION_RESULT but the step omitted that env variable and the job omitted browser-collection from direct needs.
- Added the direct dependency and needs.browser-collection.result env binding. Executed the actual YAML shell step with simulated GitHub needs resolution: original exits 1 with all producers successful; repaired exits 0; missing/failed/cancelled/skipped mandatory collection exits 1; documented no-application-change selection exits 0. Temporary reproduction: /tmp/alga-verify-browser-prerequisite.cjs.
- Both browser jobs and aggregate are terminal, so publication can proceed without cancelling a live browser build. Updated native application/API outcomes are still unverified because no browser runtime started in this run.

### 2026-09-07 — Playwright native collections join global inventory

- Added format=playwright to read-runner-collection, using the existing validated Playwright parser. Deduplicates file identities across projects/cases while rejecting empty reports, reported import errors and paths outside the producer checkout.
- Actual production collection: CE 23 cases/14 files; EE 25 cases/14 files. Both JSON artifacts successfully read by the adapter. Full adapter/discovery behavioral set: 21 passed, zero skipped, 4.07 seconds on Node 25.
- Standalone browser-collection job now uploads both native JSON collections before image builds. No execution outcomes are inferred from collection.
- Additional local actual file collections found 287 integration files, 20 API files and six fast Temporal readiness files. After these plus mobile, 149 prior unmatched files remain (including 14 production browser files now readable by the adapter). Remaining concentration: legacy browser suites and Temporal tests outside fast readiness. These collections mix local and older native evidence; global CI assignment/enforcement remains incomplete.

### 2026-09-07 — SLA and marketing activity tests enter fast readiness

- Native env backup guard and mobile unit job now pass at published 2f75678de2. Mobile artifact verification remains separate from the successful job status.
- Investigated two Temporal files outside readiness: marketing had nine passing cases; SLA could not import businessHoursCalculator/workflow-streams because Vitest lacked source aliases already in tsconfig. This is harness configuration evidence, not proof of a deployed package defect.
- Repaired SLA mocks for current withTenantTransactionRetryReadOnly/tenantDb and Redis event publishing; fixed self-reference during mock-chain initialization. Preserved nine real calendar/deadline cases and strengthened notification/audit assertions. Added both files to readiness config and its independent candidate classifier.
- Expanded readiness: eight files, 96 tests passed, zero skips, 3.01 seconds with TEMPORAL_TEST_SKIP_ENV_BOOTSTRAP=1 and root Vitest 4.1.10. Evidence: evidence/temporal-sla-marketing-readiness.json. Native assignment verification remains pending; other Temporal gaps remain.

### 2026-09-07 — Schedule suites and native mobile reconciliation

- Downloaded mobile-execution from run 34104450446 and independently recomputed execution reconciliation from its raw collection, assertion collection and results: 134 files, 901 passes, zero skips/missing, no failures. Native artifact reporting works.
- Three schedule suites failed because vi.fn arrow implementations cannot construct Client in Vitest 4. Replaced only those constructor implementations with functions; all ten schedule/tenant-suspension cases then passed without assertion removal.
- Added schedule suites and tenant-suspension activities to fast readiness and its candidate classifier. Full expanded suite: 12 files, 106 passes, 4.09 seconds; native verification pending. Evidence: evidence/temporal-schedules-and-mobile-native.json.

### 2026-09-07 — Email lifecycle seams join reconciled readiness

- Added tenant-email-ingestion activities (seven provider pause/resume/teardown cases) and tenant email-settings defaults (two cases) to readiness and its independent candidate classifier. Both existing suites passed without assertion changes.
- Expanded direct suite: 14 files, 115 passes. Then ran the actual CI entry point `node scripts/run-additional-workspace-tests.mjs temporal-readiness` to verify independent discovery plus assertion/execution reconciliation: all passed, exact 14-file execution, 115 passes, no skips. Evidence: evidence/temporal-email-readiness.json. Local source records the uncommitted additions; no claim of final native readiness.

### 2026-09-07 — Native correction input mismatch and mock isolation

- Nx job 101686141225 failed one of 1271 billing assertions: grouped invoice correction expected quantity 7, received 0. Native log also retained a prior quantity-12 save call because upsert mock was never cleared between cases.
- Full file passes locally before change (37), so the native input mismatch remains intermittent/unproven. Reset the upsert mock per test and use awaited user clear/type/click, assert displayed 7, preserve revision-3/quantity-7 payload checks, and require exactly one save. No production fix inferred.
- After change full file passes all 37 in 4.20 seconds. Native verification remains pending. Evidence: evidence/billing-correction-test-isolation.json; logs /tmp/alga-billing-grouped-{82cc,after-82cc}.log.

### 2026-09-07 — Product upgrade seams enter required readiness

- Existing product-upgrade activity tests cover invalid subscription/price refusal, no-op target detection, seat quantity preservation, annual mapping and fallback price configuration. Product-bootstrap resolver tests cover unsupported products and actual temporary-directory seed enumeration. Eleven cases pass unchanged.
- Added both suites to readiness config and independent discovery classifier. Actual run-additional-workspace-tests temporal-readiness entry point passes 16 files / 126 cases with complete discovery and execution reconciliation. Evidence: evidence/temporal-product-readiness.json.
- Does not satisfy previous-release schema upgrade or live Stripe parity requirements. Native expanded readiness verification is still pending.

### 2026-09-07 — Awaited email helper assertions and comment recovery

- Comment recovery forwarding behavior passed unchanged but was unassigned. Email helper suite failed 17/24 cases and emitted an unhandled rejection: test assumptions were synchronous although password/service creation is async, and Context mock used logger instead of log. Password uniqueness tests had falsely compared distinct promises.
- Await actual password values and service instances, assert the unknown-provider promise rejection, and update Context mock. All 24 email helper assertions now pass; no product behavior changed.
- Added both suites to readiness/configured discovery. Actual required runner: 18 files, 151 passed, zero skips or unhandled errors, full discovery/execution reconciliation. Evidence: evidence/temporal-email-helper-readiness.json. Native verification pending.

### 2026-09-07 — Portal rendering and Git helpers enter readiness

- Three previously unassigned portal suites passed unchanged: rendered resource shape and configured portal URL (six cases), plus Git helpers using injected command runner and temporary files (23 cases). No production Git or Kubernetes changes performed.
- Added all three to fast-readiness config and independent candidate classifier. Actual required runner: 21 files / 180 passes, no skips, matching discovery/execution. Evidence: evidence/temporal-portal-readiness.json.
- Live custom-domain deployment and remaining worker/browser assignment gaps are still incomplete; these helper tests do not establish deployed behavior.

### 2026-09-07 — Dedicated Temporal engine execution lane

- Marketing fan-out and NinjaOne refresh workflow seams pass unchanged; assigned both to fast readiness. Reconciled fast runner now passes 23 files / 184 tests.
- Product-upgrade workflow requires a real Temporal test server. Sandbox run failed to download the ephemeral binary; approved network-enabled run passed all four actual workflow cases. No external application state used: activities are stubbed and server is ephemeral.
- Added vitest.engine.config.ts, temporal-engine runner/discovery assignment, and a separate Temporal engine execution complete CI job with required raw artifacts. Exact local CI entry point passed four collected/executed cases in 1.85 seconds. Evidence: evidence/temporal-engine-upgrade.json.
- Native execution and branch protection remain pending. This does not substitute for previous-release schema upgrade tests.

### 2026-09-07 — SLA and appliance workflows enter engine lane

- Existing appliance tenant creation (two cases) and SLA workflow (ten cases) passed on actual ephemeral Temporal servers. Covers supplied tenant identity/password and hosted-step selection; SLA signal transitions, pause/resume, cancel and missed-close recovery. Activities remain stubbed; no real customer state modified.
- Added both files to temporal-engine config and independent candidate classification. Exact CI runner passes three files / 16 tests, zero skips, reconciled collection/execution, 5.47 seconds. Evidence: evidence/temporal-engine-appliance-sla.json.
- Native browser jobs 101692993747 (CE) and 101692993738 (EE) are now running in run 34104450316, confirming the previous prerequisite wiring no longer stops startup. Do not publish while their current runtime evidence is still being gathered.

### 2026-09-07 — Domain engine suites and SLA integration investigation

- Managed-email workflow: six cases pass (verification success/failure/deadline, reuse, delete trigger and in-flight delete). Portal-registration workflow: three cases pass against the ephemeral engine. Added both to required engine selection and independent inventory. Exact runner passes five files / 25 tests, zero skips, 8.51 seconds. Evidence: evidence/temporal-engine-domains.json.
- Separate sla-ticket-workflow.integration.test.ts failed four cases during bundling because workflowsPath pointed to src without an entry module. Local uncommitted repair points its three worker constructions to ../sla-ticket-workflow.ts.
- Rerun session 58160 remains live, log /tmp/alga-temporal-sla-transitions-after-82cc.log. It reached the lifecycle workflow and appears to wait on responseNotification without enabling virtual time skipping. Investigate after terminal confirmation; do not restart while live. Suspect its Date.now-based deadline mock also needs the workflow-supplied clock after time skips. This suite is not included in the passing engine count.

### 2026-09-07 — SLA integration timing repairs remain under test

- Session 58160 ended: one pass, three failures (missing expected 100% notification, lifecycle timeout without virtual-time advancement, restart query before deadline initialization).
- Local uncommitted changes preserve all cases: direct SLA workflow bundle, deadline mock based on workflow currentTime plus pause, explicit virtual sleeps, polling for initialized/phase state, include supported 100% breach notification. First rerun session 36368 ended two passes/two failures: lifecycle reached resolution breach before completion signal, restart timed out.
- Adjusted lifecycle resolution target to ten minutes and advance three minutes to its warning; explicitly advance eleven virtual minutes after restart. Current session 25564 remains live, log /tmp/alga-temporal-sla-clock-final-82cc.log; reached restarted worker but no final outcome yet. Do not restart before terminal confirmation. Next investigation if still timing out: sticky task routing/cache around worker shutdown, while preserving actual cold-worker replay coverage.
- This suite is still excluded from claimed passing engine count and has not been added to mandatory engine selection. Changes remain uncommitted pending meaningful verification.

### 2026-09-07 — SLA cold replay repaired and required

- Session 25564 ended three passes / one restart timeout. The following cold-replay attempt is terminal: four cases passed in 2.58 seconds. Disabling workflow caching on both restart-test workers resolved that test-environment stall; this does not establish a production SDK defect.
- Retained all four behavioral cases, corrected workflow entry paths and virtual-clock fixtures, and strengthened restart verification to require exactly [50, 75, 90, 100] notifications after a fresh worker resumes the same workflow.
- Added SLA integration to engine config and independent candidate discovery. Exact runner session 71496 exited zero: six files / 29 tests, no skips or missing cases, 10.41 seconds. Evidence: evidence/temporal-engine-sla-replay.json.
- PR 3343 checks still show browser CE/EE, server unit coverage and full integration pending. Known Nx billing failure has a local committed fix; native verification and publication of the current batch remain pending. Full plan is not complete.

### 2026-09-07 — Provider credential behavior becomes required

- Audited unassigned Temporal candidates and selected two existing behavioral suites: Gmail adapter log hygiene (one case), Microsoft profile filesystem credentials (three cases: dummy secret resolution, missing-secret failure, polling delegation). No source-string tests or production changes added.
- First local run ended two passes/two failures because sandbox denied the tsx subprocess IPC socket. Authorized rerun passed all four; only test-generated temporary dummy secrets were accessed.
- Added both suites to readiness config and independent inventory selection. Exact runner session 4808 exited zero: 25 files / 188 tests, zero skips/missing identities, 3.65 seconds. Evidence: evidence/temporal-provider-secret-readiness.json. Native CI remains pending.
- Current PR checks confirm both browser jobs, full integration and server coverage remain in progress; preserve browser run 34104450316 until terminal before publishing queued commits.

### 2026-09-07 — Native browser results isolate invoice fixture failure

- Downloaded run 34104450316 browser artifacts 10013109152 (CE) and 10013131758 (EE). Reports: CE 22 pass / one fail, EE 24 pass / one fail; zero skips or flaky results. Both fail the invoice ticket-ownership fixture at its dynamic server billing import with Cannot use import statement outside a module. API steps remain running, so preserve current run.
- Shared source fixture now accepts materializeServicePeriods:false while keeping its default real synchronizer for existing DB tests. New standalone browser fixture explicitly seeds the August arrears periods due in September, following existing recurring-billing fixture behavior. Invoice generation, four snapshot links, subtotal, foreign-tenant rejection and PDF assertions remain intact.
- Temporary standalone Playwright DB check executed fixture against owned invoice_citus_82cc and rolled back. Both hourly/usage periods and four source entries verified. Initial temporary check incorrectly stringified a PostgreSQL Date; corrected to ISO and passed. Temporary diagnostic spec moved to /tmp, not added to CI.
- Full repaired browser journey requires native rerun. Evidence: evidence/browser-invoice-fixture-boundary.json.

### 2026-09-07 — Accounting browser acceptance verified natively

- Independently reconciled raw Playwright collection/results from enterprise artifact 10013131758, run 34104450316, merge revision 7c52ed7d53ade3306f2ec7fae2971bd5868efaf2. Full counts reproduce 24 pass / one failed invoice fixture / zero missing/skipped/flaky.
- QBO and Xero each passed on the first attempt (32.991s and 29.135s). Inspected test bodies against R6: real OAuth and UI mapping, export batch, vendor invoice readback, selected realm/organisation identity, injected 500, expired token refresh, successful recovery and no duplicate invoice. QBO also verifies external edit/CDC drift and stale SyncToken re-export recovery.
- Marked F033/F035 and T027/T029 implemented with evidence/accounting-native-browser.json. Xero selection follows its supported first-connected-organisation behavior, explicitly documented in the evidence. No claim of a separate Alga organisation picker or live-provider parity. F036 aggregate enforcement/fault-matrix and full browser green remain incomplete.

### 2026-09-07 — Queued repairs published and inventory refreshed

- Prior browser run 34104450316 is terminal. Both API execution/reconciliation steps succeeded; browser failure remains invoice fixture only. Published all queued commits through 9180b2a9c85aa46a26f6151c1d7053acd73ccaf6 and verified PR head. New browser run 34109001526, Temporal 34109001598, unit 34109001912, integration 34109001846 are live.
- Refreshed partial repository inventory using native browser/mobile plus fresh Temporal runner collections: 3944 candidates, 110 unmatched. No blanket exclusions introduced. Evidence: evidence/remaining-inventory.json. This mixes revisions and proves remaining assignment gaps, not aggregate readiness.
- Temporary Playwright fixture diagnostic had cleared root test-results; fresh Temporal list commands recovered collections into /tmp. Earlier execution summaries remain committed; native rerun will provide retained raw artifacts.

### 2026-09-07 — Product upgrade CLI is a required behavioral gate

- Existing four CLI cases execute the actual child process and verify refusal of conflicting modes, missing explicit mode and malformed tenant UUID, plus help without DB access. Focused run passed four cases; added the file to readiness include and independent discovery.
- Exact readiness runner session 55615 exited zero: 26 files / 192 tests with zero skips/missing identities. Evidence: evidence/temporal-upgrade-cli-readiness.json. Native verification pending next publication.
- Corrected prior inventory wording: 110 files were unmatched in mixed-revision collection artifacts, not necessarily unassigned in current code. The i18n baseline already matches current Node tooling selection; current CI artifacts must close stale collection gaps before claiming remaining ownership counts.

### 2026-09-07 — Explicit DB configuration precedence repaired

- Attempted previously unassigned product-upgrade-operations.integration.test.ts against owned invoice_citus_82cc. All ten cases failed before DB access because packages/db/src/lib/knexfile.ts manually overwrote explicit DB_NAME_SERVER from dotenv parsed values (server).
- Removed redundant overwrite; dotenv defaults now fill absent settings while respecting explicit environment variables. Added two behavioral configuration cases using a dotenv boundary double. Before: four failed/two passed; after: six passed. Existing connection expectations retained.
- Reran same real DB suite with explicit test credentials: all ten passed, 6.59 seconds. Covers PSA seed/RBAC/tax/SLA backfill idempotency, preserved roles/users, no-write preflight, guarded product flip, failed verification, and Stripe-failure withholding. No previous-release schema-upgrade claim.
- Evidence: evidence/explicit-db-precedence.json. Native verification and mandatory DB runner assignment remain outstanding.

### 2026-09-07 — Required database lane and native portal bundle repair

- Native engine job 101700596140 (run 34109001598) ended 26 pass / three portal-registration failures. Its broad workflow-index bundle required unrelated unbuilt workflow package exports. Three test workers now bundle registration.workflow.ts directly; all assertions retained. Exact engine runner passes six files / 29 cases in 10.48 seconds.
- Added temporal-database config, independent discovery and reconciled runner selection for product-upgrade-operations.integration.test.ts. Runner preserves explicit DB credentials for this lane and rejects missing explicit connection settings. Initial runner attempt exposed its default DB-less credential stripping; corrected lane behavior and exact rerun passes one file / ten cases in 6.55 seconds.
- Citus workflow now executes database lane against the migrated citus_runtime DB after workflow/invoice regressions, uploads evidence even on failure, and includes runner/seed/core dependency triggers. Native verification pending publication.
- Evidence: evidence/temporal-database-and-portal-gates.json.

### 2026-09-07 — Portal resource reconciliation harness restored

- Existing two cases failed because they depended on implicit service-host defaults and mocked the obsolete Kubernetes client path; current application uses Git/kubectl commands. Replaced obsolete transport mock with existing command-runner injection, explicit dummy Git/service configuration and temporary manifest files. No real Git or Kubernetes effects.
- Preserved routing and stale-resource deletion assertions. New harness parses the actual multidocument YAML passed to apply, simulates stale manifest deletion and checks generated VirtualService host. Added admin retry boundary double used by current implementation. No production changes.
- Focused cases pass; exact readiness runner session 86809 passes 27 files / 194 cases, zero skipped/missing, 9.21 seconds. Added file to readiness config and independent discovery. Evidence: evidence/portal-resource-reconciliation.json. Certificate issuance itself remains outside these simulated command checks.

### 2026-09-07 — Standalone email async assertions restored

- Existing standalone email suite: initial run two failed/six passed. Password assertions were inspecting Promises, and the uniqueness case falsely passed by comparing Promise identities. Awaited actual generated passwords, retaining all content/length/uniqueness checks and all email cases.
- Added suite to readiness selection and independent discovery. Exact runner session 49374 exited zero: 28 files / 202 tests, zero missing/skipped, 9.04 seconds. Evidence: evidence/email-standalone-readiness.json. No production changes.
- Current published head remains 9180b2a9c8. Browser image build jobs 101701349398/101701349408 still live; known native engine failure is repaired in queued commit 9ed8b450a3.

### 2026-09-07 — Direct email context tests restored

- Existing email-activities.temporal.test.ts failed ten/eleven cases: obsolete Context.logger mock and unresolved password Promises. Its only passing randomness case compared Promise objects. Corrected Context.log and awaited values, preserving all eleven cases.
- Removed unused ephemeral Temporal environment: no workflow or activity execution was routed through it. Renamed describe to Context Behavior and assigned the file to fast readiness with independent discovery. No engine-coverage claim.
- Exact readiness runner session 61873 exited zero: 29 files / 213 tests, zero missing/skipped, 10.00 seconds. Evidence: evidence/email-context-readiness.json. Native publication/verification pending.

### 2026-09-07 — Database runner fails closed before execution

- Verified actual temporal-database runner with missing connection settings: exits one and records explicit configuration failure. Added scripts/tests/temporal-database-runner.test.mjs, automatically selected by Node tooling inventory.
- Behavioral test copies the runner/libs into a temporary Git repository, removes each of five mandatory settings in turn, seeds stale passed evidence and verifies nonzero exit, failed replacement evidence and cleared raw results. All five scenarios pass; no network/database access or source-string assertion.
- Remaining legacy tenant-activities.test.ts is not promoted: it directly calls activities without context, expects obsolete setup roles/statuses and includes an empty connection-failure case. Requires substantive behavioral repair rather than counting nominal cases.

### 2026-09-07 — Tenant setup retry no longer loses remaining work

- Added real Citus regression using MockActivityEnvironment: initial setup, remove tenant_settings to represent incomplete setup, repeat with existing email settings, verify missing settings are recreated and original email settings preserved. Before fix second setup returned empty steps and failed recovery assertion.
- Each of four optional setup groups now executes in a nested transaction/savepoint. Caught duplicate SQL errors roll back that group without leaving the parent transaction aborted. No broad conflict suppression or changed defaults. Updated existing email-settings mock to support savepoints.
- Required temporal-database runner passes two files / 11 tests; readiness passes 29 files / 213 tests. Evidence: evidence/tenant-setup-savepoint-recovery.json. Initial harness attempts needed activity context and current result shape; one incomplete synthetic tenant from that attempt was explicitly removed (one fixture). Subsequent fixture cleanup completed.
- Native verification remains pending.

### 2026-09-07 — Setup recovery preserves completed onboarding

- Strengthened the new real-DB regression with a third setup invocation after onboarding_completed becomes true. Entire tenant_settings row and email settings must remain unchanged; cleanup must actually remove the tenant, not merely return from rollback.
- Exact temporal-database runner session 77177 exited zero: two files / 11 cases, 7.17 seconds, no skips/missing cases. Evidence: evidence/tenant-setup-preservation.json.
- Current browser run 34109001526 has CE job 101707718598 and EE job 101707718632 in progress. Preserve them until terminal; known engine failure has a queued repair.

### 2026-09-07 — Expanded gates follow dependency changes

- Audited path filters after growing Temporal and Citus coverage. Temporal paths omitted core/db/email/SLA and shared email changes; Citus omitted billing/email package changes despite executing invoice and tenant setup behavior.
- Both workflows now select packages/**, ee/packages/**, shared/**, EE onboarding seeds and all shared runner libraries. Kept existing migration, workflow, manifest and harness triggers. This deliberately widens execution when package dependencies change.
- Parsed actual workflow YAML and exercised both pull_request/push glob selectors against seven representative dependency paths plus unrelated docs: all 28 dependency selections pass and unrelated docs remain unselected. No source-string test added.
- Native browser jobs remain active; queued commits are not yet published.

### 2026-09-07 — Browser readiness rejects unverified source state

- browserTestMetrics previously checked revision and raw execution but could project passed from an evidence manifest marked dirty or lacking before/after source provenance. New behavioral case reproduced actual passed vs expected failed.
- Metrics now require explicit clean before/after revisions, empty change lists and workingTreeDirty:false. Missing/dirty/changed provenance records a failure without copying source file details or secret payloads to metrics. Existing versioned columns unchanged.
- Browser metrics and Sheets projection tests: nine passed. Covers five source-evidence mutations in addition to missing execution/retries/edition/column behavior. Native verification remains pending; full F024/F025 not claimed complete.

### 2026-09-07 — Browser command aligns with source-evidence readiness

- Reprojected prior native CE/EE raw artifacts through updated metrics: retains 22/24 passed and one failed invoice fixture respectively, no source failures (both native checkouts clean).
- Found companion gap: browser run.mjs recorded workingTreeDirty but still exited zero for otherwise passing reports. New command-level test uses a temporary Git checkout and simulated Playwright report producer to exercise clean, already-dirty and changed-during-execution states. Before fix dirty command incorrectly exited zero.
- Browser gate now fails dirty before/after source. All ten browser runner/metrics/Sheets tests pass; test asserts raw passing case count remains one while dirty command is rejected. No customer/browser behavior replaced by the protocol fixture.
- Native browser job 101707718632 remains live (credentials setup observed); preserve run pending completion.

### 2026-09-07 — Independent combined Temporal execution gate

- Extracted the existing workspace evaluator into reusable evaluateExecutionGate while preserving workspace requirements and its complete test suite. New Temporal adapter fixes two required suites/jobs in code.
- Added verify-temporal-execution.mjs and always-evaluated (non-scheduled) Temporal execution gate job. Downloads named readiness/engine artifacts, independently recomputes raw execution and inventory for the checked-out candidate, rejects missing/dirty/stale/filtered reports and unsuccessful prerequisites, and uploads aggregate evidence even on failure.
- Ten gate tests pass: eight existing workspace tests plus two Temporal tests covering passing bundles and seven failure mutations. Native verification pending. This is the Temporal aggregate only; F007 global aggregate remains incomplete.

### 2026-09-07 — Temporal aggregate CLI artifact contract verified

- Added command-level coverage in a temporary clean Git checkout with tracked Temporal candidates and independently generated raw collection/results. Valid readiness/engine artifact names produce passed aggregate; wrong GITHUB_SHA, malformed needs JSON, corrupt results and missing results exit one and persist failed aggregate evidence.
- All three Temporal gate tests pass, including evaluator mutation coverage. This verifies actual CLI file loading and output persistence beyond the evaluator seam; no external network or app writes.
- Native browser CE/EE remain active on published head; queued changes await their terminal results.

### 2026-09-07 — Scheduled Temporal behavioral execution

- Removed schedule exclusions from both Temporal behavioral lanes and their always-evaluated aggregate. Nightly execution now runs readiness, engine tests and reconciliation alongside existing Docker parity; a scheduled run can no longer omit both behavioral lanes by design.
- Readiness artifact upload now errors when evidence files are absent, matching engine evidence handling.
- Validation: actionlint passes; all 11 Temporal/workspace aggregate behavioral and CLI tests pass. Native scheduled execution remains unverified until publication.

### 2026-09-07 — Published 9180 browser failure isolated

- Downloaded native run 34109001526 browser artifacts to /tmp/alga-browser-34109001526. Community: 22 passed, one unexpected; enterprise: 24 passed, one unexpected; zero skipped/flaky in both raw reports. Both attempts fail invoice-ticket-ownership.spec.ts:57: subtotal expected 87500, received 82500. Earlier generation, four snapshot links and authenticated foreign-tenant checks pass. PDF assertions remain unreached for this case.
- Difference equals the fixture usage charge (5000); root cause remains unproven. Inspect seeded service periods versus production materialization and selector execution before changing expected totals. Existing source fixture seeds one August usage record and separate hourly/usage obligations.
- Browser jobs still executing API checks when inspected; do not publish queued commits until run terminal. Other native jobs need fresh inspection. Full plan remains incomplete.

### 2026-09-07 — Invoice ownership browser expectation matches selected obligation

- Root cause established from API InvoiceService.generateInvoice → generateInvoiceForSelectionInput → normalized single selector → scopeRecurringTimingSelectionsForSelectorInputs: the request selects only the hourly obligation. Native subtotal 82500 correctly equals four regular hours at 15000 plus one overtime hour at 22500; the usage obligation is not selected. The 87500 assertion had been copied from whole-cycle generation.
- Corrected browser subtotal to 82500 and added runtime assertions that all generated charges reference the hourly service, the one usage record remains uninvoiced, and its recurring period remains generated/unclaimed. Retained four snapshot links, tenant isolation, private-text exclusion and actual downloaded PDF checks. Whole-cycle immutable invoice regression still requires subtotal 87500 and tax 8750.
- Standalone Playwright collection validates the edited spec. Native execution of new assertions and previously unreached PDF assertions remains required; no full-pass claim.

### 2026-09-07 — Calendar permission and throttling recovery candidates

- Expanded the existing enterprise calendar OAuth/browser round-trip into three isolated cases: persistent HTTP 503 outage, 403 ErrorAccessDenied and 429 TooManyRequests during PATCH. Each retains real login/OAuth, UI creation/deletion, callback ingestion, local edit and visible provider error, disarm/retry with expired stored token, stable local/remote mapping, callback update and deletion.
- Added explicit successful PATCH request evidence after recovery and fault classification to the identity attachment. The 429 case checks failure/recovery semantics, not Retry-After timing (operation-fault does not expose response headers); Teams/SSO remain separate unresolved coverage.
- Enterprise Playwright collection finds all three cases. Full browser execution is pending publication; F034/F036 remain false. Current published browser run still has both API stages live, so queued changes are preserved locally.

### 2026-09-07 — Repository inventory requires runner artifacts

- Found verify-test-inventory accepted inline files when collectionFile was absent, permitting a manifest to claim collection without loading any runner artifact. Added a CLI regression to the actual Vitest collection test; before fix it incorrectly returned passed.
- CLI now requires a nonblank collectionFile on every runner descriptor. Existing reader still rejects simultaneous inline/artifact data, missing files and invalid source roots. The reusable reconcileDiscovery evaluator remains available for already-loaded runtime collections.
- All 21 discovery, actual Vitest/Node execution and Playwright evidence tests pass after repair. F004 remains incomplete until all repository candidates are assigned and the full registry runs in native CI.
- Browser step budget is 25 minutes versus approximately eight minutes for the last enterprise execution; no speculative timeout increase. Current browser run 34109001526 remains active, so queued commits are not yet published.

### 2026-09-07 — Redis blocking publish latency reproduced

- Native API client reactivation: community timed out at20s; enterprise passed10.637s. Several native client/project cases cluster near5s multiples. Code inspection found event-bus blocking XREADGROUP shares getClient with writes.
- Owned Redis transport reproduction uses unique temporary stream/group and cleanup: BLOCK2000, publish after100ms. Shared connection publication took1929ms; redis4 commandOptions({isolated:true}) publication took1ms. Evidence: evidence/redis-blocking-publish-latency.json.
- This establishes the transport hazard, not direct causality for the CI case. Next add actual event-bus behavioral regression and isolate blocking reads with shutdown/recovery validation. No timeout relaxation or production change made yet. Published a02bfb4136 browser run34113539423 is active.

### 2026-09-07 — Event-bus read isolation fixes reproducible publication stall

- Permanent infrastructure regression initially hit unit Redis alias; corrected invocation to REAL_REDIS=1. First blocked-client observation was too broad and saw other local consumers; restricted to newly created bus connections. Correct before-fix assertion then failed at4999.76ms publication against a2000ms bound.
- EventBus now leases a Redis isolation-pool connection for blocking reads and tracks it for explicit interruption before hard-timeout reset or close. Writes retain the command connection. Existing pending/poison/hard-timeout doubles implement the lease callback.
- Real regression passes publication/delivery, actively blocked close under2s, and recreation/repeated delivery (2.45s total). Calendar/search real Redis regression also passes; four existing timeout/pending/poison tests pass; package tsc --noEmit passes. Synthetic prefix keys and processed markers cleaned.
- New file is independently discovered by the infrastructure runner; CI config already supplies REAL_REDIS=1. Native verification and exact causality of earlier API timeout remain pending. Preserve current browser run before publishing this follow-up.

### 2026-09-07 — Native Temporal database collection repaired

- Published a02bfb4136 Citus job101714987332 failed collecting the new Temporal database lane: @alga-psa/email/providerConfig resolves to unbuilt dist in clean CI. Prior Citus runtime lane passed all8 workflow/invoice tests.
- Added exact providerConfig source alias to the shared Temporal Vitest config, consistent with existing workspace aliases. Real provider defaults remain executed, not mocked. All11 database tests pass against owned invoice_citus_82cc (7.33s). Native verification pending.
- Published Temporal run34113539264: engine job101714986881, readiness101714987097 and aggregate101715882515 all completed success. Docker parity legitimately skipped on PR. Native browser run34113539423 still builds CE/EE images. Keep local bus fix and alias follow-up queued until browser run terminal.

### 2026-09-07 — Isolated reader timeout recovery verified

- Strengthened existing hard-timeout regression with a distinct leased reader whose pending read rejects on disconnect. Parent reset checks all leased readers are closed; final assertions require reader interruption, replacement parent and closed leases after bus shutdown.
- Updated test passes (0.853s). Temporarily removed only stopBlockingRead from hard-timeout recovery; regression fails because reader is never disconnected. Production code restored in finally; diff confirms no mutation retained. This supplements prior real-Redis publication/blocked-close/recreation tests.
- Browser run34113539423 remains active; local follow-up commits remain queued. Full plan still incomplete.

### 2026-09-07 — Worker queue ownership assigned to readiness

- Added existing orphan worker-queue-ownership.test.ts to readiness config and independent selector: two runtime configuration cases check default queues and rejection of the authored runtime queue; its pre-existing source packaging guard is retained, not new behavioral coverage.
- Deleted test-file-check.test.ts: it allocated an empty temporary directory, printed a nonexistent file path and performed no assertion or application call. No behavior coverage was removed or replaced with a passing exclusion.
- Full readiness execution:30files,216passed,zero skipped (9.55s). Direct diagnostic commands initially lacked bootstrap bypass, then used root Vitest4 instead of the runner's server Vitest3; final run matches server binary and TEMPORAL_TEST_SKIP_ENV_BOOTSTRAP=1. Two subprocess tests required local IPC outside sandbox; authorized execution passed without changing their assertions.
- Global repository inventory remains incomplete; the earlier mixed-revision orphan list is not a current count. Native verification pending publication after current browser run.

### 2026-09-07 — Xero emulator OAuth client binding

- Wire regression reproduced authorization code accepted for different client (200 instead of400). Codes now require original client and exact redirect; refresh tokens retain and require client identity. Invalid attempts leave valid grants usable. Token route resolves HTTP Basic credentials and rejects conflicting header/body client IDs.
- Existing expiry fixture had refreshed without a client; now supplies client identity exposed in control token diagnostics. Full9wiretests pass and package typecheck passes. Basic secret values remain unverified; application registration, PKCE and organisation consent still outstanding. No F037 completion claim.
- Official standard-flow reference and before/after details: evidence/xero-oauth-client-binding.json. Native verification remains pending; preserve active browser run.

### 2026-09-07 — Xero S256 verifier enforcement

- Wire regression initially accepted invalid challenge method (302 vs400). Authorization now validates supplied S256 challenge; exchange requires43–128character verifier with matching SHA256 base64url before consuming code. Wrong/missing verifiers preserve the grant, and a successful exchange consumes it.
- All10Xero wire tests and package typecheck pass. Application registry/secret validation remain outstanding, so absence of PKCE cannot yet be checked against registered application type. F037 remains incomplete. Evidence: evidence/xero-pkce-verification.json.
- Published browser run34113539423 now executes jobs101721277526(EE) and101721277537(CE); preserve active run before publishing follow-ups.

### 2026-09-07 — Registered Xero applications close credential gap

- Added explicit application seeder (confidential secret or public PKCE, exact redirect URIs). Unknown applications, wrong callback and unsupported response type reject authorization. Confidential code/refresh exchange validates secret; registered PKCE type requires challenge even when request omits all PKCE fields. Reset clears registrations and tokens. Seeder response excludes secret.
- Wrong-secret wire regression reproduced200vs401 before repair. Full11wiretests now pass, including wrong refresh secret preserving valid token and reset cleanup; package typecheck passes. Browser Xero fixture seeds synthetic application and still collects. README documents mandatory fixture setup.
- Prior PKCE/client-binding evidence limitations about missing registration are superseded by evidence/xero-application-registration.json; per-client organisation consent, live drift and native browser verification remain outstanding. F037 not complete.

### Xero application organisation consent (2026-09-07)

Closed the emulator gap where all seeded organisations were accessible to every
application. Access tokens now retain client identity; connections and accounting
routes require explicit consent set by a control action. Added wire regressions
for denied reads/writes without side effects, atomic invalid changes, independent
application grants, revocation, and restoration. The first regression failed
before the fix because an unconsented organisation appeared in /connections.
All 13 wire tests and emulator typecheck pass; enterprise browser collection
passes with explicit fixture consent. Evidence: `evidence/xero-organisation-consent.json`.
This supersedes the consent limitation in earlier Xero evidence; real-provider
parity and native execution of the updated fixture remain outstanding (F037 open).
Browser run 34113539423 remains live in both editions, executing Playwright;
queued commits remain local to avoid cancelling it.

### Tenant activity database suite (2026-09-07)

Repaired the previously unassigned tenant-activities suite. It now invokes real
activities in MockActivityEnvironment against migrated Citus and covers optional
client naming/fallbacks, normalized email, duplicate display names, setup retry,
rollback isolation, rejected-write atomicity and blank-name validation. Removed
an empty database failure placeholder and obsolete expectations that setup creates
roles/statuses (onboarding seeds own those). The restored empty-name regression
exposed a persisted blank tenant; createTenantInDB now raises non-retryable
ValidationError before writing. Failed client writes use PostgreSQL's rejected
NUL byte to exercise transaction rollback rather than a guessed length limit.

All 20 DB cases across 3 files passed; 216 readiness cases across 30 files and
6 discovery checks passed. Runner configuration and independent selector include
the repaired suite. The earlier providerConfig alias also passed the exact runner
at f0a6f2c243 (11 DB cases before this suite was added). Native browser run
34113539423 remains active; community reached API dependency installation while
enterprise was still executing Playwright. No queued commits pushed yet.
Evidence: `evidence/tenant-activity-database.json`. Full inventory and native
candidate verification remain open.

### Native browser success and real admin-user coverage (2026-09-07)

Downloaded both browser execution reports from run 34113539423. Community passed
23 journeys and enterprise passed 27, with zero skipped/unexpected/flaky results.
Both used merge revision a3183ff88b0dae6ad4601e025c19a363f60e99e6 for PR head a02.
This includes the repaired invoice snapshot/PDF boundary and expanded calendar
fault scenarios. API validation remains live; this is not full-run green evidence.
Report hashes and counts: `evidence/browser-native-a02.json`.

Replaced user-activities-simple's copied DB operations with the shipped activities
against migrated Citus. Five cases cover usable generated/supplied passwords,
MSP versus portal roles, duplicate internal email across tenants, missing-role
transaction rollback and tenant-isolated cleanup. The fixture supplies its own
synthetic encryption key and restores environment. Client account-manager behavior
from the old copied helper is not implemented by the shipped activity and is not
claimed covered. Assigned suite to temporal-database and independent discovery.
All 25 DB cases across four files passed. Removing the MSP/client role predicates
made the missing-MSP-role case fail with incorrect successful account creation;
source restored. Evidence: `evidence/user-activity-database.json`.

### Packaged permission catalog and duplicate tenant test cleanup (2026-09-07)

Assigned permission-catalog-packaging.test.ts to readiness and its independent
selector. Strengthened its copied-runtime exercise to compile real role grants:
Technician gets only the product-scoped MSP ticket grant, portal User gets none,
and MSP Admin retains its all-MSP marker. Existing Dockerfile guards remain;
no new source-string guards added. All 219 tests across 31 readiness files pass.

Removed tenant-activities-simple.test.ts, which tested another copied tenant
implementation. Its meaningful create/setup cases are superseded by real activity
DB tests landed at 56ce1cc085. Its alleged validation test merely accepted invalid
email in the copied helper; it was not a production validation test. The obsolete
role/status setup expectations belong to onboarding seeds, covered separately in
product upgrade DB tests. Mapping: `evidence/temporal-catalog-inventory.json`.

The initial remaining-Temporal selector query was narrower than the whole CI
inventory: workflowInvocationPersistence.integration.test.ts already executes in
scripts/run-citus-runtime-tests.mjs and must not be counted as an uncovered test.
API CI was still running at the last authoritative inspection; no push yet.

### Native API results for a02 (2026-09-07)

Downloaded both API evidence artifacts from run 34113539423, merge revision
a3183ff88b0dae6ad4601e025c19a363f60e99e6. EE passed 335/335; CE passed334 and
failed1 with zero skipped. CE client-only reactivation timed out at20006ms;
EE's same case passed in15305ms. Both browser editions already passed (23CE/27EE).
The event-bus isolated reader fix is still queued locally and must be validated
on the next candidate; do not attribute this timeout conclusively to it yet.
Evidence: `evidence/api-native-a02.json`. At final inspection both edition jobs
had finished and fresh-install-e2e aggregate was queued; preserve run until terminal.

### Executable tenant deletion control flow (2026-09-07)

Added ten workflow behavior cases beside the existing source-only contracts.
All four triggers verify suspension ordering and final provider teardown; rollback
checks both resume failures, preserving completion and refusing tenant deletion;
legacy patch-disabled paths omit new calls. Activity and Temporal API doubles
exercise the shipped control flow without a server. This does not prove engine
history replay compatibility or provider side effects. Assigned to readiness and
independent discovery; all229 cases across32 files pass. Removing background
suspension produces four intended ordering failures, and production source was
restored. Evidence: `evidence/tenant-deletion-control-flow.json`.

Published head remains d8cf156c73. CI had no reported failures on the last check;
new browser run34118119011 must not be cancelled by pushing this follow-up early.

### Product bootstrap engine regression (2026-09-07)

Extended the existing tenantCreationWorkflow appliance suite to execute both PSA
and AlgaDesk on the real ephemeral Temporal engine, record seed inputs/order, and
verify product identity reaches seed activity before admin creation. Added a
non-retryable seed-failure case that verifies no admin/setup/customer/email steps
and no destructive automatic tenant rollback. All four focused cases pass.
Omitting productCode from the seed input fails the AlgaDesk case; source restored.
Activity results remain synthetic; this is orchestration evidence, not DB seed
execution. Evidence: `evidence/product-bootstrap-engine.json`.

CI34118119105 remains active, running workflow/invoice Citus regressions. No early
PR failures reported at inspection. Follow-up remains local while published
candidate d8cf156c73 continues verification.

### Legacy event-bus fixture repair from native CI (2026-09-07)

Native additional-workspace run34118119064 job101729601177 failed four
server-colocated recovery assertions. Its logs show executeIsolated is missing
from legacy server Redis doubles. Package-level doubles were updated with the
transport change, but the separate legacy entry-point suites were not. Added the
method to all three legacy doubles; preserved all assertions and timeouts.
All four cases pass with the actual server-colocated config. These doubles do not
claim real transport isolation; the package/real-Redis regressions cover that.
Evidence: `evidence/legacy-event-bus-fixtures.json`.

Native Citus run34118119105 completed successfully. Downloaded artifacts show
25 Temporal DB cases and8 workflow/invoice runtime cases passed, zero skips,
at merge revision3072eefdf9ecd8ccd551e7dfaf8d595eb6b2908f for d8cf. This verifies
the providerConfig alias fix in native CI; topology/upgrade gaps remain.
Evidence: `evidence/citus-native-d8cf.json`.

Full server-colocated runner passed381 tests across76 files at11810e8d14 with
complete execution reconciliation and clean source. This includes the four
repaired legacy event-bus cases; native publication is still pending.

### Real Temporal KB import retry policy (2026-09-07)

Added three engine cases for genericJobWorkflow, supplementing source-only KB
wiring checks. Actual activity attempts verify KB stops at2, generic jobs at3,
and KB can recover on attempt2 with stable execution identity and returned totals.
Failure status cannot be mistaken for completed. Changing KB policy to3 caused
the intended attempt-count failure; production source restored. Focused3 pass.
Assigned new file to engine config and independent discovery. These activity
stubs do not establish article persistence or browser polling-budget behavior.
Evidence: `evidence/kb-import-engine-policy.json`.

Native workspace aggregate failure is downstream of the legacy Redis fixture
failure repaired at11810e8d14. Published browser builds remain active; follow-up
commits are intentionally local until the run is terminal.

### Refreshed repository collection gap audit (2026-09-07)

Re-ran verify-test-inventory with25 actual collection artifacts. Refreshed native
workspace34118119064, infrastructure34118118987 and Node34118119081 inputs,
local Temporal collections and native Citus; retained explicitly older inputs
where fresh full-run artifacts are unavailable. Carried the existing localization
manual exclusion from scripts/node-test-exclusions.json (not a new quarantine).
Result:3949 candidates,98 unmatched (76legacy Playwright,13Temporal,9other server),
plus the one documented localization exclusion. No non-unmatched verification
failures. This supersedes the110-file snapshot but remains mixed-revision discovery
only. F004 and global execution requirements remain open.

Evidence includes collection hashes and the exact unmatched list in
`evidence/remaining-inventory.json`. Next work should prioritize legacy browser
fixture migration, remaining server service tests and classification of source-only
Temporal contracts. The visual invoice suite currently writes a missing baseline
and passes, so it needs explicit update mode before becoming mandatory.

### Fail closed on missing invoice visual baselines (2026-09-07)

Replaced automatic baseline creation with a shared filesystem policy: missing
baseline fails and the suite retains the actual render as diagnostics. Explicit
local UPDATE_VISUAL_BASELINES=1 creates/replaces baselines; CI rejects update mode.
Four unit cases exercise filesystem outcomes using disposable bytes/directories;
all pass, covering absence, preservation, update and CI refusal. The invoice
visual suite collects with RUN_VISUAL=1 and a required DB TCP probe. Did not run
its destructive reset hook or compare actual rendered images, and no checked-in
PNGs changed. README documents review and update mode. Visual suite remains an
open mandatory-runner assignment. Evidence: `evidence/visual-baseline-policy.json`.

### 2026-09-07 — reviewed visual baseline and native fresh-install green

- Native run 34118119011 completed successfully for CE/EE browser and API lanes at merge revision 3072eefdf9ecd8ccd551e7dfaf8d595eb6b2908f (PR head d8cf156). Downloaded and inspected actual execution evidence; summary and SHA-256 hashes are in evidence/fresh-install-native-d8cf.json. This does not prove whole-PR readiness: workspace fixture failure is fixed locally, and unit/full integration were still running.
- Full invoice visual execution on owned disposable visual_regression_82cc_test initially exposed host dark color scheme and a missing by-ticket baseline. Explicit light print media restores all four existing baselines unchanged. Reviewed and added only the missing by-ticket no-ticket fallback PNG; this is not ticket-group coverage.
- Added exact 40000 subtotal / 3550 tax / 43550 total and 15000/25000 line assertions, since pixel tolerance misses small numeric changes. HTML diagnostics retained. Comparison-only rerun passed all five templates (1 test, 18.79 seconds), CI=1 and UPDATE_VISUAL_BASELINES=0; log /tmp/alga-visual-render-reviewed.log. Visual lane still requires a reproducible mandatory runner before it counts toward global inventory completion.

### 2026-09-07 — assign real server-rendered locale regression to API CI

- The existing serverRenderedLocale.e2e.test.ts had no mandatory collector despite testing the real Next HTTP boundary. Added it to vitest.api-e2e.config.ts and independent isAdditionalWorkspaceTest API discovery. Existing fresh-install CE/EE API execution and reconciliation now require these five cases.
- Public HTTP tests passed against the existing local app: 5 passed, zero skips (2.46 seconds; /tmp/alga-locale-http.log). Sandbox-only first attempt could not reach the app and correctly failed setup; approved network retry passed. No auth secrets, account creation, or DB mutation was needed.
- Discovery behavioral tests pass 7/7 (/tmp/alga-locale-discovery.log). Full native CI for this assignment remains pending; no global inventory completion claim. Preserve live published-revision full integration job 101729712868 and unit job 101729600848 until terminal before push.

### 2026-09-07 — require API fixture behavior and remove false pass

- Assigned existing utils/utilities.test.ts (14 cases) to the fresh-install API runner and independent discovery selector. Fixed stale env.locationId assertion to the fixture public addressId field. Replaced catch-any-request-error test with seeded contact GET/readback asserting success and identity, tenant, client, name and email. Native API collection now includes this suite.
- Collection passed; discovery behavior 7/7 passed. Thirteen fixture/database cases passed against this task-owned visual_regression_82cc_test database (3.27 seconds; /tmp/alga-utilities-db.log). The one HTTP contact readback was deliberately filtered locally because the running app uses a different database; this partial run is NOT full-suite evidence. Native CI must run all 14 with its owned matching app/database pair, no filter.
- Published unit job 101729600848 and integration job 101729712868 remained live on recheck; do not cancel solely because they are slow. Local follow-up commits remain queued for publication after terminal evidence.

### 2026-09-07 — collect workflow trigger validation and dispatch behavior

- Moved orphan server/src/test/e2e/workflowRuntimeV2.e2e.test.ts into integration/workflowRuntimeV2TriggerLaunch.integration.test.ts and added it to the Tier-1 floor. The six existing cases exercise real migrated DB/action behavior with mocked auth and Temporal dispatch; they are not real engine execution. Full/affected integration discovery now sees this suite, and the manifest requires it on Tier-1 runs.
- First full run: five passed, one failed because draft creation now rejects malformed time.wait configuration before publish. Updated that assertion to require the specific validation failure and zero persisted drafts, retaining valid-config publication. Rerun all six passed, zero skips, 17.61 seconds on task-owned visual_regression_82cc_test; /tmp/alga-workflow-trigger-integration-fixed.log. No production behavior weakened.
- Historical plan references preserve the old path as historical context; active runner path is the new integration filename. Native full-suite validation remains pending publication.

### 2026-09-07 — fix Microsoft denial callback credential logging

- Inspecting unassigned legacy OAuth tests exposed a production route issue: the Microsoft denial callback logged raw authorization code, signed state and provider error_description. Added a behavioral request test to the real DB-backed callback suite; it failed before the fix on the synthetic authorization-code log assertion (/tmp/alga-ms-oauth-log-before.log).
- Replaced those fields (including raw provider error) in this diagnostic with presence flags, preserving callback response and provider error persistence. Full callback suite passed 15/15 with zero skips (14.07 seconds; /tmp/alga-ms-oauth-log-fixed.log). Added the suite to the Tier-1 mandatory floor. This is scoped to the denial diagnostic, not a claim of complete callback/access-log hygiene.
- Latest native state: unit job 101729600848 became CANCELLED; integration job 101729712868 remained in progress. Retrieve terminal unit logs to diagnose cancellation before the next publication. Workspace failure remains locally repaired.

### 2026-09-07 — native unit timeout diagnosis

- Native unit job 101729600848 stopped at its 60-minute job limit while making progress, not on a failing assertion. Downloaded runner collection and progress artifact. Actual execution journal: 2544/2692 modules passed, 13843/14550 cases finished; next module queued at 12:44:11. Runtime began 12:13:10 after collection/import overhead. Raw log also includes earlier collection-time output, so do not use its 2734 pass lines as execution count. Hashed evidence: evidence/unit-native-d8cf-timeout.json. No full report/coverage exists; baseline remains incomplete.
- Increased only this full-coverage job limit to 90 minutes to accommodate measured collection + per-file worker isolation + coverage. Kept serial workers, full selection, progress reporter and all assertions. This does not prove completion; verify the next native run. Integration run remains live pending terminal evidence before publication.

### 2026-09-07 — reconcile full server unit identities

- Full unit workflow collected file/case identities but lacked a post-run comparison with execution. Added verify-server-unit-execution.mjs using the existing reconcileExecution implementation, an always-run workflow step with actual runner outcome, candidate SHA/clean checkout checks, and uploaded evidence.json. Missing/invalid reports fail explicitly; retries/skips cannot silently satisfy the inventory. This is lane-level enforcement, not global aggregate completion.
- Real temporary-artifact behavioral test covers passing report, cancellation/skipped/missing outcome, dirty/mismatched revision, missing collected case, pending assertion, absent report and persisted failure evidence. New test plus existing reconciliation tests pass 7/7 (/tmp/alga-server-unit-verifier.log); workflow YAML parsed and diff check passed. Initial fixture had a macOS /var symlink/nonexistent-path issue; creating its actual file identity corrected the fixture without changing production path validation.
- Native execution of this step awaits publication after the still-live integration run.

### 2026-09-07 — full tooling runner validates new unit verifier

- Exact scripts/run-node-tooling-tests.mjs selected 43 required files plus the existing explicit localization manual exclusion; complete run passed 475 cases, zero failures/cancellations/skips/todos in 117.32 seconds at clean revision 8b1c4dcdd4. Evidence summary/hash: evidence/node-tooling-local-8b1c.json; /tmp/alga-node-tooling-8b1c-network.log. New server-unit verifier test was included by actual Node runner discovery.
- Initial sandbox run finished with local listener EPERM failures; rerun after approval for local HTTP/TLS services passed with no code changes. This does not establish native CI or complete global inventory.

### 2026-09-07 — propagate unit execution completeness to metrics

- Connected the unit coverage metrics uploader to test-results/server-coverage/evidence.json via TEST_METRICS_EXECUTION. Existing row logic rejects missing/mismatched/failed evidence, marks the run partial and suppresses its pass percentage, while preserving existing sheet columns/history. This ensures the new CI reconciliation result also reaches the metrics view.
- Existing lifecycle and sheet-schema behavioral tests passed 18/18 (/tmp/alga-unit-metrics-wiring.log); workflow YAML parse and diff checks passed. No direct external sheet write was performed. Native uploader behavior remains to be verified on the next CI revision.

### 2026-09-07 — release baseline clarification and rule refresh

- GitHub latest release metadata: v1.5.0 published 2026-08-28. Asked the user asynchronously to identify the previous supported upgrade release and deployment target; latest tag alone does not resolve supported upgrade policy or authorize a guessed deployment target. Requirements F020–F023 remain open. Refreshed effective main rules via GitHub API without mutations; evidence/release-and-rule-refresh-sep7.json.
- Native integration job 101729712868 still live on recheck. Preserve its terminal evidence before pushing queued fixes; do not declare it stopped on elapsed time alone.

### 2026-09-07 — retain unit evidence when revision inspection fails

- Wrapped actual Git checkout inspection in the unit verification entry point. Missing checkout metadata now produces persisted failed execution evidence instead of throwing before the artifact writer. The lane still fails closed.
- Behavioral test uses a real temporary directory without Git metadata and verifies the saved failure; verifier/reconciliation tests pass 8/8 (/tmp/alga-unit-metadata-failure.log). No full tooling rerun claimed for this follow-up.

### 2026-09-07 — remove legacy email unavailable-service false passes

- Removed seven 404 early-success returns across legacy OAuth/webhook suites and the validation-token branch that accepted 404 as successful coverage. Required endpoints now fail assertions when unavailable; the OAuth request helper no longer synthesizes a mock 404 for connection refusal.
- Existing suites collected 13 cases after the edit (/tmp/alga-legacy-email-collection.json). This is collection only: service fixtures/CI assignment and stale OAuth/refresh expectations remain unresolved; do not count this as runtime passing evidence or close inventory requirements. No source-string regression tests were added.

### 2026-09-07 — fix persistent email fixture option loss

- PersistentE2ETestContext helper passed options to initialize even though E2ETestContext consumes options in its constructor. This discarded autoStartServices=false and caller overrides. Construct with optimizedOptions and use inherited no-argument initialize; remove the ineffective override.
- Two behavioral boundary tests invoke the actual helper with a substituted parent lifecycle (no Docker/DB side effects), checking defaults, overrides and initialization/health order. Both failed before the fix and pass after (/tmp/alga-persistent-context-before.log, /tmp/alga-persistent-context-fixed.log). Located under server unit testing so the full unit lane collects them.
- Legacy fixture still hardcodes database/server/Redis/mail ports and changes only test-process provider endpoints. This fix alone does not make legacy email suites isolated CI coverage; keep their assignment gap open.

### 2026-09-07 — reject unobserved legacy workflow processing

- DockerServiceManager.waitForWorkflowProcessing previously logged that timeout implied completion. It now throws when no processing is observed and bounds each HTTP health request by the remaining wait budget. This remains an aggregate worker-counter check; callers still need ticket/content assertions and it does not prove correlation to a specific event.
- Three controlled-polling behavioral tests cover healthy/no-progress timeout, unreachable worker timeout and observed-progress success. Before fix: two failed/one passed; after fix: all three passed. Combined unit testing directory passes 9/9 (/tmp/alga-email-wait-before.log, /tmp/alga-email-wait-fixed.log). No Docker services or database touched. Native execution awaits publication.

### 2026-09-07 — use current checkout for legacy email Docker commands

- Removed hardcoded /Users/robertisaacs/alga-psa from DockerServiceManager start/stop. All lifecycle/diagnostic commands use the module-derived worktree root as cwd and docker compose argument arrays via execFile; no shell interpolation. This fixes checkout targeting and Compose v2 command availability, but fixed container names/ports in the legacy compose file still prevent full parallel isolation.
- Command-boundary behavioral test captures actual manager calls for start/stop/logs/restart/status and expected cwd/arguments. It failed before the change; combined testing fixture suite now passes 10/10 (/tmp/alga-email-docker-before.log, /tmp/alga-email-docker-fixed.log). Child-process execution is substituted: no Docker service was started/stopped and this is not full service integration evidence.

### 2026-09-07 — fix timeout in the actual email scenario context

- Caller tracing showed legacy scenarios call E2ETestContext.waitForWorkflowProcessing, not DockerServiceManager.waitForWorkflowProcessing. The context also silently succeeded after timeout; changed that actual caller path to reject when ticket processing is unobserved.
- Direct context-method tests substitute DB query responses and service dependencies: no ticket now rejects, observed ticket still completes. Before: one failed/one passed; after: both pass; combined fixture tests 12/12 (/tmp/alga-ticket-wait-before.log, /tmp/alga-ticket-wait-fixed.log).
- Remaining semantic gap: the context looks for a ticket entered after wait start, rather than correlating the sent message. This can miss already-completed processing or accept unrelated same-tenant activity. Full legacy email CI assignment still requires replacing this with message-specific persisted outcomes; do not count polling tests as complete end-to-end coverage.

### 2026-09-07 — correlate scenario completion with sent message

- Both EmailTestHelpers scenario variants now remember sentEmail.messageId and wait for that exact normalized message ID in tenant/contact-scoped ticket email_metadata or reply comment metadata.email. They no longer use a ticket-created-after-wait-start heuristic, so already-completed processing is recognized and unrelated activity does not complete the scenario. Missing sends and read failures reject.
- Shared wait helper uses the existing scoped ticket/comment readers; no new production DB queries. Four behavioral cases cover completed-before-wait, delayed matching reply, unrelated events/missing send and read failure. Combined fixture suite 16/16 passed (/tmp/alga-email-message-outcome.log). These are controlled-reader tests, not real mail-service execution. Direct legacy context callers and unknown-contact retrieval semantics still need integration verification.

### 2026-09-07 — unknown-sender message lookup without contact joins

- Unknown-sender scenario now reads tenant-scoped tickets by the captured Message-ID (canonical and bracketed forms), avoiding the inner contact join that hid no-contact tickets. Its legacy E2E assertion now requires exactly one matching-title/tenant ticket rather than the vacuous length >= 0 and an unasserted cross-tenant task scan.
- Added migrated-PostgreSQL behavioral coverage with own/foreign tenants, a no-contact ticket, unrelated message and foreign same-ID ticket. Exact own ticket returned; missing ID yields none; no send rejects. Passed 1/1 in 14.84 seconds on task-owned visual_regression_82cc_test (/tmp/alga-email-message-db.log). Added this DB suite to Tier-1 floor. Full legacy SMTP/manual-fallback workflow execution remains unverified; this proves lookup/isolation only.

### 2026-09-07 — combined changed DB suite validation

- Ran Microsoft callback, workflow trigger dispatch and email message lookup suites together with per-file fork isolation/maxWorkers=1 on the owned disposable database. All 3 files / 22 cases passed, zero skips, 45.59 seconds. Evidence: evidence/local-db-followups-combined.json; /tmp/alga-combined-new-db-suites.log. This validates the changed suites together, not complete integration CI. Plan validator passes 37 features/31 test entries and git diff check is clean.

### 2026-09-07 — preserve explicitly isolated legacy email endpoints

- Isolated legacy email initialization now requires an explicit test database name, host, port and admin user, preserves caller-supplied service endpoints, and aligns DB_NAME_SERVER with the reset target TEST_DB_NAME. Removed the email settings fixture's earlier unconditional endpoint overrides.
- Behavioral initialization-boundary tests verify preserved settings and rejection before connecting when the isolated database name is missing. Combined fixture suite: 7 files / 18 cases passed in 1.28 seconds (/tmp/alga-isolated-email-env.log). Database initialization is substituted; fixed Compose ports and health URLs remain outstanding, so this is not full-stack isolation evidence.
- Rechecked native integration run 34118118987: job 101729712868 remains in_progress. Its result is not yet available; no replacement run was started.

### 2026-09-07 — candidate aggregate raw-report verifier

- Added candidate-execution-gate composition for independently supplied mandatory requirements and raw Vitest, Playwright and Node events. It checks candidate revision/source cleanliness, successful job outcome, complete unfiltered selection, collected/executed identities and tracked candidate inventory; duplicate/missing bundles, unsupported formats and malformed requirement containers fail closed.
- Five behavioral cases pass, including an actual child Node runner whose missing terminal pass events then fail the gate. Earlier combined run with existing Node and Temporal verifiers passed 15 cases before adding the final child-runner case (/tmp/alga-candidate-gate-tests.log).
- This is the aggregation library, not enforcement. F007 remains false: committed repository-wide requirement selection, cross-workflow artifact retrieval/source-path normalization, shard composition, global orphan resolution and the stable required CI check remain to be wired and verified. No GitHub protection changed.

### 2026-09-07 — capture unit source before collection

- Server unit CI now captures checkout revision and changes before collection, preserves that artifact, and rejects a dirty start. Its execution verifier requires clean matching before/after source records and emits the same source/selection fields needed by candidate aggregation.
- Eight focused unit-evidence/candidate-gate tests pass, including a real temporary Git checkout that records a clean revision and rejects/preserves an untracked change. Missing/stale/dirty before records fail verification. Native CI execution remains pending publication; the old active integration job still reports in_progress.

### 2026-09-07 — load aggregate runner artifacts across checkout roots

- Added raw artifact reader for Vitest, Playwright and Node reports, with explicit producer root, file mapping and externally supplied CI outcome. Candidate verifier normalizes report identities against that producer checkout before comparing independently selected repository candidates; unsuccessful producer verification remains a failure even if assertions appear green.
- Seven focused tests pass. Real downloaded d8cf community API artifacts reconcile 335 passing assertions, then correctly fail current inventory because locale and utilities suites were assigned after that native run. This is a deliberate mixed-revision compatibility/omission probe, not candidate readiness evidence.
- Native browser manifests lacked selection metadata. The full browser runner already forbids filtered arguments; it now records explicit full/unfiltered selection on execution evidence. Old browser artifacts remain insufficient for the new aggregate's selection requirement. CI artifact downloading, shard composition and the stable check remain unfinished; F007 stays false.

### 2026-09-07 — wire fresh-install aggregate to raw reports

- Replaced fresh-install's outcome-only shell gate with raw browser/API artifact verification for both editions. Required files come from the gate checkout; browser edition metadata must match. It independently recomputes change selection, checks build/collection/browser outcomes, preserves an aggregate decision, and requires complete artifacts on runtime changes. Documentation-only selection is explicit and still requires the existing successful browser no-op jobs.
- Added two file-artifact behavioral tests covering four successful lanes, uncollected new browser files, cancelled builds, missing enterprise API results and selection/no-op failures. Combined candidate/artifact/fresh-install tests passed 9/9 before adding edition metadata enforcement; the two fresh-install cases passed afterward. Native wiring has not run yet. This completes local wiring for the fresh-install aggregate only; repository-wide gate and protections remain open.

### 2026-09-07 — full tooling validation after aggregate wiring

- Complete tooling runner passed 486 cases across 46 required files, zero failures/skips/cancellations, 122.26 seconds on clean c704e97ad5. This includes newly added aggregate/artifact/source-capture tests and all existing tooling fixtures. Evidence: evidence/node-tooling-local-c704.json; /tmp/alga-node-tooling-c704.log.
- actionlint passed both edited workflows with shellcheck disabled. Native integration job 101729712868 remains in_progress as of 13:40 UTC; pending publication is intentionally preserving its terminal evidence. No full-plan completion claim.

### 2026-09-07 — preserved terminal full integration timeout

- Run 34118118987 / job 101729712868 reached terminal cancelled at 13:44 UTC after its 120-minute limit. Downloaded logs/artifacts to /tmp/alga-integration-terminal-d8cf and /tmp/alga-integration-terminal-d8cf.log before any push.
- Actual progress journal: 118/287 files completed and 794/2080 cases finished; final report and execution evidence are null. Last completed file clientTypeEnumMigration, next queued accounting/batchLifecycle. Evidence: evidence/integration-native-d8cf-timeout.json. This is incomplete execution, not green.
- Next required repair before publishing: isolated full-integration CI shards with combined file/assertion reconciliation. A modest timeout increase cannot fit this measured workload; do not weaken or exclude required tests. Tooling/fixture follow-ups remain locally committed pending this repair and publication.

### 2026-09-07 — isolated full integration shards

- Full integration now selects four independent CI jobs; each has its own PostgreSQL, Redis and SMTP services. Tier-1 uses one job. Runner validates the existing floor and selected inventory, deterministically partitions files, checks exact filtered collection, then collects assertions and executes only its partition. No required assertions were removed.
- New combined integration job verifies raw reports against evidence, all shard identities/revisions, the complete full-run repository inventory (or Tier-1 floor), and successful matrix outcome. Missing/cancelled/stale execution fails. Metrics now come from one combined report instead of per-shard partial rows; progress and raw reports are preserved in each shard artifact.
- Actual Vitest process fixture runs three shards, verifies all five fixture files once, and rejects stale/missing evidence. Combined shard tests 4/4 pass (5.63 seconds); actionlint passes after correcting YAML placement during editing. Native workload validation is required next; a passing fixture does not prove the 287-file native suite fits or passes.

### 2026-09-07 — integration aggregate rejects ambiguous evidence

- While external push approval remains pending, strengthened local integration aggregation: require explicit full/Tier-1 selection, reject extra shard directories, require empty source change lists and explicit unfiltered execution metadata.
- Extended the actual Vitest shard fixture to reject extra directories, cleared raw results behind a passing manifest and inconsistent source change records, then recover after restoring valid evidence. Four shard tests pass in 5.75 seconds; git diff check passes.
- Publication remains pending explicit approval after automatic review rejected the combined commit/push to origin. Verified origin URL is https://github.com/nine-minds/alga-psa.git; no push workaround was attempted.

### 2026-09-07 — preserve combined assertion inventory for metrics

- Found the combined integration evidence omitted expectedTests, which the existing metrics reader requires before presenting complete execution. Aggregate now carries expected/executed assertion identities from independently reverified raw reports.
- Actual three-shard Vitest fixture now feeds aggregate artifacts through testCounts: valid execution reports complete / five passing / 100%; extra shard evidence downgrades to partial with blank pass percentage. Fixture passes in 5.74 seconds. This validates local report projection only, with no Sheets writes or external publication.

### 2026-09-07 — assign Temporal deployment rendering tests

- Assigned existing temporal-worker-shared-tenant-secrets Helm behavioral suite to readiness config and independent discovery. CI installs Helm v3.17.3. Suite uses HELM_BIN or PATH and no longer silently skips when /snap/bin/helm is absent; missing tooling fails execution.
- Local real Helm renders passed all six cases (496ms total); deliberate HELM_BIN=/nonexistent/helm produced six failures, zero skips. Logs: /tmp/alga-temporal-helm-assignment.log, /tmp/alga-temporal-helm-missing.log. Initial direct invocation hit the shared Docker setup; corrected to the readiness lane's TEMPORAL_TEST_SKIP_ENV_BOOTSTRAP=1, requiring no service startup. Workflow actionlint and diff checks pass.
- Removes one prior runner assignment gap locally; native CI and remaining Temporal/browser orphans remain unverified. External push still awaits approval.

### 2026-09-07 — complete Temporal readiness validation

- Full readiness runner passed all 33 files / 235 assertions on clean f0ce18967d, with complete discovery/execution reconciliation and zero skips. Evidence: evidence/temporal-readiness-local-f0ce.json; /tmp/alga-temporal-readiness-f0ce-permitted.log. Duration 10.73 seconds.
- Initial sandbox attempt had two failures from tsx IPC listen EPERM, with 233 passing. Approved rerun of unchanged code passed; no weakening of those synthetic filesystem-provider tests. This verifies the Helm assignment alongside all current readiness cases, not outstanding connection/E2E orphans or native CI.

### 2026-09-07 — assign owned Temporal and database connection smoke

- Replaced fixed localhost Temporal connection with an owned TestWorkflowEnvironment and separate client, verifying a service request plus gRPC SERVING health and test-clock advancement. Cleanup is guaranteed after the suite/client. Assigned to the Temporal engine config and independent discovery.
- Relocated the existing SELECT 1 PostgreSQL smoke to the database lane's configured admin connection, removing hardcoded temporal credentials/port. Assigned database config and discovery; no application rows are modified.
- Owned Temporal 2/2 pass (634ms); configured task-owned PostgreSQL 1/1 pass. Logs /tmp/alga-owned-temporal-connection.log and /tmp/alga-temporal-db-connection.log. Initial additional nonempty-version expectation failed because the ephemeral server returns an empty version string; readiness now uses its real health status rather than version text. Full engine/database native execution remains pending publication approval.

### 2026-09-07 — validate complete engine/database lanes after connection assignment

- Complete Temporal engine runner passed eight files / 36 cases in 12.63 seconds, using owned ephemeral Temporal servers. Complete Temporal database runner passed five files / 26 cases in 10.80 seconds on the task-owned single-node Citus database workflow_citus_82cc. Both reconciled clean bf719bcbb1 with zero skips.
- Evidence: evidence/temporal-engine-database-local-bf719.json. Logs: /tmp/alga-temporal-engine-bf719.log and /tmp/alga-temporal-database-bf719.log. These establish complete current local lane execution, not native CI, a previous-supported-release upgrade, or remaining unassigned suites. Push authorization is still pending.

### 2026-09-07 — assign runtime role-grant catalog checks

- Assigned existing product-upgrade-role-grants.contract.test.ts to the Temporal readiness config and independent discovery. It loads the real CommonJS grant/catalog modules and checks default role exports, resolvable permission keys and retired permission absence; no source-string tests were introduced.
- All three existing cases pass through the configured Vitest runner (192ms), /tmp/alga-role-grants-assignment.log. No broader native or role-upgrade DB claim; this closes only its local runner assignment gap. Publication approval remains pending.

### 2026-09-07 — exercise production workflow index bundles

- Added an engine test that bundles both source production workflow indexes, starts workers on owned Temporal servers and executes readinessWorkflow and marketingFanoutWorkflow by registered name. It verifies echo identity, per-tenant activity calls and exact fan-out results. Assigned to engine config and independent discovery.
- Both cases pass in 1.80 seconds (/tmp/alga-production-index-engine.log). This catches bundle/export/dispatch problems missed by individual-workflow imports. Activity implementations are synthetic, so this does not prove production activity-index registration, built-image packaging or provider side effects. Existing unassigned registration/source-contract files are not silently removed or counted as covered.

### 2026-09-07 — assign remaining lightweight Temporal contract suites

- Audited eight unassigned lightweight suites. Seven source-contract suites passed 18 existing assertions; worker-registration initially failed during import. Aligned Vitest aliases with the worker's enterprise domain entry, workDate and EE db paths, and its real worker-side notification implementation (confirmed in built output). No production behavior changed and no replacement no-op was introduced.
- Assigned all eight existing suites to readiness config and independent discovery. Source-text checks remain supplemental rather than proof of customer outcomes; existing/new engine and database tests supply runtime coverage separately.
- Full readiness runner passes 42 files / 263 cases, zero skips, in 12.87 seconds (/tmp/alga-temporal-readiness-registration.log). This run included uncommitted harness changes, so its source metadata is dirty and cannot establish candidate readiness. Native publication remains awaiting approval.

### 2026-09-07 — refresh complete Temporal evidence and remaining discovery

- Clean fedfeffee8 readiness run passes 42 files / 263 assertions (13.65s); engine passes nine files / 38 assertions (13.82s), zero skips and complete execution reconciliation. Evidence: evidence/temporal-discovery-refresh-fedfe.json.
- Refreshed the mixed-revision repository inventory with actual current Temporal collections. Only two Temporal files remain unmatched: email-only.e2e.test.ts and tenant-creation-workflow.e2e.test.ts. Overall mixed-artifact unmatched count is 100, but other lanes' older artifacts omit newer assigned tests, so this is not a current-CI orphan count. Global discovery remains failed/incomplete. Report: /tmp/alga-inventory-after-temporal-result.json.
- No external publication attempted; push approval remains pending.

### 2026-09-07 — own the legacy email workflow environment and test actual timeout

- Legacy email workflow suite now owns a TestWorkflowEnvironment, native worker connection and unique task queue, with deterministic worker/environment teardown. Explicitly selects the existing mock email provider before imports, preserving its original mock-message assertions without risking live delivery. Assigned to the engine runner and independent discovery.
- Replaced the misleading timeout-success case with an injected real activity delay: verifies the activity started and the workflow failed with TimeoutFailure at its one-second execution deadline. Other password/validation/minimal/concurrency cases remain. Six cases pass in 3.73 seconds (/tmp/alga-email-owned-engine.log).
- This is workflow orchestration/mock-email coverage; it does not replace the built-container SMTP/MIME integration lane. Full engine execution with this assignment remains to be validated; tenant-creation-workflow.e2e.test.ts is still unassigned. External push remains awaiting approval.

### 2026-09-07 — stop swallowing tenant E2E assertion failures

- Removed the tenant-creation E2E catch that logged and ignored failed database reads/assertions. Tenant/client name and admin user/email checks now propagate failure. Cleanup errors also propagate while database destruction remains in finally. Removed the unused canned mock-database factory; it was not called by the suite.
- Real Vitest collection still discovers the existing single case (/tmp/alga-tenant-e2e-collection.json); no runtime execution is claimed. The suite still needs owned Temporal/native connection setup, configured database endpoints and reliable fixture cleanup before CI assignment. No source-string test was added to compensate for those missing E2E prerequisites.

### 2026-09-07 — execute tenant onboarding through owned Temporal and Citus fixtures

- Replaced fixed database and Temporal endpoints in the remaining tenant creation E2E with configured admin DB access, an owned time-skipping Temporal server, native worker connection, unique queue and preallocated synthetic tenant ID. The real workflow and activities create the tenant, default client, admin and role assignment. Assertions distinguish company/default-client names and verify the returned password against the persisted hash instead of the obsolete 12-character expectation.
- The fixture explicitly uses mock email delivery and a synthetic NEXTAUTH_SECRET. It requires TEMPORAL_TENANT_E2E_ISOLATED=true, removes onboarding seed records before basic rollback and verifies tenant removal. The two exact tenant IDs left by initial failed runs were removed from the task-owned database and verified absent. No existing app DB or authentication secrets were accessed.
- Assigned the E2E to the database config, independent discovery and isolated Citus CI step. Local full database lane passes six files / 27 tests (16.34s); full engine lane with the previously assigned email suite passes ten files / 44 tests (44.20s), zero skipped tests. Logs: /tmp/alga-temporal-database-with-tenant-e2e.log and /tmp/alga-temporal-engine-with-email.log. actionlint and seven discovery tooling tests pass.
- These are local working-tree validation results, not clean-candidate/native CI evidence. Mock email does not prove provider delivery; optional hosted customer tracking remains nonfatal when its management tenant is absent. Basic rollback does not remove all onboarding seeds, so this test supplies scoped fixture cleanup and does not claim general production tenant-deletion coverage. Full-plan completion and external publication remain pending.

### 2026-09-07 — independently enforce affected integration coverage

- The integration shard aggregate previously checked the fixed manifest floor and the shards' self-reported selection but could accept a passing report that omitted an affected suite. It now derives changes from the checkout/base revision and separately invokes Vitest file collection for the affected graph. Missing change history or an unavailable graph requires every integration candidate. Full runs retain independent repository inventory checks.
- The aggregate CI job now fetches history, receives the same base revision and REAL_REDIS alias setting as the runner, and installs locked dependencies for selected runs. Its timeout accommodates dependency installation. Full runs do not need this additional collection/install.
- Extended the real temporary-Git/Vitest runner test: changed an imported runtime dependency, supplied a valid passing floor-only report and verified rejection of the omitted affected suite; executed the affected union and verified acceptance. Missing base and missing collection tooling reject partial evidence. Existing missing/stale/duplicate/incomplete shard and metrics checks remain.
- Four focused behavioral tests pass in 11.31 seconds (/tmp/alga-independent-affected-gate-final.log); actionlint and diff checks pass. These local results close a verifier gap, not the global F006/F007 requirements or native CI publication requirement. Publication approval remains pending.

### 2026-09-07 — migrate portal dashboard redirect coverage into the production browser floor

- Replaced the unassigned legacy MSP-access redirect test's fabricated cookie/nonexistent identities with e2e-tests/tests/msp-access-redirects.spec.ts. It signs in using the production fixture's real portal credentials, asserts the exact session identity, verifies MSP→portal dashboard redirect without an auth/MSP loop, then checks greeting and identity after reload. Redirect/navigation diagnostics are attached even on failure. The legacy file is removed because this is its behavioral replacement.
- The existing production runner and independent candidate enumeration automatically include the migrated file for both editions. Real Playwright collection succeeds with 24 CE / 28 EE cases. A headed Chromium run against a separate disposable database and local production EE image passes the migrated case in 18.4 seconds, without retries or auth/app-init bypass. Initial local attempts exposed an incorrect image executable path and internal-network forwarding setup; neither was treated as a product failure or hidden with test retries.
- Temporary app/proxy containers and the newly created database were removed successfully. Evidence: evidence/portal-dashboard-redirect-local.json. Existing app accounts/secrets were not used. This moves one previously unassigned browser behavior into the mandatory production directory; it does not claim the remaining legacy inventory is resolved, CE execution passed, or current-candidate/native CI is green. Publication approval remains pending.

### 2026-09-07 — reconcile historical native after-fix evidence in the regression ledger

- Audited raw collection, results and clean before/after source metadata from native fresh-install run 34118119011. Reconciliation confirms 23 CE / 27 EE first-attempt passes with no skips/flaky/missing cases. Extracted the manual invoice case in both editions and all three EE Microsoft calendar fault/recovery cases, retaining raw report/collection hashes and exact titles.
- Fetched the exact historical tested merge commit 3072eefdf9ecd8ccd551e7dfaf8d595eb6b2908f for read-only verification. Its parents include PR head d8cf156c731bdfb9414ee6435152a676e0bcecf4; both referenced fix commits are ancestors, and the two relevant specs plus Finance fixture match the current checkout. No branch or remote was mutated.
- Updated three stale pending entries in regression-ledger.json with historical native-after evidence, preserving local before/fix evidence and explicit limits. The optional sales-order permission replay is still supported by focused component tests: the browser confirms the Finance manual flow but does not independently assert the absence of sales-order permissions. No claim was added for table-refresh or catalog-refresh races that the selected native cases do not deterministically reproduce.
- Evidence: evidence/regression-native-after-audit-d8cf.json. Production incident attribution and current-candidate CI remain unproven, so F029 remains open. Publication approval remains pending.

### 2026-09-07 — always emit the integration aggregate decision

- The integration aggregate inherited the selector's should_run condition, so selector failure could skip the aggregate instead of producing an explicit failure. The job now runs with always(), passes prerequisite outcomes/event to its verifier, and rejects failed, cancelled, missing or unexpectedly skipped change selection. Scheduled full runs explicitly permit their intentionally skipped selector.
- A skipped integration job is accepted only when an independent checkout diff proves documentation-only/identical revisions and full coverage was not requested. The saved verdict is not-applicable with the selection reason, never an empty passing suite. Missing base evidence or runtime changes still require execution. Verified no-op runs do not install runner dependencies, download nonexistent shards or emit misleading pass metrics.
- Extended the actual temporary-Git/Vitest behavioral test with a committed documentation-only change, failed/cancelled/missing selector outcomes, unjustified skipped execution, unavailable base and the scheduled-selector exception. Four focused tests pass in 11.34 seconds (/tmp/alga-integration-selector-gate-final.log); actionlint and diff checks pass. No implementation-text assertion was added.
- This fixes the integration lane's prerequisite verdict. Global aggregate coverage, effective GitHub protections and native publication remain open; no broad plan flags changed. Push approval remains pending.
