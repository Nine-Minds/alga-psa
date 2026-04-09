# SCRATCHPAD — Workflow V2 Runtime Worker Ownership Split

## Purpose

Track the architecture change that moves authored Workflow Runtime V2 Temporal execution into `workflow-worker` and repairs the runtime/bootstrap package boundary.

Related plans:
- `ee/docs/plans/2026-04-08-workflow-v2-temporal-native-runtime/`
- `ee/docs/plans/2026-04-08-workflow-v2-temporal-hard-cutover-remediation/`

## User-approved decisions

- Authored Workflow Runtime V2 execution should move from `temporal-worker` to `workflow-worker`.
- `temporal-worker` should continue owning non-authored/domain Temporal workflows only.
- Ownership should be expressed in the same `workflow-worker` process/container, not a second sidecar process.
- This is a real architecture change for the codebase going forward, not just a local workaround.
- Preferred cleanup direction is the proper split:
  - worker-safe runtime core
  - separate bootstrap/app-wiring surface
- No more brainstorming needed; move directly to ALGA plan.

## Why this plan exists

Observed local Temporal behavior showed:
- authored runs launch into Temporal successfully
- Temporal UI reports `No Workers Running` for queue `workflow-runtime-v2`
- `workflow-worker` is up
- `temporal-worker` is not healthy

That exposed two separate but related issues:
1. operational ownership for authored runtime is in the wrong worker
2. `@alga-psa/workflows/runtime` is not a clean worker-safe boundary

## High-signal findings

### Current worker split
- `services/workflow-worker/src/index.ts`
  - currently boots authored workflow support duties
  - initializes workflow runtime bootstrap
  - starts event-stream worker
  - optionally starts legacy DB polling worker
  - does **not** currently poll Temporal authored queue

- `ee/temporal-workflows/src/worker.ts`
  - currently includes `workflow-runtime-v2` in its default queue list
  - also owns non-authored queues like tenant/domain/job queues

### Current runtime boundary smell
- `ee/packages/workflows/src/runtime/index.ts`
  - currently mixes runtime exports with bootstrap side effects
  - imports AI action registration
  - imports AI inference wiring from `packages/ee/src/services/workflowInferenceService`
  - re-exports a large shared runtime barrel

### Current layering leaks seen during worker boot investigation
- unresolved `@shared/*` imports in authored runtime paths
- repo-relative imports from built workflow dist back into source layout
- mixed app/runtime/bootstrap concerns pulled into worker startup

## Files likely involved

### Worker ownership / startup
- `services/workflow-worker/src/index.ts`
- `services/workflow-worker/Dockerfile`
- `docker-compose.ee.yaml`
- `docker-compose.temporal.ee.yaml`
- `ee/temporal-workflows/src/worker.ts`

### Authored Temporal runtime implementation
- `ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts`
- `ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts`
- `ee/temporal-workflows/src/workflows/index.ts`

### Runtime/package boundary split
- `ee/packages/workflows/src/runtime/index.ts`
- likely new worker-safe runtime core entrypoint under `ee/packages/workflows/src/runtime/`
- likely new bootstrap/app-wiring entrypoint under `ee/packages/workflows/src/runtime/` or nearby
- `ee/packages/workflows/package.json`
- `ee/packages/workflows/tsup.config.ts`

### Alias/import cleanup hotspots already observed
- `shared/workflow/runtime/nodes/registerDefaultNodes.ts`
- `shared/workflow/actions/emailWorkflowActions.ts`
- any worker-reachable path still importing `@shared/*`

## Constraints / guardrails

- Do not reintroduce legacy DB runtime authority for authored Workflow Runtime V2.
- Prefer explicit worker-safe boundaries over container-only symlink or build hacks.
- Keep authored queue name stable unless separately approved.
- Minimize blast radius to non-authored/domain Temporal workflows.
- Keep `workflow-worker` as a single process/container for authored support + authored queue polling.

## Validation targets

