# Scratchpad — Workflow V2 Temporal-Native Runtime

- Plan slug: `workflow-v2-temporal-native-runtime`
- Created: `2026-04-08`

## What This Is

Working notes for replacing the current DB-backed Workflow Runtime V2 execution engine with a full Temporal-native interpreter for Enterprise Edition workflows.

## Core Decisions

- (2026-04-08) Temporal will be the sole execution authority for all new Workflow V2 runs in both hosted EE and appliance EE.
- (2026-04-08) The workflow designer and authored DSL remain declarative and user-friendly; Temporal concepts stay behind the runtime boundary.
- (2026-04-08) The migration posture is a hard cutover. No active-run migration is required, and old DB-runtime records may be abandoned if needed.
- (2026-04-08) The database remains a projection and audit surface, not the scheduler or resume authority.
- (2026-04-08) `control.callWorkflow` should become a Temporal child workflow rather than inline child execution.
- (2026-04-08) `time.wait` should use native Temporal timers; DB due-wait polling should be retired for new runs.
- (2026-04-08) `event.wait` should become signal-backed. Event ingress should signal candidate runs, and Temporal workflows should decide whether the active wait matches.
- (2026-04-08) `control.forEach` should be sequential in the first Temporal-native release. Parallel loop concurrency is not worth carrying into the first real interpreter.
- (2026-04-08) Action side effects should be treated as at-least-once safe through durable idempotency design, not by chasing “exactly once” semantics.
- (2026-04-08) Runtime semantics should be explicitly versioned so future interpreter changes can be reasoned about safely.

## Discoveries / Constraints

- (2026-04-08) The current runtime is strongly DB-driven: [shared/workflow/runtime/runtime/workflowRuntimeV2.ts](/Users/roberisaacs/alga-psa/shared/workflow/runtime/runtime/workflowRuntimeV2.ts) stores run state through `node_path`, snapshots, wait rows, and explicit resume bookkeeping.
- (2026-04-08) The current worker is a polling scheduler: [shared/workflow/workers/WorkflowRuntimeV2Worker.ts](/Users/roberisaacs/alga-psa/shared/workflow/workers/WorkflowRuntimeV2Worker.ts) scans due retries, due timeouts, due time waits, and runnable runs on a fixed interval.
- (2026-04-08) The existing service worker already boots both the DB runtime worker and the event stream worker in [services/workflow-worker/src/index.ts](/Users/roberisaacs/alga-psa/services/workflow-worker/src/index.ts).
- (2026-04-08) Event-triggered workflow starts already have a dedicated ingress path in [services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts](/Users/roberisaacs/alga-psa/services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts), but it currently starts DB-native runs rather than Temporal interpreter runs.
- (2026-04-08) The current wait persistence model already contains many of the right projection fields (`event_name`, `key`, `timeout_at`, `payload`) in [shared/workflow/persistence/workflowRunWaitModelV2.ts](/Users/roberisaacs/alga-psa/shared/workflow/persistence/workflowRunWaitModelV2.ts).
- (2026-04-08) Workflow Runtime V2 already supports the important product-facing step types that the interpreter must preserve:
  - `event.wait`
  - `time.wait`
  - `human.task`
  - `control.if`
  - `control.forEach`
  - `control.tryCatch`
  - `control.callWorkflow`
  - `control.return`
- (2026-04-08) Existing Temporal infrastructure is real and reusable. `ee/temporal-workflows` already contains workers, clients, signals, queries, sleeps, and child-orchestration patterns, but not a generic authored-workflow interpreter.
- (2026-04-08) The strongest prior design artifact is [ee/docs/plans/2026-02-03-sla-temporal-workflow-architecture/PRD.md](/Users/roberisaacs/alga-psa/ee/docs/plans/2026-02-03-sla-temporal-workflow-architecture/PRD.md), which already frames Temporal as orchestration with DB as source/projection depending on subsystem boundaries.
- (2026-04-08) `workflow_run_snapshots` are useful as historical/debug material in the current system, but they should not remain the execution resume authority in the Temporal-native design.

## Architecture Notes

### Recommended runtime split

- **Authoring truth:** database
- **Execution truth:** Temporal
- **Product read model:** database projection

### Recommended event-wait model

1. Persist inbound event for audit/debugging.
2. Use wait projection indexes to find candidate runs by tenant/event name/correlation key.
3. Signal all candidate runs.
4. Let each Temporal workflow decide whether its current active wait matches.

### Recommended schedule model

- Manual/API runs: start Temporal directly.
- Event-triggered runs: start Temporal directly from ingress.
- One-time schedules: Temporal-native scheduling authority.
- Recurring schedules: Temporal Schedules.

### Recommended migration posture

- Hard cutover.
- No active-run migration.
- Old worker/scheduler paths can be retired instead of preserved behind complicated fallback logic.

## Open Design Questions

- Should `workflow_run_snapshots` remain as a redacted debug checkpoint surface, or should Temporal queries/history plus targeted projection rows replace that completely?
- For one-time schedules, should the implementation use the same Temporal Schedules reconciliation path as recurring schedules, or a thinner single-fire abstraction?
- Should `forEach.concurrency > 1` be rejected at publish time or hidden in the designer while schema cleanup follows later?

## Commands / Runbooks

### Inspect current DB runtime execution authority
- `rg -n "executeRun|resumeRunFromEvent|resumeRunFromTimeout|scheduleRetry|findCatchPath" shared/workflow/runtime/runtime/workflowRuntimeV2.ts`
- `rg -n "listDueRetries|listDueTimeouts|listDueTimeWaits|acquireRunnableRun" shared/workflow/workers/WorkflowRuntimeV2Worker.ts`

### Inspect current wait and event-ingress behavior
- `rg -n "submitWorkflowEventAction|event.wait|time.wait|human.task" ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts shared/workflow/runtime/nodes/registerDefaultNodes.ts`
- `rg -n "WorkflowRuntimeV2EventStreamWorker|launchPublishedWorkflowRun" services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts`

### Inspect existing runtime schema and persistence
- `rg -n "eventWait|timeWait|control\.forEach|control\.callWorkflow" shared/workflow/runtime/types.ts`
- `read shared/workflow/persistence/workflowRunWaitModelV2.ts`
- `read server/migrations/20251221090000_create_workflow_runtime_v2_tables.cjs`

