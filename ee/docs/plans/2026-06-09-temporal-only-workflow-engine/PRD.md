# PRD: Temporal-only workflow engine

Design: [`../2026-06-09-temporal-only-workflow-engine-design.md`](../2026-06-09-temporal-only-workflow-engine-design.md)
Branch: `fix/workflow-replay-noop`

## Problem

Workflow runtime V2 ships two execution engines — Temporal and a legacy
DB-polling engine — selected per-process by environment flags. The API server
and the workflow worker can disagree about which engine is live, and the
Temporal producer and worker can resolve different task queues. Either
mismatch strands new runs: a `workflow_runs` row is created, stays `RUNNING`
with zero steps, and the operator experiences the Run/Replay button as doing
nothing. A customer reported exactly this (with video); internal testing on a
correctly-configured stack could not reproduce it.

Adjacent defects in the same surface: the Run Studio shows Retry/Resume/
Requeue buttons that hard-fail with 409 on Temporal runs; Replay submits the
redacted `input_json` as an explicit payload override when redaction is
configured; and a queued-but-unworked run gives no visual indication that
anything is wrong.

## User value

Operators get a run/replay surface where every visible control works on every
run, misconfiguration can no longer silently strand runs, and a genuinely
stuck run announces itself instead of impersonating a healthy one.

## Goals

1. Temporal is the only execution engine; no flag combination can produce a
   run that nothing executes.
2. One task queue constant shared by producer and worker; no env override.
3. Legacy DB-only run controls (retry/resume/requeue) and the dead DB
   interpreter are deleted, not stranded as dead code.
4. Replay never submits redacted payloads and lands the operator on the new
   run.
5. Runs that are queued but unworked for >60s are visibly flagged.
6. Stranded non-Temporal runs in existing databases are finalized honestly
   (CANCELED with an explanatory error).
7. Every EE compose stack includes Temporal; the overlay file disappears.

## Non-goals

- Temporal-native retry-from-failed-step (Replay is the recovery path).
- Re-launching historical stranded runs on Temporal.
- Deleting the `engine` column, `'db'` historical values, or the
  `workflow_run_snapshots` table (kept for reading pre-cutover runs).
- Refactoring the Temporal interpreter/activities themselves.
- New monitoring/alerting beyond the in-app stuck-run banner.

## Primary flows

1. **Run now**: designer or runs-list → Run dialog → `startWorkflowRunAction`
   → `launchPublishedWorkflowRun` → always `engine='temporal'`, always
   `client.workflow.start` on the contract task queue → navigate to run page.
2. **Replay**: run details → Replay → unedited payload sends nothing (server
   uses original unredacted `input_json`); edited payload sends the edit →
   new Temporal run → UI navigates to it.
3. **Cancel / quota resume**: always the Temporal signal path.
4. **Stuck run**: run page shows "queued, waiting for worker" banner when
   `RUNNING` + zero steps + age > 60s.

## Data / migration

One Knex migration: `workflow_runs` where `engine` is null or `'db'` and
`status` in (`RUNNING`,`WAITING`) → `status='CANCELED'`,
`completed_at=now()`, `error_json` noting the temporal-only cutover; resolve
their open `workflow_run_waits`. Terminal rows untouched.

## Risks

- **Test rewrite breadth**: ~60–80 e2e/integration cases drive the DB
  executor directly; rewrites must preserve coverage of run semantics, not
  just delete it. Mitigation: the ~50-case Temporal interpreter suite already
  covers step semantics; migrate only control-surface tests.
- **Hidden DB-engine dependents**: any deployment or script still setting
  `WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING=false` will now run Temporal
  regardless. Compose defaults are updated in this change; external/infra
  repos must be swept separately.
- **Migration on large tables**: status update is bounded by an index on
  status; affected rows expected to be few.

## Acceptance criteria

- `grep -r WORKFLOW_RUNTIME_V2_ENABLE` over the repo returns nothing
  (code, compose, tests).
- No code path writes `engine` other than `'temporal'`.
- Producer and worker both compile against the single task-queue constant;
  the env var is gone.
- Retry/Resume/Requeue buttons, actions, and routes are gone; Replay, Cancel,
  Export remain and work on Temporal runs.
- Unedited Replay of a redaction-configured run executes with the original
  payload (verified by run input of the new run).
- Replay navigates to the new run.
- A run with zero steps older than 60s renders the queued-warning banner.
- Migration cancels a seeded stranded run and resolves its waits; leaves
  terminal rows and Temporal runs untouched.
- `docker compose -f docker-compose.ee.yaml` brings up a stack where a
  manually started workflow executes end to end.
- Full test suite green.
