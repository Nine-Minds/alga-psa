# PRD — Workflow V2 Temporal-Native Runtime

- Slug: `workflow-v2-temporal-native-runtime`
- Date: `2026-04-08`
- Status: Draft

## Summary

Replace the current database-driven Workflow Runtime V2 execution engine with a full Temporal-native interpreter for Enterprise Edition workflows. The workflow designer and authored DSL remain declarative and approachable for non-technical users, while Temporal becomes the authoritative execution runtime for all workflow runs in both hosted EE and appliance EE. Database tables remain product-facing read models and idempotency ledgers, not scheduler or resume authority.

## Problem

Workflow Runtime V2 currently executes through database-backed run state, wait rows, snapshots, and worker polling. That design was sufficient for early iteration, but it creates structural limitations:

1. **Polling-based waits are operationally weak** — `time.wait` requires a background polling worker instead of durable native timers.
2. **Execution authority is split across rows, snapshots, and worker leases** — the run model is harder to reason about and harder to recover cleanly.
3. **Long-running workflows are awkward** — event waits, retries, and child workflow semantics rely on custom scheduler logic rather than a durable orchestration engine.
4. **Runtime semantics are difficult to evolve safely** — replay, determinism, and versioning are implicit instead of explicit.
5. **Hosted and appliance need one durable runtime model** — workflows are an EE feature, and appliance includes Temporal, so diverging engines would create unnecessary complexity.

A Temporal-native interpreter solves the hardest workflow-runtime concerns directly:
- durable timers for `time.wait`
- signal-based wakeups for `event.wait` and `human.task`
- native child workflow orchestration
- cleaner cancellation and recovery semantics
- a single durable execution authority

## Goals

1. **Temporal-native execution authority** — every new Workflow V2 run executes as a Temporal workflow, and Temporal is the source of truth for execution state.
2. **Single EE runtime across hosted and appliance** — both hosted EE and appliance EE use the same interpreter model and semantics.
3. **Preserve intuitive workflow authoring** — the workflow DSL and designer remain declarative and user-friendly; Temporal concepts stay behind the runtime boundary.
4. **Hard cutover with minimal migration burden** — the current DB-backed runtime can be abandoned for new runs; no active-run migration is required.
5. **Durable, deterministic interpreter** — pinned definitions, explicit runtime semantics versioning, deterministic expression evaluation, and activity-only side effects.
6. **Keep the database as a first-class product read model** — run details, step timelines, waits, action invocations, and event audit remain queryable in the DB.
7. **Support all current workflow categories** — manual runs, event-triggered runs, one-time schedules, recurring schedules, waits, retries, child workflows, and human tasks.
8. **Establish a clean future architecture** — retire lease-based polling execution and DB-driven wait resolution so future workflow features build on a durable engine.

## Non-goals

- Redesigning the workflow designer around imperative Temporal concepts.
- Preserving exact internal runtime table semantics from the DB-backed engine.
- Migrating in-flight DB-runtime runs into Temporal.
- Maintaining a long-term hybrid runtime where DB execution and Temporal execution coexist as equal authorities.
- Building a broad new observability platform beyond the minimum run/query/projection surfaces needed for workflow support.
- Introducing parallel `forEach` execution in the first Temporal-native release.
- Replatforming Community Edition workflows onto Temporal.

## Users and Primary Flows

### Primary users

- **Workflow authors** creating automations in the visual workflow designer.
- **Operators and support engineers** inspecting workflow runs, waits, failures, and event routing.
- **Platform engineers** evolving the runtime, actions, and trigger orchestration safely.

### Primary flows

#### Flow 1: Manual or API run
1. A published workflow is started manually or via API.
2. The system allocates an Alga run ID and starts a Temporal interpreter workflow for that run.
3. The interpreter loads the pinned published definition version.
4. Steps execute through the interpreter until completion, wait, failure, or cancellation.
5. The database projection is updated so the run appears in run-detail UI and APIs.

#### Flow 2: Event-triggered workflow
1. A domain event enters the workflow event ingress path.
2. The event is validated, recorded for audit, and matched to published workflow triggers.
3. Matching workflows start new Temporal runs directly.
4. If an existing run is waiting on an `event.wait`, candidate runs are signaled.
5. Each signaled run decides inside Temporal whether the signal matches its active wait.

#### Flow 3: Time wait inside a workflow
1. A workflow reaches `time.wait`.
2. The interpreter computes `dueAt` deterministically.
3. The workflow projects a wait row for product visibility and then sleeps with a native Temporal timer.
4. On wake, the interpreter resolves the projected wait and continues execution.

#### Flow 4: Child workflow orchestration
1. A workflow reaches `control.callWorkflow`.
2. The parent interpreter starts a Temporal child interpreter workflow with mapped input.
3. The child completes or fails.
4. The parent maps outputs or handles the child failure using retry or catch semantics.

