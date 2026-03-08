# Scratchpad — Workflow V2 Time-Based Clock Triggers

- Plan slug: `workflow-v2-time-based-clock-triggers`
- Created: `2026-03-07`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while planning and implementing Workflow V2 pure clock triggers.

## Decisions

- (2026-03-07) Scope starts with pure clock triggers only. Each fire starts one workflow run. No domain-record fan-out.
- (2026-03-07) Cron support is limited to 5-field cron. No seconds field and no 6-field cron syntax.
- (2026-03-07) This capability is EE-only.
- (2026-03-07) “No trigger” remains the no-trigger shape. Do not add an explicit manual trigger type in this scope.
- (2026-03-07) Preferred architecture is first-class time triggers, not synthetic event catalog entries.
- (2026-03-07) Preferred scheduling substrate is the job-runner abstraction (`scheduleJobAt` and `scheduleRecurringJob`), not the legacy `JobScheduler`.
- (2026-03-07) Time-triggered workflows should use a fixed synthetic payload contract and pinned payload schema mode in v1.
- (2026-03-07) Run creation should be unified behind one launcher service shared by event and time triggers.
- (2026-03-07) Canonical Workflow V2 trigger discriminants will be `event`, `schedule`, and `recurring`; one-time and recurring triggers stay first-class instead of overloading event names.
- (2026-03-07) Create/update action inputs should continue to accept trigger variants by delegating to `workflowDefinitionSchema` rather than duplicating a second trigger union.

## Discoveries / Constraints

- (2026-03-07) The canonical Workflow V2 definition schema only supports `trigger.type = 'event'` today. Key file: `shared/workflow/runtime/types.ts`.
- (2026-03-07) The designer trigger UX is event-only and tightly coupled to event catalog lookups, source schema overrides, and trigger mapping. Key file: `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`.
- (2026-03-07) Publish validation is split between shared runtime validation and server-action validation. Trigger-specific logic currently assumes event triggers.
- (2026-03-07) Event-trigger run start logic already exists in more than one path and has behavioral drift. Adding a third bespoke path for time triggers would worsen consistency problems.
- (2026-03-07) Workflow V2 already has durable wait/retry timing inside runs, but not durable scheduled starts for workflow definitions.
- (2026-03-07) The extension scheduler is the strongest reusable scheduling implementation already in the repo and persists both internal job ids and external runner schedule ids.
- (2026-03-07) `IJobRunner` supports both one-time scheduled execution and recurring scheduled execution. This is the correct reuse seam for workflow time triggers.
- (2026-03-07) The legacy `JobScheduler` is not a safe base for real cron semantics because it coarsens cron-ish input to a delayed interval path.
- (2026-03-07) Current workflow list/filter code still contains trigger-type heuristics that infer “scheduled” from event-name strings. That should be removed once real trigger types exist.
- (2026-03-07) Existing job-runner handler signatures do not provide a per-occurrence recurring fire id. PgBoss cron schedules inject the stable registration `jobServiceId` into each delivery, and the runner calls handlers with that value instead of the transient PgBoss job id. Temporal recurring schedules likewise start each occurrence with the stable registration `jobRecord.jobId`. That means `scheduleId + jobId` is safe for one-time schedules but would incorrectly dedupe every recurring fire after the first one. Key files: `server/src/lib/jobs/runners/PgBossJobRunner.ts`, `ee/server/src/lib/jobs/runners/TemporalJobRunner.ts`, `ee/temporal-workflows/src/workflows/generic-job-workflow.ts`.
- (2026-03-07) Importing the broad `server/src/lib/jobs` barrel from workflow runtime code drags in unrelated handlers; for scheduling lifecycle code, the safer seam is `server/src/lib/jobs/JobRunnerFactory` so action/import paths do not depend on optional job-handler modules.
- (2026-03-07) Existing `workflow_runs` columns are sufficient for event provenance but not honest enough for time-trigger provenance. Added explicit `trigger_type` plus `trigger_metadata_json` so clock-triggered runs are not represented as fake event names.
- (2026-03-07) Direct `trigger.eventName` and `trigger.sourcePayloadSchemaRef` access already exists in shared bundling, runtime actions, and run-studio UI; widening the trigger union requires explicit event-trigger narrowing at those call sites.
- (2026-03-07) `payload_schema_mode` is persisted on the workflow definition record, not on publish input. That means publish must explicitly reject time-trigger definitions if an older draft is still marked `inferred`.
- (2026-03-07) Local Workflow V2 integration tests in this worktree could not use the usual DB-backed harness because PostgreSQL was unavailable on `localhost:5438`; a mock-backed unit suite was a better fit for publish-path validation coverage.
- (2026-03-07) The paged workflow list action still filtered `scheduled` workflows by checking `trigger.eventName` for `schedule`/`cron` substrings. Real trigger filtering needs to key off `trigger.type`.

