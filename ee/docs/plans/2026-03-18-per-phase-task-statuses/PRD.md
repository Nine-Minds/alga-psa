# PRD — Per-Phase Task Statuses

- Slug: `per-phase-task-statuses`
- Date: `2026-03-18`
- Status: Draft

## Summary

Allow each project phase to have its own independent set of task status columns. Currently all phases share the project-level status configuration. With this change, a "Design" phase can use "To Do / In Design / Review / Done" while a "Development" phase uses "Backlog / In Progress / Code Review / QA / Done".

## Problem

MSPs run projects with phases that represent fundamentally different workflows (design, development, deployment, onboarding). Forcing all phases to share the same status columns means either:
- Generic statuses that don't describe any phase's workflow well
- Cluttered boards with statuses irrelevant to the current phase
- Workarounds like separate projects per workflow type

## Goals

1. Each phase can optionally define its own set of task statuses
2. Phases without custom statuses fall back to the project-level defaults (backward compatible)
3. Tasks moving between phases with different statuses are automatically remapped
4. Project templates support per-phase status configuration
5. Client portal correctly displays phase-specific statuses

## Non-goals

- Per-task status overrides (statuses remain at the phase/project level)
- Status workflow rules (e.g., "must go through Review before Done")
- Cross-phase status analytics or reporting
- Drag-and-drop status column customization directly on the Kanban board

## Users and Primary Flows

### Personas
- **Project Manager (MSP admin)**: Configures per-phase statuses in project settings; creates templates with phase-specific statuses
- **Technician**: Views and interacts with phase-specific Kanban columns; moves tasks between phases
- **Client user**: Views project progress in client portal with correct phase-specific statuses (read-only)

### Primary Flows

**Flow 1 — Configure phase statuses (Project Manager)**
1. Open Project Settings > Task Statuses
2. Select a phase from the phase dropdown/tabs
3. Toggle "Use custom statuses for this phase" (vs. project defaults)
4. Add/remove/reorder statuses from the tenant library
5. Save — Kanban board now shows phase-specific columns

**Flow 2 — View phase-specific Kanban (Technician)**
1. Open a project, select a phase tab
2. Kanban board columns reflect that phase's effective statuses
3. Task status dropdown shows only that phase's statuses
4. Moving a task to a different phase auto-remaps its status

**Flow 3 — Move task between phases (Technician)**
1. Move or reassign a task from Phase A to Phase B
2. System resolves status: same name → keep; no match + open → first open; no match + closed → first closed
3. Task appears in the correct column in Phase B's board

**Flow 4 — Create template with phase statuses (Project Manager)**
1. Create/edit a project template
2. Define phases within the template
3. For each phase, optionally configure custom status columns
4. Creating a project from this template copies phase-specific statuses

**Flow 5 — Client portal view (Client user)**
1. Client views project in client portal
2. Selects a phase — sees that phase's status columns
3. Tasks grouped/displayed by phase-effective statuses

## UX / UI Notes

### MSP Project Settings
- Phase selector (dropdown or tabs) above the status configuration area
- Default shows "Project Defaults" — the existing project-level statuses
- Each phase shows toggle: "Use project defaults" / "Custom statuses for this phase"
- When toggling to custom: option to "Copy project defaults as starting point" or "Start empty"
- Add/remove/reorder UI remains the same, just scoped to the selected phase

### Kanban Board
- Already has phase tabs — no new navigation needed
- Status columns change when switching between phases that have different statuses
- No visual indicator needed that statuses are phase-specific vs. project defaults

### Task Status Select
- Shows effective statuses for the task's current phase
- No change to UX, just data source changes

### Client Portal
- Kanban and list views show phase-effective statuses
- No configuration UI (read-only)

## Requirements

### Functional Requirements

#### FR-1: Database Schema
- FR-1.1: Add nullable `phase_id` column to `project_status_mappings` table referencing `project_phases(phase_id)` with ON DELETE CASCADE
- FR-1.2: Add index on `(tenant, project_id, phase_id)` for efficient lookups
- FR-1.3: Existing rows with `phase_id = NULL` represent project-level defaults (no data migration needed)
- FR-1.4: Add nullable `template_phase_id` column to `project_template_status_mappings` referencing `project_template_phases(template_phase_id)` with ON DELETE CASCADE
- FR-1.5: EE/Citus companion migration — FK constraints use composite keys `(tenant, phase_id)` since both tables are distributed on `tenant`

#### FR-2: Effective Status Resolution
- FR-2.1: New model function `getEffectiveStatusMappings(knex, tenant, projectId, phaseId)` — returns phase-specific statuses if any exist for that phase_id, otherwise falls back to project-level statuses (phase_id IS NULL)
- FR-2.2: Resolution is transparent — callers get a flat list of statuses regardless of source
- FR-2.3: All status-fetching actions (`getProjectTaskStatuses`, `getProjectStatusMappings`, `getClientProjectStatuses`) accept optional `phaseId` and use effective resolution

#### FR-3: Phase Status Configuration
- FR-3.1: `addStatusToProject()` accepts optional `phaseId` — creates mapping with that phase_id
- FR-3.2: `reorderProjectStatuses()` scopes to phase if phaseId provided
- FR-3.3: New action `copyProjectStatusesToPhase(projectId, phaseId)` — copies project defaults as phase-specific mappings
- FR-3.4: New action `removePhaseStatuses(phaseId)` — deletes all mappings for a phase, reverting it to project defaults
- FR-3.5: `deleteProjectStatusMapping()` — no change needed (works by mapping ID)

