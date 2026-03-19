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
- (2026-03-18) Implemented `F002` in the same migration file by indexing `(tenant, project_id, phase_id)`. Keeping the column and its lookup index together avoids ordering issues during rollout and rollback.
- (2026-03-18) Implemented `F003` in `server/migrations/20260318101000_add_template_phase_id_to_project_template_status_mappings.cjs`: added nullable `template_phase_id` with a composite FK on `(tenant, template_phase_id)` because `project_template_phases` is also keyed that way.
- (2026-03-18) Implemented `F004` with `ee/server/migrations/citus/20260318102000_fix_phase_status_mapping_foreign_keys.cjs` and marked the CE migrations `transaction: false`. The EE migration inspects existing FK definitions and only drops/recreates phase-related constraints when they are not tenant-scoped, which is safer for already-distributed tables than assuming a fixed constraint name.
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
- Validate template migration syntax quickly: `node -e "require('./server/migrations/20260318101000_add_template_phase_id_to_project_template_status_mappings.cjs')"`
- Validate EE Citus migration syntax quickly: `node -e "require('./ee/server/migrations/citus/20260318102000_fix_phase_status_mapping_foreign_keys.cjs')"`
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

- (2026-03-18) Implemented `F005` by adding `phase_id?: string` to `IProjectStatusMapping` in both shared and server-local interface copies. The duplicate interface files still need to stay in sync manually.
- (2026-03-18) Implemented `F006` by adding `phase_id?: string` to `ProjectStatus` in the same two interface files so the flattened status DTO can carry its scope through actions and UI props.

### Key Files — Models & Actions
- `packages/projects/src/models/project.ts` — getProjectStatusMappings, getProjectTaskStatuses, addProjectStatusMapping
- `packages/projects/src/actions/projectTaskStatusActions.ts` — addStatusToProject, getProjectStatusMappings, reorderProjectStatuses
- `packages/projects/src/actions/projectActions.ts` — getProjectTaskStatuses (L1123-1134)
- `packages/projects/src/actions/projectTaskActions.ts` — moveTaskToPhase (L938-1120), updateTaskStatus

- (2026-03-18) Implemented `F007` by changing `ProjectModel.getProjectStatusMappings()` to accept `phaseId?: string | null`; omitted/null now explicitly means project defaults (`phase_id IS NULL`) rather than “all mappings for the project.” That keeps legacy callers stable once phase-specific rows exist.
- (2026-03-18) Implemented `F008` with `ProjectModel.getEffectiveStatusMappings()`, which first looks for phase-scoped mappings and only falls back to project defaults when none exist. This keeps callers from having to manually merge or filter both scopes.
- (2026-03-18) Implemented `F009` by threading `phaseId` through `ProjectModel.getProjectTaskStatuses()` and copying `mapping.phase_id` onto the returned status objects. Model callers can now request the effective status list for a specific phase without reproducing fallback logic.
- (2026-03-18) Implemented `F010` by extending `addStatusToProject()` with optional `phaseId`, storing `phase_id` on insert, and scoping the `display_order` lookup to either the target phase or project defaults. This prevents new phase statuses from inheriting order positions from unrelated scopes.
- (2026-03-18) Implemented `F011` by extending the action-layer `getProjectStatusMappings()` with the same scope rule as the model: `phaseId` fetches that phase’s rows, and no `phaseId` fetches only project defaults. That avoids leaking all phase rows into the existing settings UI.
- (2026-03-18) Implemented `F012` by extending `reorderProjectStatuses()` with optional `phaseId` and constraining each update to the matching phase/default scope. This protects phase-specific boards from reordering the wrong mapping set.
- (2026-03-18) Implemented `F013` by adding `copyProjectStatusesToPhase(projectId, phaseId)`. It validates phase ownership, treats an already-customized phase as idempotent, and copies only project-default mappings (`phase_id IS NULL`) into the phase while preserving ordering, visibility, and status references.
- (2026-03-18) Implemented `F014` by adding `removePhaseStatuses(phaseId)` and remapping affected tasks before deletion. The replacement rule already follows the PRD’s status-resolution order: same name first, then first target status with the same open/closed state, then final fallback to the first default status.
- (2026-03-18) Implemented `F015` by extending the public `getProjectTaskStatuses()` action and its internal helpers with optional `phaseId`, switching them onto `ProjectModel.getEffectiveStatusMappings()`, and carrying `phase_id` into the returned `ProjectStatus` DTOs.
- (2026-03-18) Implemented `F016` in `moveTaskToPhase()` by splitting same-project cross-phase moves from the existing cross-project branch, fetching target phase-effective mappings, and preserving intent via same-name matches when the original mapping ID is not valid in the destination phase.
- (2026-03-18) Implemented `F017` by upgrading the same-project phase move fallback: if no same-name mapping exists and the source status is open, the task now lands in the first open target status by `display_order` instead of the first arbitrary column.
- (2026-03-18) Implemented `F018` by making the fallback symmetric for closed work: if a closed task has no same-name match in the destination phase, `moveTaskToPhase()` now selects the first closed target status before falling back to the first overall column.
- (2026-03-18) Implemented `F019` by leaving the original cross-project move branch intact and isolating the new remapping logic to same-project cross-phase moves only. This keeps legacy project-to-project behavior stable while enabling phase-aware remapping where the PRD requires it.