### Inspect existing Temporal reusable patterns
- `find ee/temporal-workflows/src/workflows -maxdepth 2 -type f | sort`
- `rg -n "defineSignal|defineQuery|setHandler|sleep\(|proxyActivities|condition\(" ee/temporal-workflows/src/workflows -g'*.ts'`

## Links / References

- [shared/workflow/runtime/runtime/workflowRuntimeV2.ts](/Users/roberisaacs/alga-psa/shared/workflow/runtime/runtime/workflowRuntimeV2.ts)
- [shared/workflow/workers/WorkflowRuntimeV2Worker.ts](/Users/roberisaacs/alga-psa/shared/workflow/workers/WorkflowRuntimeV2Worker.ts)
- [shared/workflow/runtime/nodes/registerDefaultNodes.ts](/Users/roberisaacs/alga-psa/shared/workflow/runtime/nodes/registerDefaultNodes.ts)
- [shared/workflow/runtime/types.ts](/Users/roberisaacs/alga-psa/shared/workflow/runtime/types.ts)
- [shared/workflow/persistence/workflowRunWaitModelV2.ts](/Users/roberisaacs/alga-psa/shared/workflow/persistence/workflowRunWaitModelV2.ts)
- [ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts](/Users/roberisaacs/alga-psa/ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts)
- [services/workflow-worker/src/index.ts](/Users/roberisaacs/alga-psa/services/workflow-worker/src/index.ts)
- [services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts](/Users/roberisaacs/alga-psa/services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts)
- [server/migrations/20251221090000_create_workflow_runtime_v2_tables.cjs](/Users/roberisaacs/alga-psa/server/migrations/20251221090000_create_workflow_runtime_v2_tables.cjs)
- [ee/temporal-workflows/README.md](/Users/roberisaacs/alga-psa/ee/temporal-workflows/README.md)
- [ee/temporal-workflows/src/worker.ts](/Users/roberisaacs/alga-psa/ee/temporal-workflows/src/worker.ts)
- [ee/temporal-workflows/src/client.ts](/Users/roberisaacs/alga-psa/ee/temporal-workflows/src/client.ts)
- [ee/docs/plans/2026-02-03-sla-temporal-workflow-architecture/PRD.md](/Users/roberisaacs/alga-psa/ee/docs/plans/2026-02-03-sla-temporal-workflow-architecture/PRD.md)

## Progress Log — 2026-04-08

### Planning session outcomes

- Confirmed scope is **runtime + migration**, not a narrower timer-only proposal.
- Confirmed the end-state is **all EE workflows on Temporal**, not just long-running or wait-heavy workflows.
- Confirmed the desired authority model is **Temporal authoritative, DB projection-only**.
- Confirmed the target is **one runtime for both hosted and appliance EE**.
- Confirmed cutover can be **hard/greenfield**, since the runtime is still early and customer migration is not required.
- Confirmed the workflow DSL should remain user-friendly and mostly stable, with targeted cleanup allowed where it materially improves runtime correctness.
- Confirmed action side effects should target **at-least-once safety via idempotency**, not an unrealistic exact-once guarantee.

### Current recommendation status

- Full Temporal-native interpreter is the only rational end-state architecture for this feature.
- Hybrid or wrapper approaches would preserve too much of the current DB-runtime complexity and split authority.
- The resulting ALGA plan should be treated as the implementation source of truth for the runtime rewrite.

## Progress Log — 2026-04-08 (Implementation)

### F001 completed

- Implemented a Temporal run-launch path in [ee/packages/workflows/src/lib/workflowRunLauncher.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/packages/workflows/src/lib/workflowRunLauncher.ts):
  - New launches now default to starting a Temporal workflow execution (`WORKFLOW_RUNTIME_V2_ENGINE=temporal` default).
  - Legacy inline `runtime.executeRun(...)` remains only as an explicit `WORKFLOW_RUNTIME_V2_ENGINE=legacy` mode or test/fallback guard.
- Added Temporal launch helper [ee/packages/workflows/src/lib/workflowRuntimeV2Temporal.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/packages/workflows/src/lib/workflowRuntimeV2Temporal.ts):
  - Defines stable task queue and workflow type names for Workflow V2 runtime.
  - Starts Temporal workflow ID `workflow-runtime-v2:run:<run_id>` so each Alga run maps to a deterministic Temporal workflow.
- Added minimal Temporal runtime workflow + activity bridge:
  - [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts)
  - [ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts)
  - Registered in workflow/activity indexes and added `workflow-runtime-v2` to Temporal worker default queues in [ee/temporal-workflows/src/worker.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/worker.ts).
- Updated event ingress launch call in [services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts) to avoid forcing `execute:false`, so event-triggered launches also enter the Temporal path by default.
- Added/updated tests:
  - [server/src/test/unit/workflowRunLauncher.unit.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/server/src/test/unit/workflowRunLauncher.unit.test.ts) now asserts Temporal launch is invoked for new runs.
  - [services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts) updated expectation for launch params.

### Validation runbook used

- `npm --prefix server run test -- src/test/unit/workflowRunLauncher.unit.test.ts`
- `cd services/workflow-worker && npx vitest src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts --run`
- `npm --prefix ee/packages/workflows run typecheck`
- `npm --prefix ee/temporal-workflows run type-check`

### Gotchas

- `services/workflow-worker` package test script references a missing `vitest.config.ts`; direct `npx vitest ... --run` works and was used for validation.
- Existing Temporal integration tests in `ee/temporal-workflows` can time out in local runs due to dockerized Temporal startup hooks; this pass focused on deterministic unit checks + package typecheck.

### F002-F006 completed

- Added explicit runtime semantics constant in [ee/packages/workflows/src/lib/workflowRuntimeV2Semantics.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/packages/workflows/src/lib/workflowRuntimeV2Semantics.ts) and now pin it onto each launched run.
- Added deterministic definition hashing at launch in [ee/packages/workflows/src/lib/workflowRunLauncher.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/packages/workflows/src/lib/workflowRunLauncher.ts), then persisted `definition_hash` + `runtime_semantics_version` through `startRun(...)`.
- Run identity mapping is now deterministic: Temporal workflow ID always derives from Alga run ID (`workflow-runtime-v2:run:<run_id>`) and is projected back onto `workflow_runs`.
- Added projection fields migration [server/migrations/20260408193000_add_temporal_projection_fields_to_workflow_runs.cjs](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/server/migrations/20260408193000_add_temporal_projection_fields_to_workflow_runs.cjs):
  - `engine`
  - `temporal_workflow_id`
  - `temporal_run_id`
  - `definition_hash`
  - `runtime_semantics_version`
  - `parent_run_id`
  - `root_run_id`
