# Project list search performance comparison

This is a reproducible, disposable PostgreSQL comparison of the stored-vector search baseline and the confidentiality-preserving implementation. It does not start an app server. The harness calls the real `searchProjectListIds` action and real `createProjectReadAuthorizer` kernel and bundle provider. Only the action wrapper and its coarse RBAC gate are adapted for Vitest; record-level authorization and the selected-client policy are database-backed.

## Revisions and fixture assumptions

- Stored-vector baseline: `0b01336f9631253be710c2fae29dff06ec2d156f` (parent of `46e9baaf21`).
- Repaired implementation: `839f6db6ab9cf9c6bf7decdb2147dca8c1b993a6` (phase authorization repair, UUID-index joins, and stored-vector candidate filtering).
- Default volume: 2,500 projects and 10,000 search-index rows, one each for project, phase, task, and task comment. All source project/phase/task rows are seeded. Set `PROJECT_SEARCH_BENCHMARK_PROJECTS` to a larger integer when measuring larger tenants; the harness rejects values below 1,000.
- Distribution: half of projects belong to the selected client and half to a denied client. Every fourth project name contains `commonamber`; one selected-client project contains `rarezircon`; `nevermatchingtoken` is absent. Project numbers are unique. The corpus is synthetic and uniform, intended to expose scaling and query-plan differences, not to claim an exact production distribution.
- Policy: a real user-targeted authorization bundle has a `project:read` `selected_clients` rule allowing only the selected client. Expected decisions are exactly half allowed, half denied, and no field redactions.
- Baseline authorization: revision `0b01336f9631253be710c2fae29dff06ec2d156f` has only the coarse permission gate in this action. The harness separately runs the real project authorization sweep and adds each measured sweep to the corresponding baseline action time; it records the original action/SQL timings as well. This makes the total-action comparison authorization-equivalent without treating baseline result IDs as evidence or trusting its missing record authorization.
- Cache: one warmup per search term, then three measured action and raw-query repetitions per term. The database is not restarted between repetitions. Results describe a warm PostgreSQL shared-buffer/host-page-cache run.
- Review responsiveness criterion: at this 2,500-project scale, treat a search query adding more than 250 ms to the authorization-only median, or a search SQL median above 100 ms, as a substantial responsiveness regression. The 250 ms allowance is a practical user-visible wait increment; 100 ms reserves most of an interactive request budget for authorization and normal action work. These are investigation thresholds, not a production SLA. This run meets both; the authorization sweep itself remains close to one second and needs a deployed-scale latency budget before release claims.

## Disposable PostgreSQL setup

Run from the repository root. Docker must be available. The port binds to loopback only. The disposable container uses local trust authentication because the repository migration knexfile reads its local secret file before environment overrides; do not reuse this container or database for application data.

```sh
docker run -d --name project-search-bench-20261123 \
  -e POSTGRES_PASSWORD=bench-local \
  -e POSTGRES_DB=postgres \
  -p 127.0.0.1:55842:5432 \
  pgvector/pgvector:0.8.7-pg15-bookworm
docker exec project-search-bench-20261123 sh -lc \
  "sed -i 's/scram-sha-256/trust/g' \"\$PGDATA/pg_hba.conf\" && psql -U postgres -c 'SELECT pg_reload_conf()'"
docker exec project-search-bench-20261123 createdb -U postgres project_search_test
docker exec project-search-bench-20261123 psql -U postgres -d project_search_test \
  -c 'CREATE ROLE app_user LOGIN'
```

Apply the repository migrations (no app process is started):

```sh
cd server
DB_HOST=127.0.0.1 DB_PORT=55842 DB_USER_ADMIN=postgres \
DB_PASSWORD_ADMIN=bench-local DB_NAME_SERVER=project_search_test \
npx knex migrate:latest --knexfile knexfile.cjs --env migration
cd ..
```

## Run baseline, then repaired HEAD

The same isolated database is used sequentially. Each harness invocation creates a fresh tenant; the synthetic project/index rows and policy bundle are in a rolled-back transaction. The few committed tenant bootstrap rows are harmless and remain isolated in this disposable database. The baseline invocation runs first. Preserve both JSON output files and do not change PostgreSQL settings between runs.

