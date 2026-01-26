# Scratchpad

## Status

- Harness unit tests green; next: run real fixtures in `ls | sort` order against the running EE stack.

## Notes / Decisions

- PRD scope interpretation: “implement PRD” means actually executing the iteration loop (import → isolate → trigger → wait → assert → cleanup → artifacts → commit) across the fixture suite until all tests are green.
- Start with harness unit tests (no server required), then move to fixture runs (requires running server + Postgres + tenant + auth cookie/api key).
- Adjusted several fixtures to prefer HTTP cleanup (with DB fallback) so reruns don’t accumulate state and stubbed tests reflect real behavior.
- Harness CLI now allows omitting `--cookie*` when `WORKFLOW_HARNESS_API_KEY`/`ALGA_API_KEY` is set (auth still required one way or the other).

## Commands / Runbook

- `ls planning/adhoc/2026-01-26-181023-the-iteration-loop` (confirmed plan artifacts present)
- `ls ee/test-data/workflow-harness | sort | head` (confirmed fixture catalog exists)
- `node --test tools/workflow-harness/tests/*.test.cjs` (green after fixture + harness tweaks)
- `docker ps` (confirmed EE stack already running: `prep_1_0_server_ee`, `10-preparation-workflow-worker-1`, `prep_1_0_postgres`, etc.)
- `docker port prep_1_0_server_ee` (server exposed on `localhost:3010`)
- `docker port prep_1_0_postgres` (postgres exposed on `localhost:55432`)
- `psql -h localhost -p 55432 -U postgres -d server -c "select tenant, client_name from tenants ..."` (found the active tenant UUID to use for fixture runs)

## Gotchas

- (Anything likely to bite you later)
