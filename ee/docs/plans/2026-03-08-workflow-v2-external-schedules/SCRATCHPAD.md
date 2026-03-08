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
- (2026-03-08) The publish path must only invoke legacy inline schedule sync when either the old or new workflow definition uses an inline time trigger; otherwise it will accidentally disable external schedules on non-time-trigger workflows.
- (2026-03-08) Scheduled execution should pass `tenant_workflow_schedule.payload_json` straight through as workflow run input and move timing details into `trigger_metadata_json`; the old synthetic clock contract is now provenance-only data.
- (2026-03-08) The schedules list does not need debounced search in v1; immediate server-backed filtering keeps the URL state simple and avoids timer complexity in the new client surface.

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
- (2026-03-08) The EE server DB-backed harness started hitting `KnexTimeoutError` during database recreation after multiple suite runs against the shared local Postgres container. For the publish lifecycle slice, unit coverage around the publish action and schedule lifecycle was faster and more reliable than retrying the saturated DB harness.
- (2026-03-08) The initial schedules dialog payload-mode implementation had two self-referential sync bugs: form mode kept reparsing `payloadText` into fresh objects, and JSON mode kept rewriting `formValue` from unchanged text. Converting mode switches into explicit handlers removed those loops and stabilized the full schedules UI suite. Key file: `packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx`.

## Implementation Log

- (2026-03-08) Completed `F001` by keeping this redesign in its own plan folder under `ee/docs/plans/2026-03-08-workflow-v2-external-schedules/`, preserving the prior 2026-03-07 inline-trigger plan as historical context.
- (2026-03-08) Completed `F002`-`F004` by adding a migration to remove the legacy one-schedule-per-workflow constraint and by extending `tenant_workflow_schedule` with required `name` and persisted `payload_json`. Key files: `ee/server/migrations/20260308130000_expand_workflow_schedule_for_external_schedules.cjs`, `shared/workflow/persistence/workflowScheduleStateModel.ts`.
- (2026-03-08) Completed `F006`-`F015` by adding external schedule persistence helpers, lifecycle wrappers, zod action schemas, and tenant-scoped server actions for list/get/create/update/pause/resume/delete with published-version, pinned-schema, and payload validation guards. Key files: `server/src/lib/workflow-runtime-v2/workflowScheduleLifecycle.ts`, `packages/workflows/src/actions/workflow-schedule-v2-schemas.ts`, `packages/workflows/src/actions/workflow-schedule-v2-actions.ts`.
- (2026-03-08) Completed `F036` in the action layer by requiring workflow read permission for list/get and workflow manage permission for create/update/pause/resume/delete, plus explicit tenant checks before reading or mutating schedule records.
- (2026-03-08) Completed `T001`-`T020` and `T054` with new DB-backed migration and action integration suites covering migration safety, persisted `name` and `payload_json`, create/edit flows for one-time and recurring schedules, pause/resume/delete, published-version and pinned-schema guards, payload validation failures, and tenant-scoped global listing. Key files: `ee/server/src/__tests__/integration/workflow-external-schedules.migration.integration.test.ts`, `ee/server/src/__tests__/integration/workflow-external-schedules.actions.integration.test.ts`.
- (2026-03-08) Completed `F005` and `F016`-`F018` by adding publish-time external schedule revalidation that updates `workflow_version` for valid schedules, preserves invalid schedules with `status=failed` and validation errors, and avoids running the legacy inline schedule sync for non-time-trigger workflows. Key files: `packages/workflows/src/actions/workflow-runtime-v2-actions.ts`, `server/src/lib/workflow-runtime-v2/workflowScheduleLifecycle.ts`.
- (2026-03-08) Completed `T021`-`T024` with unit coverage on `publishWorkflowDefinitionAction`, using in-memory persistence mocks to verify valid-only rebinding, mixed validity handling, and per-schedule revalidation across all attached schedules. Key file: `server/src/test/unit/workflowExternalSchedulesPublishLifecycle.unit.test.ts`.
- (2026-03-08) Completed `F019`-`F020` by updating the scheduled run handlers to send saved schedule payload JSON into `launchPublishedWorkflowRun` while preserving schedule/timing provenance in trigger metadata. Key file: `server/src/lib/jobs/handlers/workflowScheduledRunHandlers.ts`.
- (2026-03-08) Completed `T025`-`T028` with unit coverage proving one-time and recurring schedules now launch with saved payload input, provenance metadata is retained, and invalid payloads at fire time are recorded as schedule errors without pretending the launch succeeded. Key file: `server/src/test/unit/workflowScheduledRunHandlers.unit.test.ts`.
- (2026-03-08) Completed `F021`-`F027` and `F030` by adding a `Schedules` tab to Automation Hub, wiring a server-backed schedules list with workflow/trigger/status filters, row-level edit/pause/resume/delete actions, and a create/edit dialog with workflow selection, one-time `runAt`, recurring `cron + timezone`, and inline payload validation. Key files: `packages/workflows/src/components/automation-hub/AutomationHub.tsx`, `packages/workflows/src/components/automation-hub/Schedules.tsx`, `packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx`, `packages/workflows/src/actions/index.ts`.
- (2026-03-08) Completed `T029`-`T033` with client-side Vitest coverage for the new Automation Hub schedules tab, list columns, and workflow/trigger/status filters. Key files: `packages/workflows/src/components/automation-hub/AutomationHub.schedules.test.tsx`, `packages/workflows/src/components/automation-hub/Schedules.test.tsx`.
- (2026-03-08) Completed `F028`-`F029` by finishing the reusable payload editor in the schedule dialog: schema-driven form mode now exposes labeled controls, JSON mode switches explicitly instead of looping state, and both modes operate against the workflow schema loaded from `getWorkflowSchemaAction`. Key file: `packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx`.
- (2026-03-08) Completed `T034`-`T046` with a now-stable full schedules UI suite covering text search, edit/pause/resume/delete row actions, dialog required fields, one-time and recurring timing controls, schema-driven form fields, JSON editing, invalid payload blocking, and inferred-schema eligibility messaging. Key files: `packages/workflows/src/components/automation-hub/Schedules.test.tsx`, `packages/workflows/src/components/automation-hub/AutomationHub.schedules.test.tsx`.

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
- (2026-03-08) Verify publish-time external schedule rebinding logic with the server unit harness:
  - `cd server && npx vitest run src/test/unit/workflowExternalSchedulesPublishLifecycle.unit.test.ts`