### Ownership validation
- `workflow-worker` logs show Temporal polling for `workflow-runtime-v2`
- `temporal-worker` logs/config no longer show authored queue ownership
- Temporal UI shows active workers for `workflow-runtime-v2`

### Behavior validation
- manual run launches Temporal workflow and progresses with `workflow-worker`
- authored `time.wait` / `event.wait` progress without `temporal-worker`
- non-authored/domain Temporal queues still run under `temporal-worker`

### Boundary validation
- worker-safe runtime imports do not require `@shared/*`
- worker-safe runtime imports do not require repo-relative source hops from dist
- worker-safe runtime imports do not drag UI/app-only modules into worker boot

## Useful commands

### Worker/container inspection
- `docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | rg 'temporal-worker|temporal-dev|workflow-worker'`
- `docker logs --tail 120 alga-psa-local-test-workflow-worker-1`
- `docker logs --tail 120 alga-psa-local-test-temporal-worker-1`

### Queue ownership checks
- open Temporal UI at `http://localhost:8088`
- inspect queue `workflow-runtime-v2`
- confirm workers tab shows ownership from `workflow-worker` expectations

### Import graph checks
- `rg -n "@shared/|packages/ee/src|\.\./\.\./\.\./\.\./\.\./shared" ee/packages/workflows/src ee/temporal-workflows/src shared/workflow -g '!**/dist/**'`
- `node -e "import('./ee/packages/workflows/dist/runtime/index.mjs')"`

## Open follow-ups

- Decide whether authored workflow definitions/activities should remain physically under `ee/temporal-workflows` for now or move later.
- Decide whether to add a hard startup assertion against dual queue ownership.
- Decide whether `workflow-worker` should host only authored runtime queue polling or eventually more Temporal responsibilities.

## Implementation log (2026-04-09)

### Completed feature set in this checkpoint
- Ownership + queue split foundations: `F001`, `F002`, `F003`, `F004`, `F006`, `F007`, `F008`, `F009`, `F010`
- Runtime boundary split: `F011`, `F012`, `F013`, `F014`, `F015`, `F016`, `F017`
- Worker-safe import layering and startup dependency cleanup: `F018`, `F019`, `F020`, `F021`
- Contract/environment continuity: `F022`, `F023`, `F024`, `F025`, `F026`

### Key decisions and rationale
- `workflow-worker` now owns authored Temporal polling by adding a dedicated in-process Temporal poller (`WorkflowRuntimeV2TemporalWorker`) that starts alongside existing event-ingress workers.
  - Rationale: satisfy single-process ownership (`FR-3`) and make authored run debugging start from `workflow-worker`.
- `temporal-worker` now hard-fails if configured with `workflow-runtime-v2`.
  - Rationale: enforce no-dual-ownership risk mitigation (`F008`) instead of relying on convention.
- `@alga-psa/workflows/runtime` was split into explicit surfaces:
  - `runtime/core` for worker-safe initialization (no AI/bootstrap wiring)
  - `runtime/bootstrap` for app/server richer registration
  - `runtime/index` now re-exports bootstrap for backward compatibility.
  - Rationale: preserve existing server behavior while giving workers a safe core import path.
- `workflow-worker` switched imports from `@alga-psa/workflows/runtime` to `@alga-psa/workflows/runtime/core`.
  - Rationale: keep app/bootstrap-only side effects out of worker startup.

### Files changed (high signal)
- Worker ownership/polling:
  - `services/workflow-worker/src/v2/WorkflowRuntimeV2TemporalWorker.ts` (new)
  - `services/workflow-worker/src/index.ts`
  - `services/workflow-worker/src/index.startup.test.ts`
  - `services/workflow-worker/src/v2/WorkflowRuntimeV2TemporalWorker.test.ts` (new)
- Temporal worker scope:
  - `ee/temporal-workflows/src/workerConfig.ts` (new)
  - `ee/temporal-workflows/src/worker.ts`
  - `ee/temporal-workflows/src/__tests__/worker-queue-ownership.test.ts` (new)
