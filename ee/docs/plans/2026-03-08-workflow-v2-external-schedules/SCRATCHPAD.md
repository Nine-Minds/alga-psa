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

## Discoveries / Constraints

- (2026-03-08) The current schedule table was introduced as `tenant_workflow_schedule` and still enforces `unique(workflow_id)`, which blocks many schedules per workflow. Key file: `ee/server/migrations/20260307200000_create_workflow_schedule_tables.cjs`.
- (2026-03-08) The current schedule persistence model has no `name` or `payload_json` field. Key file: `shared/workflow/persistence/workflowScheduleStateModel.ts`.
- (2026-03-08) Workflow editor currently still contains inline time-trigger controls for one-time and recurring scheduling. Key file: `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`.
- (2026-03-08) Existing scheduled-run handlers already load schedule records and launch runs through a shared launcher, so reusing schedule-owned payloads should fit the current runtime seam. Key files: `server/src/lib/jobs/handlers/workflowScheduledRunHandlers.ts`, `server/src/lib/workflow-runtime-v2/workflowRunLauncher.ts`.
- (2026-03-08) The manual run dialog already has both schema-driven form mode and JSON mode plus client-side schema validation, and it is the best reuse candidate for schedule payload authoring. Key file: `ee/server/src/components/workflow-designer/WorkflowRunDialog.tsx`.
- (2026-03-08) Automation Hub currently has tabs for Template Library, Workflows, Events Catalog, and Logs & History. Schedules can slot into that existing tab model without inventing a separate top-level area. Key file: `packages/workflows/src/components/automation-hub/AutomationHub.tsx`.
- (2026-03-08) The prior 2026-03-07 plan describes the inline time-trigger approach and is already marked implemented, so this redesign needs its own plan folder instead of overwriting that historical plan.

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

## Links / References

- Prior inline time-trigger plan: `ee/docs/plans/2026-03-07-workflow-v2-time-based-clock-triggers/`
- Schedule migration: `ee/server/migrations/20260307200000_create_workflow_schedule_tables.cjs`
- Schedule persistence model: `shared/workflow/persistence/workflowScheduleStateModel.ts`
- Workflow editor: `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
- Workflow run dialog: `ee/server/src/components/workflow-designer/WorkflowRunDialog.tsx`
- Schedule lifecycle: `server/src/lib/workflow-runtime-v2/workflowScheduleLifecycle.ts`
- Scheduled run handlers: `server/src/lib/jobs/handlers/workflowScheduledRunHandlers.ts`
- Automation Hub tabs: `packages/workflows/src/components/automation-hub/AutomationHub.tsx`

## Open Questions

- None currently. Product decisions were resolved during planning.