#### Flow 5: Schedule-triggered workflow
1. A published workflow is configured with a one-time or recurring schedule trigger.
2. The system reconciles schedule state to Temporal Schedules (or equivalent Temporal-native scheduling authority).
3. When the schedule fires, Temporal starts a workflow run.
4. The run appears in the database projection like any other run.

## UX / UI Notes

- The workflow designer should continue to present a declarative workflow model. Authors should never need to understand task queues, Temporal histories, activity retries, or workflow replay.
- Existing workflow step concepts remain product-facing: `action.call`, `control.if`, `control.forEach`, `control.tryCatch`, `control.callWorkflow`, `event.wait`, `time.wait`, `human.task`, and `control.return`.
- It is acceptable for some internal runtime semantics to evolve if the designer remains intuitive and authored workflows stay understandable.
- Run detail UIs should continue to show:
  - current status
  - current step
  - current wait
  - step timeline
  - action invocation history
  - terminal error context
- Replay/re-run in the UI should mean “start a new run from the pinned definition and input,” not “resume a DB-backed snapshot.”

## Requirements

### Functional Requirements

#### FR-1: Temporal as execution authority
- All new Workflow V2 runs must execute as Temporal workflows.
- Temporal must be the sole execution authority for run progression, waits, retries, and child workflow orchestration.
- The same Temporal-native runtime must be used for hosted EE and appliance EE.
- New runs must no longer depend on DB lease ownership, runnable-run polling, or DB snapshot resume logic.

#### FR-2: Stable run identity and pinned definition loading
- Every run must have a stable Alga `run_id` that is created before the Temporal workflow starts.
- Each Temporal execution must map deterministically to that `run_id`.
- Runs must pin `workflow_id`, `published_version`, `definition_hash`, and `runtime_semantics_version` at start.
- The interpreter must load the pinned published definition through an activity and execute only that version for the life of the run.

#### FR-3: Explicit interpreter state machine
- The Temporal-native interpreter must use an explicit frame-based execution model rather than DB `node_path` as execution authority.
- The interpreter must maintain serializable state for:
  - execution frames
  - workflow scope
  - local lexical scopes
  - current step
  - pending wait descriptor
  - terminal result or error
- The runtime must support safe continue-as-new checkpoints for long-lived executions.

#### FR-4: Deterministic expression and runtime semantics
- Workflow control decisions must be deterministic under Temporal replay.
- Expressions may read from workflow scopes and pinned metadata only.
- Workflow code must not directly read mutable DB state, secrets, or network resources.
- Runtime semantics must be versioned explicitly so support and future migrations can identify the interpreter contract used by a run.

#### FR-5: `action.call` activity execution and idempotency
- `action.call` must execute through a dedicated Temporal activity boundary.
- The runtime must compute deterministic idempotency keys for action executions.
- A durable action invocation ledger must suppress duplicate side effects across retries, activity re-execution, and worker restarts.
- Action outputs must be available for assignment/save behavior and run-detail projection.
- User-authored retry policy must remain visible and owned by the interpreter, not hidden inside uncontrolled Temporal activity retry behavior.

#### FR-6: Control-flow semantics inside the interpreter
- `control.if` must evaluate conditions deterministically and route execution to the correct branch.
- `control.tryCatch` must support catch-branch routing and `captureErrorAs` behavior for catchable runtime failures.
- `control.return` must terminate the current workflow successfully.
- `control.forEach` must be supported as sequential iteration in the first Temporal-native release.
- `control.forEach` loop bodies must support waits, actions, branching, and `onItemError` semantics.
- First-release publish validation or designer constraints must reject or hide `forEach.concurrency > 1`.

#### FR-7: Child workflow execution
- `control.callWorkflow` must execute as a Temporal child workflow, not inline in the parent interpreter.
- Child workflows must receive their own run IDs plus root/parent linkage metadata.
- Parent workflows must be able to map child outputs and handle child failures through retry or catch semantics.

#### FR-8: Native wait semantics
- `time.wait` must execute using native Temporal timers.
- `time.wait` must fast-path when `dueAt <= now` so already-due waits do not suspend unnecessarily.
- `event.wait` must execute using Temporal signal handling, not DB wait resolution.
- `event.wait` must continue to support event name, correlation key, payload filters, and timeout behavior.
- `human.task` must continue to behave as a signal-backed wait with response validation before resume.

#### FR-9: Event ingress and candidate signaling
- Incoming workflow events must be recorded in the database for audit/debugging.
- Event ingress must identify candidate waiting runs using database projection indexes, including tenant, event name, and correlation key.
- Event ingress must signal all candidate waiting runs rather than resolving a single DB wait row as the execution authority.
- Each Temporal workflow must decide whether the signaled event matches its active wait.
- External event delivery must be idempotent by `event_id`.