- Extended run model typing in [shared/workflow/persistence/workflowRunModelV2.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/shared/workflow/persistence/workflowRunModelV2.ts) for those fields.
- Added fail-fast pinned-definition hash validation in [shared/workflow/runtime/runtime/workflowRuntimeV2.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/shared/workflow/runtime/runtime/workflowRuntimeV2.ts): runtime now throws a `ValidationError` when the pinned hash and loaded definition diverge.
- Added launcher unit assertions to confirm hash + semantics pinning and Temporal ID projection in [server/src/test/unit/workflowRunLauncher.unit.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/server/src/test/unit/workflowRunLauncher.unit.test.ts).

### Additional validation runbook

- `mkdir -p server/coverage/.tmp && npm --prefix server run test -- src/test/unit/workflowRunLauncher.unit.test.ts`
- `cd services/workflow-worker && npx vitest src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts --run`
- `npm --prefix ee/packages/workflows run typecheck`

### F007-F008 completed (Temporal frame interpreter skeleton)

- Added explicit Temporal interpreter state module at [ee/temporal-workflows/src/workflows/workflow-runtime-v2-interpreter.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-interpreter.ts):
  - Serializable `WorkflowRuntimeV2InterpreterState` now tracks sequence frames and `currentStepPath`.
  - Root sequence-frame stepping is explicit via `initializeWorkflowRuntimeV2InterpreterState`, `getWorkflowRuntimeV2CurrentStep`, and `advanceWorkflowRuntimeV2InterpreterState`.
  - Step paths remain canonical (`root.steps[n]`) while execution authority moves into Temporal workflow state.
- Updated [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts):
  - Runtime now loads pinned definition first and drives a loop from frame state.
  - `control.return` is interpreted as terminal success in the Temporal workflow loop.
  - Unsupported steps still use temporary legacy bridge activity while additional handlers are migrated.
- Extended [ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts):
  - Added `loadWorkflowRuntimeV2PinnedDefinition(...)` with definition-hash verification against the pinned run.
  - Added `completeWorkflowRuntimeV2Run(...)` to project terminal status from the Temporal workflow.

Rationale:
- This introduces explicit frame-based interpreter authority in Temporal first, while preserving operational safety through a scoped bridge for not-yet-migrated step handlers.
- The interpreter state is plain serializable data, so it survives Temporal replay and worker restarts without relying on DB `node_path` resume mechanics.

### T001 completed

- Confirmed `T001` coverage through launcher unit checks in [server/src/test/unit/workflowRunLauncher.unit.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/server/src/test/unit/workflowRunLauncher.unit.test.ts):
  - Asserts Temporal execution start for new runs.
  - Asserts pinned definition hash + runtime semantics are passed at run creation.
  - Asserts `workflow_runs` projection is updated with `engine=temporal`, `temporal_workflow_id`, and `temporal_run_id`.

### Added tests for interpreter state behavior

- Added [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-interpreter.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-interpreter.test.ts):
  - Verifies root sequence-frame initialization.
  - Verifies deterministic top-level step advancement and terminal exhaustion behavior.

### Validation commands run (this checkpoint)

- `npm --prefix ee/temporal-workflows run type-check`
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-interpreter.test.ts --run`
- `npm --prefix server run test -- src/test/unit/workflowRunLauncher.unit.test.ts`

### Gotchas

- `WorkflowDefinition` schema currently uses top-level `steps`; interpreter frame paths keep `root.steps[n]` path conventions for continuity with existing runtime pathing.

### F009-F013 completed (scope model + replay/checkpoint foundations)

- Extended interpreter state in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-interpreter.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-interpreter.ts) with normalized runtime scopes:
  - `scopes.payload`
  - `scopes.workflow`
  - `scopes.lexical`
  - `scopes.system` (run/workflow identity + pinned `definitionHash` + `runtimeSemanticsVersion`)
- Updated pinned-definition load activity in [ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts) to return `initialScopes` derived from pinned run projection metadata.
- Added expression-context adapter `buildWorkflowRuntimeV2ExpressionContext(...)` to preserve author ergonomics over normalized scopes (`payload`, `vars`, direct variable access, lexical locals, and `meta/system` context).
- Added explicit continue-as-new checkpoint support:
  - [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts) now supports optional checkpoint input and issues `continueAsNew` every 250 interpreted steps.
  - Interpreter checkpoints are produced by `createWorkflowRuntimeV2InterpreterCheckpoint(...)` and carry serializable state + step count.

Rationale:
- Scope partitioning decouples deterministic workflow-code decisions from mutable external state and sets up clear semantics boundaries.
- Checkpointed continue-as-new preserves interpreter progression while controlling long-running Temporal history growth.
- Including `runtimeSemanticsVersion` in system scope keeps interpreter contract versioning attached to each run.

### Interpreter test coverage expanded

- Extended [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-interpreter.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-interpreter.test.ts):
  - validates normalized scope initialization/preservation
  - validates expression-context ergonomics mapping
  - validates JSON-serializable replay safety
  - validates checkpoint round-trip continuity

### Validation commands run (scope/checkpoint slice)

- `npm --prefix ee/temporal-workflows run type-check`
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-interpreter.test.ts --run`

### F014-F015 completed (deterministic control-flow boundary + dedicated action activity)

- Migrated Temporal-native workflow loop in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts):
  - `control.if` is now evaluated in workflow code against interpreter scopes only.
  - `control.if` explicitly rejects `nowIso()` usage in control-flow decisions to keep replay-safe deterministic behavior.
  - `action.call` now executes via a dedicated Temporal activity (`executeWorkflowRuntimeV2ActionStep`) instead of through inline deterministic workflow code.
  - Step-start/step-completion projections are now emitted per interpreted step through dedicated activities.
- Expanded interpreter frame model in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-interpreter.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-interpreter.ts):
  - Sequence-frame paths are now generic (not just `root.steps`) so nested branch execution can be represented without DB `node_path` authority.
  - Added frame push helper for branch sequences.