## Commands / Runbooks

- (2026-03-07) Inspect Workflow V2 trigger contract:
  - `sed -n '260,325p' shared/workflow/runtime/types.ts`
- (2026-03-07) Inspect Workflow Designer trigger UI:
  - `rg -n "workflow-designer-trigger|Trigger event|payloadMapping|event catalog" ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
  - `sed -n '3460,3875p' ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
- (2026-03-07) Inspect publish validation and event-trigger launch path:
  - `rg -n "computeValidation|submitWorkflowEventAction|publishWorkflowDefinitionAction" packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
- (2026-03-07) Inspect scheduling substrate:
  - `sed -n '36,140p' server/src/lib/jobs/interfaces/IJobRunner.ts`
  - `sed -n '400,590p' ee/server/src/lib/extensions/schedulerHostApi.ts`
  - `sed -n '260,420p' server/src/lib/jobs/runners/PgBossJobRunner.ts`
- (2026-03-07) Validate initial schema slice:
  - `cd server && pnpm vitest run src/test/unit/workflowTimeTriggerSchemas.unit.test.ts --config vitest.config.ts`
  - `pnpm exec eslint shared/workflow/runtime/types.ts shared/workflow/bundle/dependencySummaryV1.ts packages/workflows/src/actions/workflow-runtime-v2-actions.ts ee/server/src/components/workflow-run-studio/RunStudioShell.tsx server/src/test/unit/workflowTimeTriggerSchemas.unit.test.ts`
- (2026-03-07) Validate time-trigger publish/contract slice:
  - `cd server && pnpm vitest run src/test/unit/workflowTimeTriggerSchemas.unit.test.ts src/test/unit/workflowTimeTriggerPublishValidation.unit.test.ts --config vitest.config.ts`
  - `pnpm exec eslint shared/workflow/runtime/types.ts shared/workflow/runtime/init.ts shared/workflow/runtime/index.ts shared/workflow/runtime/schemas/workflowClockTriggerSchema.ts server/src/lib/features.ts packages/workflows/src/actions/workflow-runtime-v2-actions.ts server/src/test/unit/workflowTimeTriggerPublishValidation.unit.test.ts`
- (2026-03-07) Validate workflow list trigger-type filtering:
  - `cd server && pnpm vitest run src/test/unit/workflowDefinitionListTriggerFilters.unit.test.ts --config vitest.config.ts`
  - `pnpm exec eslint packages/workflows/src/actions/workflow-runtime-v2-schemas.ts packages/workflows/src/actions/workflow-runtime-v2-actions.ts packages/workflows/src/components/automation-hub/WorkflowList.tsx server/src/test/unit/workflowDefinitionListTriggerFilters.unit.test.ts`
- (2026-03-07) Validate Workflow Designer time-trigger UI:
  - `pnpm exec eslint ee/server/src/components/workflow-designer/WorkflowDesigner.tsx ee/server/src/__tests__/page-objects/WorkflowDesignerPage.ts ee/server/src/__tests__/integration/workflow-designer-time-triggers.playwright.test.ts`
  - `cd ee/server && npm run typecheck`
  - `cd ee/server && npx playwright test -c playwright.config.ts src/__tests__/integration/workflow-designer-time-triggers.playwright.test.ts --headed`
- (2026-03-07) Validate scheduling lifecycle and launcher wiring:
  - `cd server && pnpm vitest run src/test/unit/workflowTimeTriggerSchedulingLifecycle.unit.test.ts src/test/unit/workflowScheduledRunHandlers.unit.test.ts src/test/unit/workflowEventLauncherRouting.unit.test.ts --config vitest.config.ts`
  - `cd ee/server && npm run typecheck`
- (2026-03-07) Attempt event-trigger regression validation after launcher extraction:
  - `cd server && pnpm vitest run src/test/integration/workflowRuntimeV2.eventTrigger.integration.test.ts --coverage.enabled=false --config vitest.config.ts`
- (2026-03-07) Validate run provenance persistence:
  - `cd server && pnpm vitest run src/test/unit/workflowRunTriggerProvenance.unit.test.ts src/test/unit/workflowScheduledRunHandlers.unit.test.ts src/test/unit/workflowEventLauncherRouting.unit.test.ts src/test/unit/workflowTimeTriggerSchedulingLifecycle.unit.test.ts --coverage.enabled=false --config vitest.config.ts`
  - `cd ee/server && npm run typecheck`
- (2026-03-07) Validate run provenance, dedupe, and UI trigger-label helpers after recurring-fire-key fix:
  - `cd server && pnpm vitest run src/test/unit/workflowScheduledRunHandlers.unit.test.ts src/test/unit/workflowRunLauncher.unit.test.ts src/test/unit/workflowRunTriggerProvenance.unit.test.ts src/test/unit/workflowEventLauncherRouting.unit.test.ts src/test/unit/workflowTimeTriggerSchedulingLifecycle.unit.test.ts --coverage.enabled=false --config vitest.config.ts`
  - `cd ee/server && pnpm vitest run src/__tests__/unit/workflowRunTriggerPresentation.unit.test.ts`
  - `cd ee/server && npm run typecheck`
  - `cd ee/temporal-workflows && npm run type-check`

## Progress Log

- (2026-03-07) Completed F001/F002 and T001-T005.
  - Added `workflowTriggerSchema` as a discriminated union in `shared/workflow/runtime/types.ts` with `event`, `schedule`, and `recurring` variants plus reusable type guards.
  - Kept no-trigger behavior unchanged by leaving `trigger` optional on `workflowDefinitionSchema`.
  - Confirmed create/update action inputs accept time-trigger variants via the shared definition schema instead of separate action-only trigger parsing.
  - Added `server/src/test/unit/workflowTimeTriggerSchemas.unit.test.ts` covering shared schema acceptance, no-trigger preservation, and create/update input parsing.
  - Narrowed existing event-only call sites in dependency summary extraction, workflow runtime actions, and run-studio trigger display so the widened trigger union stays type-safe.
- (2026-03-07) Completed F003-F007 and T006-T015.
  - Added the fixed clock payload contract schema/registry entry at `payload.WorkflowClockTrigger.v1`.
  - Time-trigger draft saves now normalize onto the fixed clock payload contract and reject CE create/update attempts at action time.
  - Publish now rejects CE time-trigger workflows and rejects any time-trigger publish attempt that still uses inferred payload schema mode.
  - Added publish-time validation for one-time schedules (`runAt` required, valid ISO timestamp, future-only) and recurring schedules (valid 5-field cron, valid IANA timezone).
  - Added `server/src/test/unit/workflowTimeTriggerPublishValidation.unit.test.ts` to cover EE gating, fixed schema resolution, inferred-mode rejection, and one-time/recurring validation behavior without depending on a local PostgreSQL harness.
- (2026-03-07) Completed F008 and T016-T017.
  - Replaced workflow-definition list filtering on `trigger.eventName` substring heuristics with direct `trigger.type` comparisons.
  - Preserved backward compatibility for legacy `trigger=scheduled` URLs by mapping that filter to both `schedule` and `recurring` trigger types.
  - Updated the workflow list UI to label and iconize `event`, `schedule`, `recurring`, and `manual` directly from persisted trigger types.
  - Added `server/src/test/unit/workflowDefinitionListTriggerFilters.unit.test.ts` to verify one-time and recurring filters hit the real `trigger.type` query path and return the corresponding trigger types intact.
- (2026-03-07) Completed F009-F013 and T018-T021.
  - Replaced the event-only trigger control in `WorkflowDesigner.tsx` with an explicit trigger-type selector that switches among no trigger, event, one-time schedule, and recurring schedule.
  - Added one-time schedule editing via a future `datetime-local` input and recurring schedule editing via a cron input plus searchable timezone selector with 5-field guidance.
  - Time-trigger selection now hides event-only catalog/mapping controls, forces the fixed clock contract into pinned mode, and disables schema overrides while a time trigger is active.
  - Added an inline clock-contract preview card that surfaces `payload.WorkflowClockTrigger.v1` and its fixed payload fields directly in the trigger section.
  - Added `ee/server/src/__tests__/integration/workflow-designer-time-triggers.playwright.test.ts` plus page-object helpers for the new controls.
  - `npm run typecheck` passed in `ee/server`.
  - The targeted Playwright run could not complete in this environment because the EE Playwright web-server bootstrap never brought `http://localhost:3300` up; the worker stalled before any browser steps ran.