- (2026-03-08) Verify scheduled-run payload handoff and provenance behavior:
  - `cd server && npx vitest run src/test/unit/workflowScheduledRunHandlers.unit.test.ts`
- (2026-03-08) Verify the new schedules tab route state:
  - `cd server && npx vitest run ../packages/workflows/src/components/automation-hub/AutomationHub.schedules.test.tsx --coverage=false`
- (2026-03-08) Verify exact schedules list UI cases without the broad shuffled suite:
  - `cd server && npx vitest run ../packages/workflows/src/components/automation-hub/Schedules.test.tsx -t "shows schedule name, workflow, trigger type, timing, status, and error columns" --coverage=false`
  - `cd server && npx vitest run ../packages/workflows/src/components/automation-hub/Schedules.test.tsx -t "filters the schedules list by status" --coverage=false`
- (2026-03-08) Verify the full schedules UI suite after payload-mode state fixes:
  - `cd server && npx vitest run ../packages/workflows/src/components/automation-hub/Schedules.test.tsx --coverage=false`
  - `cd server && npx vitest run ../packages/workflows/src/components/automation-hub/AutomationHub.schedules.test.tsx --coverage=false`

## Links / References

- Prior inline time-trigger plan: `ee/docs/plans/2026-03-07-workflow-v2-time-based-clock-triggers/`
- Schedule migration: `ee/server/migrations/20260307200000_create_workflow_schedule_tables.cjs`
- External schedule expansion migration: `ee/server/migrations/20260308130000_expand_workflow_schedule_for_external_schedules.cjs`
- Schedule persistence model: `shared/workflow/persistence/workflowScheduleStateModel.ts`
- External schedule action schemas: `packages/workflows/src/actions/workflow-schedule-v2-schemas.ts`
- External schedule actions: `packages/workflows/src/actions/workflow-schedule-v2-actions.ts`
- Publish action: `packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
- Workflow editor: `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
- Workflow run dialog: `ee/server/src/components/workflow-designer/WorkflowRunDialog.tsx`
- Schedule lifecycle: `server/src/lib/workflow-runtime-v2/workflowScheduleLifecycle.ts`
- Scheduled run handlers: `server/src/lib/jobs/handlers/workflowScheduledRunHandlers.ts`
- Publish lifecycle unit test: `server/src/test/unit/workflowExternalSchedulesPublishLifecycle.unit.test.ts`
- Scheduled run handler unit test: `server/src/test/unit/workflowScheduledRunHandlers.unit.test.ts`
- Automation Hub tabs: `packages/workflows/src/components/automation-hub/AutomationHub.tsx`
- Schedules list UI: `packages/workflows/src/components/automation-hub/Schedules.tsx`
- Schedule dialog UI: `packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx`
- Automation Hub schedules tab test: `packages/workflows/src/components/automation-hub/AutomationHub.schedules.test.tsx`
- Schedules UI test: `packages/workflows/src/components/automation-hub/Schedules.test.tsx`

## Open Questions

- None currently. Product decisions were resolved during planning.
