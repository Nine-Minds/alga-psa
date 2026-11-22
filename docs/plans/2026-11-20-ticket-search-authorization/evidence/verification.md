# Search authorization repair verification

Governing specification: [PRD](../PRD.md). Tested implementation revision: `e3ad618d24d244e7e4161dfc7a1b7e67de75385e`.

## Mixed-search performance repair

Repair commit: `86abc71008a370b0765ac850fb8642ea48daa953`.

- The PostgreSQL mixed-search benchmark passed at the repair revision: two tests, including eight request scenarios (limit 5 and 100, first and subsequent pages, unrestricted and selected-client bundle-restricted internal users), a complete cursor walk, stale project index exclusion, and exact per-type totals. PostgreSQL 15.4; one warmup and five measured sequential requests per scenario.
- The same harness failed its candidate-growth assertion against baseline `bdca35983cc22c75f9b07ffd797aedc8463b2129`: 160 SQL statements at 150 project matches and 515 at 500. The repair measures 10 statements at both sizes. See [raw mixed-search performance evidence](benchmark.md#mixed-search-repair-round) for every timing and SQL sample plus reproduction commands.
- Search unit suites: six files, 79 tests passed (`searchAuthorizationRegression`, search actions, ACL, query, `runAppSearch`, API search controller).
- PostgreSQL authorization suite: `searchAuthorizationProduction.integration.test.ts`, five tests passed. This retains real UUID ticket/comment correlation, portal audience, cross-tenant comment, deleted/missing parent, unsupported ticket rule, and resolver-failure checks.
- PostgreSQL cursor suite: `searchRankingCursor.db.test.ts`, three tests passed, including delayed scan ranking and the 205-row 100/100/5 public cursor traversal.
- Seven-read authorization regressions: ticket record authorization, Bento actions and sibling ticket actions; three files, 23 tests passed.
- `npx tsc --noEmit -p packages/search/tsconfig.json` — passed. `npx tsc --noEmit -p packages/tickets/tsconfig.json` — passed.
- `npx nx run search:build` and `npx nx run tickets:build` — passed. The tickets build used its supported Nx target; its direct package script is not a configured tsup input build.
- `git diff --check` — passed before the repair commit.
- The server remained stopped. The November 3 live walkthrough mentioned in older material is historical baseline evidence only. No browser smoke or production validation was performed for this repair.

Reviewers should start with the [repair review guide](review-guide.md), then the mixed-search section of the benchmark report.

## Completed checks at the tested revision

- `npx tsc --noEmit -p packages/tickets/tsconfig.json` — passed.
- `npx tsc --noEmit -p packages/search/tsconfig.json` — passed.
- `npx nx run search:build` — passed.
- `npx nx run tickets:build` — passed. The supported tickets target is Nx; the direct workspace build script was not used. Nx reported dependency build outputs matched cache.
- Affected Vitest suites: search authorization regression, search actions, API search controller, ACL, query/ranking, app search, PostgreSQL ranking cursor, production-schema search authorization, production-path benchmark, five Bento-read authorization tests, two sibling-read authorization tests, and ticket record authorization — 11 files, 98 tests passed.
- PostgreSQL fixtures use actual `tickets.ticket_id` and `comments.comment_id` UUID columns with text `app_search_index.object_id`. Coverage exercises guarded UUID comparisons (including malformed mixed-search IDs), exact counts, restrictive and unrestricted policies, live/deleted/missing/foreign-tenant comment records, requester audience, scheduled/deleted publication states, mixed result types, genuinely compiler-unsupported constraint fallback, fail-closed policy resolution, and evaluator parity.
- The PostgreSQL cursor suite follows five compiled readable tickets through three public pages to the final ticket and cursor termination. The public maximum test follows 205 mixed matches through pages of 100, 100 and 5, with unique identities, exact totals/groups, and termination.
- The seven-read suites cover all five Bento reads and both sibling reads.

The production-path benchmark is recorded separately in [benchmark.md](benchmark.md) and is pinned to baseline `5cdc72b0d450943c6b92b0f7fb856920f89e44e7` and revised `e3ad618d24d244e7e4161dfc7a1b7e67de75385e`.

The application server was not started. No fresh browser walkthrough or production handoff was performed. The November 3 live-smoke recording in the external guide remains historical evidence for the baseline only.

## Mixed-search latency follow-up

The latest mixed-search benchmark measures application revision `cc641b43be4bc197b533b245bab5823da07541e5`; the only application-side content added afterward is the benchmark fixture and assertions. See [benchmark.md](benchmark.md#mixed-search-at-150-500-and-1500-total-candidates) and [raw measurements](index-acl-measurements.json) for six scenarios (three total candidate sizes, two policies), individual elapsed samples, p95 calculations and SQL statement counts.

- `cd server && SEARCH_BENCH_REVISION=cc641b43be4bc197b533b245bab5823da07541e5 npx vitest run src/test/integration/searchAuthorizationProductionBenchmark.integration.test.ts --coverage.enabled=false --reporter=verbose --silent=false` — passed, 8 tests. The new total-candidate scenarios passed six combinations with one warmup and five timed requests each; all exact per-type authorization totals and page behavior were asserted.
- Search unit regressions (`searchAuthorizationRegression`, `searchActions`, `apiSearchController`, `searchAcl`, `searchQuery`, `runAppSearch`) — passed, 79 tests.
- PostgreSQL search behavior (`searchAuthorizationProduction.integration.test.ts`, `searchRankingCursor.db.test.ts`, `--no-file-parallelism`) — passed, 8 tests.
- Ticket authorization regressions (`ticketBentoActions.authz`, tenant-scoped Bento contract, sibling reads, `ticketRecordAuthorization`) — passed, 20 tests.
- `npx tsc --noEmit -p packages/search/tsconfig.json` and `npx tsc --noEmit -p packages/tickets/tsconfig.json` — passed.
- `npx nx run search:build` and `npx nx run tickets:build` — passed. Nx reported cached dependency outputs for all 31 search tasks and all 29 tickets tasks; no build tasks needed to execute.
- JSON parse validation and `git diff --check` passed. Existing unrelated `package-lock.json` and `server/.next-review/` changes were preserved and excluded from the repair commit.
- The application server stayed stopped. No approved plan was attached. `alga-dev` exposes generic workflow verification recording but does not expose a `security-finding-resolved` check, so that check was not run. No browser/production validation or external CI result is claimed; later CI observations belong to the subsequent owner.

## Review correction round at `46aac638eb6823db6645e81c8a147a78c90a4abd`

- Added PostgreSQL behavioral regressions for replacing a compiled project verifier with deny-all and for documents with a denied association followed by an allowed association. The supplied reproductions failed at pre-correction `574c387258c6d10e684fa46721ea52c4f33786bb`: project search returned total 500 instead of 0, and document SQL included a row the verifier rejected (`/tmp/pr4133-lead-round1-repro.log`). Both new regressions pass at this revision.
- Added the inverse project-replacement regression: an allowing replacement verifier admits an indexed candidate without a source project, proving the superseded built-in SQL predicate is not retained. The production-path benchmark/regression file passes six tests after this addition.
- Added source-verifier/PostgreSQL compiled-predicate parity for project, phase, task, task comment, workflow task assignee forms (including empty and malformed entries), existing status, and stale/missing status. Documents remain on fail-closed verifier fallback because the previous first-association behavior had no deterministic ordering and the broader SQL `EXISTS` semantics were unsafe.
- The refreshed mixed benchmark passed: 5 tests, including eight mixed request scenarios, 150/500 project growth, and cursor completion. PostgreSQL 15.4; one warmup, five sequential samples, concurrency 1. The 150 and 500 project fixtures both used 10 SQL statements; see the follow-up section in `benchmark.md` for raw per-request timings and query samples. Baseline comparison values are from the identical earlier fixture/harness and remain 516/517 mixed request statements.
- Search behavior and PostgreSQL suites: eight files, 86 tests passed after the inverse replacement-verifier regression. Seven-read ticket authorization regressions: four files, 20 tests passed.
- `npx tsc --noEmit -p packages/search/tsconfig.json` and `npx tsc --noEmit -p packages/tickets/tsconfig.json` passed. `npx nx run search:build` and `npx nx run tickets:build` passed; tickets used the supported Nx target because its direct package build is not configured as a tsup input build.
- `git diff --check` passed before committing the correction. The app server remained stopped. No fresh browser smoke, production validation, or `security-finding-resolved` check is claimed.

## Index-ACL-only correction at `9e3d592e9083af4c2b68d1f75aef4b63d737f9e6`

- `canCompileSearchVisibility` now distinguishes absent verifier registrations from registered verifiers without SQL compilers. The former use the shared index ACL count/page route; the latter remain on source-verifier fallback. No entity-specific client special case was added.
- Added a PostgreSQL behavioral growth regression for the index-ACL-only `client` type. It checks permission and user-visibility filtering, exact totals (90/300/900 from 150/500/1,500 candidates), bounded first pages, and a complete 900-result cursor walk at page size 100. It passes with 10 statements at every size. The earlier diagnostic reproduction recorded one request per size at 10/14/24 statements using fully readable candidates, a different fixture from this ACL-filtered regression.
- Full affected search behavior and PostgreSQL tests passed: eight files, 87 tests. The benchmark file passed seven tests, including its original mixed scenarios, index-ACL growth case, verifier replacement protections, document fallback, and compiled visibility parity.
- Seven-read ticket authorization regressions passed: four files, 20 tests. Search/tickets TypeScript checks and `npx nx run search:build` plus `npx nx run tickets:build` passed.
- Mixed benchmark rerun at this revision used PostgreSQL 15.4 and five sequential samples at concurrency 1. Mixed request scenarios had one warmup each; project and client growth checks had no separate warmup. Mixed queries remained at 9/10 statements, project growth at 10/10, and index-ACL-only client growth at 10/10/10 across 150/500/1,500 matches. Raw output is retained at `/tmp/pr4133-9e3d-benchmark.log`; report tables include raw timings and counts.
- The first benchmark attempt overlapped a second database integration invocation, which reset the shared test database and failed with `database "test_database" does not exist`. That attempt was discarded; the recorded benchmark above was rerun alone and passed.
- No browser smoke or production validation was performed, and no `security-finding-resolved` check is claimed.

## Independent review at `daa867b4f4cd305bbe659215af5da4acdd246ed0`

- Nine focused search/API/ticket unit files passed 96 tests. The production search authorization, ranking-cursor and benchmark files ran in one sequential invocation and passed 15 PostgreSQL tests. Logs: `/tmp/pr4133-lead-round3-unit.log` and `/tmp/pr4133-lead-round3-db.log`.
- The search TypeScript check passed. The client growth check again measured 10 statements per request at 150/500/1,500 candidates, with five measured requests per size, no separate warmup, and exact visible totals of 90/300/900. Its measurements are preserved in [index-acl-measurements.json](index-acl-measurements.json).
- During the documentation correction, the tickets TypeScript check also passed. `npx nx run search:build` and `npx nx run tickets:build` passed using cached task outputs. Logs: `/tmp/pr4133-takeover-search-build.log` and `/tmp/pr4133-takeover-tickets-build.log`. No application code changed after the tested revision.
- Documentation now separates the earlier single-request diagnostic fixture from the later ACL-filtered benchmark. The diagnostic observations are not repeated as five raw samples or used as an identical-fixture latency comparison.

## Pre-fix behavioral reproductions

Both regressions were run against pre-fix implementation revision `7b20448d1e490793c31fcc1048c8493b0e7b9d1e` in an isolated detached worktree:

- The production-schema authorization test failed while running compiled counts with PostgreSQL `operator does not exist: uuid = text` for the ticket/comment correlation. The same suite passes on revised `e3ad618d24d244e7e4161dfc7a1b7e67de75385e`.
- The supplied `/tmp/pr4133-lead-review-max-page.test.ts` reproduction returned 100 results and total 1,500 but failed because `nextCursor` was `undefined`. The revised PostgreSQL test verifies three terminating mixed-result pages of 100, 100 and 5.

## Document visibility SQL repair

- Production-path benchmark rerun passed on exact implementation revision `8ed50f3b799b5803d13ee2808ba189201e790edb` (PostgreSQL 15.4).
- The default document verifier now has a matching registered SQL compiler. The predicate denies absent source rows, binds source/association checks to the principal tenant, and denies scoped access when any client association is outside the allowed set. Replacing the document verifier with one that has no compiler removes the default SQL predicate and uses the verifier fallback. Existing index-ACL-only and custom-verifier fallback paths remain intact.
- PostgreSQL benchmark/regression file: 9 tests passed, including source-existence and multiple-association behavior, allowing verifier replacement, and 12 performance scenarios across 150/500/1,500 candidates, typeahead/full search, and unrestricted/client-portal contexts.
- Search unit suites (`searchAuthorizationRegression`, `searchActions`, `searchAcl`, `searchQuery`, `searchSql`): 5 files, 66 tests passed.
- PostgreSQL authorization, document, and pagination suites (`searchAuthorizationProduction`, `searchRankingCursor`, `documentPermissionsIntegration`, `documentContentAuthorization`): 4 files, 24 tests passed.
- Existing ticket authorization suites (five Bento reads, two sibling reads, record authorization): 4 files, 20 tests passed.
- `npx tsc --noEmit -p packages/search/tsconfig.json` and `npx tsc --noEmit -p packages/tickets/tsconfig.json` passed. `npx nx run search:build` and `npx nx run tickets:build` passed; Nx used cached dependency outputs.
- PostgreSQL 15.4 benchmark: one warmup plus five sequential samples per scenario, concurrency 1. Internal document search used 10 SQL statements for each of 150/500/1,500 candidates; client-portal scoped search used 3. Both contexts issued zero standalone document/association verification SELECTs. Exact totals were 135/450/1,350 internally and 92/308/926 for the portal. Full search walked all visible rows with unique identities and terminating cursors. Raw p95 and latency samples are in [benchmark.md](benchmark.md#repaired-sql-filtered-document-search-at-150-500-and-1500-candidates) and [index-acl-measurements.json](index-acl-measurements.json).
- Portal p95 ranged approximately 0.75–0.98 seconds despite bounded SQL statement counts; its latency source was not isolated. The benchmark exercises the shared typeahead engine directly without the outer action wrapper and is not production load evidence.
- No application server was started. No fresh browser/production validation or `security-finding-resolved` check is claimed.