### Key Files — MSP UI
- `packages/projects/src/components/ProjectDetail.tsx` — orchestrator, passes statuses to KanbanBoard (L2401-2406), phase selection (L186), task filtering (L346-425)
- `packages/projects/src/components/KanbanBoard.tsx` — receives statuses as prop
- `packages/projects/src/components/TaskStatusSelect.tsx` — status dropdown
- `packages/projects/src/components/settings/projects/ProjectTaskStatusSettings.tsx` — status config UI
- `packages/projects/src/components/settings/projects/AddStatusDialog.tsx` — add status dialog
- `packages/projects/src/components/ProjectTaskStatusEditor.tsx` — project creation status setup
- `packages/projects/src/components/ProjectTaskStatusSelector.tsx` — status selection for project setup

- (2026-03-18) Implemented `F021` by making `ProjectDetail.tsx` refetch `getProjectTaskStatuses(projectId, selectedPhase.phase_id)` whenever the selected phase changes, while resetting to the initial project-level statuses if no phase is selected.
- (2026-03-18) Implemented `F022` by deriving kanban counts from a lookup of the currently effective phase statuses, sorting visible columns by `display_order`, and ignoring tasks whose mapping IDs are not part of the selected phase’s effective status set.
- (2026-03-18) Implemented `F023` with a minimal prop-boundary change: `ProjectDetail.tsx` now passes `visibleKanbanStatuses` into `KanbanBoard`, so the board renders from the selected phase’s effective status columns directly.
- (2026-03-18) Implemented `F024` by making `TaskEdit` and `TaskQuickAdd` fetch phase-effective statuses for their active phase, including same-project phase switches. That ensures `TaskStatusSelect` receives the correct status list via props even when the editor phase differs from the surrounding view state.
- (2026-03-18) Implemented `F025` in `ProjectTaskStatusSettings` with a scope selector at the top of the panel. `Project Defaults` is the first option, followed by each project phase loaded from `getProjectMetadata(projectId)`.
- (2026-03-18) Implemented `F026` with phase-level mode controls in `ProjectTaskStatusSettings`: each selected phase now shows `Use project defaults` versus `Custom statuses`, with control enablement derived from whether that phase currently has custom mappings.
- (2026-03-18) Implemented `F027` by wiring the phase-default state to a `Copy from project defaults` action that calls `copyProjectStatusesToPhase(projectId, phaseId)` and reloads the scoped mappings after success.
- (2026-03-18) Implemented `F028` by making the `Use project defaults` path confirm before calling `removePhaseStatuses(phaseId)`, then reloading the phase scope so the UI falls back to the project-level mappings.

### Key Files — Client Portal
- `packages/client-portal/src/components/projects/ProjectDetailView.tsx` — orchestrator
- `packages/client-portal/src/components/projects/ClientKanbanBoard.tsx` — kanban view
- `packages/client-portal/src/components/projects/ClientTaskListView.tsx` — list view
- `packages/client-portal/src/actions/client-portal-actions/client-project-details.ts` — getClientProjectStatuses

- (2026-03-18) Implemented `F020` by extending `getClientProjectStatuses()` with optional `phaseId` and the same “phase first, else project defaults” lookup pattern used on the MSP side. The query now also coalesces custom and standard statuses so client portal reads remain backward compatible.

### Key Files — Templates
- `packages/projects/src/components/project-templates/TemplateStatusManager.tsx`
- `packages/projects/src/components/project-templates/wizard-steps/TemplateStatusColumnsStep.tsx`

### Key Files — Import / Events
- `packages/types/src/interfaces/phaseTaskImport.interfaces.ts` — IImportReferenceData

## Open Questions

- None currently — all design decisions agreed upon.
