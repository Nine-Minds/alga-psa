# Scratchpad — Workflow V2 External Schedules

- Plan slug: `workflow-v2-external-schedules`
- Created: `2026-03-08`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while planning and implementing the external schedules redesign for Workflow V2.

## Decisions

- (2026-03-08) Schedules move out of workflow definitions and become first-class tenant-owned records.
- (2026-03-08) A workflow can have many schedules.
- (2026-03-08) Schedules are managed from a global Automation Hub schedules screen.
- (2026-03-08) Add a menu entry under the Automation Hub parent menu for schedules.
- (2026-03-08) Only workflows with pinned payload schemas are schedulable in v1.
- (2026-03-08) Schedules follow the latest published workflow version automatically.
- (2026-03-08) Schedule names are required.
- (2026-03-08) Workflow editor trigger options should become `No trigger` and `Event`; one-time and recurring trigger authoring moves out of the editor.
- (2026-03-08) Schedule payload authoring should reuse the existing schema-driven form/json patterns from the run dialog instead of creating a new payload editor from scratch.
- (2026-03-08) External schedule server actions should register only payload schemas, not the full workflow runtime, so schedule validation does not drag in unrelated action/node dependencies during request handling or test startup.

## Discoveries / Constraints

- (2026-03-08) The current schedule table was introduced as `tenant_workflow_schedule` and still enforces `unique(workflow_id)`, which blocks many schedules per workflow. Key file: `ee/server/migrations/20260307200000_create_workflow_schedule_tables.cjs`.
- (2026-03-08) The current schedule persistence model has no `name` or `payload_json` field. Key file: `shared/workflow/persistence/workflowScheduleStateModel.ts`.
- (2026-03-08) Workflow editor currently still contains inline time-trigger controls for one-time and recurring scheduling. Key file: `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`.
- (2026-03-08) Existing scheduled-run handlers already load schedule records and launch runs through a shared launcher, so reusing schedule-owned payloads should fit the current runtime seam. Key files: `server/src/lib/jobs/handlers/workflowScheduledRunHandlers.ts`, `server/src/lib/workflow-runtime-v2/workflowRunLauncher.ts`.
- (2026-03-08) The manual run dialog already has both schema-driven form mode and JSON mode plus client-side schema validation, and it is the best reuse candidate for schedule payload authoring. Key file: `ee/server/src/components/workflow-designer/WorkflowRunDialog.tsx`.
- (2026-03-08) Automation Hub currently has tabs for Template Library, Workflows, Events Catalog, and Logs & History. Schedules can slot into that existing tab model without inventing a separate top-level area. Key file: `packages/workflows/src/components/automation-hub/AutomationHub.tsx`.
- (2026-03-08) The prior 2026-03-07 plan describes the inline time-trigger approach and is already marked implemented, so this redesign needs its own plan folder instead of overwriting that historical plan.
- (2026-03-08) Importing `@shared/workflow/runtime` from the new schedule actions eagerly loads workflow runtime initialization exports, which in turn pull unrelated email/storage dependencies into Vitest resolution. Direct imports from the schema registry and schema modules avoid that coupling. Key files: `packages/workflows/src/actions/workflow-schedule-v2-actions.ts`, `shared/workflow/runtime/index.ts`.
- (2026-03-08) The new backend checkpoint covers persistence, migration, CRUD actions, validation guards, permission checks, and tenant-scoped list/get flows, but not publish-time rebinding/revalidation or runner launch payload changes yet. Keep `F005` and `F016`-`F020` false until that lifecycle work lands.

## Implementation Log

