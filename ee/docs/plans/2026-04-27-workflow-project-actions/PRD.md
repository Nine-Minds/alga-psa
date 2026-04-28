# PRD — Workflow Project Actions

- Slug: `workflow-project-actions`
- Date: `2026-04-27`
- Status: Approved

## Summary

Add workflow business-operation actions for core project-management entities: projects, project phases, and project tasks. The action set should let workflow authors find/search project entities, update names and descriptions through generic update actions, move/assign/duplicate/delete tasks, delete phases/projects using existing domain semantics, link tickets to tasks, and attach tags to projects or tasks.

The plan prioritizes fidelity with existing workflow action patterns and existing project UI/domain behavior. It should extend the current workflow action registry rather than introduce a new action framework.

## Problem

Workflows can currently create project tasks through `projects.create_task`, but they cannot perform common follow-up operations on project work: locating an existing project/task/phase, moving a task across phase/status/project boundaries, updating names/descriptions, assigning task users, duplicating work, deleting project entities, linking tickets, or tagging project work.

This forces users to leave workflow automation for routine project maintenance, or to use lower-fidelity workarounds such as direct IDs and manual updates outside the workflow designer.

## Goals

- Add workflow actions for finding and searching projects, phases, and tasks.
- Add generic update actions for projects, phases, and tasks that cover rename and description-edit use cases.
- Add a dedicated task assignment action that matches the `tickets.assign` pattern where practical.
- Add task move and duplicate actions that mirror existing project UI/domain behavior.
- Add delete actions for tasks, phases, and projects that mirror existing project UI/domain deletion behavior.
- Add ticket-to-task link action that maintains both project-side and ticket-side link tables.
- Add project/task tag actions that mirror existing `contacts.add_tag` behavior.
- Add workflow designer picker support for project, phase, task, and project-task-status/status-mapping fields.
- Keep tag entry as free-text arrays, matching existing tag workflow actions.

## Non-goals

- Do not add separate narrow `rename_*` or `edit_*_description` actions; use generic update actions.
- Do not invent new delete cascade or archive semantics; mirror current project UI/domain behavior.
- Do not introduce tag pickers in this plan.
- Do not add team assignment for project tasks unless existing project task domain support is first-class; the planned assignment model is primary user plus additional users.
- Do not change workflow runtime mapping semantics or persisted workflow step shape.
- Do not replace existing `projects.create_task`; extend the project workflow action module around it.

## Users and Primary Flows

### Users

- Workflow authors building project automations.
- MSP operators automating ticket-to-project task handoff.
- Project managers using workflows to keep project work aligned with tickets, tags, assignments, and statuses.

### Primary flows

- A workflow receives a ticket or client event, finds a project/task/phase, and updates task details.
- A workflow searches tasks by project/phase/status/title and branches based on whether matching work exists.
- A workflow moves a task to a target phase/status or into another project while preserving existing domain behavior.
- A workflow assigns a task to a primary user and additional users.
- A workflow duplicates a task into another phase with selected related data copied.
- A workflow deletes a task, phase, or project using the same guardrails as the UI.
- A workflow links an existing ticket to an existing project task.
- A workflow adds tags to a project or task idempotently.

## UX / UI Notes

- New actions should appear in the Business Operations category with labels consistent with existing workflow actions.
- Fixed-value inputs should be ergonomic for ID-heavy fields:
  - project picker for project IDs
  - phase picker scoped by project where applicable
  - task picker scoped by project/phase where applicable
  - project-task-status/status-mapping picker scoped by project/phase where applicable
- Picker dependencies should use workflow schema editor metadata so dependent fields explain what must be selected first.
- Tag inputs remain free-text string arrays, as in `contacts.add_tag`.
- Generic update actions should be clear in the palette, e.g. “Update Project”, “Update Project Phase”, “Update Project Task”. They should not create separate palette entries for rename or description editing.

## Requirements

### Functional Requirements

#### Find and search actions

- Add `projects.find` for exact project lookup.
  - Should follow `clients.find` / `tickets.find` style.
  - Should support `on_not_found: 'return_null' | 'error'`.
  - Candidate lookup keys: `project_id`, exact project name, and any existing external reference field if the project domain has one.
- Add `projects.search` for project search.
  - Should follow `clients.search` style: `query`, `filters`, `page`, `page_size`, array output, first result, and total.
