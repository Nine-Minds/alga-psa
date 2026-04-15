# PRD — Workflow V2 Runtime Worker Ownership Split

- Slug: `workflow-v2-runtime-worker-ownership-split`
- Date: `2026-04-09`
- Status: Draft
- Parent context:
  - `ee/docs/plans/2026-04-08-workflow-v2-temporal-native-runtime/`
  - `ee/docs/plans/2026-04-08-workflow-v2-temporal-hard-cutover-remediation/`

## Summary

Move authored Workflow Runtime V2 Temporal execution out of `temporal-worker` and into `workflow-worker`, then repair the package/runtime layering so the authored runtime has a clean worker-safe core surface and a separate bootstrap surface.

The intended end state is:

- `workflow-worker` owns authored Workflow Runtime V2 Temporal execution on queue `workflow-runtime-v2`
- `workflow-worker` continues to own workflow event-stream ingress and other authored-workflow support duties
- `temporal-worker` continues to own non-authored/domain Temporal workflows only
- `@alga-psa/workflows` stops exposing a mixed runtime/bootstrap boundary that drags app-only or source-layout-specific dependencies into standalone worker startup

## Problem

The current authored runtime placement and package shape create both operational confusion and concrete boot failures.

### 1. Wrong operational ownership for authored workflows
A manually started authored workflow launches successfully into Temporal, but Temporal UI shows no worker polling the `workflow-runtime-v2` queue. Today that queue is effectively tied to `temporal-worker`, even though authored workflow ingress, projections, and support duties already live with `workflow-worker`.

This splits authored workflow responsibility across two workers and makes debugging harder:

- authored workflow event ingress lives in `workflow-worker`
- authored runtime execution lives in `temporal-worker`
- domain/job Temporal workflows also live in `temporal-worker`

The result is unclear ownership and slower diagnosis when authored runs stall.

### 2. The current workflow runtime package boundary is not real enough for a standalone worker
The current `@alga-psa/workflows/runtime` surface mixes:

- runtime core exports
- AI/bootstrap wiring
- email/action registration side effects
- repo-relative imports into `shared/...` and `packages/ee/src/...`
- path alias assumptions such as `@shared/*`

That package shape works in app/source mode, but it is not a stable worker-safe boundary. Built artifacts are still coupled to repo layout and transitive app concerns.

### 3. Temporal worker startup failures are exposing the architectural issue
The immediate failures seen in local runtime validation are symptoms of the deeper boundary problem:

- dist artifacts reaching back into repo source structure
- worker startup pulling in modules unrelated to authored runtime execution
- path alias and dist/export mismatches surfacing only in standalone worker mode

If left unfixed, this will continue to make authored runtime execution brittle across local, CI, and deployment environments.

## Goals

1. Make `workflow-worker` the permanent execution owner of authored Workflow Runtime V2 Temporal runs.
2. Keep `temporal-worker` responsible only for non-authored/domain Temporal workflows.
3. Preserve a single-process `workflow-worker` model that handles both authored workflow support duties and authored Temporal queue polling.
4. Split `@alga-psa/workflows` into a clean worker-safe runtime core surface and a separate bootstrap/app-wiring surface.
5. Eliminate source-layout-relative and unresolved alias dependencies from authored runtime startup paths.
6. Make local and deployed authored workflow execution operationally intuitive: authored runtime issues should be diagnosable from `workflow-worker` first.

## Non-goals

- Full package extraction of authored runtime into an entirely new npm workspace/package.
- Retirement of `temporal-worker` as a whole.
- Migration of non-authored/domain Temporal workflows into `workflow-worker`.
- Broad redesign of workflow authoring UX.
- Reintroducing the legacy DB runtime as an execution fallback.

## Users and Primary Flows

### Primary users

- Platform engineers responsible for authored workflow runtime correctness
- Operators debugging stalled or failed authored workflow runs
- Developers running EE workflow runtime locally

