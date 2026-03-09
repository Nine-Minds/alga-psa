# Scratchpad — Workflow V1 Hard Removal

- Plan slug: `workflow-v1-hard-removal`
- Created: `2026-03-08`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-08) Hard-remove workflow v1 now rather than soft-disabling it. Rationale: the v1 template/editor/runtime stack is dead product surface and creates ongoing confusion.
- (2026-03-08) Do not migrate existing v1 workflows. Rationale: the user explicitly wants cleanup, not compatibility.
- (2026-03-08) Remove the current template library as part of the cut. Rationale: it only supports the retired AssemblyScript workflow system.
- (2026-03-08) Preserve the template concept only as future product intent; do not build v2 templates in this removal pass.

## Discoveries / Constraints

- (2026-03-08) Legacy runtime bootstrap still enters through `shared/workflow/init/serverInit.ts`, `shared/workflow/init/index.ts`, and `shared/workflow/init/workflowInit.ts`.
- (2026-03-08) Remaining direct `getWorkflowRuntime()` callers include `workflow-event-actions.ts`, `workflow-visualization-actions.ts`, task inbox actions, event attachment actions, and integration email-domain actions.
- (2026-03-08) The workflow control panel still imports `TemplateLibrary` in `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`.
- (2026-03-08) Legacy schema footprint is broader than templates: it includes `workflow_executions`, `workflow_events`, `workflow_event_processing`, and `workflow_snapshots` in addition to registration/version/template tables.
- (2026-03-08) Some platform maintenance code still references v1 tables, including tenant export and citus distribution migrations.

## Commands / Runbooks

- (2026-03-08) Legacy runtime/action inventory: `rg -n "getWorkflowRuntime\\(|workflow-runtime-actions|workflow-editor-actions|template-library-actions|WorkflowEditorComponent|TemplateLibrary" packages server shared ee -g '!**/node_modules/**'`
- (2026-03-08) Legacy schema inventory: `rg -n "workflow_registrations|workflow_registration_versions|system_workflow_registrations|system_workflow_registration_versions|workflow_templates|workflow_template_categories|workflow_events|workflow_event_processing|workflow_executions|workflow_snapshots" . -g '*/migrations/*' -g '*/seeds/*'`

## Links / References

- Design doc: `ee/docs/plans/2026-03-08-workflow-v1-hard-removal-design.md`
- Plan folder: `ee/docs/plans/2026-03-08-workflow-v1-hard-removal/`
- Legacy runtime: `shared/workflow/core/workflowRuntime.ts`
- Legacy init: `shared/workflow/init/`
- Legacy actions: `packages/workflows/src/actions/workflow-editor-actions.ts`, `packages/workflows/src/actions/workflow-runtime-actions.ts`, `packages/workflows/src/actions/template-library-actions.ts`
- Legacy UI: `packages/workflows/src/components/workflow-editor/`, `packages/workflows/src/components/automation-hub/TemplateLibrary.tsx`

## Open Questions

- Future v2-native templates need a separate plan after this cut.
