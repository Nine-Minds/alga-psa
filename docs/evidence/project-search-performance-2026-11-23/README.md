# Project list search performance comparison

This is a reproducible, disposable PostgreSQL comparison of the stored-vector search baseline and the confidentiality-preserving implementation. It does not start an app server. The harness calls the real `searchProjectListIds` action and real `createProjectReadAuthorizer` kernel and bundle provider. Only the action wrapper and its coarse RBAC gate are adapted for Vitest; record-level authorization and the selected-client/redaction policy are database-backed.

## Revisions and fixture assumptions

- Stored-vector baseline: `0b01336f9631253be710c2fae29dff06ec2d156f` (parent of `46e9baaf21`).
- Repaired implementation: `deb9615c947556226daea5476595e4e8140dca32` (parsed PostgreSQL exclusion detection, search projection, and selective candidate authorization).
- Default volume: 2,500 projects and 10,000 search-index rows, one each for project, phase, task, and task comment. All source project/phase/task rows are seeded. Set `PROJECT_SEARCH_BENCHMARK_PROJECTS` to a larger integer when measuring larger tenants; the harness rejects values below 1,000.
- Distribution: half of projects belong to the selected client and half to a denied client. Every fourth project name contains `commonamber`; one selected-client project contains `rarezircon`; `nevermatchingtoken` is absent. Project numbers are unique. The corpus is synthetic and uniform, intended to expose scaling and query-plan differences, not to claim an exact production distribution.
- Policy: a real user-targeted authorization bundle has a `project:read` `selected_clients` rule allowing only the selected client and redacting `projects.description` and `project_tasks.description`. The real decision distribution is 1,250 allowed and 1,250 denied; both groups carry the configured redactions. Baseline `0b01336f` already calls `filterAuthorizedProjects` for matched project IDs. Each reported action time is the actual action end-to-end time, including that revision's real record authorization; no full-tenant authorization time is added to baseline timings.
- Candidate behavior: the repaired action first finds candidate project IDs using indexed text, then authorizes only those projects, and finally checks matches against the effective projected source fields. Queries containing NOT in PostgreSQL's parsed `tsquery` use a broader candidate fallback before authorization because indexed hidden values cannot safely filter candidates for negation. This includes parenthesized, quoted, and exclusion-only searches; it does not depend on detecting whitespace before a minus sign. This is a correctness-preserving fallback, not an unrestricted result path; the final match still uses the projection.
- Cache: one warmup per search term, then three measured action and raw-query repetitions per term. The database is not restarted between repetitions. Results describe a warm PostgreSQL shared-buffer/host-page-cache run.
- Review responsiveness criterion: compare measured end-to-end action latency on the same corpus and policy. For this review, flag a change as substantial when it is both more than 2x and more than 100 ms slower; this distinguishes material user waits from small fixed query overhead at this scale. This is an investigation threshold, not a product SLA. The separate full-tenant authorization sweep is diagnostic only and is never added to action timings; selective searches authorize matched candidates.

## Disposable PostgreSQL setup

Run from the repository root. Docker must be available. The port binds to loopback only. The disposable container uses local trust authentication because the repository migration knexfile reads its local secret file before environment overrides; do not reuse this container or database for application data.

```sh
docker run -d --name project-search-bench-20261123 \
  -e POSTGRES_PASSWORD=bench-local \
  -e POSTGRES_DB=postgres \
  -p 127.0.0.1:55843:5432 \
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
DB_HOST=127.0.0.1 DB_PORT=55843 DB_USER_ADMIN=postgres \
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
REQUIRE_DB=1 TEST_DB_NAME=project_search_test DB_HOST=127.0.0.1 DB_PORT=55843 \
DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=bench-local DB_NAME_SERVER=project_search_test \
DB_USER_SERVER=postgres DB_PASSWORD_SERVER=bench-local SECRET_READ_CHAIN=env \
npx vitest run --config vitest.workspace-db.config.ts ../packages/projects/src/actions/projectActions.searchPerformance.db.test.ts
cd "$REPO_ROOT"
git worktree remove --force /tmp/project-search-baseline
cd "$REPO_ROOT/server"
PROJECT_SEARCH_BENCHMARK=1 PROJECT_SEARCH_BENCHMARK_PROJECTS=2500 \
PROJECT_SEARCH_BENCHMARK_OUTPUT="$REPO_ROOT/docs/evidence/project-search-performance-2026-11-23/repaired-head.json" \
REQUIRE_DB=1 TEST_DB_NAME=project_search_test DB_HOST=127.0.0.1 DB_PORT=55843 \
DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=bench-local DB_NAME_SERVER=project_search_test \
DB_USER_SERVER=postgres DB_PASSWORD_SERVER=bench-local SECRET_READ_CHAIN=env \
npx vitest run --config vitest.workspace-db.config.ts ../packages/projects/src/actions/projectActions.searchPerformance.db.test.ts
cd "$REPO_ROOT"
```