### Primary flows

#### Flow 1: Manual/API authored run starts
1. A user starts an authored Workflow Runtime V2 run from UI or API.
2. The server launches the Temporal workflow on queue `workflow-runtime-v2`.
3. `workflow-worker` picks up the Temporal task and executes the authored workflow.
4. The run progresses without depending on `temporal-worker`.

#### Flow 2: Event ingress resumes authored waits
1. `workflow-worker` consumes workflow event ingress.
2. It resolves candidate authored Temporal waits/runs.
3. It signals Temporal-backed authored runs.
4. The same `workflow-worker` process family owns both ingress and authored runtime execution, making failures easier to trace.

#### Flow 3: Domain/job workflows continue unchanged
1. Existing non-authored Temporal workflows continue polling on `temporal-worker`.
2. Removing `workflow-runtime-v2` from `temporal-worker` does not affect tenant/domain/job/schedule workflows that are not part of authored Workflow Runtime V2.

## UX / UI Notes

- No workflow authoring UX changes are required.
- Temporal UI should show an active worker for the `workflow-runtime-v2` queue once `workflow-worker` is running.
- Run support/debug flow should become simpler:
  - authored workflow execution problem → inspect `workflow-worker`
  - non-authored/domain Temporal problem → inspect `temporal-worker`
- Existing run/event/projected UI surfaces should continue to behave the same as long as projections remain correct.

## Requirements

### Functional Requirements

#### FR-1: Authored runtime ownership
- `workflow-worker` must poll the Temporal queue used for authored Workflow Runtime V2 execution.
- The authored runtime queue remains `workflow-runtime-v2` unless an explicit rename is separately approved.
- Authored Workflow Runtime V2 Temporal workflows must execute successfully with only `workflow-worker` running, assuming Temporal server is available.

#### FR-2: Temporal worker scope reduction
- `temporal-worker` must stop polling `workflow-runtime-v2`.
- `temporal-worker` must continue polling all approved non-authored/domain queues.
- Removing authored queue ownership from `temporal-worker` must not break unrelated Temporal workflows.

#### FR-3: Single-process workflow-worker ownership
- The same `workflow-worker` process/container must own:
  - workflow event-stream ingress/support paths
  - authored Workflow Runtime V2 Temporal queue polling
- This must not require a second sidecar process inside the `workflow-worker` container.

#### FR-4: Runtime core vs bootstrap split
- `@alga-psa/workflows` must expose a worker-safe authored runtime core surface with no app/bootstrap side effects.
- AI inference service wiring, AI action registration, and similar app/bootstrap concerns must live in a separate bootstrap-oriented surface.
- `workflow-worker` must import only the worker-safe runtime/core surface plus explicit worker-safe registrations it truly needs.

#### FR-5: Worker-safe import graph
- Authored runtime startup paths used by `workflow-worker` must not depend on:
  - unresolved `@shared/*` aliases
  - raw repo-relative imports into unrelated source trees
  - UI-only or app-only modules
- Built artifacts used in worker contexts must be self-contained enough to resolve through stable package exports or explicit local worker-owned files.

#### FR-6: Clear runtime initialization contract
- Runtime initialization required by `workflow-worker` must be explicit and deterministic.
- Worker-safe initialization must register only what authored runtime execution actually needs.
- Server/bootstrap initialization may register additional app-facing behavior, but that must not leak into worker-safe core by accident.

#### FR-7: Compose and environment alignment
- Local Docker/compose wiring must reflect the new ownership model.
- `workflow-worker` must receive the Temporal environment and queue configuration required to poll authored workflow tasks.
- `temporal-worker` configuration must no longer imply ownership of authored workflow runtime.

#### FR-8: Backward-compatible run launch contract
- Existing authored run launch and signal helpers may continue targeting Temporal queue `workflow-runtime-v2`.
- The move in ownership from `temporal-worker` to `workflow-worker` must not require API/UI changes to start or signal authored runs.

