# Search authorization performance evidence

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

## Mixed-search repair round

The ticket-only measurements above are historical evidence for the prior ticket authorization repair. They do not measure the separate full-search cost from source-record verifiers on non-ticket types. This section measures that mixed path before and after commit `86abc71008a370b0765ac850fb8642ea48daa953`.

### Fixture and method

- Baseline source revision: `bdca35983cc22c75f9b07ffd797aedc8463b2129`.
- Repair source revision: `86abc71008a370b0765ac850fb8642ea48daa953`.
- PostgreSQL: 15.4 (`Debian 15.4-2.pgdg120+1`).
- Each run used an isolated TestContext database fixture against production `tickets`, `comments`, `projects` and `app_search_index` schemas. The fixture contained 500 matching tickets (50 admitted by the selected-client bundle rule and 450 denied), 50 published comments on the 50 admitted tickets, 500 matching projects, and one stale project index row with no project source record. The mixed indexed candidate set therefore had 1,051 rows; the exact authorized total was 1,050 unrestricted and 600 under the bundle-restricted policy.
- The user had ticket and project read permissions. The unrestricted cases removed the benchmark bundle assignment; restricted cases kept its selected-client rule active. Project rows remained readable for both internal-user policies. Comment visibility still depended on the parent ticket and shared ticket/comment policy.
- Eight requests covered first and subsequent pages at typeahead size 5 and maximum size 100 for both policies. Cursor setup was outside the timing window. Each scenario used one warmup followed by five measured requests, sequentially (concurrency 1). Results, groups and exact totals were asserted on every request. A separate cursor walk checked the complete 1,050-row unrestricted result set, no duplicate identities, no omissions, and termination.
- The growth check queried 150 and 500 live projects (the broad query also had the stale index row). Each sample measured the entire `runAppSearch` request. SQL counts came from Knex `query` events and included principal/policy resolution, source authorization, counts and result pages. Latency used `performance.now()` wall-clock request duration. p95 is nearest-rank sample 5 of 5. Fixture creation and cursor generation were excluded.
- On the pre-repair source, the same behavioral benchmark failed its flat-growth assertion: 160 statements at 150 projects and 515 at 500. This directly reproduces the review hold. The old path queried the source verifier once per matching project while continuing through all candidates to produce exact groups and totals.

### Mixed request results

| Request | Policy | Baseline p95 ms | Baseline SQL/request | Repair p95 ms | Repair SQL/request |
|---|---|---:|---:|---:|---:|
| First page, limit 5 | Unrestricted | 133.04 | 516 | 21.21 | 9 |
| First page, limit 5 | Bundle restricted | 105.99 | 517 | 20.95 | 10 |
| Subsequent page, limit 5 | Unrestricted | 107.38 | 516 | 26.19 | 9 |
| Subsequent page, limit 5 | Bundle restricted | 107.21 | 517 | 24.77 | 10 |
| First page, limit 100 | Unrestricted | 113.45 | 516 | 20.45 | 9 |
| Subsequent page, limit 100 | Unrestricted | 103.60 | 516 | 23.49 | 9 |
| First page, limit 100 | Bundle restricted | 107.13 | 517 | 20.99 | 10 |
| Subsequent page, limit 100 | Bundle restricted | 108.75 | 517 | 24.52 | 10 |

### Raw latency samples (ms)

| Request | Baseline samples | Repair samples |
|---|---|---|
| First page, limit 5, unrestricted | `[133.04, 125.36, 113.05, 114.25, 117.06]` | `[18.86, 21.21, 18.75, 18.14, 17.77]` |
| First page, limit 5, bundle restricted | `[103.64, 96.86, 105.99, 96.22, 102.09]` | `[20.49, 20.95, 17.73, 16.65, 17.16]` |
| Subsequent page, limit 5, unrestricted | `[107.38, 101.47, 106.02, 102.57, 105.90]` | `[23.85, 21.33, 21.22, 21.83, 26.19]` |
| Subsequent page, limit 5, bundle restricted | `[98.01, 101.05, 100.86, 87.77, 107.21]` | `[21.25, 23.25, 23.79, 21.01, 24.77]` |
| First page, limit 100, unrestricted | `[98.05, 95.21, 104.35, 113.45, 103.02]` | `[20.45, 18.45, 16.96, 18.23, 18.46]` |
| Subsequent page, limit 100, unrestricted | `[100.05, 95.21, 102.66, 103.60, 102.99]` | `[23.49, 20.94, 22.13, 21.78, 22.73]` |
| First page, limit 100, bundle restricted | `[96.89, 99.41, 102.12, 104.54, 107.13]` | `[16.95, 17.21, 18.37, 19.74, 20.99]` |
| Subsequent page, limit 100, bundle restricted | `[106.71, 94.30, 104.14, 108.75, 103.38]` | `[23.48, 24.52, 22.68, 21.24, 21.52]` |

