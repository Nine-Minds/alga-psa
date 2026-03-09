# PRD — Workflow V1 Hard Removal

- Slug: `workflow-v1-hard-removal`
- Date: `2026-03-08`
- Status: Approved

## Summary

Remove the legacy AssemblyScript/code-editor workflow system and make Alga PSA workflow-v2-only. This includes deleting workflow v1 UI, actions, bootstrap/runtime wiring, seeded/template artifacts, and the legacy database schema. Existing v1 workflows will not be migrated. Templates remain a future product concept, but the current template library is removed because it only supports workflow v1.

## Problem

The repo currently carries two workflow systems with overlapping product surfaces:

- workflow v1: code-editor/runtime/template-library stack backed by `workflow_registrations`, `workflow_executions`, and related tables
- workflow v2: the current data-driven workflow designer/runtime

The v1 surfaces are now detritus. They are no longer the intended product path, but they still leak into:

- workflow control tabs
- server bootstraps
- exported action barrels
- database schema and seeds

That creates product confusion and ongoing maintenance risk. It also blocks a clean v2-native template system because the existing template library is coupled to the retired runtime.

## Goals

- Remove workflow v1 product surfaces from the app.
- Remove workflow v1 runtime and runner logic from shared/server bootstraps.
- Remove workflow v1 server actions, models, and exports.
- Drop workflow v1 database tables and related seeded/system data.
- Preserve and verify workflow v2 authoring, runs, schedules, and event surfaces.

## Non-goals

- Migrating existing v1 workflows to v2.
- Preserving legacy workflow definitions or template records.
- Delivering a workflow-v2-native template library in this change.
- Changing the workflow v2 product model beyond removing legacy tabs/buttons.

## Users and Primary Flows

### Primary users

- MSP admins who author or operate workflows
- developers maintaining workflow infrastructure

### Primary flows after the change

- Create and edit workflows only through the workflow v2 editor.
- Manage schedules, runs, events, and event catalog through workflow control.
- Start from scratch when creating workflows; no legacy template flow remains in this cut.

## UX / UI Notes

- Remove all v1-oriented UI surfaces, especially the current template library.
- Remove the `Template Library` tab from workflow control.
- Keep `/msp/workflow-editor` as the primary v2 authoring surface.
- Keep `/msp/workflow-control` for operational workflow-v2 tabs only.
- Any stale automation-hub/template links should redirect or be removed instead of leaving broken screens.

## Requirements

### Functional Requirements

- The app must no longer render or navigate to the workflow v1 editor or template-library UI.
- The workflow actions barrel must no longer export v1 workflow editor/runtime/template actions.
- Shared/server bootstrap must not initialize the workflow v1 runtime.
- Legacy consumers of `getWorkflowRuntime()` must be removed or migrated to workflow v2 equivalents.
- Database migrations must drop legacy workflow v1 tables and remove system/template data coupled to them.
- Tenant export/deletion/distribution code must stop referencing dropped v1 tables.
- Workflow v2 screens must continue to load after the v1 removal.

### Non-functional Requirements

- Removal must be coherent: no dead routes, dead menu entries, or dead exports left behind.
- The destructive DB migration must be idempotent enough for local/dev environments and safe for already-partially-cleaned states.
- Verification must include at least app boot plus focused workflow-v2 coverage.

## Data / API / Integrations

Legacy schema targeted for removal:

- `workflow_template_categories`
- `workflow_templates`
- `workflow_registrations`
- `workflow_registration_versions`
- `system_workflow_registrations`
- `system_workflow_registration_versions`
- `workflow_executions`
- `workflow_events`
- `workflow_event_processing`
- `workflow_snapshots`

Associated legacy APIs/codepaths targeted for removal:

- `workflow-editor-actions`
- `workflow-runtime-actions`
- `template-library-actions`
- shared v1 runtime/persistence modules under `shared/workflow/core`, `shared/workflow/init`, and `shared/workflow/persistence`

## Security / Permissions

- No new permissions are introduced.
- Existing workflow-v2 permissions remain authoritative.
- Dropping legacy tables must not break permission-gated workflow-v2 screens.

## Observability

- No new observability scope is added for this cleanup.
- Existing workflow-v2 logs and operational surfaces remain unchanged.

## Rollout / Migration

- This is a destructive retirement of workflow v1.
- Existing workflow v1 templates and definitions are intentionally deleted, not migrated.
- Database cleanup ships in the same cut as code removal.
- A future v2-native template library will be planned separately.

## Open Questions

- None blocking for this cut. Future v2 template design is intentionally deferred.

## Acceptance Criteria (Definition of Done)

- No product surface in the app exposes workflow v1 editor or template library.
- No workflow v1 runtime/bootstrap code executes during app startup.
- No workflow v1 action/module exports remain in active barrels.
- Legacy workflow v1 tables are dropped by migration and active code no longer queries them.
- Workflow v2 editor and workflow control operational tabs still load and function.
