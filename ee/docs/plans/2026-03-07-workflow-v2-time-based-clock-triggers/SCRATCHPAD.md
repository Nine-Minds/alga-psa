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
- (2026-03-07) Direct `trigger.eventName` and `trigger.sourcePayloadSchemaRef` access already exists in shared bundling, runtime actions, and run-studio UI; widening the trigger union requires explicit event-trigger narrowing at those call sites.

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

## Progress Log

- (2026-03-07) Completed F001/F002 and T001-T005.
  - Added `workflowTriggerSchema` as a discriminated union in `shared/workflow/runtime/types.ts` with `event`, `schedule`, and `recurring` variants plus reusable type guards.
  - Kept no-trigger behavior unchanged by leaving `trigger` optional on `workflowDefinitionSchema`.
  - Confirmed create/update action inputs accept time-trigger variants via the shared definition schema instead of separate action-only trigger parsing.
  - Added `server/src/test/unit/workflowTimeTriggerSchemas.unit.test.ts` covering shared schema acceptance, no-trigger preservation, and create/update input parsing.
  - Narrowed existing event-only call sites in dependency summary extraction, workflow runtime actions, and run-studio trigger display so the widened trigger union stays type-safe.

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
