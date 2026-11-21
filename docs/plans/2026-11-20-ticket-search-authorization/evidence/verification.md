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

## Pre-fix behavioral reproductions

Both regressions were run against pre-fix implementation revision `7b20448d1e490793c31fcc1048c8493b0e7b9d1e` in an isolated detached worktree:

- The production-schema authorization test failed while running compiled counts with PostgreSQL `operator does not exist: uuid = text` for the ticket/comment correlation. The same suite passes on revised `e3ad618d24d244e7e4161dfc7a1b7e67de75385e`.
- The supplied `/tmp/pr4133-lead-review-max-page.test.ts` reproduction returned 100 results and total 1,500 but failed because `nextCursor` was `undefined`. The revised PostgreSQL test verifies three terminating mixed-result pages of 100, 100 and 5.