- Add `projects.find_phase` for exact phase lookup.
  - Should support `phase_id` and optionally project-scoped exact phase name.
  - Should support `on_not_found`.
- Add `projects.search_phases` for phase search/listing.
  - Should support project scope and query/filter/pagination where useful.
- Add `projects.find_task` for exact task lookup.
  - Should support `task_id` and optionally project/phase-scoped exact task name.
  - Should support `on_not_found`.
- Add `projects.search_tasks` for task search/listing.
  - Should support filters for project, phase, status/status mapping, assignee, tags, and query against task name/description where practical.
  - Should return array output, first result, page metadata, and total.

#### Generic update actions

- Add `projects.update` to update project fields needed by this plan, including project name and description.
- Add `projects.update_phase` to update phase fields needed by this plan, including phase name and description.
- Add `projects.update_task` to update task fields needed by this plan, including task name/title and description.
- Generic update actions must reject empty patches.
- Generic update actions must validate target existence and permissions.
- Generic update actions must write workflow run audit entries.

#### Task move action

- Add `projects.move_task`.
- It must mirror existing `moveTaskToPhase` behavior:
  - validate source task and target phase
  - support optional target status mapping
  - support cross-project moves through target phase/project context
  - remap status mappings when no explicit target status is provided
  - regenerate WBS/order key as current domain logic does
  - update project ticket links to the target project/phase
  - support optional before/after positioning if practical

#### Task assignment action

- Add `projects.assign_task`.
- It must be a dedicated action, not folded into `projects.update_task`.
- It should mirror `tickets.assign` where practical:
  - primary user assignment
  - additional user assignments
  - optional reason/comment if consistent with existing task audit/comment behavior
  - `no_op_if_already_assigned` defaulting to true
  - output current assignment and updated timestamp
- Primary assignee maps to `project_tasks.assigned_to`.
- Additional users map to existing task resource/additional assignment records.

#### Task duplicate action

- Add `projects.duplicate_task`.
- It must mirror existing `duplicateTaskToPhase` behavior:
  - duplicate task into a target phase
  - support optional target status mapping
  - append the existing copy suffix behavior unless a custom target name is included in scope during implementation
  - reset actual hours as existing domain behavior does
  - optionally copy primary assignee, additional assignees, checklist, and ticket links
  - preserve authorization checks for source project/task and linked tickets

#### Delete actions

- Add `projects.delete_task`.
  - Must mirror existing task delete UI behavior.
  - Must refuse delete when associated time entries exist.
  - Must clean up ticket links and checklist items as current UI behavior does.
- Add `projects.delete_phase`.
  - Must mirror existing phase delete UI/domain behavior.
- Add `projects.delete` for project deletion.
  - Must mirror existing project delete UI/domain behavior using existing validation where possible.
  - Must preserve existing cleanup of project tags, task tags, project ticket links, email reply tokens, and project deletion validation.

#### Ticket-to-task link action

- Add `projects.link_ticket_to_task`.
- It must validate ticket, task, phase, and project context.
- It must maintain both:
  - `project_ticket_links`
  - `ticket_entity_links` with `entity_type: 'project_task'`, `entity_id: task_id`, `link_type: 'project_task'`, and project/phase metadata
- It should be idempotent or conflict-safe where duplicate link constraints exist.
- It must write a workflow run audit entry.

#### Tag actions

- Add `projects.add_tag` for project tags.
- Add `projects.add_task_tag` for project task tags.
- Both must mirror `contacts.add_tag` behavior:
  - input target ID, `tags: string[]`, optional `idempotency_key`
  - action-provided idempotency
  - create missing tag definitions with generated colors
  - insert tag mappings idempotently
  - return `added`, `existing`, `added_count`, `existing_count`
  - write workflow run audit entries

#### Workflow designer picker support

- Add fixed-value picker support for:
  - project
  - project phase
  - project task
  - project task status/status mapping
- Use dependency metadata for scoped pickers, e.g. phase depends on project, task can depend on project/phase, status mapping can depend on project/phase.
- Do not add tag picker support in this plan.

### Non-functional Requirements

