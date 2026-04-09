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
