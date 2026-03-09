# Workflow V1 Hard Removal Design

- Date: `2026-03-08`
- Status: Approved

## Summary

Alga PSA currently ships two workflow systems:

- workflow v1: AssemblyScript/code-editor driven, bootstrapped from `shared/workflow/core` and `shared/workflow/init`
- workflow v2: data-driven workflow designer/runtime under `shared/workflow/runtime` and `packages/workflows/src/actions/workflow-runtime-v2-actions.ts`

This change hard-removes workflow v1 from product surfaces, server bootstraps, actions, and database schema. No legacy workflows will be migrated. Templates remain a product concept, but the existing template library is v1-only and is removed as part of this cut. A future v2-native template system will be designed separately.

## Goals

- Make the application workflow-v2-only.
- Remove workflow v1 editor, template library, runtime actions, and runtime/bootstrap wiring.
- Drop workflow v1 database tables and seeded/system records.
- Keep workflow v2 workflow editor, runs, schedules, events, and event catalog working.

## Non-goals

- Migrating existing v1 workflows to v2.
- Delivering a v2-native template library in this change.
- Preserving legacy v1 APIs for compatibility.

## Recommended Approach

Use a hard cut, not a compatibility shim.

Why:

- The current template library and legacy editor are actively misleading because they only operate on the retired AssemblyScript model.
- Leaving v1 bootstraps or dead tables behind guarantees future regressions and increases maintenance cost.
- Workflow v2 already has the live product surface; this is primarily a removal and cleanup effort.

Rejected alternatives:

- Soft-disable v1 in the UI but keep bootstraps/tables: lower immediate risk, but leaves dead architecture in place.
- Remove only bootstraps and keep old code in-tree: still leaves stale routes, action exports, and schema detritus.

## Scope

### Code and Product Surface

Remove:

- legacy workflow runtime from `shared/workflow/core/*`
- legacy workflow initialization/registration from `shared/workflow/init/*`
- v1 workflow editor actions and runtime actions
- v1 template library actions and UI
- v1 workflow editor components and related dialogs/modals
- remaining references to the old template library tab in workflow control

Keep:

- workflow v2 designer/editor
- workflow v2 run history and run details
- workflow v2 schedules
- workflow v2 events/event catalog/dead-letter views

### Database Cleanup

Drop the workflow v1 persistence footprint, including:

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

Also remove legacy seeded data and system workflow records that exist only for workflow v1.

## Implementation Slices

### 1. Surface cleanup

- Remove `Template Library` from workflow control.
- Remove legacy workflow editor components and template-library UI.
- Delete or repoint routes and links that still reach v1-only flows.

### 2. Action and model cleanup

- Remove v1 actions from `packages/workflows/src/actions/index.ts`.
- Delete v1 action modules that only operate on legacy tables/runtime.
- Remove models/helpers that only serve legacy registration/version tables.

### 3. Runtime/bootstrap cleanup

- Remove `getWorkflowRuntime()` and the shared singleton runtime.
- Remove legacy workflow initialization from server/shared startup.
- Delete v1 persistence models and event-sourcing helpers under `shared/workflow/persistence`.

### 4. Database cleanup

- Add destructive migration(s) to delete legacy data and drop v1 tables.
- Update tenant export/deletion/distribution code that still references dropped tables.

## Data Flow After This Change

- Authoring uses workflow v2 definitions only.
- Manual runs, event-driven runs, and schedules all launch via workflow v2 actions/runtime.
- The control panel exposes only workflow-v2 operations.
- No server bootstrap path initializes or processes workflow v1 definitions/events.

## Risks

- Some non-obvious consumers still query v1 tables directly, especially inbox/activity/integration code.
- Schema drops may break tenant export/deletion or citus distribution helpers if not updated in the same pass.
- Old tests that still import `getWorkflowRuntime()` or v1 actions will fail until removed or rewritten.

## Mitigations

- Remove surface area first so stale UI is gone before backend cleanup.
- Audit all `getWorkflowRuntime()` and legacy action imports before deleting core runtime files.
- Run focused typecheck/tests after each slice and boot the local app before applying DB drops.

## Acceptance Criteria

- No menu/tab/route in the app exposes workflow v1 editor or template library.
- No code in the app bootstraps or calls workflow v1 runtime.
- No exports remain for v1 workflow actions.
- Legacy v1 workflow tables are dropped by migration and no active code references them.
- `/msp/workflow-editor` and `/msp/workflow-control` remain operational for workflow v2.
