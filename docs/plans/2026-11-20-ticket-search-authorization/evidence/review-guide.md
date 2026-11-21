# PR #4133 mixed-search repair review guide

Implementation under review: `86abc71008a370b0765ac850fb8642ea48daa953`.

## Inspect first

1. In `packages/search/src/acl.ts`, review the SQL predicates derived from the existing record verifiers. Project, phase, task, task-comment, document, workflow-task and status source checks are tenant-scoped and correlated to the indexed object. The workflow-task predicate mirrors the existing assignee-array parsing behavior.
2. In `packages/search/src/query.ts`, confirm that the same record-visibility predicate is used for ranked rows and grouped/exact counts. Ticket and comment predicates remain coupled to the shared ticket read policy.
3. In `packages/search/src/runAppSearch.ts`, verify that SQL-compilable types use the authorized count/page route, while a registered verifier without a compiled predicate stays on the existing candidate scan and verifier path. The public cursor still uses the fixed ranking timestamp and visible page lookahead.
4. Review the production-schema fixtures in `server/src/test/integration/searchAuthorizationProductionBenchmark.integration.test.ts`. They check exact ticket/comment/project totals, a stale project index entry, 5- and 100-result first/later pages, and cursor completion. The 150-versus-500 project assertion is the regression guard for per-candidate SQL work.

## Evidence to check

- [Mixed-search benchmark](benchmark.md#mixed-search-repair-round) contains the exact baseline and repair revisions, fixture proportions, PostgreSQL version, raw timings and SQL counts, and commands to reproduce both sides.
- [Verification record](verification.md#mixed-search-performance-repair) lists the PostgreSQL behavior suites, seven-read authorization suites, typechecks and Nx builds.
- The baseline harness was run at `bdca35983cc22c75f9b07ffd797aedc8463b2129` and failed the new growth assertion at 160 statements for 150 project matches versus 515 for 500. The repair passed at 10 statements for each fixture size.

## Authorization and pagination checks

- Ticket and comment search metadata remains visible only through the compiled shared ticket policy or the existing fail-closed evaluator fallback.
- Existing PostgreSQL tests cover requester comment audience, missing/deleted parents, foreign-tenant comments, UUID/text index correlations, resolver failure and unsupported ticket policy rules.
- The mixed benchmark walks all unrestricted matches through public pages and verifies 1,050 unique identities and exact groups. The existing cursor test separately verifies 205 mixed rows as pages of 100, 100 and 5, with stable ranking and termination.
- Missing project source records are rejected by the SQL admission check and do not affect counts. Tenant predicates are explicit on source rows and joins.

## Limits and historical demonstrations

This benchmark is a sequential PostgreSQL integration measurement with five samples, not a production load test. It scales project candidates while mixing ticket and comment candidates; it does not create large fixtures for every entity type. Custom verifier types without a compiled SQL predicate still use the batched fail-closed scan.

The application server was deliberately left stopped. Any November 3 live walkthrough or earlier browser demonstration in the plan is historical evidence for the prior revision, not fresh verification of `86abc71008a370b0765ac850fb8642ea48daa953`. No browser smoke or production validation was performed for this repair.