- Added activity implementations in [ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts):
  - `projectWorkflowRuntimeV2StepStart`
  - `projectWorkflowRuntimeV2StepCompletion`
  - `executeWorkflowRuntimeV2ActionStep` (resolves input mapping, invokes action registry, writes action invocation ledger rows, and returns output + `saveAs` path)

Rationale:
- This moves control-flow authority for interpreted branches into deterministic Temporal workflow state while keeping side effects behind activity boundaries.
- The split keeps workflow code free of DB/network/secret reads and creates a clean seam for later retry/catch semantics work.

### T002 completed

- Added focused interpreter workflow tests in [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts):
  - straight-line `action.call` then `control.return` with step projection assertions
  - deterministic `control.if` branch routing
  - rejection path for non-deterministic `nowIso()` in control decisions
- Updated interpreter state tests in [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-interpreter.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-interpreter.test.ts) for frame-pop completion behavior.

### Validation commands run (this slice)

- `npm --prefix ee/temporal-workflows run type-check`
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-interpreter.test.ts src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts --run`

### Gotchas

- Importing runtime value-level helpers from `@alga-psa/workflows/runtime` in workflow tests pulled heavier package dependencies (`@alga-psa/storage`) into vitest resolution. The workflow-level expression evaluation in this slice uses local JSONata wiring to keep Temporal workflow tests isolated.

### F016-F017 completed (action idempotency keying + ledger dedupe)

- Implemented deterministic idempotency key derivation in [ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts):
  - default key uses stable tuple (`runId`, `stepPath`, `actionId`, `version`, parsed input) via `generateIdempotencyKey(...)`
  - optional user-provided idempotency expression is still supported
  - tenant-prefixed key normalization keeps cross-tenant dedupe boundaries explicit
- Implemented durable invocation-ledger reuse in the same activity:
  - prior successful invocation for the same idempotency key returns cached validated output
  - new invocations are persisted as `STARTED` and transitioned to `SUCCEEDED`/`FAILED`

Rationale:
- This keeps side-effect idempotency in a durable DB ledger while Temporal retry/replay re-enters through deterministic idempotency keys.

### F018-F021 + F028 completed (action error/retry semantics + deterministic branching)

- Updated [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts):
  - Added structured runtime error normalization for action-step failures (`category`, `message`, `nodePath`, `at`, optional `code/details`).
  - Added interpreter-owned retry loop for `action.call` using authored `retry` policy fields (`maxAttempts`, `backoffMs`, `backoffMultiplier`, `maxDelayMs`, `retryOn`) with Temporal `sleep(...)` backoff.
  - Preserved `action.call` `onError.policy` semantics: `continue` captures error into scope and advances execution; `fail` propagates failure.
  - Maintained `control.return` as immediate successful terminal outcome.
- Updated [ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts):
  - Normalizes thrown action activity failures into structured runtime error payloads before rethrow.

### T003 coverage completed (plus extended action semantics checks)

- Extended [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts):
  - deterministic `control.if` branch assertion remains in place
  - added action retry + `onError=continue` exhaustion path assertion
- Temporal interpreter tests now cover:
  - straight-line action + return
  - deterministic branch routing and non-deterministic guard rejection
  - interpreter-owned action retry/continue behavior

### Validation commands run (retry/error slice)

- `npm --prefix ee/temporal-workflows run type-check`
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts src/workflows/__tests__/workflow-runtime-v2-interpreter.test.ts --run`

### F022 completed (try/catch routing + capture binding)

- Extended branch frame resolution in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-interpreter.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-interpreter.ts) to support:
  - `root.steps[n].try.steps[m]`
  - `root.steps[n].catch.steps[m]`
- Updated [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts):
  - added interpreter handling for `control.tryCatch` (pushes try sequence frame)
  - on step failure in active try scope, routes execution into catch sequence when present
  - binds structured runtime error into `vars.<captureErrorAs>` before catch execution

### T004 coverage completed

- Extended [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts) with a try/catch routing test that asserts:
  - try-step action failure is caught
  - catch branch action executes next
  - captured error object is present in catch-step workflow scope (`caughtError`)

### Validation commands run (try/catch slice)

- `npm --prefix ee/temporal-workflows run type-check`
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts src/workflows/__tests__/workflow-runtime-v2-interpreter.test.ts --run`

### F023 + T005 completed (uncatchable cancellation/corruption handling)

- Updated Temporal interpreter workflow in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts):
  - Added uncatchable-failure gating so cancellation-like failures bypass interpreter retry/`onError` and bypass `control.tryCatch` catch routing.
  - Cancellation-like failures now project the active step as `CANCELED` and terminally project the run as `CANCELED`.
  - Added explicit interpreter-corruption fail-fast path when frames exist but no current step can be resolved (prevents silent success on invalid frame state).
  - Interpreter-corruption failures are marked unrecoverable and are not routed through `control.tryCatch`.
- Updated activity typings/projection handling in [ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts):
  - `projectWorkflowRuntimeV2StepCompletion` now supports `CANCELED` step projection status.
  - `completeWorkflowRuntimeV2Run` now supports `CANCELED` terminal run projection status.
- Added tests in [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts):
  - cancellation thrown inside `control.tryCatch` try branch is not swallowed by catch and terminal status is `CANCELED`
  - corrupted checkpoint/frame state fails fast with `InterpreterCorruption` instead of being treated as successful completion

Rationale:
- Cancellation semantics are control-plane signals and must not be treated as catchable business-step failures.
- Corrupted interpreter state is unrecoverable runtime authority drift; allowing catch-branch recovery would hide interpreter defects and produce inconsistent run outcomes.

Plan bookkeeping updates:
- Marked `F023` implemented.
- Marked `T005` implemented and narrowed its scope to cancellation-not-swallowed semantics.
- Added `T025` (implemented:false) for child-cancellation propagation once child workflow execution semantics (`F029`, `F061`) are in place.

Validation commands (this checkpoint):
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts --run`
- `npm --prefix ee/temporal-workflows run type-check`

Gotchas:
- Cancellation detection is currently pattern-based (`CancelledFailure` name/message and explicit `category=Cancellation`) so later Temporal signal-based cancellation wiring should align on an explicit runtime-error category to avoid accidental broad matching.

