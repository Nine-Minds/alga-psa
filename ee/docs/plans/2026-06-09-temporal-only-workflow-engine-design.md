# Temporal-only workflow engine

Workflow runtime V2 currently supports two execution engines: Temporal (the
default) and a legacy DB-polling engine. The split is selected per-process by
environment flags, which lets the API server and the workflow worker disagree
about who executes a run. When they disagree — or when the producer and worker
resolve different Temporal task queues — a click on **Run** or **Replay**
creates a `workflow_runs` row that nothing ever executes. The run sits in
`RUNNING` with zero steps, and to the operator the button "did nothing."

This change removes the DB engine entirely. Temporal becomes the only engine,
on one task queue, with no per-process configuration to get wrong.

## Failure modes this eliminates

1. **Engine flag mismatch.** The server defaults new runs to
   `engine='temporal'` unless `WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING` is
   false (`ee/packages/workflows/src/lib/workflowRunLauncher.ts`), while the
   worker only starts the DB poller when
   `WORKFLOW_RUNTIME_V2_ENABLE_DB_POLLING=true`
   (`services/workflow-worker/src/index.ts`). Set the first flag to false on
   the server without setting the second on the worker and every new run is
   stranded.
2. **Task-queue split brain.** The worker honors a
   `WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE` override
   (`services/workflow-worker/src/v2/WorkflowRuntimeV2TemporalWorker.ts`), but
   the producer hardcodes the contract constant
   (`ee/packages/workflows/src/lib/workflowRuntimeV2Temporal.ts`). Any
   environment that sets the variable starts runs on a queue nobody polls.
3. **Legacy run controls that 409 on Temporal runs.** Retry, Resume, and
   Requeue Event only work for DB-engine runs and hard-fail for Temporal runs
   via `assertLegacyRunControlSupported`
   (`ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`), yet
   the Run Studio shows Retry on any FAILED run.
4. **Replay submits redacted payloads.** The Replay dialog pre-fills its
   payload editor from `run.input_json` as returned by `getWorkflowRunAction`,
   which applies `applyRunStudioRedactions`. Submitting unedited sends the
   redaction placeholders as an explicit payload override.
5. **Silent stuck runs.** A run accepted by Temporal but never picked up (a
   down worker, a queue backlog) shows as `RUNNING` with no steps and no
   warning.

## Design

### Launch path and task queue

`launchPublishedWorkflowRun` always writes `engine='temporal'` and always
starts the Temporal workflow; `isTemporalPollingEnabled()` is deleted.
`StartRunParams` loses its `engine` parameter — `startRun` writes
`'temporal'` unconditionally.

The task queue becomes the single constant in
`workflowRuntimeV2TemporalContract.ts`, used verbatim by both producer and
worker. The env override in `WorkflowRuntimeV2TemporalWorker` and the
`WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE` compose plumbing are removed.
Environment isolation remains the job of `TEMPORAL_ADDRESS` and
`TEMPORAL_NAMESPACE`.

### Worker service

`services/workflow-worker/src/index.ts` starts the Temporal worker and the
event-stream worker unconditionally. Both `WORKFLOW_RUNTIME_V2_ENABLE_*`
flags disappear. Both DB-poller classes are deleted:

- `services/workflow-worker/src/v2/WorkflowRuntimeV2Worker.ts`
- `shared/workflow/workers/WorkflowRuntimeV2Worker.ts`

The `workflow_data_store` expiry sweep currently embedded in the shared
poller is not engine work; it moves to a small standalone interval module in
the worker service.

### Server actions and event routing

Deleted, including API routes and UI entry points:

- `retryWorkflowRunAction` (`POST /api/workflow-runs/[runId]/retry`)
- `resumeWorkflowRunAction` (`POST /api/workflow-runs/[runId]/resume`)
- `requeueWorkflowRunEventWaitAction` (`POST /api/workflow-runs/[runId]/requeue`)
- `assertLegacyRunControlSupported` / `throwUnsupportedTemporalRunControlAction`

