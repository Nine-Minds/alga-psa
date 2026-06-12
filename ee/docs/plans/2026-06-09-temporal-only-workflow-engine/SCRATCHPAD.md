# Scratchpad: temporal-only workflow engine

## Origin

Customer video: Run button "did nothing"; internal testing couldn't reproduce.
Investigation concluded the UI path always toasts/navigates/disables — the
silent failure modes are downstream (run created, nothing executes it).
Design: `../2026-06-09-temporal-only-workflow-engine-design.md`.

## Key discoveries (verified against code, 2026-06-09)

- Producer hardcodes the task queue (`workflowRuntimeV2Temporal.ts:42-46`);
  worker honors `WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE`
  (`WorkflowRuntimeV2TemporalWorker.ts:61`). Override ⇒ split brain.
- Server defaults engine to temporal unless
  `WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING` is falsy
  (`workflowRunLauncher.ts:20-22`); worker DB poller is opt-in via
  `WORKFLOW_RUNTIME_V2_ENABLE_DB_POLLING` (`index.ts:62-92`). Mismatch ⇒
  stranded `engine='db'` runs.
- `executeWorkflowRuntimeV2Run` (activities:36) is exported but never invoked
  by any workflow or worker registration — the live Temporal path is the
  interpreter + per-step activities. Hence the whole DB interpreter
  (`executeRun` & co.) is orphaned once legacy actions/workers go.
- Temporal activities never write `workflow_run_snapshots` (grep: zero
  snapshot references in activities). Snapshots are DB-interpreter artifacts;
  keep tables/models for historical reads only.
- TWO DB poller copies: `services/workflow-worker/src/v2/` (stripped) and
  `shared/workflow/workers/` (canonical; also sweeps `workflow_data_store`
  expiry — must be relocated, it is not engine work).
- Legacy controls hard-409 on temporal runs via
  `assertLegacyRunControlSupported` (actions:1259), but the panel shows
  Retry for ANY FAILED run (`canRetry`, panel:906) — guaranteed 409 trap.
- Replay pre-fills payload from `getWorkflowRunAction`'s **redacted**
  `input_json` (actions:2326-2332; panel:517-525) and always submits it
  (`hasExplicitReplayPayload`, actions:3253) ⇒ replays run with `[REDACTED]`
  placeholders when redaction configured.
- Replay success only toasts and refreshes the OLD run (panel:1002-1004) —
  no navigation to the new run. Big contributor to "did nothing" perception.
- `docker-compose.ee.yaml:240` sets TEMPORAL_POLLING=false — base EE compose
  relies on the DB engine unless `docker-compose.temporal.ee.yaml` overlay is
  applied. Appliance flux profile sets neither flag (defaults = temporal).
- Toasts are fine: `ThemedToaster` mounted in root layout at zIndex 999999,
  above dialog z-70. UI can't silently swallow errors.

## Decisions (Robert, 2026-06-09)

1. Scope: full engine removal (not config-only, not interpreter rewrite).
2. Retry/Resume/Requeue deleted; Replay is the operator recovery story.
3. Migration cancels stranded non-temporal RUNNING/WAITING runs.
4. Bundle the redacted-replay-payload fix and the stuck-run banner.
5. Merge Temporal services into base `docker-compose.ee.yaml`; delete overlay.

## Open questions / watch-outs for implementation

- `launchPublishedWorkflowRun`'s `execute?: boolean` param: check remaining
  callers (schedules?) before assuming always-start; `execute:false` + db
  engine used to mean "poller will pick it up" — that semantic dies with the
  poller.
- `workflowRunStartLimiter` and concurrency checks are duplicated between
  `startWorkflowRunAction` and `launchPublishedWorkflowRun` — possible
  follow-up simplification, out of scope here.
- i18n: removing panel buttons orphans `runDetails.actions.retry/resume/
  requeueEvent` + dialog keys across locale files — sweep them.
- e2e rewrite needs a Temporal test target: check what
  `WorkflowRuntimeV2TemporalWorker.integration.test.ts` uses (likely
  TestWorkflowEnvironment) and reuse the harness.
- External infra repos may still set the deleted env flags — harmless after
  removal (code ignores them), but sweep separately.
- Stranded-run migration: also check `workflow_run_waits` rows whose run is
  being canceled — resolve with a status that the run studio renders sanely.

## Implementation notes (2026-06-09)

- `launchPublishedWorkflowRun`'s `execute` flag was only ever passed as `true`
  (4 call sites) — removed along with the engine ternary. `executionKey` is
  genuinely used (schedules, webhooks, event launch) and stays.
- `WorkflowRuntimeV2` is now only the run-row projection writer (`startRun`);
  the whole DB interpreter (~1,300 lines) was deleted after confirming the
  Temporal interpreter never called it (`executeWorkflowRuntimeV2Run` was
  exported but never registered/invoked).
- `services/workflow-worker/src/v2/WorkflowRuntimeV2Worker.ts` was already
  unreferenced (index.ts imported the shared copy) — both deleted.
- Bulk Resume in `WorkflowRunList` used the legacy resume action — removed
  with the per-run buttons; bulk Cancel stays.
- Replay payload-dirty detection compares the textarea string against the
  pre-filled pristine string (ref) — exact-match is sufficient because
  untouched textareas don't reformat.
- `server/src/test/unit/workflowRunLauncher.unit.test.ts` fails to LOAD even
  unmodified (pre-existing: `@alga-psa/db/workDate` unresolvable through
  `importOriginal` of the runtime in this worktree). Updated for the new API
  anyway; failure is environmental, also see quota test's stale `tenant_id`
  field which suggests these server unit tests aren't in the active CI gate.
- Playwright workflow suites: host-run server needs `TEMPORAL_ADDRESS`
  pointing at the new `temporal-playwright` service (host port 17233 via
  `PLAYWRIGHT_TEMPORAL_PORT`) for replay/run-start flows to function.
- ee/server full typecheck needs `NODE_OPTIONS=--max-old-space-size=12288`.

## Remaining follow-ups (tests.json items still false)

- Migration coverage (T046–T049): the stranded-run migration has no automated
  test; needs the DB-backed integration harness.
- Stuck-run banner (T042–T045) and removed-button absence (T033–T035): no
  component tests written; behavior is hand-verifiable in the run studio.
- Replay UI dirty-detection (T036/T039): server-side contract is covered;
  the client-side "send nothing when unedited" path is not unit-tested.
- Full-stack runs (T030/T050/T052): need a live compose stack with Temporal;
  `docker compose -f docker-compose.ee.yaml up` then start a manual run.
- DB-backed integration suites (control/publish/e2e) were verified by
  typecheck + vitest collection only in this worktree (no DB available);
  CI run pending.
- EventStreamWorker vitest suite (7 cases) fails in this worktree on real
  Redis/mock-resolution grounds — confirmed identical failure on pre-change
  code; not a regression.

## Commands

- Find engine references: `grep -rn "engine.*'db'\|'db'.*engine" --include="*.ts" shared ee services server | grep -v node_modules`
- Flag sweep: `grep -rn "WORKFLOW_RUNTIME_V2_ENABLE" --include="*" . | grep -v node_modules | grep -v docs/plans`
- Stranded runs (prod triage): `select run_id, status, engine, started_at from workflow_runs where (engine is null or engine='db') and status in ('RUNNING','WAITING');`