#### FR-10: Trigger execution model
- Manual and API-triggered runs must start Temporal workflow executions directly.
- Event-triggered workflows must start Temporal workflow executions directly from published trigger definitions.
- One-time schedule triggers must use a Temporal-native scheduling authority.
- Recurring schedule triggers must use Temporal Schedules or an equivalent Temporal-native scheduler model.
- Publish/unpublish/update of scheduled workflows must reconcile DB schedule state to Temporal schedule state.

#### FR-11: Database projection and product APIs
- `workflow_runs` must become a Temporal-backed run summary projection.
- `workflow_run_steps` must represent actual step execution attempts/timeline.
- `workflow_run_waits` must represent wait projection and event-routing index state.
- `workflow_action_invocations` must remain the durable side-effect idempotency ledger and product-facing action timeline.
- `workflow_runtime_events` must remain the event audit surface.
- Existing run-detail and listing APIs should continue to work through the projection model wherever practical.

#### FR-12: Queries, cancellation, and operator controls
- The runtime must support run cancellation with correct propagation to active child workflows.
- Cancellation must not be swallowed by normal workflow catch semantics.
- Replay/re-run must start a fresh Temporal-native run from the pinned definition and input.
- Operational debug queries should expose at least current step, current wait, and interpreter summary for support/debug tooling.

#### FR-13: Hard cutover and runtime retirement
- New Workflow V2 runs must hard-cut to the Temporal-native engine.
- No active-run migration from the DB runtime is required.
- The current DB-backed runnable-run acquisition, due-wait polling, and DB wait-resolution paths must be retired for new runs.
- Obsolete execution-authority fields and tables may remain temporarily for compatibility, but they must no longer drive execution.

### Non-functional Requirements

- The Temporal-native runtime must be deterministic under replay.
- The runtime must preserve tenant scoping for triggers, events, waits, and actions.
- Side effects must be at-least-once safe through durable idempotency design.
- The same authored workflow definition must execute with the same semantics in hosted EE and appliance EE.
- The first Temporal-native release must prefer correctness and clarity over speculative parallelism or optimization.
- The design must support long-running workflows through continue-as-new rather than unbounded history growth.

## Data / API / Integrations

### Existing relevant surfaces

- DB-backed runtime engine: [shared/workflow/runtime/runtime/workflowRuntimeV2.ts](/Users/roberisaacs/alga-psa/shared/workflow/runtime/runtime/workflowRuntimeV2.ts)
- DB polling worker: [shared/workflow/workers/WorkflowRuntimeV2Worker.ts](/Users/roberisaacs/alga-psa/shared/workflow/workers/WorkflowRuntimeV2Worker.ts)
- Workflow worker bootstrap: [services/workflow-worker/src/index.ts](/Users/roberisaacs/alga-psa/services/workflow-worker/src/index.ts)
- Event ingress worker: [services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts](/Users/roberisaacs/alga-psa/services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts)
- Workflow runtime actions: [ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts](/Users/roberisaacs/alga-psa/ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts)
- Existing workflow runtime tables: [server/migrations/20251221090000_create_workflow_runtime_v2_tables.cjs](/Users/roberisaacs/alga-psa/server/migrations/20251221090000_create_workflow_runtime_v2_tables.cjs)
- Temporal workflow package: [ee/temporal-workflows/README.md](/Users/roberisaacs/alga-psa/ee/temporal-workflows/README.md)
- Existing Temporal worker/client entrypoints:
  - [ee/temporal-workflows/src/worker.ts](/Users/roberisaacs/alga-psa/ee/temporal-workflows/src/worker.ts)
  - [ee/temporal-workflows/src/client.ts](/Users/roberisaacs/alga-psa/ee/temporal-workflows/src/client.ts)

### Recommended projection model

Keep these tables, but change their role:

- `workflow_runs`
  - run summary projection
  - Temporal workflow/run IDs
  - pinned definition/version/hash
  - current step and wait summary
  - terminal status/error summary
- `workflow_run_steps`
  - step execution timeline
  - attempts
  - durations
  - failures
- `workflow_run_waits`
  - historical and current wait projection
  - event-routing index for active waits
- `workflow_action_invocations`
  - action timeline projection
  - durable side-effect idempotency ledger
- `workflow_runtime_events`
  - inbound event audit trail
  - delivery/routing trace metadata

`workflow_run_snapshots` should no longer be the resume authority. It may remain only as an optional debug checkpoint surface if still useful.

### Recommended new projection fields

Likely additions include:
- `engine = 'temporal'`
- `temporal_workflow_id`
- `temporal_run_id`
- `definition_hash`
- `runtime_semantics_version`
- `parent_run_id`
- `root_run_id`
- wait correlation tokens for idempotent wait-projection updates

