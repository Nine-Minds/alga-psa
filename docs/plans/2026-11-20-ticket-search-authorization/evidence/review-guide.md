# PR #4133 mixed-search repair review guide

Initial mixed-search implementation: `86abc71008a370b0765ac850fb8642ea48daa953`.
Review correction: `46aac638eb6823db6645e81c8a147a78c90a4abd`.
Index-ACL-only paging correction: `9e3d592e9083af4c2b68d1f75aef4b63d737f9e6`.

## Current mixed-search latency evidence

The remaining mixed-search latency requirement was measured at application revision `cc641b43be4bc197b533b245bab5823da07541e5` using the existing PostgreSQL production-path fixture and benchmark harness. Each request included ticket, comment and project results together. Sizes are total candidates across the three types: 150 (50/50/50), 500 (167/167/166), and 1,500 (500/500/500). Five successful timed requests per size/policy, after one warmup, used concurrency 1 and the first page (no cursor) at page size 100. Nearest-rank p95 values (the maximum of five) were:

| Total candidates | Unrestricted p95 (n=5) | Selected-client bundle p95 (n=5) |
|---:|---:|---:|
| 150 | 21.37 ms | 78.50 ms |
| 500 | 23.70 ms | 64.69 ms |
| 1,500 | 20.24 ms | 69.21 ms |

The complete timing samples, exact per-type authorization counts, policy, timing boundary, database version and reproduction command are in the [benchmark report](benchmark.md#mixed-search-at-150-500-and-1500-total-candidates) and [measurements JSON](index-acl-measurements.json). These are sequential PostgreSQL integration results, not production latency claims. The extended harness measures only; no visibility-engine refactor was made for this follow-up.

## Inspect first

1. In `packages/search/src/acl.ts`, review how SQL compilers are bound to active verifier registrations. Replacing a built-in verifier without a compiler must remove its SQL predicate and use the verifier fallback. Project, phase, task, task-comment, workflow-task and status source checks are tenant-scoped and correlated to the indexed object. Documents deliberately remain on fallback: any denied client association denies the document, rather than broadening access with an `EXISTS` match.
2. In `packages/search/src/query.ts`, confirm that the same record-visibility predicate is used for ranked rows and grouped/exact counts. Ticket and comment predicates remain coupled to the shared ticket read policy.
3. In `packages/search/src/runAppSearch.ts`, verify that types with no source verifier use shared index-ACL SQL counts and bounded pages. A registered verifier without a compiled predicate stays on the candidate scan and verifier path. The public cursor still uses the fixed ranking timestamp and visible page lookahead.
4. Review the production-schema fixtures in `server/src/test/integration/searchAuthorizationProductionBenchmark.integration.test.ts`. They check exact ticket/comment/project/client totals, stale index exclusion, 5- and 100-result pages, cursor completion, index ACL filtering, deny/allow verifier replacement, multiple document associations, and PostgreSQL parity for every compiled visibility predicate. Project growth and index-ACL-only client growth assertions guard against per-candidate SQL work.

## Evidence to check

- [Mixed-search benchmark](benchmark.md#mixed-search-repair-round) retains the historical repair comparisons. The new [total-candidate mixed search measurements](benchmark.md#mixed-search-at-150-500-and-1500-total-candidates) report raw timings for all three result types at 150, 500 and 1,500 candidates.
- [Verification record](verification.md#mixed-search-performance-repair) lists the PostgreSQL behavior suites, seven-read authorization suites, typechecks and Nx builds.
- The baseline harness was run at `bdca35983cc22c75f9b07ffd797aedc8463b2129` and failed the growth assertion at 160 statements for 150 project matches versus 515 for 500. The corrected revision `46aac638eb6823db6645e81c8a147a78c90a4abd` passed at 10 statements for both sizes. The supplied review reproductions failed at the pre-correction `574c387258c6d10e684fa46721ea52c4f33786bb`.
- The round-2 PostgreSQL reproduction at `2e4ad092a5d99ac2c443ec15ce27e52b6da1cd0c` recorded one request each at 10, 14 and 24 statements for 150, 500 and 1,500 fully readable client matches. The committed regression at `9e3d592e9083af4c2b68d1f75aef4b63d737f9e6` uses a different fixture with 40% of index candidates denied by ACL. Five requests at each size use 10 statements, with exact visible totals of 90/300/900. See [sampling and fixture provenance](index-acl-measurements.json); these are not identical-fixture latency comparisons.

## Authorization and pagination checks

- Ticket and comment search metadata remains visible only through the compiled shared ticket policy or the existing fail-closed evaluator fallback.
- Existing PostgreSQL tests cover requester comment audience, missing/deleted parents, foreign-tenant comments, UUID/text index correlations, resolver failure and unsupported ticket policy rules.
- The mixed benchmark walks all unrestricted matches through public pages and verifies 1,050 unique identities and exact groups. The existing cursor test separately verifies 205 mixed rows as pages of 100, 100 and 5, with stable ranking and termination.
- Missing project source records are rejected by the SQL admission check and do not affect counts. Tenant predicates are explicit on source rows and joins.

## Limits and historical demonstrations

The additional mixed-search fixture contains all three result types at each measured total. This remains a sequential PostgreSQL integration measurement with five samples, not a production load test. Documents and custom/replacement verifiers without a matching SQL compiler remain on the batched fail-closed scan path; the measurements do not establish that every fallback scan has been eliminated.

The application server was deliberately left stopped. Any November 3 live walkthrough or earlier browser demonstration in the plan is historical evidence for older revisions, not fresh verification of the mixed-search latency follow-up. No browser smoke or production validation was performed for this repair.