- Runtime split:
  - `ee/packages/workflows/src/runtime/core.ts` (new)
  - `ee/packages/workflows/src/runtime/bootstrap.ts` (new)
  - `ee/packages/workflows/src/runtime/index.ts`
  - `ee/packages/workflows/package.json` exports update
  - `ee/packages/workflows/src/runtime/__tests__/runtimeEntryBoundaries.test.ts` (new)
- Compose/build wiring:
  - `docker-compose.ee.yaml`
  - `docker-compose.temporal.ee.yaml`
  - `services/workflow-worker/Dockerfile`
  - `services/workflow-worker/package.json`

### Commands and checks run
- `cd services/workflow-worker && npx vitest run src/index.startup.test.ts src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts src/v2/WorkflowRuntimeV2TemporalWorker.test.ts`
- `cd services/workflow-worker && npm run build`
- `cd ee/temporal-workflows && npx vitest run src/__tests__/worker-queue-ownership.test.ts`
- `cd ee/temporal-workflows && npm run build`
- `cd ee/packages/workflows && npx vitest run src/runtime/__tests__/runtimeEntryBoundaries.test.ts`
- `cd ee/packages/workflows && npm run build`

### Tests checklist updates completed in this checkpoint
- `T001` implemented
- `T003` implemented
- `T004` implemented
- `T005` implemented
- `T006` implemented
- `T008` implemented
- `T010` implemented

### Gotchas discovered
- `ee/temporal-workflows/src/worker.ts` could not be directly imported in a lightweight config unit test due broader worker module dependency graph resolution; fixed by extracting queue config to `workerConfig.ts` for isolated testing.
- `services/workflow-worker/package.json` test script pointed at a missing `vitest.config.ts`; updated to plain `vitest`/`vitest --watch`.

### Remaining items after this checkpoint
- Features not yet implemented/verified: `F005`, `F027`, `F029`
- Tests not yet implemented/verified: `T002`, `T007`, `T009`, `T011`
- Added ownership/support documentation: `OWNERSHIP.md` (`F030`).
- Updated `ee/packages/workflows/src/lib/workflowRunLauncher.ts` to import runtime initialization from `@alga-psa/workflows/runtime/core` so worker startup paths do not transitively pull `runtime/bootstrap`.
- Strengthened `services/workflow-worker/scripts/validate-runtime-imports.mjs` with explicit checks for unresolved `@shared/*` aliases and bootstrap-only runtime dependency leakage (`registerAiActions`, `workflowInferenceService`, `runtime/bootstrap`).
- Added contract regression test for Temporal launch/signal queue authority:
  - `ee/packages/workflows/src/lib/__tests__/workflowRuntimeV2Temporal.contract.test.ts` (`T010`)
- Attempted local compose smoke for `F029`/`T009` with:
  - `docker compose -f docker-compose.ee.yaml -f docker-compose.temporal.ee.yaml up -d --build workflow-worker temporal-worker`
  - Blocked by missing compose env/secret context in this shell (`service "setup" refers to undefined secret postgres_password`).

## Implementation log (2026-04-09, follow-up checkpoint)

### Completed in this checkpoint
- Feature `F005` implemented via real Temporal integration coverage in `workflow-worker`.
- Feature `F027` implemented by removing authored-runtime modules from `temporal-worker` startup entrypoints.
- Test `T002` implemented with an automated authored-run execution smoke test (Temporal test environment + `WorkflowRuntimeV2TemporalWorker`).
- Test `T007` implemented with import-graph regression tests that validate dist-graph safety against unresolved `@shared/*` aliases and repo-layout-relative source hops.

### Decisions and rationale
- Added non-authored Temporal worker entrypoint barrels (`non-authored-index.ts`) and pointed `ee/temporal-workflows/src/worker.ts` to those barrels.
  - Rationale: `temporal-worker` should not carry authored-runtime startup/module baggage once authored queue ownership moved.
- Added an integration test that starts `WorkflowRuntimeV2TemporalWorker` against `TestWorkflowEnvironment` and executes `workflowRuntimeV2RunWorkflow` on queue `workflow-runtime-v2`.
  - Rationale: directly proves authored runtime tasks are picked up/progressed by `workflow-worker` without requiring `temporal-worker`.