SQL statement samples were constant within each scenario: baseline `[516, 516, 516, 516, 516]` unrestricted and `[517, 517, 517, 517, 517]` restricted; repair `[9, 9, 9, 9, 9]` unrestricted and `[10, 10, 10, 10, 10]` restricted.

### Candidate growth and raw measurements

| Live project matches | Baseline SQL samples | Baseline latency samples (ms) | Repair SQL samples | Repair latency samples (ms) |
|---:|---|---|---|---|
| 150 | `[160, 160, 160, 160, 160]` | `[22.07, 19.69, 21.55, 21.67, 21.24]` | `[10, 10, 10, 10, 10]` | `[11.82, 9.71, 9.93, 9.86, 8.81]` |
| 500 (+ 1 stale index entry) | `[515, 515, 515, 515, 515]` | `[91.68, 82.89, 82.41, 92.00, 82.18]` | `[10, 10, 10, 10, 10]` | `[9.74, 9.48, 9.64, 10.09, 9.13]` |

The repaired path applies source visibility in the same SQL used for ranking/pages and exact counts. Project statement counts remain flat at 10 while matches grow from 150 to 500; a missing project source row stays excluded from results and totals. Ticket/comment counts and metadata continue through the shared ticket read policy. No raw candidate cap or partial total was introduced.

### Reproduction

Run the repair benchmark from the repository's `server/` directory:

```sh
SEARCH_BENCH_REVISION=86abc71008a370b0765ac850fb8642ea48daa953 \
  npx vitest run src/test/integration/searchAuthorizationProductionBenchmark.integration.test.ts \
  --coverage.enabled=false --reporter=verbose --silent=false
```

To run the same harness against the baseline source, create a detached baseline worktree, copy the committed benchmark harness into it, and link the current dependencies and test environment:

```sh
git worktree add --detach /tmp/alga-pr4133-mixed-baseline bdca35983cc22c75f9b07ffd797aedc8463b2129
git show 86abc71008a370b0765ac850fb8642ea48daa953:server/src/test/integration/searchAuthorizationProductionBenchmark.integration.test.ts \
  > /tmp/alga-pr4133-mixed-baseline/server/src/test/integration/searchAuthorizationProductionBenchmark.integration.test.ts
ln -s "$PWD/node_modules" /tmp/alga-pr4133-mixed-baseline/node_modules
ln -s "$PWD/.env.localtest" /tmp/alga-pr4133-mixed-baseline/.env.localtest
cd /tmp/alga-pr4133-mixed-baseline/server
SEARCH_BENCH_REVISION=bdca35983cc22c75f9b07ffd797aedc8463b2129 \
  npx vitest run src/test/integration/searchAuthorizationProductionBenchmark.integration.test.ts \
  --coverage.enabled=false --reporter=verbose --silent=false
```

The baseline run is expected to fail only the regression assertion comparing the 150- and 500-project statement counts; its measurements are printed before that assertion. Remove the detached worktree after review with `git worktree remove /tmp/alga-pr4133-mixed-baseline`.

### Limits

These are sequential PostgreSQL integration measurements with five samples, not a production traffic load test. The fixture exercises project source verification at scale and mixed ticket/comment authorization, but does not assign large match sets to every searchable entity type. SQL compilation is attached to the active verifier registration. A replacement/custom verifier without a matching compiler, including documents, remains on the batched fail-closed scan path. The application server was not started, and no new browser smoke or production validation was performed.

## Reproducibility and limitations

The test is `server/src/test/integration/searchAuthorizationProductionBenchmark.integration.test.ts`; it calls the same production `runAppSearch` and authorization path at each revision. The baseline run used a temporary test-only copy of the harness in the detached baseline checkout; no baseline application source was changed. Setup, cursor creation and fixture insertions occur outside measured request query listeners. The five-sample p95 is a small-sample comparison and should be read with that limitation. These are PostgreSQL integration measurements, not a live browser or production traffic test.

## Review correction round