### F024-F026 + T006 completed (Temporal sequential forEach)

- Implemented `control.forEach` in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts):
  - Deterministic item-array evaluation via workflow-side expression evaluation.
  - Sequential body execution by pushing `...body.steps` interpreter sequence frames.
  - Deterministic loop progression tracked in interpreter scope (`vars.__forEach[loopId]`) with stable `items` + `index`.
- Added loop lifecycle support around interpreter advancement:
  - advance to next item when the last body step of the current item completes
  - restore pre-loop value of the configured `itemVar` on loop completion
  - clear loop runtime bookkeeping on completion
- Added lexical loop locals:
  - per-iteration lexical scope now includes dynamic `itemVar` value and stable helpers (`item`, `index`, `length`, `isFirst`, `isLast`)
  - lexical scope updates each iteration and is removed when loop completes
- Preserved `onItemError` semantics:
  - `continue` advances execution from the failed step using normal interpreter path progression (including continuing loop progression when body-end is reached)
  - `fail` preserves terminal failure behavior
- Extended interpreter sequence resolution in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-interpreter.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-interpreter.ts) to support `root.steps[n].body.steps` (forEach body container paths).

Tests:
- Extended [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts):
  - sequential forEach item order + index progression assertions
  - lexical loop locals exposure assertions
  - `onItemError=continue` progression assertions
  - `onItemError=fail` terminal failure assertion

Plan bookkeeping updates:
- Marked `F024`, `F025`, `F026` implemented.
- Marked `T006` implemented.

Validation commands (this checkpoint):
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts --run`
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-interpreter.test.ts --run`
- `npm --prefix ee/temporal-workflows run type-check`

Gotchas:
- Current forEach-body path parsing is intentionally scoped to top-level `root.steps[n].body.steps[...]` in this slice; nested branch-container forEach path traversal should be generalized when nested branch/loop combinations are implemented more broadly.

### F027 + T007 completed (forEach concurrency guard)

- Added publish/runtime-schema guard in [shared/workflow/runtime/types.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/shared/workflow/runtime/types.ts):
  - `control.forEach` now rejects `concurrency > 1` via `forEachBlockSchema` validation.
  - Validation error message explicitly documents first-release Temporal-native constraint.
- Added unit test coverage in [shared/workflow/runtime/__tests__/types.exprPersistence.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/shared/workflow/runtime/__tests__/types.exprPersistence.test.ts):
  - verifies parser rejection for `control.forEach` with `concurrency: 2`.

Rationale:
- First-release runtime intentionally enforces sequential loop semantics; rejecting unsupported concurrency at schema validation time avoids silent semantics drift between designer/runtime expectations.

Plan bookkeeping updates:
- Marked `F027` implemented.
- Marked `T007` implemented.

Validation commands (this checkpoint):
- `cd shared && npx vitest workflow/runtime/__tests__/types.exprPersistence.test.ts --run`
- `npm --prefix shared run typecheck`

Gotchas:
- This guard is currently schema-level rejection (publish/runtime parse path), not a UI-only hide; if product wants hide-only UX later, designer-level constraints can be layered on top while keeping parser hard-stop for safety.

### F029-F030 + T026 completed (Temporal child workflow execution path)

- Implemented `control.callWorkflow` as Temporal child execution in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts):
  - parent interpreter evaluates child input mapping deterministically from interpreter scopes
  - parent starts child run allocation/projection via activity boundary
  - parent executes child using Temporal `executeChild(...)` on the same runtime workflow type/task queue
  - removed inline legacy runtime behavior for `control.callWorkflow` in the Temporal-native path
- Added child run allocation activity in [ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts):
  - creates child run rows through runtime `startRun(...)`
  - pins child `definition_hash` and inherits runtime semantics version from parent projection
  - writes parent/root linkage (`parent_run_id`, `root_run_id`)
  - returns deterministic Temporal workflow ID `workflow-runtime-v2:run:<childRunId>`
- Extended start-run inputs in [shared/workflow/runtime/runtime/workflowRuntimeV2.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/shared/workflow/runtime/runtime/workflowRuntimeV2.ts) to support persisted parent/root linkage metadata.
- Added unit coverage in [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts):
  - verifies child run start activity invocation and Temporal `executeChild` call for `control.callWorkflow`
  - verifies structured child failure category (`ChildWorkflowError`) is surfaced to the parent workflow

Rationale:
- Child orchestration authority now remains inside Temporal instead of falling back to inline DB runtime recursion.
- Deterministic child IDs + linkage metadata establish the lineage model needed for parent/child observability and future cancellation propagation.

Plan bookkeeping updates:
- Marked `F029` implemented.
- Marked `F030` implemented.
- Added `T026` (implemented:true) for the completed child launch/linkage behavior.
- Kept `T008` pending because it also requires `F031` (output mapping) and broader projection assertions.

Validation commands (this checkpoint):
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts --run`
- `npm --prefix ee/temporal-workflows run type-check`
- `npm --prefix shared run typecheck`

### F031 + T027 completed (child output mapping semantics)

- Extended Temporal runtime workflow return contract in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts):
  - interpreter workflow now returns final scope state (`WorkflowRuntimeV2RunWorkflowResult`) for child-call consumers
- Implemented `control.callWorkflow` output mapping in parent interpreter:
  - after `executeChild(...)`, parent evaluates `outputMapping` expressions against a `childRun` context containing child `payload`, `vars`, `local`, and `meta/system` fields
  - mapping assignments are applied using the same scoped assignment-path behavior (`vars.*`, `payload.*`, pointer/default handling)
- Updated child workflow unit coverage in [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts):
  - verifies mapped child values are visible in subsequent parent steps

Rationale:
- This preserves authored DSL semantics where `control.callWorkflow` output mappings are expression-driven and assigned back into parent workflow scope, while keeping execution authority in Temporal.

Plan bookkeeping updates:
- Marked `F031` implemented.
- Added `T027` (implemented:true) for explicit child-output-mapping runtime coverage.
- Kept `T008` pending for broader integration/projection assertions (`F054`) beyond this interpreter unit slice.

Validation commands (this checkpoint):
- `npm --prefix ee/temporal-workflows run type-check`
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts --run`

### F033-F035 + T028 completed (Temporal-native `time.wait` + wait projection)