#### FR-9: Operability and support clarity
- Logs should make it obvious that `workflow-worker` has started Temporal polling for authored runtime.
- Logs/config should make it obvious that `temporal-worker` is not expected to own `workflow-runtime-v2` anymore.

### Non-functional Requirements

- Prefer explicit boundaries over hidden fallback behavior.
- Fail fast when worker-safe runtime code accidentally depends on bootstrap/app-only layers.
- Keep authored runtime deterministic and replay-safe.
- Minimize the blast radius to non-authored/domain Temporal workflows.
- Preserve local-development practicality; the authored runtime should be testable without package-layout hacks.

## Data / API / Integrations

### Relevant files

- `services/workflow-worker/src/index.ts`
- `services/workflow-worker/Dockerfile`
- `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts`
- `ee/temporal-workflows/src/worker.ts`
- `ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts`
- `ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts`
- `ee/packages/workflows/src/runtime/index.ts`
- `ee/packages/workflows/package.json`
- `docker-compose.ee.yaml`
- `docker-compose.temporal.ee.yaml`

### Integration notes

- Temporal workflow definitions and activities for authored Workflow Runtime V2 may still physically live under `ee/temporal-workflows` initially, but operational ownership moves to `workflow-worker`.
- If shared code from `ee/temporal-workflows` is reused by `workflow-worker`, the import/build contract must be explicit and worker-safe.
- Build/export fixes should prefer stable package/module boundaries over additional container-only symlink hacks.

## Risks

1. **Partial move leaves both workers polling authored queue**
   - Mitigation: explicit queue ownership changes plus startup tests/log assertions.

2. **Move breaks non-authored Temporal workflows accidentally**
   - Mitigation: keep `temporal-worker` scope narrow and validate non-authored queue config separately.

3. **Runtime split is incomplete and worker-safe boundary still leaks bootstrap concerns**
   - Mitigation: define and test the intended core/bootstrap surfaces explicitly.

4. **Docker/compose changes hide code-level layering issues temporarily**
   - Mitigation: require worker-safe import/build validation outside compose where practical.

5. **Legacy DB polling path becomes confused with authored Temporal polling**
   - Mitigation: keep authored Temporal ownership clearly separated from optional legacy DB polling flags.

## Rollout / Migration Notes

- This is an architecture change, not a local-only workaround.
- Existing authored Workflow Runtime V2 runs continue to use Temporal as execution authority.
- The operational owner of authored queue polling changes from `temporal-worker` to `workflow-worker`.
- Local environment and deployment manifests must be updated consistently so only `workflow-worker` owns authored queue polling.
- No authored-run API contract change is required for callers.

## Open Questions

1. Should authored Temporal workflow definitions/activities remain physically housed under `ee/temporal-workflows` for now, or should a later follow-up relocate them closer to `workflow-worker`?
2. Which exact bootstrap registrations should remain app/server-only versus worker-safe shared registrations?
3. Do we want an explicit startup assertion that fails if both workers are configured to poll `workflow-runtime-v2`?

## Acceptance Criteria / Definition of Done

This plan is done when:

1. Starting an authored Workflow Runtime V2 run results in `workflow-worker` polling and executing queue `workflow-runtime-v2`.
2. `temporal-worker` no longer polls `workflow-runtime-v2` but continues running non-authored/domain Temporal workflows.
3. `workflow-worker` can start authored runtime execution in the same process/container that already handles event-stream ingress.
4. `@alga-psa/workflows` exposes a worker-safe runtime/core surface that does not depend on bootstrap/app-only wiring.
5. Worker startup paths no longer depend on unresolved `@shared/*` aliases or repo-layout-relative source hops.
6. Local EE smoke testing shows Temporal UI reporting active workers for authored queue ownership through `workflow-worker`.
7. Focused tests cover queue ownership, worker startup, authored run execution, and runtime boundary separation.