### Temporal integration model

- Use a dedicated workflow runtime interpreter workflow type and task queue.
- Use activities for:
  - loading pinned definitions
  - executing actions
  - writing projections
  - validating human-task form responses when runtime metadata requires DB access
  - reconciling Temporal Schedules
- Use child workflows for `control.callWorkflow`.
- Use workflow signals for:
  - external events
  - human task completion/admin resume
  - cancellation and future runtime controls if needed
- Use Temporal Schedules for one-time and recurring workflow triggers.

## Security / Permissions

- Continue to use existing workflow permissions for authoring, publish, run, and inspect operations.
- Maintain tenant scoping across event routing, action execution, and read-model projections.
- Secret access must remain activity-only and must never happen directly in deterministic workflow code.
- Projected logs and errors must continue to honor redaction behavior for sensitive fields.

## Observability

This plan deliberately avoids a large new observability program. Minimum required visibility is:
- run summary and status
- current step
- current wait
- step execution timeline
- action invocation timeline
- inbound event audit
- current interpreter summary available via Temporal query for operator debugging

Temporal UI should be considered a support/engineering surface, not the primary end-user workflow run UI.

## Rollout / Migration

### Migration posture

- Hard cutover.
- All new Workflow V2 runs use the Temporal-native runtime.
- No migration of in-flight DB-runtime runs is required.
- Old DB-backed run records may remain for historical/debug reasons only.

### Recommended implementation phases

#### Phase 1: Runtime skeleton
- Start runs directly in Temporal.
- Load pinned definitions through activities.
- Support straight-line execution (`action.call`, `control.if`, `control.return`).
- Write run and step projections.

#### Phase 2: Core control flow
- Add sequential `control.forEach`.
- Add `control.tryCatch` and normalized runtime errors.
- Add `control.callWorkflow` as child workflows.
- Stabilize action idempotency ledger behavior.

#### Phase 3: Waits and signals
- Add `time.wait` using native Temporal timers.
- Add `event.wait` using signal handling and candidate signal fan-out.
- Add `human.task` resume signaling and validation.
- Stabilize wait projections and event-routing indexes.

#### Phase 4: Trigger platform
- Move event-triggered run start fully onto Temporal-native execution.
- Move one-time schedules to Temporal-native scheduling.
- Move recurring schedules to Temporal Schedules with reconciliation.

#### Phase 5: Cutover cleanup
- Disable DB polling/runtime execution authority for new runs.
- Remove or deprecate lease-based execution assumptions.
- Reduce `workflow_run_snapshots` to optional debug-only use if retained.
- Plan follow-on schema cleanup for obsolete execution-authority fields.

## Open Questions

1. Should `workflow_run_snapshots` survive as an operator debug surface, or should that move entirely to Temporal queries/history plus targeted redacted checkpoints?
2. Should the first Temporal-native release reject `forEach.concurrency > 1` at publish time, or hide that capability in the designer and reserve schema cleanup for follow-up?
3. For one-time schedule triggers, should the implementation use Temporal Schedules uniformly, or a simpler single-fire start mechanism wrapped in the same schedule reconciliation layer?

## Acceptance Criteria (Definition of Done)

1. [ ] A newly started Workflow V2 run executes as a Temporal workflow and is no longer scheduled by the DB polling worker.
2. [ ] Hosted EE and appliance EE use the same Temporal-native interpreter semantics.
3. [ ] Each run pins workflow definition ID, version, hash, and runtime semantics version at start.
4. [ ] `action.call` executes through activities with durable idempotency so duplicate side effects are suppressed across retries.
5. [ ] `control.if`, `control.tryCatch`, sequential `control.forEach`, and `control.return` execute correctly inside the interpreter.
6. [ ] `control.callWorkflow` executes as a Temporal child workflow with parent/root linkage and output mapping.
7. [ ] `time.wait` uses native Temporal timers and resumes without DB polling.
8. [ ] `event.wait` uses signal handling and resumes only when the active wait matches event name, correlation key, and filters.
9. [ ] Event ingress records inbound events, identifies candidate waiting runs, and signals those runs idempotently.
10. [ ] One-time and recurring schedule triggers are reconciled to Temporal-native scheduling authority.
11. [ ] Database run, step, wait, action, and event surfaces remain usable as product-facing read models.
12. [ ] Run cancelation works correctly and propagates to child workflows.
13. [ ] Replay/re-run starts a fresh Temporal-native run from pinned definition/input rather than DB snapshot resume.
14. [ ] DB-backed wait polling and lease-based execution are no longer required for new runs.
15. [ ] High-signal Temporal and DB-backed integration tests cover interpreter semantics, waits, event routing, schedules, and idempotency.