- (2026-03-07) Completed F014-F023 and T008/T025-T034.
  - Added the EE migration `ee/server/migrations/20260307200000_create_workflow_schedule_tables.cjs` plus `shared/workflow/persistence/workflowScheduleStateModel.ts` for durable workflow schedule registration state.
  - Added `server/src/lib/workflow-runtime-v2/workflowScheduleLifecycle.ts` to build desired schedule state, register one-time and recurring jobs through `IJobRunner`, compensate failed reschedules, and clean up registrations on pause/delete/trigger changes.
  - Added `server/src/lib/workflow-runtime-v2/workflowRunLauncher.ts` as the shared published-workflow launcher, then routed both `submitWorkflowEventAction` and `WorkflowRuntimeV2EventStreamWorker` through it.
  - Added `server/src/lib/jobs/handlers/workflowScheduledRunHandlers.ts` and registered EE-only one-time/recurring schedule handlers in `server/src/lib/jobs/registerAllHandlers.ts`.
  - Publishing, pausing, deleting, and re-publishing time-triggered workflows now synchronize schedule registration state from `packages/workflows/src/actions/workflow-runtime-v2-actions.ts`.
  - Narrowed workflow schedule lifecycle imports to `server/src/lib/jobs/JobRunnerFactory` so the new scheduler path does not pull the entire jobs barrel during action imports.
  - Added unit coverage in `server/src/test/unit/workflowTimeTriggerSchedulingLifecycle.unit.test.ts`, `server/src/test/unit/workflowScheduledRunHandlers.unit.test.ts`, and `server/src/test/unit/workflowEventLauncherRouting.unit.test.ts` for launcher wiring, fixed payload contract emission, schedule registration calls, pause/delete/change-away cleanup, and one-time/recurring reschedule replacement.
  - Left T022-T024 false because this checkpoint still lacks DB-backed integration coverage that exercises real `tenant_workflow_schedule` rows against a migrated test database; current coverage is action/handler-focused unit coverage.
  - Left T046 false because the targeted event-trigger integration suite could not run in this local environment: PostgreSQL was unavailable on `127.0.0.1:5438`/`::1:5438`, so the suite skipped its tests during setup and failed before exercising the regression path.