```sh
REPO_ROOT=$(git rev-parse --show-toplevel)
git worktree add --detach /tmp/project-search-baseline \
  0b01336f9631253be710c2fae29dff06ec2d156f
cp "$REPO_ROOT/packages/projects/src/actions/projectActions.searchPerformance.db.test.ts" \
  /tmp/project-search-baseline/packages/projects/src/actions/
ln -s "$REPO_ROOT/node_modules" /tmp/project-search-baseline/node_modules
cd /tmp/project-search-baseline/server
PROJECT_SEARCH_BENCHMARK=1 PROJECT_SEARCH_BENCHMARK_PROJECTS=2500 \
PROJECT_SEARCH_BENCHMARK_OUTPUT="$REPO_ROOT/docs/evidence/project-search-performance-2026-11-23/baseline.json" \
REQUIRE_DB=1 TEST_DB_NAME=project_search_test DB_HOST=127.0.0.1 DB_PORT=55842 \
DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=bench-local DB_NAME_SERVER=project_search_test \
DB_USER_SERVER=postgres DB_PASSWORD_SERVER=bench-local SECRET_READ_CHAIN=env \
npx vitest run --config vitest.workspace-db.config.ts ../packages/projects/src/actions/projectActions.searchPerformance.db.test.ts
cd "$REPO_ROOT"
git worktree remove --force /tmp/project-search-baseline
cd "$REPO_ROOT/server"
PROJECT_SEARCH_BENCHMARK=1 PROJECT_SEARCH_BENCHMARK_PROJECTS=2500 \
PROJECT_SEARCH_BENCHMARK_OUTPUT="$REPO_ROOT/docs/evidence/project-search-performance-2026-11-23/repaired-head.json" \
REQUIRE_DB=1 TEST_DB_NAME=project_search_test DB_HOST=127.0.0.1 DB_PORT=55842 \
DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=bench-local DB_NAME_SERVER=project_search_test \
DB_USER_SERVER=postgres DB_PASSWORD_SERVER=bench-local SECRET_READ_CHAIN=env \
npx vitest run --config vitest.workspace-db.config.ts ../packages/projects/src/actions/projectActions.searchPerformance.db.test.ts
cd "$REPO_ROOT"
```

To include query plans and the sample/action details, retain `baseline.json` and `repaired-head.json`. Each artifact includes exact revision, project and index volumes, allowed/denied/redacted decision counts, three separate authorization sweep timings, three total-action and raw-SQL timings per term, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans for each term, PostgreSQL version/settings, and index definitions/statistics. Baseline artifacts include both the stored-vector action timings and the authorization-adjusted full-action timings. The current search SQL first filters index rows with stored vectors/title/subtitle candidates, then rebuilds vectors from current authorized source fields as a final match check. Stored text is never sufficient to return a result, so stale hidden-field text cannot leak. This may defer discovery of newly edited text until its search index row is refreshed; fixture measurements use synchronized source/index snapshots.

## Recorded comparison

The committed artifacts are the reproducible evidence; rounded medians are summarized here for review. The same PostgreSQL 15.19 disposable database and 2,500-project/10,000-row corpus were used. Both policy sweeps evaluated 1,250 allowed and 1,250 denied projects with the real selected-client rule.

| Search | Baseline SQL median | Repaired SQL median | Baseline action median | Repaired action median | Results |
| --- | ---: | ---: | ---: | ---: | ---: |
| Common (`commonamber`) | 534 ms | 80 ms | 789 ms + auth | 1,046 ms | 625 |
| Rare (`rarezircon`) | 34 ms | 48 ms | 37 ms + auth | 1,040 ms | 1 |
| No match | 38 ms | 53 ms | 38 ms + auth | 1,034 ms | 0 |

Baseline action timings lack record-level authorization; use `baselineAuthorizationAdjustedMedianMs` from the artifact for an authorization-equivalent comparison (about 1,808 ms common, 1,056 ms rare, and 1,058 ms no-match). The repaired action includes its real authorization sweep. The repair removes the common-query join/vector rebuild cost and keeps rare/no-match SQL below the review threshold; the modest 10–16 ms rare/no-match SQL increase is well below the substantial-regression threshold. The plans show the baseline common query spending most execution in source joins/vector rebuilding; repaired candidate filtering limits that work to stored-text candidates and verifies matches with current source fields. See each artifact's full plans and buffer counts.

This is a deterministic synthetic corpus with uniform project structures, not a production tenant sample. Repeated measurements are three warm-cache samples and are too few for a stable p95. Authorization still scans and evaluates all 2,500 tenant projects (median about 999 ms); no fast path or policy weakening was used. The benchmark supports the comparison at this stated scale only. A human reviewer should first inspect the authorization sweep timings and plan buffer counts, then verify the stored-vector candidate CTE cannot return a result without the effective current-source vector match.

Run the current-revision confidentiality suite on the same disposable database:

```sh
cd server
REQUIRE_DB=1 TEST_DB_NAME=project_search_test DB_HOST=127.0.0.1 DB_PORT=55842 \
DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=bench-local DB_NAME_SERVER=project_search_test \
DB_USER_SERVER=postgres DB_PASSWORD_SERVER=bench-local SECRET_READ_CHAIN=env \
npx vitest run --config vitest.workspace-db.config.ts ../packages/projects/src/actions/projectActions.searchRedaction.db.test.ts
cd ..
```

Clean up after copying the artifacts:

```sh
docker rm -f project-search-bench-20261123
```

The benchmark deliberately uses non-redacted source text and does not treat the stored-vector baseline as a confidentiality pass. It contains no hidden-field search terms and makes no unrestricted authorization shortcut. After any search-path change, the separate current-revision confidentiality test must pass before interpreting performance results.
