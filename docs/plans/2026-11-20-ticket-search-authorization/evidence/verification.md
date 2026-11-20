# Search authorization repair verification

Governing specification: [PRD](../PRD.md). Tested implementation revision: `e3ad618d24d244e7e4161dfc7a1b7e67de75385e`.

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