- (2026-03-07) Completed F024 and T035/T037/T038.
  - One-time schedule handler success now marks `tenant_workflow_schedule` rows `completed`, clears runner handles, disables the schedule, and nulls `next_fire_at`.
  - Re-delivery after a successful one-time fire now short-circuits on the existing `enabled/status` guard, so later ticks do not launch another run.
  - Re-ran `cd server && pnpm vitest run src/test/unit/workflowScheduledRunHandlers.unit.test.ts src/test/unit/workflowEventLauncherRouting.unit.test.ts src/test/unit/workflowTimeTriggerSchedulingLifecycle.unit.test.ts --coverage.enabled=false --config vitest.config.ts`.
- (2026-03-07) Completed F025 and T039/T040.
  - Added `server/migrations/20260308010000_add_workflow_run_trigger_provenance.cjs` to store `trigger_type` and `trigger_metadata_json` on `workflow_runs`.
  - `WorkflowRuntimeV2.startRun()` now persists trigger provenance explicitly, and `launchPublishedWorkflowRun()` threads that metadata through for both event and time-triggered launches.
  - Time-trigger job handlers now pass the fixed clock payload through as trigger metadata, while event launches tag runs as `trigger_type = 'event'` with lightweight trigger metadata for parity.
  - `listWorkflowRunsAction()` now selects the new provenance fields so downstream UI can distinguish schedule and recurring runs without inferring from `event_type`.
  - Added `server/src/test/unit/workflowRunTriggerProvenance.unit.test.ts` and re-ran the unit provenance/lifecycle suite plus `cd ee/server && npm run typecheck`.