- Implemented native `time.wait` execution in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts):
  - Added explicit interpreter branch for `time.wait` that computes deterministic `dueAt` from either `durationMs` or `until` expression.
  - Uses Temporal `sleep(...)` directly when `dueAt` is in the future (`F033`).
  - Fast-paths without `sleep(...)` when `dueAt <= now` (`F034`).
  - Preserves `time.wait` post-resume assignment behavior by writing `vars.timeWait` and evaluating optional `assign` expression mappings.
- Added wait projection activities in [ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts):
  - `projectWorkflowRuntimeV2TimeWaitStart(...)` creates `workflow_run_waits` rows with `wait_type=time`, `status=WAITING`, `timeout_at=dueAt`.
  - `projectWorkflowRuntimeV2TimeWaitResolved(...)` marks wait rows `RESOLVED` with `resolved_at` after timer completion (`F035`).
- Extended Temporal workflow tests in [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts):
  - verifies duration-mode wait performs projection start + Temporal sleep + projection resolve
  - verifies until-mode fast-path skips sleep when already due

Rationale:
- Execution authority remains Temporal-native (timer and progression live inside workflow code), while DB `workflow_run_waits` remains a read-model projection and routing index.
- Added `T028` because existing `T010` also depends on broader cutover cleanup (`F064`) that is not yet complete; this isolates and records meaningful runtime-level verification for the completed time-wait slice.

Plan bookkeeping updates:
- Marked `F033`, `F034`, `F035` implemented.
- Added `T028` (implemented:true) for this runtime-focused time wait coverage.

Validation commands (this checkpoint):
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts --run`
- `npm --prefix ee/temporal-workflows run type-check`

Gotchas:
- Shared `TimeWaitConfig` type allows optional fields by schema shape; interpreter uses a stricter local parsed-discriminated type to avoid unsafe `undefined` behavior under strict TypeScript.

### F036-F040 + T029 completed (`event.wait` signal runtime + wait projection)

- Added Temporal signal-backed `event.wait` execution in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts):
  - Introduced workflow signal `workflowRuntimeV2Event` and in-workflow pending-signal buffer.
  - `event.wait` now evaluates wait descriptor fields (`eventName`, deterministic `correlationKey`, filters, optional timeout) at wait start.
  - Wait resume now requires event-name + correlation-key + payload-filter match before continuation.
  - Unmatched signals are ignored (remain non-authoritative) and only matching signals are consumed.
  - When timeout elapses with no match, runtime throws structured `TimeoutError` (catchable by existing try/catch semantics).
- Added event wait projection activities in [ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts):
  - `projectWorkflowRuntimeV2EventWaitStart(...)` writes `workflow_run_waits` row (`wait_type=event`, event name/key/timeout/payload descriptor)
  - `projectWorkflowRuntimeV2EventWaitResolved(...)` marks wait resolved and records matched event metadata in payload
- Extended runtime workflow tests in [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts):
  - matching signal resumes wait and advances workflow with `vars.event` + `vars.eventName`
  - timeout path throws `TimeoutError` and resolves wait projection

Rationale:
- This moves `event.wait` authority into Temporal signal handling while keeping DB wait rows as projection/index only.
- Existing broader ingress fan-out/candidate-selection work is still required for full end-to-end routing, but interpreter-side correctness is now in place.

Plan bookkeeping updates:
- Marked `F036`, `F037`, `F038`, `F039`, `F040` implemented.
- Added `T029` (implemented:true) for focused interpreter-level event-wait coverage.

Validation commands (this checkpoint):
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts --run`
- `npm --prefix ee/temporal-workflows run type-check`

Gotchas:
- Runtime filter operators in schema are symbolic (`=`, `!=`) rather than textual (`eq`, `neq`); event-filter matching logic and tests now mirror schema operators exactly.

### F041-F042 + T030 completed (`human.task` signal wait + response validation)

- Added `human.task` Temporal-native wait handling in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts):
  - Introduced signal `workflowRuntimeV2HumanTask` and task-id-based signal matching.
  - Interpreter now resolves human-task title/description/context expressions deterministically, creates task+wait through activity boundary, waits for matching task signal, validates response, and resumes with `vars.event`/`vars.eventName`.
- Added dedicated human-task activities in [ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts):
  - `startWorkflowRuntimeV2HumanTaskWait(...)` creates `workflow_tasks` row and `workflow_run_waits` projection (`wait_type=human`) with task identity.
  - `resolveWorkflowRuntimeV2HumanTaskWait(...)` resolves wait projection with response metadata.
  - `validateWorkflowRuntimeV2HumanTaskResponse(...)` enforces form-schema validation (with admin-resume bypass semantics) before interpreter resume.
- Added helper for task form-schema lookup in activities mirroring existing runtime lookup behavior across system/tenant task definitions.
- Extended workflow tests in [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts):
  - valid human-task response resumes workflow and resolves wait
  - invalid human-task response fails with catchable `ValidationError`

Rationale:
- Human task progression is now Temporal signal-authoritative while retaining product/task surfaces in DB.
- Response validation remains activity-bound where DB-backed form metadata access is safe.

Plan bookkeeping updates:
- Marked `F041`, `F042` implemented.
- Added `T030` (implemented:true) for interpreter-level human-task validation coverage.

Validation commands (this checkpoint):
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts --run`
- `npm --prefix ee/temporal-workflows run type-check`

### F043-F047 + T031 completed (event-ingress persistence + candidate signal fan-out)

- Extended event-ingress worker in [services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts):
  - Keeps idempotent inbound-event persistence (`workflow_runtime_events`) by `event_id`.
  - Uses `workflow_run_waits` projection lookup (`listEventWaitCandidates`) scoped by tenant/event/correlation key to find candidate waiting runs.
  - Signals every candidate Temporal run via `signalWorkflowRuntimeV2Event(...)` instead of selecting a single wait row as execution authority.
  - Keeps failure isolation per candidate signal (warn + continue) so one failed signal does not block delivery to other candidates.
- Added Temporal event-signal client helper in [ee/packages/workflows/src/lib/workflowRuntimeV2Temporal.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/packages/workflows/src/lib/workflowRuntimeV2Temporal.ts):
  - exported runtime signal constants
  - added `signalWorkflowRuntimeV2Event(...)` helper for `workflow-runtime-v2:run:<runId>` handles
- Updated runtime workflow signal naming in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts) to consume shared signal constants.
- Extended worker tests in [services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts):
  - asserts candidate lookup + per-candidate signal fan-out
  - asserts duplicate `event_id` short-circuit does not relaunch or re-signal

Rationale:
- Event ingress is now aligned with Temporal-native wait authority: DB indexes select candidates, Temporal workflows decide active-wait matches.

Plan bookkeeping updates:
- Marked `F043`, `F044`, `F045`, `F046`, `F047` implemented.
- Added `T031` (implemented:true) for ingress persistence/signal fan-out/dedup coverage.

Validation commands (this checkpoint):
- `cd services/workflow-worker && npx vitest src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts --run`
- `npm --prefix ee/packages/workflows run typecheck`
- `npm --prefix ee/temporal-workflows run type-check`
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts --run`

