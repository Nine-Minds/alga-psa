# Production-path ticket search authorization benchmark

Governing specification: [PRD](../PRD.md). The earlier synthetic 1,500-row candidate-query benchmark is retained as [supplementary evidence](benchmark-query-path-supplementary.md); the measurements here use production ticket/comment authorization code and the real indexed tables.

## Revisions, fixture, and procedure

- Baseline: `5cdc72b0d450943c6b92b0f7fb856920f89e44e7`, in an isolated detached checkout at `/tmp/alga-pr4133-baseline-5cdc72b0d4`.
- Revised: `e3ad618d24d244e7e4161dfc7a1b7e67de75385e`.
- PostgreSQL: 15.4 (`Debian 15.4-2.pgdg120+1`).
- Fixture: 500 production `tickets` rows with UUID `ticket_id` and 500 rows in `app_search_index` with text `object_id`; 50 tickets match the assigned `selected_clients` rule and 450 do not. The same deterministic ticket IDs, ticket distribution, search vectors, role permission, selected-client assignment semantics, query text and page size are used on both revisions. Each checkout uses the same transactional TestContext fixture setup.
- Requests: five-hit typeahead and later page under unrestricted and restrictive policies. Later-page cursors are generated from the first page under the same policy. Every warmup and measured result is checked against its expected identity list and exact authorized total.
- Sampling: one warmup and five measured requests per scenario, sequentially (concurrency 1). p95 is nearest-rank, sample 5 of 5; raw latency samples are in request order. Query counts are measured with Knex `query` events on the transaction connection during `runAppSearch`, so they include principal resolution, policy resolution, candidate evaluation/source loads, counts and pages. Counts shown are the median of five; raw counts are also provided. Fixture setup and cursor-generation requests are excluded from request measurements.
- Match-count scaling uses the same production path and restrictive assignment at 150 matches (15 readable) and 500 matches (50 readable).

## Four required request scenarios

| Request | Authorization | Baseline p95 ms | Baseline SQL statements/request | Revised p95 ms | Revised SQL statements/request |
|---|---|---:|---:|---:|---:|
| Broad five-hit typeahead | Unrestricted | 408.69 | 3,507 | 9.55 | 9 |
| Broad five-hit typeahead | Restrictive | 660.71 | 4,007 | 9.26 | 10 |
| Later search page | Unrestricted | 444.83 | 3,507 | 13.44 | 9 |
| Later search page | Restrictive | 458.56 | 4,007 | 11.41 | 10 |

## Raw latency samples (ms)

| Request | Baseline samples | Revised samples |
|---|---|---|
| Broad five-hit typeahead, unrestricted | `[391.48, 356.76, 392.30, 408.69, 400.93]` | `[9.55, 9.45, 9.48, 9.26, 9.46]` |
| Broad five-hit typeahead, restrictive | `[503.63, 527.69, 660.71, 534.63, 423.08]` | `[7.33, 8.35, 9.26, 7.22, 7.99]` |
| Later search page, unrestricted | `[444.83, 381.55, 374.86, 398.19, 377.69]` | `[12.04, 13.44, 11.67, 11.77, 13.02]` |
| Later search page, restrictive | `[458.56, 443.45, 396.11, 445.29, 412.73]` | `[11.41, 10.19, 9.66, 9.58, 9.35]` |

Raw SQL statement samples were constant in each scenario: baseline `[3507, 3507, 3507, 3507, 3507]` unrestricted and `[4007, 4007, 4007, 4007, 4007]` restrictive; revised `[9, 9, 9, 9, 9]` unrestricted and `[10, 10, 10, 10, 10]` restrictive.

## Match-count scaling and result checks

| Revision/path | Matching rows | Readable rows | Median request SQL statements |
|---|---:|---:|---:|
| Baseline evaluator path | 150 | 15 | 1,203 |
| Baseline evaluator path | 500 | 50 | 4,007 |
| Revised compiled path | 150 | 15 | 10 |
| Revised compiled path | 500 | 50 | 10 |

The four scenario assertions verify identical expected IDs and authorized totals on baseline and revised runs: 500 unrestricted and 50 restrictive, including each later page. The revised path reduces measured p95 by 96.98%–98.60% and request SQL statements from 3,507–4,007 to 9–10. Its request SQL count remains flat as matches grow from 150 to 500.

## Reproducibility and limitations

The test is `server/src/test/integration/searchAuthorizationProductionBenchmark.integration.test.ts`; it calls the same production `runAppSearch` and authorization path at each revision. The baseline run used a temporary test-only copy of the harness in the detached baseline checkout; no baseline application source was changed. Setup, cursor creation and fixture insertions occur outside measured request query listeners. The five-sample p95 is a small-sample comparison and should be read with that limitation. These are PostgreSQL integration measurements, not a live browser or production traffic test.