The reviewer reproduced two correctness issues at `574c387258c6d10e684fa46721ea52c4f33786bb`: a replacement deny-all project verifier was bypassed by the stale built-in SQL predicate (search returned 500 instead of zero), and a document SQL `EXISTS` predicate admitted a row the source verifier denied. The supplied log is `/tmp/pr4133-lead-round1-repro.log`. The correction is committed at `46aac638eb6823db6645e81c8a147a78c90a4abd`.

SQL compilers now belong to verifier registrations. Replacing a built-in verifier without supplying a matching compiler removes that type from compiled admission/count SQL and uses its verifier fallback. Documents stay on fallback: their source check now denies a document when any client association is outside the scoped user's access, avoiding the previous ambiguous `.first()` behavior and avoiding the broader “any allowed association” SQL rule. PostgreSQL parity coverage exercises every other compiled source predicate, including missing status rows and workflow assignee variants.

The rerun used the identical mixed fixture and request parameters above on PostgreSQL 15.4 (`Debian 15.4-2.pgdg120+1`), with one warmup and five sequential measured samples per scenario, concurrency 1. Raw timing and statement samples follow. Totals and page walks were asserted, including a unique 1,050-result traversal at page size 100.

| Request | Policy | Prior baseline p95 ms / SQL | Corrected p95 ms / SQL |
|---|---|---:|---:|
| First page, limit 5 | Unrestricted | 133.04 / 516 | 20.09 / 9 |
| First page, limit 5 | Bundle restricted | 105.99 / 517 | 20.06 / 10 |
| Subsequent page, limit 5 | Unrestricted | 107.38 / 516 | 27.29 / 9 |
| Subsequent page, limit 5 | Bundle restricted | 107.21 / 517 | 25.30 / 10 |
| First page, limit 100 | Unrestricted | 113.45 / 516 | 23.66 / 9 |
| Subsequent page, limit 100 | Unrestricted | 103.60 / 516 | 28.20 / 9 |
| First page, limit 100 | Bundle restricted | 107.13 / 517 | 23.21 / 10 |
| Subsequent page, limit 100 | Bundle restricted | 108.75 / 517 | 24.82 / 10 |

| Request | Corrected raw latency samples (ms) | Corrected SQL samples |
|---|---|---|
| First page, limit 5, unrestricted | `[19.01, 20.09, 19.46, 19.17, 18.31]` | `[9, 9, 9, 9, 9]` |
| First page, limit 5, bundle restricted | `[19.17, 18.73, 19.33, 19.97, 20.06]` | `[10, 10, 10, 10, 10]` |
| Subsequent page, limit 5, unrestricted | `[26.21, 27.29, 23.95, 25.47, 24.45]` | `[9, 9, 9, 9, 9]` |
| Subsequent page, limit 5, bundle restricted | `[24.14, 25.12, 25.30, 23.86, 24.93]` | `[10, 10, 10, 10, 10]` |
| First page, limit 100, unrestricted | `[23.66, 21.97, 21.10, 22.66, 18.88]` | `[9, 9, 9, 9, 9]` |
| Subsequent page, limit 100, unrestricted | `[28.20, 24.98, 25.65, 26.02, 23.63]` | `[9, 9, 9, 9, 9]` |
| First page, limit 100, bundle restricted | `[18.17, 17.05, 21.20, 21.12, 23.21]` | `[10, 10, 10, 10, 10]` |
| Subsequent page, limit 100, bundle restricted | `[24.05, 24.82, 23.05, 24.34, 23.37]` | `[10, 10, 10, 10, 10]` |

| Live projects | Corrected SQL samples | Corrected latency samples (ms) | p95 ms |
|---:|---|---|---:|
| 150 | `[10, 10, 10, 10, 10]` | `[11.35, 11.97, 14.76, 10.53, 13.30]` | 14.76 |
| 500 + one stale index row | `[10, 10, 10, 10, 10]` | `[11.60, 13.03, 14.74, 12.78, 15.31]` | 15.31 |

Reproduce the corrected benchmark from `server/` with:

```sh
SEARCH_BENCH_REVISION=46aac638eb6823db6645e81c8a147a78c90a4abd \
  npx vitest run src/test/integration/searchAuthorizationProductionBenchmark.integration.test.ts \
  --coverage.enabled=false --reporter=verbose --silent=false
```

Raw command output from this run was retained at `/tmp/pr4133-46aac-benchmark.log` in the implementation environment. The older review hold reproductions were run against pre-correction `574c387258c6d10e684fa46721ea52c4f33786bb` and failed with the mismatches described above. Historical live demonstrations remain historical; this correction has no fresh browser smoke or production validation.