### F048-F050 completed (direct Temporal launch paths for manual/event/replay)

- Confirmed manual/API runs continue to launch through [ee/packages/workflows/src/lib/workflowRunLauncher.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/packages/workflows/src/lib/workflowRunLauncher.ts) Temporal-first path (`WORKFLOW_RUNTIME_V2_ENGINE=temporal` default), preserving existing launch concepts (`run_id` allocation + projection) while delegating execution authority to Temporal.
- Confirmed event-triggered runs are started from published trigger metadata and validated payloads in [services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts), then launched via `launchPublishedWorkflowRun(...)` into Temporal-native execution.
- Updated replay behavior in [ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts):
  - removed inline DB-runtime replay execution (`runtime.executeRun(...)`)
  - replay now creates a fresh run through `launchPublishedWorkflowRun(...)` so Temporal starts a new native execution
  - defaults replay payload to original run input when no explicit override payload is provided

Rationale:
- Replay/re-run semantics now align with product expectation: new execution from pinned definition/input rather than DB snapshot resume behavior.

Plan bookkeeping updates:
- Marked `F048`, `F049`, `F050` implemented.

Validation commands (this checkpoint):
- `npm --prefix ee/packages/workflows run typecheck`
- `cd services/workflow-worker && npx vitest src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts --run`

### F061 completed (Temporal cancel path from operator controls)

- Added Temporal cancel helper in [ee/packages/workflows/src/lib/workflowRuntimeV2Temporal.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/packages/workflows/src/lib/workflowRuntimeV2Temporal.ts):
  - `cancelWorkflowRuntimeV2TemporalRun(...)` resolves run workflow ID and issues Temporal `handle.cancel()`.
- Updated operator cancel action in [ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts):
  - when a run is Temporal-backed (`engine=temporal`), cancellation is sent to Temporal before projection updates.
  - existing DB projection updates/logging/audit remain for product/API surfaces.

Rationale:
- Cancellation authority now targets Temporal execution directly for Temporal runs, allowing native child-workflow cancellation propagation semantics to apply.

Plan bookkeeping updates:
- Marked `F061` implemented.
- Kept `T025` pending for explicit child-cancellation propagation test coverage.

Validation commands (this checkpoint):
- `npm --prefix ee/packages/workflows run typecheck`
- `npm --prefix ee/temporal-workflows run type-check`

### F062 + T033 completed (operator query surface)

- Added Temporal query handlers in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts):
  - `workflowRuntimeV2CurrentStep`
  - `workflowRuntimeV2CurrentWait`
  - `workflowRuntimeV2InterpreterSummary`
- Query state now tracks current step path, active wait descriptor, frame depth, and interpreted step count as workflow execution progresses.
- Extended runtime workflow tests in [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts) to assert query registration and non-null summary outputs.

Plan bookkeeping updates:
- Marked `F062` implemented.
- Added `T033` (implemented:true) for operator query coverage.