Retain `baseline.json` and `repaired-head.json`. Each artifact includes exact revision, project and index volumes, allowed/denied/redacted decision counts, diagnostic full-tenant authorization sweep timings, three end-to-end action timings and database statement timings per term, and `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans for every search statement. It also records PostgreSQL version/settings and index definitions/statistics. Baseline action timings are the actual baseline action timings with record authorization for matched projects. Repaired statement timings separate the candidate lookup from the projected match SQL. Hidden-source text is masked using canonical project and child-resource field/wildcard semantics before the final vector is rebuilt. Search-index text can narrow candidate IDs but cannot return a result by itself.

## Recorded comparison

The committed artifacts are the reproducible evidence; rounded medians are summarized here for review. The same PostgreSQL 15.19 disposable database and 2,500-project/10,000-row corpus were used. Each full authorization diagnostic evaluated 1,250 allowed and 1,250 denied projects, with configured project-description and task-description redactions. Action times below include the real per-candidate authorization evaluation in each revision.

| Search | Baseline SQL median | Repaired SQL median | Baseline action median | Repaired action median | Results |
| --- | ---: | ---: | ---: | ---: | ---: |
| Common (`commonamber`) | 535.0 ms | 90.6 ms total | 795.1 ms | 351.5 ms | 625 |
| Rare (`rarezircon`) | 32.4 ms | 62.7 ms total | 34.4 ms | 66.0 ms | 1 |
| No match | 35.9 ms | 36.0 ms | 36.6 ms | 36.7 ms | 0 |

The common search improves by about 444 ms end to end because the repaired lookup limits source-vector reconstruction to candidate projects instead of rebuilding vectors across the whole index. Rare search increases by about 32 ms (roughly 1.9x, below the stated substantial-regression criterion); no-match is effectively unchanged. The repaired common/rare SQL medians comprise candidate lookup and projected-match statements, reported separately in the JSON artifacts. The baseline action already performs matched-project authorization, so no synthetic authorization adjustment is applied.

This is a deterministic synthetic corpus with uniform project structures, not a production tenant sample. Repeated measurements are three warm-cache samples and are too few for a stable p95. The diagnostic all-project authorization sweep is approximately one second, but selective action timings do not perform that sweep: they authorize only candidate project IDs. Exclusion queries intentionally widen candidate discovery to all visible indexed project entries to avoid filtering on hidden values. No authorization result is skipped for projects that can match, and the final SQL only returns a project after current effective-field matching. A human reviewer should inspect the hidden-field exclusion and child-wildcard database tests, then the saved candidate/final plans and actual action timings.

Run the current-revision confidentiality suite on the same disposable database:

```sh
cd server
REQUIRE_DB=1 TEST_DB_NAME=project_search_test DB_HOST=127.0.0.1 DB_PORT=55843 \
DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=bench-local DB_NAME_SERVER=project_search_test \
DB_USER_SERVER=postgres DB_PASSWORD_SERVER=bench-local SECRET_READ_CHAIN=env \
npx vitest run --config vitest.workspace-db.config.ts ../packages/projects/src/actions/projectActions.searchRedaction.db.test.ts
cd ..
```

Clean up after copying the artifacts:

```sh
docker rm -f project-search-bench-20261123
```

The measured common/rare/no-match terms are in visible project names; the corpus also has redacted description sources under the real policy. The baseline is used only for performance comparison, not as a confidentiality pass. After any search-path change, the current-revision database confidentiality suite must pass before interpreting performance results.

## Exclusion syntax regression verification

On `167a2099f25dfedee0cab847030edd319fcf5fd9`, three new database cases failed because the whitespace-based exclusion check missed parenthesized, quoted-parenthesized, and exclusion-only queries. On `deb9615c947556226daea5476595e4e8140dca32`, all nine database confidentiality cases pass. The tests compare `HarborVault` with an absent term under a description redaction, then change the hidden source and indexed description and repeat the same query. Result membership stays unchanged. A separate control verifies that a visible `HarborVault` description still excludes the project when requested.

The candidate CTE now parses websearch syntax with PostgreSQL and detects `!` in the serialized `tsquery`. Any parsed NOT selects the broad candidate fallback. Candidate authorization and the final projected match remain required. This covers the database's accepted syntax without maintaining a second websearch parser in JavaScript.

Verification on that repair revision:

- Database confidentiality: 1 file, 9 tests passed; three new cases failed before the repair.
- Focused mutation, projection, comments, and UI behavior: 7 files, 54 tests passed.
- Projects package `npm run typecheck` and `npm run build`: passed.
- Baseline and repaired benchmark: 1 test passed on each exact revision shown above.

No app server was started. The benchmark remains a three-sample warm-cache synthetic comparison, with no production or p95 latency claim. Newly edited positive search terms still depend on index refresh for candidate discovery. Exclusion searches deliberately authorize a broader candidate set and can cost more than selective positive searches.
