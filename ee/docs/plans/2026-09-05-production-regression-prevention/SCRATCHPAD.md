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