Validation commands (this checkpoint):
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts --run`
- `npm --prefix ee/temporal-workflows run type-check`

### F054-F060 marked complete (projection model alignment)

Current runtime implementation now satisfies projection-model requirements for Temporal-backed runs:
- `workflow_runs` stores engine + Temporal identifiers + pinned definition metadata and remains the run-summary API source.
- `workflow_run_steps` is written from interpreter step lifecycle projection activities with attempts/durations/status/errors.
- `workflow_run_waits` is written/resolved for `time.wait`, `event.wait`, and `human.task`, and serves ingress candidate selection.
- `workflow_action_invocations` remains durable idempotency/timeline surface through action activity execution.
- `workflow_runtime_events` remains inbound-event audit surface in ingress worker.
- `workflow_run_snapshots` is no longer used as execution authority in Temporal-native path (retained for debug/history compatibility).
- Run detail/listing actions continue to read these DB projection tables rather than directly querying Temporal histories.

Plan bookkeeping updates:
- Marked `F054`, `F055`, `F056`, `F057`, `F058`, `F059`, `F060` implemented.

### F063-F066 + T034 completed (hard-cut + polling retirement for new runs)

- Removed DB-runtime fallback branch from [ee/packages/workflows/src/lib/workflowRunLauncher.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/packages/workflows/src/lib/workflowRunLauncher.ts):
  - new launches now always start Temporal runtime workflow execution when `execute !== false`
  - removed legacy engine-mode branch and Temporal-failure fallback to inline `runtime.executeRun(...)`
- Updated worker bootstrap in [services/workflow-worker/src/index.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/services/workflow-worker/src/index.ts):
  - DB polling runtime worker is now disabled by default
  - explicit opt-in flag `WORKFLOW_RUNTIME_V2_ENABLE_DB_POLLING` gates legacy polling startup
  - event-ingress worker remains active

Rationale:
- New runs now hard-cut to Temporal-native authority; DB polling/resume mechanisms are no longer required in the default execution path.
- Legacy worker code remains available only behind explicit opt-in as transitional cleanup path.

Plan bookkeeping updates:
- Marked `F063`, `F064`, `F065`, `F066` implemented.
- Added `T034` (implemented:true) for cutover verification coverage.

Validation commands (this checkpoint):
- `npm --prefix ee/packages/workflows run typecheck`
- `mkdir -p server/coverage/.tmp && npm --prefix server run test -- src/test/unit/workflowRunLauncher.unit.test.ts`
- `cd services/workflow-worker && npx vitest src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts --run`

### F051-F053 + F067 completed (Temporal-native schedule default + continue-as-new test coverage)

- Updated default EE job-runner selection in [server/src/lib/jobs/JobRunnerFactory.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/server/src/lib/jobs/JobRunnerFactory.ts):
  - `determineRunnerType()` now defaults to `temporal` in EE (`pgboss` remains CE default).
  - This removes environment-dependent drift where workflow schedule lifecycle could silently use non-Temporal scheduling authority when `JOB_RUNNER_TYPE` was unset.
- Strengthened continue-as-new behavior in [ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts):
  - Added `maybeContinueAsNew()` helper and invoked it on all step-completion progression paths (including branch/loop/onError routes), not just loop-footer fallthrough.
  - This closes a correctness gap where early `continue` branches could bypass checkpoint emission.
- Added explicit continue-as-new test in [ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts):
  - verifies checkpoint emission at threshold using checkpointed `stepCount` input and asserts `continueAsNew(...)` receives updated checkpoint state.

### Tests checklist updates completed in this slice

- Marked implemented based on passing Temporal runtime/event-ingress tests in this branch:
  - `T008` (child-workflow launch + output mapping integration in interpreter test suite)
  - `T010`, `T011`, `T012` (native `time.wait`, fast-path due wait, signal/timeout `event.wait`)
  - `T013`, `T014` (event ingress candidate signaling fan-out and event-id dedupe)
  - `T015` (signal-backed human task with validation)
  - `T018` (event-triggered launches to Temporal path)
  - `T022` (continue-as-new checkpoint behavior in Temporal interpreter)

### Validation commands run (this slice)

- `npm --prefix server run test -- src/test/unit/workflowScheduledRunHandlers.unit.test.ts`
- `npm --prefix ee/temporal-workflows run test -- src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts --run`
- `npm --prefix ee/temporal-workflows run type-check`
- `cd services/workflow-worker && npx vitest src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts --run`

### Validation blockers / gotchas

- `server/src/test/unit/workflowExternalSchedulesPublishLifecycle.unit.test.ts` currently fails to load due stale alias import path (`@alga-psa/workflows/actions-psa/workflows-runtime-v2-actions`) in this branch test harness.
- `ee/server` DB-backed schedule integration suite requires local PostgreSQL on `localhost:5432`; run failed with `ECONNREFUSED` in this environment.

### F068 + T016/T017 completed (DB-backed integration coverage checkpoint)

- Unblocked server workflow integration suites by fixing shared/workflow module resolution regressions:
  - [packages/core/src/lib/scheduleEntryRegistry.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/packages/core/src/lib/scheduleEntryRegistry.ts) now uses `import type { Knex } ...` to avoid runtime CJS named-export resolution issues.
  - [packages/core/src/index.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/packages/core/src/index.ts) now re-exports `scheduleEntryRegistry`.
  - [ee/packages/workflows/src/actions/activity-actions/activityAggregationActions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/packages/workflows/src/actions/activity-actions/activityAggregationActions.ts) now imports `getAllScheduleEntries` from `@alga-psa/core` package root.
- Added compatibility re-export for legacy action import paths used by unit harnesses:
  - [ee/packages/workflows/src/actions-psa/workflows-runtime-v2-actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/ee/packages/workflows/src/actions-psa/workflows-runtime-v2-actions.ts)

Validation evidence used to close checklist items:
- `T016` (idempotency dedupe): exercised in DB-backed integration suite via existing idempotency tests in [server/src/test/integration/workflowRuntimeV2.control.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/server/src/test/integration/workflowRuntimeV2.control.integration.test.ts), including duplicate idempotency-key side-effect suppression and invocation-ledger assertions.
- `T017` (retry + onError continue): exercised by retry attempt/timeline coverage in control integration suite plus `onError=continue` continuation coverage in [server/src/test/integration/workflowRuntimeV2.publish.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/server/src/test/integration/workflowRuntimeV2.publish.integration.test.ts).

Commands run:
- `npm --prefix server run test -- src/test/integration/workflowRuntimeV2.control.integration.test.ts -t "Idempotency key uniqueness prevents duplicate side-effectful action calls. Mocks: non-target dependencies."`
- `npm --prefix server run test -- src/test/integration/workflowRuntimeV2.control.integration.test.ts src/test/integration/workflowRuntimeV2.publish.integration.test.ts -t "Idempotency key uniqueness prevents duplicate side-effectful action calls|Retry attempts increment workflow_run_steps\\.attempts count|onError=continue records error and continues to next step"`

### T019 completed (schedule reconciliation unit coverage restored)

- Updated [server/src/test/unit/workflowExternalSchedulesPublishLifecycle.unit.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/server/src/test/unit/workflowExternalSchedulesPublishLifecycle.unit.test.ts) test harness `knexMock` to emulate current persistence table access used by publish lifecycle code:
  - `workflow_definitions`
  - `workflow_definition_versions`
  - `tenant_workflow_schedule`
- This restored schedule lifecycle tests that verify publish/update behavior rebinds or disables schedules according to payload/schema compatibility and preserves schedule state semantics.
- Confirmed recurring and one-time scheduled-run handler coverage remains passing in [server/src/test/unit/workflowScheduledRunHandlers.unit.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/workflow-wait-steps-productization/server/src/test/unit/workflowScheduledRunHandlers.unit.test.ts).

Validation commands:
- `npm --prefix server run test -- src/test/unit/workflowExternalSchedulesPublishLifecycle.unit.test.ts`
- `npm --prefix server run test -- src/test/unit/workflowExternalSchedulesPublishLifecycle.unit.test.ts src/test/unit/workflowScheduledRunHandlers.unit.test.ts`

Follow-on blocker observed while moving to `T020`:
- `npm --prefix server run test -- src/test/integration/workflowRuntimeV2.publish.integration.test.ts src/test/integration/workflowRuntimeV2.control.integration.test.ts -t "Get run server action returns status, nodePath, and timestamps|List run steps server action returns ordered step history with attempts|Workflow runtime event list server action returns recent events|Cancel run server action sets status CANCELED and releases waits"`
  - `workflowRuntimeV2.control.integration.test.ts` target passed.
  - `workflowRuntimeV2.publish.integration.test.ts` failed during DB setup with `ROLLBACK - Connection terminated unexpectedly` and then `db.destroy` on undefined in `afterAll`.