- Made `validate-runtime-imports.mjs` accept override env `WORKFLOW_WORKER_VALIDATE_DIST_ROOT`.
  - Rationale: allows deterministic regression tests against fixture dist trees while preserving production behavior.

### Files changed in this checkpoint
- `ee/temporal-workflows/src/workflows/non-authored-index.ts` (new)
- `ee/temporal-workflows/src/activities/non-authored-index.ts` (new)
- `ee/temporal-workflows/src/worker.ts`
- `ee/temporal-workflows/src/__tests__/worker-queue-ownership.test.ts`
- `services/workflow-worker/src/v2/WorkflowRuntimeV2TemporalWorker.integration.test.ts` (new)
- `services/workflow-worker/src/v2/WorkflowRuntimeV2TemporalWorker.integration.workflows.mjs` (new)
- `services/workflow-worker/src/v2/WorkflowRuntimeV2TemporalWorker.integration.activities.mjs` (new)
- `services/workflow-worker/scripts/validate-runtime-imports.mjs`
- `services/workflow-worker/scripts/validate-runtime-imports.test.ts` (new)

### Commands and checks run
- `cd services/workflow-worker && npx vitest run src/v2/WorkflowRuntimeV2TemporalWorker.test.ts src/v2/WorkflowRuntimeV2TemporalWorker.integration.test.ts src/index.startup.test.ts scripts/validate-runtime-imports.test.ts`
- `cd ee/temporal-workflows && npx vitest run src/__tests__/worker-queue-ownership.test.ts`
- `cd services/workflow-worker && npm run build`
- `cd ee/temporal-workflows && npm run build`

### Compose smoke attempts and blockers (`F029`, `T009`, `T011`)
- Brought up compose with full base layering:
  - `docker compose -f docker-compose.base.yaml -f docker-compose.ee.yaml -f docker-compose.temporal.ee.yaml up -d --build workflow-worker temporal-worker temporal-ui temporal-dev`
- Resolved missing external volume blocker by creating:
  - `docker volume create workflow-wait-steps-productization_ngrok_data`
- Resolved Temporal host port collision by running compose with:
  - `EXPOSE_TEMPORAL_PORT=17233 EXPOSE_TEMPORAL_UI_PORT=18088 TEMPORAL_ADDRESS=temporal-dev:7233 ...`
- Remaining runtime blockers observed in logs:
  - `workflow-worker` fails at startup with Temporal native bridge load error:
    - `Error relocating ... @temporalio/core-bridge ... __register_atfork: symbol not found`
  - `temporal-worker` fails startup validation due missing required config/secrets in this shell context:
    - missing `ALGA_AUTH_KEY`, `NEXTAUTH_SECRET`, `APPLICATION_URL`
- Because workers are not both healthy in this environment, could not complete:
  - `F029` (UI active authored queue worker confirmation)
  - `T009` (compose/dev environment authored runtime ownership smoke)
  - `T011` (DB-backed integration sanity across workflow tables)

### Remaining items after this checkpoint
- Features not yet implemented/verified: `F029`
- Tests not yet implemented/verified: `T009`, `T011`

## Implementation log (2026-04-09, runtime packaging follow-up)

### What was changed
- Added a dedicated compose smoke harness script:
  - `scripts/workflow-runtime-v2-compose-smoke.mjs`
  - Added root script entry:
    - `package.json` → `test:workflow-runtime-v2-compose-smoke`
- Extended `workflow-worker` image build inputs and runtime dependencies:
  - `services/workflow-worker/Dockerfile`
  - Builds now include additional workspaces required by authored Temporal runtime paths (`@alga-psa/core`, `@alga-psa/types`, `@alga-psa/db`, `@alga-psa/formatting`, `@alga-psa/validation`, `@alga-psa/storage`, plus existing workflow/temporal/shared chain).
- Added temporal compose profile defaults for worker startup env:
  - `docker-compose.temporal.ee.yaml`
  - Includes local defaults for app/auth keys used during worker startup.