Simplified to the Temporal path only (engine branches removed):

- `cancelWorkflowRunAction`
- `resumeWorkflowRunFromQuotaPauseAction` (always signals quota resume)
- `submitWorkflowEventAction` and the event-stream worker's
  `engine !== 'temporal'` skip
- `server/src/lib/jobs/handlers/workflowQuotaResumeScanHandler.ts`

Replay (`replayWorkflowRunAction`) remains the operator recovery path for
failed runs: a fresh Temporal run with the original payload.

### DB interpreter deletion

The live Temporal path executes runs through the interpreter in
`ee/temporal-workflows/src/workflows/` plus per-step activities; it never
calls `WorkflowRuntimeV2.executeRun`. The only `executeRun` callers are the
legacy actions, the DB pollers, the quota handler's else-branch, and the
exported-but-never-invoked `executeWorkflowRuntimeV2Run` activity. With those
gone, the following are deleted from
`shared/workflow/runtime/runtime/workflowRuntimeV2.ts`:

- `executeRun`, `acquireRunnableRun`, `resumeRunFromEvent`,
  `resumeRunFromTimeout`
- the private step/action executor loop, `loadEnvelope`, `persistSnapshot`
- `executeWorkflowRuntimeV2Run` in
  `ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts`

`startRun` stays — the launcher and the child-run activity
(`startWorkflowRuntimeV2ChildRun`) both use it.

Kept as read-only history: the `engine` column and its `'db'` value, the
`workflow_run_snapshots` table and `WorkflowRunSnapshotModelV2` (Run Studio
still renders snapshots on pre-cutover runs; bulk-delete and tenant-deletion
cleanup still reference the table). Nothing writes new snapshots.

### Run Studio UI

`WorkflowRunDetailsPanel` drops the Retry, Resume, and Requeue Event buttons
and handlers; Replay, Cancel, and Export remain. Replay changes in two ways:

1. The payload is submitted only when the operator edits the pre-filled JSON.
   Unedited replays send no payload, and the server falls back to the
   original, unredacted `input_json`.
2. On success the UI navigates to the new run instead of staying on the old
   one.

### Stuck-run visibility

The run details panel shows a warning banner when a run is `RUNNING` with
zero steps and `started_at` is more than ~60 seconds old: the run is queued
and no worker has picked it up. This uses data the panel already fetches.

### Data migration

A migration finalizes stranded non-Temporal runs: rows with `engine` null or
`'db'` still in `RUNNING`/`WAITING` get `status='CANCELED'`,
`completed_at=now()`, and an `error_json` note that the DB execution engine
was removed; their open `workflow_run_waits` are resolved. Terminal
historical rows are untouched.

### Deployment

Temporal services merge from `docker-compose.temporal.ee.yaml` into
`docker-compose.ee.yaml` and the overlay file is deleted — an EE stack
without Temporal is not a valid deployment. The playwright workflow-deps
compose moves from DB polling to the Temporal stack. All engine env flags
disappear from compose files.

### Testing

- Delete `workflowEngineReferenceWorkflows.db.test.ts`; its coverage lives in
  the Temporal interpreter suite
  (`workflow-runtime-v2-run-workflow.test.ts`).
- Rewrite or delete the e2e/integration tests that drive
  `WorkflowRuntimeV2Worker`/`executeRun` directly
  (`server/src/test/e2e/workflowRuntimeV2.e2e.test.ts`,
  `server/src/test/integration/workflowRuntimeV2.control.integration.test.ts`,
  `server/src/test/integration/workflowRuntimeV2.publish.integration.test.ts`)
  — roughly 60–80 cases. Temporal-specific cases in those files survive.
- Remove flag-toggling cases from the launcher and worker-startup unit tests.
- Add: launcher always-temporal assertions, migration coverage, replay
  payload-dirty logic, stuck-run banner rendering.
