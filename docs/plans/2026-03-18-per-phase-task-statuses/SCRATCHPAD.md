# Scratchpad — Per-Phase Task Statuses

- Plan slug: `per-phase-task-statuses`
- Created: `2026-03-18`

## Decisions

- (2026-03-18) **Fallback behavior**: `phase_id IS NULL` in `project_status_mappings` = project-level defaults. Phases without custom statuses automatically fall back. No data migration needed.
- (2026-03-18) **Cross-phase task movement**: same status name → keep it; no match + source open → first open by display_order; no match + source closed → first closed by display_order. Rationale: simple, predictable, avoids modal dialogs during drag-drop.
- (2026-03-18) **Phase creation default**: New phases inherit project defaults automatically (no rows needed — fallback handles it). User explicitly opts into custom statuses. Rationale: zero-cost setup, opt-in complexity.
- (2026-03-18) **Template phases**: Add `template_phase_id` to `project_template_status_mappings` — same nullable FK pattern. Rationale: consistency with main table approach.
- (2026-03-18) **No feature flag**: Feature is additive and opt-in. Until a user configures phase-specific statuses, behavior is identical to before.

## Discoveries / Constraints

- (2026-03-18) Both `project_status_mappings` and `project_phases` are Citus-distributed on `tenant`, colocated with `tenants`. FK constraints must use composite keys `(tenant, phase_id)`.
- (2026-03-18) `project_status_mappings` has primary key `(tenant, project_status_mapping_id)`. The FK to `project_phases` must reference `(tenant, phase_id)`.
- (2026-03-18) Implemented `F001` in `server/migrations/20260318100000_add_phase_id_to_project_status_mappings.cjs`: added nullable `phase_id` plus a composite FK on `(tenant, phase_id)` to `project_phases`. Although the feature text mentions `project_phases(phase_id)`, the schema only exposes `(tenant, phase_id)` as a valid referenced key.
- (2026-03-18) `moveTaskToPhase()` in `projectTaskActions.ts` (lines 972-1033) currently only resolves statuses for **cross-project** moves. Same-project moves preserve the original status mapping ID. This must change to also handle same-project cross-phase moves when phases have different statuses.
- (2026-03-18) `ProjectDetail.tsx` is the orchestrator that passes `statuses={projectStatuses}` to KanbanBoard (line ~2406). It fetches statuses once at project level. This is the critical wiring point.
- (2026-03-18) Client portal has its own separate components (`ClientKanbanBoard`, `ClientTaskListView`, `ProjectDetailView`) — they do NOT reuse MSP-side KanbanBoard. Separate data action `getClientProjectStatuses()`.
- (2026-03-18) Status change events (`PROJECT_STATUS_ADDED`, etc.) are published from `projectTaskStatusActions.ts`. They currently include `projectId` but not `phaseId`.
- (2026-03-18) `ProjectTaskStatusEditor.tsx` and `ProjectTaskStatusSelector.tsx` are used during project creation/editing. They may need to handle template-based phase statuses.
- (2026-03-18) Phase task CSV import (`IImportReferenceData.statusMappings`) resolves statuses at project level. Needs to resolve against phase-effective statuses.
- (2026-03-18) The `display_order` field's uniqueness scope changes from per-project to per-(project, phase). Need to ensure reordering logic scopes correctly.

## Commands / Runbooks

- Build shared packages: `npm run build:shared` (needed after type changes)
- Build projects package: `npx nx build projects`
- Run project tests: `npx vitest run` in `packages/projects/`
- Run migrations: `npm run migrate`
- Validate migration syntax quickly: `node -e "require('./server/migrations/20260318100000_add_phase_id_to_project_status_mappings.cjs')"`
- Citus migrations: applied via Argo workflows in EE environments

## Links / References

### Key Files — Database
- `server/migrations/20241008191930_create_project_status_mappings_table.cjs` — original table creation
- `ee/server/migrations/citus/20250805000018_distribute_remaining_tables.cjs` — Citus distribution of project_status_mappings
- `ee/server/migrations/citus/20250805000011_distribute_project_tables.cjs` — Citus distribution of project_phases
- `server/migrations/20251119000000_add_project_templates.cjs` — template status mappings table

### Key Files — Types
- `packages/types/src/interfaces/project.interfaces.ts` — IProjectStatusMapping (L37-50), ProjectStatus (L151-165)
- `server/src/interfaces/project.interfaces.ts` — duplicate interfaces

### Key Files — Models & Actions
- `packages/projects/src/models/project.ts` — getProjectStatusMappings, getProjectTaskStatuses, addProjectStatusMapping
- `packages/projects/src/actions/projectTaskStatusActions.ts` — addStatusToProject, getProjectStatusMappings, reorderProjectStatuses
- `packages/projects/src/actions/projectActions.ts` — getProjectTaskStatuses (L1123-1134)
- `packages/projects/src/actions/projectTaskActions.ts` — moveTaskToPhase (L938-1120), updateTaskStatus

### Key Files — MSP UI
- `packages/projects/src/components/ProjectDetail.tsx` — orchestrator, passes statuses to KanbanBoard (L2401-2406), phase selection (L186), task filtering (L346-425)
- `packages/projects/src/components/KanbanBoard.tsx` — receives statuses as prop
- `packages/projects/src/components/TaskStatusSelect.tsx` — status dropdown
- `packages/projects/src/components/settings/projects/ProjectTaskStatusSettings.tsx` — status config UI
- `packages/projects/src/components/settings/projects/AddStatusDialog.tsx` — add status dialog
- `packages/projects/src/components/ProjectTaskStatusEditor.tsx` — project creation status setup
- `packages/projects/src/components/ProjectTaskStatusSelector.tsx` — status selection for project setup

### Key Files — Client Portal
- `packages/client-portal/src/components/projects/ProjectDetailView.tsx` — orchestrator
- `packages/client-portal/src/components/projects/ClientKanbanBoard.tsx` — kanban view
- `packages/client-portal/src/components/projects/ClientTaskListView.tsx` — list view
- `packages/client-portal/src/actions/client-portal-actions/client-project-details.ts` — getClientProjectStatuses

### Key Files — Templates
- `packages/projects/src/components/project-templates/TemplateStatusManager.tsx`
- `packages/projects/src/components/project-templates/wizard-steps/TemplateStatusColumnsStep.tsx`

### Key Files — Import / Events
- `packages/types/src/interfaces/phaseTaskImport.interfaces.ts` — IImportReferenceData

## Open Questions

- None currently — all design decisions agreed upon.