- Actions must follow existing action registry conventions: Zod input/output schemas, `sideEffectful`, idempotency metadata where applicable, UI labels/descriptions, permission checks, tenant-scoped transactions, standardized errors, and audit logging.
- Find/search action naming and behavior should match existing `clients.find`, `clients.search`, `contacts.find`, `contacts.search`, and `tickets.find` patterns.
- Mutating actions should reuse or faithfully replicate existing project domain behavior rather than direct table updates when domain behavior is non-trivial.
- New picker metadata should use the current workflow schema editor model and remain compatible with existing fixed/reference source-mode behavior.

## Data / API / Integrations

Primary server files expected to be involved:

- `shared/workflow/runtime/actions/businessOperations/projects.ts`
- `shared/workflow/runtime/actions/registerBusinessOperationsActions.ts` if registration shape changes
- workflow schema metadata helpers if new picker resource names are needed
- workflow designer fixed picker components and resource registries for project/phase/task/status pickers
- existing project domain action/model/service files as reference for behavior:
  - `packages/projects/src/actions/projectActions.ts`
  - `packages/projects/src/actions/projectTaskActions.ts`
  - `server/src/lib/api/services/ProjectService.ts`

Existing tables likely involved:

- `projects`
- `project_phases`
- `project_tasks`
- `project_status_mappings`
- `project_ticket_links`
- `ticket_entity_links`
- `tag_definitions`
- `tag_mappings`
- `task_checklist_items`
- task resource/additional assignment tables used by current project task actions
- `time_entries` for delete guards

## Security / Permissions

- Read actions require project read permission and must honor existing project authorization narrowing where applicable.
- Project/phase/task updates, moves, assignment changes, duplicate operations, tag additions, and ticket links require appropriate project update/create/delete permissions consistent with existing UI actions.
- Ticket linking must also validate ticket read access where existing UI behavior does.
- Project deletion must preserve existing validation and authorization semantics.
- All queries and mutations must remain tenant-scoped.

## Observability

- Mutating actions must write workflow run audit entries with action id, action version, target IDs, changed fields/counts, and no-op state where applicable.
- Read/search actions should log duration and high-level filter/result counts consistent with existing workflow action logging patterns.

## Rollout / Migration

- No database migration is expected unless implementation discovers missing constraints or metadata needed for idempotent links.
- Existing workflows and `projects.create_task` remain compatible.
- New picker resources should be additive.
- If picker support is incomplete, schemas should still allow reference-mode and pasted UUID usage; however, the plan’s target UX includes project/phase/task/status fixed-value pickers.

## Risks

- Project UI/domain logic is richer than the current workflow `projects.create_task` direct-table implementation; implementation must avoid bypassing important behavior for move, duplicate, and delete.
- Status mapping behavior is phase/project-aware and easy to get wrong for cross-project moves.
- Delete behavior can have high blast radius; project deletion must reuse existing validation semantics.
- Task assignment has primary and additional-user behavior; no-op comparison must account for both.
- Maintaining both project-side and ticket-side task links may expose existing data inconsistencies or duplicate constraints.
- Picker dependencies may require new client-side resource loaders for project-specific entities.

## Open Questions

- Exact output field shape for project, phase, and task summary schemas.
- Whether `projects.update_task` should allow status changes, or whether all status/phase/project relocation must go through `projects.move_task` only. Current PRD bias: use `projects.move_task` for relocation/status mapping changes.
- Whether `projects.duplicate_task` should allow a custom copied task title in addition to existing ` (Copy)` suffix behavior.
- Whether task assignment should include an optional task comment, and if so which existing task comment model should be used.

## Acceptance Criteria (Definition of Done)

- Workflow registry includes project find/search actions for projects, phases, and tasks.
- Workflow registry includes generic update actions for projects, phases, and tasks that cover rename and description edits.
- Workflow registry includes task move, assign, duplicate, and delete actions.
- Workflow registry includes phase and project delete actions.
- Workflow registry includes ticket-to-task link action that writes both link representations.
- Workflow registry includes project and task tag actions matching `contacts.add_tag` behavior.
- New action input schemas expose picker metadata for project, phase, task, and project-task-status/status-mapping fields where applicable.
- Workflow designer fixed-value mode can select project, phase, task, and status/status-mapping values with dependency-aware behavior.
- Mutating actions enforce tenant scoping, permissions, validation, standardized errors, idempotency where applicable, and run audit logging.
- Tests cover representative happy paths and high-risk guard cases for read/search, update, move, assign, duplicate, delete, link, tag, and picker metadata behavior.