- (2026-03-07) Completed F026/F027 and T036/T041-T044.
  - Added shared trigger/schedule presentation helpers at `ee/server/src/components/workflow-designer/workflowRunTriggerPresentation.ts` and wired workflow run list/details plus Run Studio to show one-time/recurring labels and current schedule state from `getWorkflowScheduleStateAction()`.
  - Added `server/migrations/20260308013000_add_workflow_run_trigger_fire_key.cjs` plus launcher-level duplicate handling keyed by `workflow_runs.trigger_fire_key`.
  - Corrected the recurring dedupe design after discovering runner `jobId` is the stable registration id, not a per-occurrence id. PgBoss now injects `jobExecutionId = job.id` and Temporal now injects `jobExecutionId = workflowInfo().workflowId`; schedule fire keys now use that runner-supplied execution id so later recurring occurrences still launch while retries of the same occurrence remain idempotent.
  - One-time schedule handlers now store `last_fire_key` and complete/disable the schedule after a successful fire; recurring handlers store `last_fire_key` per occurrence while leaving the schedule active.
  - Added/updated unit coverage in `server/src/test/unit/workflowScheduledRunHandlers.unit.test.ts`, `server/src/test/unit/workflowRunLauncher.unit.test.ts`, and `ee/server/src/__tests__/unit/workflowRunTriggerPresentation.unit.test.ts`.
  - Remaining unchecked tests are still environment-blocked:
    - T022-T024 need a real PostgreSQL-backed integration harness with `tenant_workflow_schedule` available.
    - T045-T046 need the same DB-backed integration harness to execute the publish/start regression paths.
    - Local verification is currently blocked because no PostgreSQL server is reachable on `localhost:5432`, and Docker commands time out in this shell before a base-compose `postgres` service can be started.

## Links / References

- Workflow definition schema: `shared/workflow/runtime/types.ts`
- Workflow publish/run actions: `packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
- Workflow action input schemas: `packages/workflows/src/actions/workflow-runtime-v2-schemas.ts`
- Workflow definition persistence: `shared/workflow/persistence/workflowDefinitionModelV2.ts`
- Workflow run worker: `shared/workflow/workers/WorkflowRuntimeV2Worker.ts`
- Workflow event-stream worker: `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts`
- Workflow designer: `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
- Job runner interface: `server/src/lib/jobs/interfaces/IJobRunner.ts`
- PG Boss runner: `server/src/lib/jobs/runners/PgBossJobRunner.ts`
- EE Temporal runner: `ee/server/src/lib/jobs/runners/TemporalJobRunner.ts`
- EE extension scheduler API: `ee/server/src/lib/extensions/schedulerHostApi.ts`
- Extension schedule handler: `server/src/lib/jobs/handlers/extensionScheduledInvocationHandler.ts`
- Related existing schedule table migration: `ee/server/migrations/20260101120000_create_extension_schedule_tables.cjs`

## Open Questions

- Should completed one-time schedules remain as durable rows forever or be archived/cleaned up later?
- Should the first version expose next-fire previews in the designer, or leave that to a follow-up?
- Should workflow run provenance for time triggers use new explicit columns, or be represented through structured run metadata layered on top of current provenance fields?
- (2026-03-07) What stable per-occurrence key should recurring schedule fires use across retries and across both PgBoss and Temporal runners? Current runner inputs expose schedule registration ids but not an occurrence id.