- (2026-03-08) Completed `F001` by keeping this redesign in its own plan folder under `ee/docs/plans/2026-03-08-workflow-v2-external-schedules/`, preserving the prior 2026-03-07 inline-trigger plan as historical context.
- (2026-03-08) Completed `F002`-`F004` by adding a migration to remove the legacy one-schedule-per-workflow constraint and by extending `tenant_workflow_schedule` with required `name` and persisted `payload_json`. Key files: `ee/server/migrations/20260308130000_expand_workflow_schedule_for_external_schedules.cjs`, `shared/workflow/persistence/workflowScheduleStateModel.ts`.
- (2026-03-08) Completed `F006`-`F015` by adding external schedule persistence helpers, lifecycle wrappers, zod action schemas, and tenant-scoped server actions for list/get/create/update/pause/resume/delete with published-version, pinned-schema, and payload validation guards. Key files: `server/src/lib/workflow-runtime-v2/workflowScheduleLifecycle.ts`, `packages/workflows/src/actions/workflow-schedule-v2-schemas.ts`, `packages/workflows/src/actions/workflow-schedule-v2-actions.ts`.
- (2026-03-08) Completed `F036` in the action layer by requiring workflow read permission for list/get and workflow manage permission for create/update/pause/resume/delete, plus explicit tenant checks before reading or mutating schedule records.
- (2026-03-08) Completed `T001`-`T020` and `T054` with new DB-backed migration and action integration suites covering migration safety, persisted `name` and `payload_json`, create/edit flows for one-time and recurring schedules, pause/resume/delete, published-version and pinned-schema guards, payload validation failures, and tenant-scoped global listing. Key files: `ee/server/src/__tests__/integration/workflow-external-schedules.migration.integration.test.ts`, `ee/server/src/__tests__/integration/workflow-external-schedules.actions.integration.test.ts`.

## Commands / Runbooks

- (2026-03-08) Inspect current schedule lifecycle:
  - `sed -n '1,220p' server/src/lib/workflow-runtime-v2/workflowScheduleLifecycle.ts`
- (2026-03-08) Inspect current scheduled-run handler behavior:
  - `sed -n '1,220p' server/src/lib/jobs/handlers/workflowScheduledRunHandlers.ts`
- (2026-03-08) Inspect current workflow editor trigger UI:
  - `sed -n '3715,4065p' ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
- (2026-03-08) Inspect current run dialog payload editor:
  - `sed -n '1,260p' ee/server/src/components/workflow-designer/WorkflowRunDialog.tsx`
- (2026-03-08) Inspect current schedule persistence model:
  - `sed -n '1,220p' shared/workflow/persistence/workflowScheduleStateModel.ts`
- (2026-03-08) Inspect current Automation Hub navigation:
  - `sed -n '1,260p' packages/workflows/src/components/automation-hub/AutomationHub.tsx`
- (2026-03-08) Verify TypeScript after the backend slice:
  - `npx tsc -p ee/server/tsconfig.json --noEmit`
- (2026-03-08) Verify the new external schedule integration suites against the local Postgres container:
  - `DB_HOST=localhost DB_PORT=55433 DB_PASSWORD_ADMIN=postpass123 DB_PASSWORD_SERVER=postpass123 npx vitest run --config vitest.config.ts src/__tests__/integration/workflow-external-schedules.migration.integration.test.ts src/__tests__/integration/workflow-external-schedules.actions.integration.test.ts`

## Links / References

- Prior inline time-trigger plan: `ee/docs/plans/2026-03-07-workflow-v2-time-based-clock-triggers/`
- Schedule migration: `ee/server/migrations/20260307200000_create_workflow_schedule_tables.cjs`
- External schedule expansion migration: `ee/server/migrations/20260308130000_expand_workflow_schedule_for_external_schedules.cjs`
- Schedule persistence model: `shared/workflow/persistence/workflowScheduleStateModel.ts`
- External schedule action schemas: `packages/workflows/src/actions/workflow-schedule-v2-schemas.ts`
- External schedule actions: `packages/workflows/src/actions/workflow-schedule-v2-actions.ts`
- Workflow editor: `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
- Workflow run dialog: `ee/server/src/components/workflow-designer/WorkflowRunDialog.tsx`
- Schedule lifecycle: `server/src/lib/workflow-runtime-v2/workflowScheduleLifecycle.ts`
- Scheduled run handlers: `server/src/lib/jobs/handlers/workflowScheduledRunHandlers.ts`
- Automation Hub tabs: `packages/workflows/src/components/automation-hub/AutomationHub.tsx`

## Open Questions

- None currently. Product decisions were resolved during planning.