#### FR-4: Cross-Phase Task Movement
- FR-4.1: When moving a task between phases within the same project, resolve status mapping:
  - Same status name exists in target phase → use it
  - No name match + source status was open → first open status by display_order
  - No name match + source status was closed → first closed status by display_order
- FR-4.2: Cross-project moves continue to work as before (existing logic in `moveTaskToPhase`)
- FR-4.3: `updateTaskStatus()` validates the status mapping belongs to the task's phase's effective statuses

#### FR-5: Settings UI
- FR-5.1: `ProjectTaskStatusSettings` shows a phase selector (dropdown or tabs) above the status list
- FR-5.2: "Project Defaults" is the first/default option in the phase selector
- FR-5.3: Each phase shows toggle: "Use project defaults" vs "Custom statuses"
- FR-5.4: Toggling to custom offers "Copy from project defaults" action
- FR-5.5: Toggling back to defaults shows confirmation (will delete phase-specific mappings)
- FR-5.6: `AddStatusDialog` passes phaseId when adding to a phase

#### FR-6: Kanban Board & Task UI
- FR-6.1: `ProjectDetail` fetches phase-effective statuses when selectedPhase changes
- FR-6.2: KanbanBoard renders columns from phase-effective statuses (receives via props, minimal change)
- FR-6.3: TaskStatusSelect shows effective statuses for the task's phase (receives via props)
- FR-6.4: Status task counts computed from phase-effective statuses
- FR-6.5: Completed task count computed from phase-effective statuses

#### FR-7: Client Portal
- FR-7.1: `getClientProjectStatuses()` accepts optional phaseId and uses effective resolution
- FR-7.2: `ProjectDetailView` fetches phase-effective statuses when phase selection changes
- FR-7.3: `ClientKanbanBoard` renders phase-specific status columns
- FR-7.4: `ClientTaskListView` groups tasks by phase-effective status groups

#### FR-8: Template Support
- FR-8.1: `project_template_status_mappings` supports `template_phase_id` for per-phase template statuses
- FR-8.2: `TemplateStatusManager` allows per-phase status configuration with phase selector
- FR-8.3: `TemplateStatusColumnsStep` (wizard) supports phase-aware status setup
- FR-8.4: Project creation from template copies phase-specific template status mappings to `project_status_mappings` with correct `phase_id`

#### FR-9: Supporting Systems
- FR-9.1: Phase task import (`IImportReferenceData.statusMappings`) resolves against phase-effective statuses
- FR-9.2: Event payloads for `PROJECT_STATUS_ADDED/UPDATED/DELETED/REORDERED` include optional `phaseId`
- FR-9.3: `ProjectTaskStatusEditor` and `ProjectTaskStatusSelector` (used during project creation) handle phase statuses from templates

### Non-functional Requirements

- NFR-1: Backward compatible — existing projects with no phase-specific statuses work identically
- NFR-2: No data migration needed — existing rows have phase_id NULL which is the project-level default
- NFR-3: Citus compatible — all queries include tenant in WHERE/JOIN conditions; FK references use composite keys

## Data / API / Integrations

### Schema Changes

**`project_status_mappings`** — add column:
```sql
phase_id UUID NULL REFERENCES project_phases(phase_id) ON DELETE CASCADE
```
Index: `(tenant, project_id, phase_id)`

**`project_template_status_mappings`** — add column:
```sql
template_phase_id UUID NULL REFERENCES project_template_phases(template_phase_id) ON DELETE CASCADE
```

### Type Changes

**`IProjectStatusMapping`** — add: `phase_id?: string`
**`ProjectStatus`** — add: `phase_id?: string`

### Key Query Pattern — Effective Resolution
```sql
-- Check if phase has custom statuses
SELECT COUNT(*) FROM project_status_mappings
WHERE tenant = ? AND project_id = ? AND phase_id = ?;

-- If count > 0: use phase statuses
SELECT * FROM project_status_mappings
WHERE tenant = ? AND project_id = ? AND phase_id = ?
ORDER BY display_order;

-- If count = 0: fall back to project defaults
SELECT * FROM project_status_mappings
WHERE tenant = ? AND project_id = ? AND phase_id IS NULL
ORDER BY display_order;
```

## Security / Permissions

- No new permissions needed — status configuration is already gated by project management permissions
- Client portal: read-only access to effective statuses, enforced by existing `getClientProjectStatuses()` access checks
- Tenant isolation: all queries include `tenant` in WHERE clauses (existing pattern)

## Rollout / Migration

- **Zero-downtime deployment**: nullable column addition, no data changes
- **Backward compatible**: all phases fall back to project defaults until customized
- **No feature flag needed**: the feature is additive and opt-in per phase
- **Rollback**: drop the `phase_id` column; phase-specific mappings are lost but project defaults remain

## Open Questions

None — all design decisions have been agreed upon (see Key Design Decisions in SCRATCHPAD.md).

## Acceptance Criteria (Definition of Done)

1. Existing projects with no phase-specific statuses behave identically to before
2. A phase can be configured with custom statuses via the settings UI
3. Kanban board shows phase-specific status columns when viewing a customized phase
4. Moving a task between phases with different statuses correctly remaps the status
5. Project templates can define per-phase statuses
6. Creating a project from a template with phase statuses sets up correct mappings
7. Client portal displays phase-specific statuses correctly
8. All existing tests pass; new tests cover the new functionality