- Hardened `@alga-psa/core` runtime exports for worker containers:
  - `packages/core/package.json` now points runtime `import` exports to built JS under `dist/` instead of TS sources.
  - `packages/core/tsup.config.ts` now enables `addJsExtensions: true` so dist ESM imports are Node-resolvable.

### New findings
- The previous blocker (`ERR_UNKNOWN_FILE_EXTENSION` for `/app/packages/core/src/lib/logger.ts`) was due to `@alga-psa/core` exports resolving to TS source in standalone worker runtime.
- After redirecting core exports to dist, worker startup moved to the next failure:
  - `Cannot find module '/app/packages/core/dist/lib/secrets/EnvSecretProvider' imported from /app/packages/core/dist/lib/secrets/index.js`
  - Root cause: extensionless relative imports in core dist ESM output.
  - Fixed by enabling `addJsExtensions` in core tsup config.
- With those fixes in place, authored queue smoke is still blocked by compose-environment instability and repeated project collisions/port contention during iterative retries (not a single deterministic app-code failure yet for final `F029/T009/T011` sign-off).

### Current blocker state
- `F029`, `T009`, `T011` remain unflipped.
- Latest known high-signal blocker for clean verification is environment orchestration stability during long compose build/start loops (port collisions and overlapping compose projects), not a closed acceptance pass yet.

### Additional unblock attempt (same day)
- Updated `services/workflow-worker/Dockerfile` base image from Alpine to Debian slim to remove Temporal native bridge libc mismatch seen earlier (`__register_atfork`).
- Updated `docker-compose.temporal.ee.yaml` to provide local defaults for:
  - `APPLICATION_URL`
  - `NEXTAUTH_URL`
  - `NEXTAUTH_SECRET`
  - `ALGA_AUTH_KEY`
- Rebuilt `workflow-worker` image and re-ran compose smoke with explicit local env overrides:
  - `EXPOSE_TEMPORAL_PORT=17233 EXPOSE_TEMPORAL_UI_PORT=18088 TEMPORAL_ADDRESS=temporal-dev:7233 ALGA_AUTH_KEY=local-alga-auth-key NEXTAUTH_SECRET=local-nextauth-secret APPLICATION_URL=http://localhost:3000 docker compose -f docker-compose.base.yaml -f docker-compose.ee.yaml -f docker-compose.temporal.ee.yaml up -d workflow-worker temporal-worker temporal-ui temporal-dev`

### New observed blockers after unblock attempt
- `workflow-worker` still fails startup before stable queue polling due missing runtime modules in container image:
  - missing `@ee/lib` import from `registerEnterpriseStorageProviders`
  - missing `@alga-psa/types/dist/index.js` import from `@alga-psa/workflows/dist/runtime/index.mjs`
- `temporal-worker` startup validation reaches DB checks but fails with:
  - `password authentication failed for user "app_user"`
- Because of these unresolved startup/runtime issues, `F029` / `T009` / `T011` remain unverified.

## Implementation log (2026-04-09, runtime packaging follow-up 2)

### Additional runtime fixes applied
- `packages/types/tsup.config.ts`
  - Enabled `addJsExtensions: true` so `dist/index.js` and internal imports emit explicit `.js` specifiers for Node ESM.
- `packages/validation/tsup.config.ts`
  - Enabled `addJsExtensions: true` preemptively for the same worker-runtime ESM compatibility reason.

### New high-signal failure observed after core fix
- Worker startup advanced further but then failed on:
  - `Cannot find module '/app/packages/types/dist/lib/attributes' imported from /app/packages/types/dist/index.js`
- This confirmed the same extensionless-import class of failure now affected `@alga-psa/types`; fix above addresses that class.

### Verification state after this follow-up
- Full `F029/T009/T011` end-to-end acceptance is still not closed in this session.
- Latest blocker remains compose-heavy verification reliability (long build/start cycles and repeated project/port churn), with worker now moving through successive package-resolution failures as runtime packaging is hardened.
