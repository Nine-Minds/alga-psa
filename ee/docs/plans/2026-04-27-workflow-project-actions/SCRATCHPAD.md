# SCRATCHPAD — Workflow Project Actions

- Slug: `workflow-project-actions`
- Date: `2026-04-27`
- Status: Discovery / PRD convergence

## Initial request

Add workflow actions for project-management entities:

- FIND task / phase / project
- MOVE task (to different status + phase, or project + phase + status)
- RENAME task / phase / project
- ASSIGN task
- DUPLICATE task
- DELETE task / phase / project
- LINK TICKET to task
- ADD TAG to task or project
- EDIT task / phase / project description

## Context from request

Workflow actions are server-registered through `shared/workflow/runtime/registries/actionRegistry.ts`, commonly in `shared/workflow/runtime/actions/registerBusinessOperationsActions.ts` and domain files under `shared/workflow/runtime/actions/businessOperations/`.

Action schemas are Zod schemas converted to JSON Schema and consumed by the workflow designer. Picker/editor metadata can be attached via schema descriptions and normalized into `ActionInputField.editor`. Picker-backed fields should use `x-workflow-editor` where possible, with legacy picker metadata still supported.

## Repository discoveries

- Existing project workflow action file: `shared/workflow/runtime/actions/businessOperations/projects.ts`.
- Existing registered project action: `projects.create_task`.
- It already validates project, optional phase, optional project_task status, optional user/team assignee, optional ticket link, writes audit, and returns task URL/status metadata.
- Existing ticket action code has a generic ticket-to-entity pattern in `shared/workflow/runtime/actions/businessOperations/tickets.ts`, including `project` and `project_task` entity types.
- Plans live under `ee/docs/plans/YYYY-MM-DD-<slug>/` with `PRD.md`, `features.json`, `tests.json`, and `SCRATCHPAD.md`.

## Open questions

- Need decide whether FIND actions are exact-ID lookup actions, criteria/search actions, or both.
- Need define destructive delete semantics for phases/projects/tasks.
- Need define duplicate semantics for tasks (comments/checklists/tags/ticket links/time entries/subtasks?).
- Need confirm picker support needed for project/phase/task/status/tag resources in workflow fixed-value inputs.

## Decisions

- FIND scope: use both exact lookup and search/list-style actions, following existing workflow action patterns.
- Pattern fidelity is a primary design constraint. Existing examples:
  - `clients.find`: exact lookup by id/name/external ref with `on_not_found` and nullable output.
  - `clients.search`: query + filters + pagination, returns array, first result, page metadata, total.
  - `contacts.find` / `contacts.search`: same split.
  - `tickets.find`: exact lookup by id/number/external ref with optional include flags.
- Proposed PRD direction: project entities should mirror that split rather than inventing separate `get` naming unless the registry already uses it elsewhere.

- Delete semantics decision: target soft/archive semantics where the project domain supports them; use hard delete only where the domain's existing behavior is genuinely hard delete. Preserve existing domain guards and avoid workflow-specific cascade behavior.
## Delete/move/duplicate implementation fidelity discoveries

- User decision: delete semantics should mirror existing project UI/domain behavior exactly.
- Existing task delete UI action (`packages/projects/src/actions/projectTaskActions.ts`) checks `project:delete`, validates project read access, refuses delete when associated `time_entries` exist, deletes ticket links, deletes checklist items, then deletes `project_tasks`.
- Existing phase delete UI action (`packages/projects/src/actions/projectActions.ts`) checks `project:delete`, validates project read access, then calls `ProjectModel.deletePhase`.
- Existing project delete UI action (`packages/projects/src/actions/projectActions.ts`) uses `deleteEntityWithValidation('project', ...)`, cleans up project tags, task tags under phases, project ticket links, email reply tokens, then deletes through `ProjectModel.delete`.
- Existing API service (`server/src/lib/api/services/ProjectService.ts`) has simpler hard-delete methods, but workflow plan should prefer UI/domain action semantics when they are richer.
- Existing task move UI action: `moveTaskToPhase` supports target phase, optional target status mapping, optional target project, optional before/after positioning. It remaps status mappings on same-project phase moves and cross-project moves if no explicit target status is provided, regenerates WBS/order key, and updates ticket link project/phase references.
- Existing task duplicate UI action: `duplicateTaskToPhase` supports target phase, optional new status mapping, and options for primary assignee, additional assignees, checklist, and ticket links. It appends ` (Copy)`, resets actual hours to 0, creates task, optionally copies related records, and emits workflow events.

## Update action decision

- User decision: use generic update actions, not separate narrow rename/edit-description actions.
- PRD direction:
  - `projects.update` covers project name and description edits, plus only other fields intentionally included by this plan.
  - `projects.update_phase` covers phase name and description edits, plus only other fields intentionally included by this plan.
  - `projects.update_task` covers task title/name, description, assignment, status, phase/project move-adjacent fields only if they do not conflict with the dedicated move action. Prefer dedicated `projects.move_task` for phase/project/status relocation because existing domain logic is non-trivial.
- Avoid palette/action sprawl for `rename_*` and `edit_*_description` variants.

## Assignment action decision

- User decision: use a dedicated `projects.assign_task` action, matching `tickets.assign` fidelity.
- PRD direction:
  - Keep task assignment out of generic `projects.update_task` except possibly preserving current assignment when other fields update.
  - `projects.assign_task` should follow `tickets.assign` shape where practical: required assignment target, optional reason/comment if useful, `no_op_if_already_assigned` default true, output task id/assigned target/updated timestamp.
  - Existing project task model supports `assigned_to` primary user and additional task resources. Need decide if workflow assignment supports only primary user in v1 or primary + additional users.

## Task assignment model decision

- User decision: `projects.assign_task` should support primary user + additional users.
- PRD direction:
  - Primary assignee maps to `project_tasks.assigned_to`.
  - Additional users map to task resource/additional assignment records, matching existing project task UI/domain behavior.
  - Do not invent team assignment unless existing project task resource semantics support it; the first-class workflow task assignment model is user-centric.
  - Provide no-op behavior when primary and additional users already match, mirroring `tickets.assign`.

## Tag behavior discovery/decision

- User instruction: look at contact workflow/tag behavior and match it.
- There is no dedicated `contacts.add_tag` workflow action today; contact/client workflow search actions filter by existing tag text through `tag_mappings` + `tag_definitions` joins.
- Existing ticket workflow create/update tag handling creates missing `tag_definitions`, inserts mappings, treats duplicate mappings as no-op, and normalizes/uniquifies trimmed tag text.
- Existing generic tag domain action `createTag` also get-or-creates tag definitions, requires entity update permission, requires `tag:create` only when the definition is new, creates the mapping, and publishes tag events.
- `createTagsForEntityWithTransaction` get-or-creates definitions and continues on per-tag failures; this is used by imports including project task import.
- PRD direction: `projects.add_tag` should match existing tag application semantics: trim/validate tag text, get-or-create tag definition for tagged type (`project` or `project_task`), insert mapping idempotently/no-op on duplicate, use existing color generation/definition colors, and respect tag permissions when practical.
- Need be careful that workflow runtime direct DB implementation should either reproduce permission requirements or call shared tag-domain helper if callable from workflow runtime.

- Follow-up search for user-mentioned `Add Tag to Contact`: current worktree search did not find a dedicated workflow contact add-tag action in `shared/workflow/runtime/actions/businessOperations/contacts.ts` or elsewhere under workflow runtime. It may be in another branch/module or not present in this worktree.
- Concrete tag behavior found in `packages/tags/src/actions/tagActions.ts#createTag`: validates non-empty tag text, trims, max 50 chars, character whitelist, requires target entity update permission, requires `tag:create` only if creating a new definition, get-or-creates `tag_definitions`, inserts `tag_mappings`, publishes `TAG_DEFINITION_CREATED` and `TAG_APPLIED`, and returns the mapping id as `tag_id` for compatibility.

## Tag action behavior decision/discovery

- User direction: match the existing workflow contact module's `contacts.add_tag` behavior.
- Existing `contacts.add_tag` behavior:
  - Action id: `contacts.add_tag`.
  - Input: `contact_id`, `tags: string[]`, optional `idempotency_key`.
  - Side-effectful with `idempotency: { mode: 'actionProvided', key: actionProvidedKey }`.
  - Requires `{ resource: 'contact', action: 'update' }`.
  - Ensures the contact exists.
  - Normalizes/uniques tag text.
  - Creates missing tag definitions for `tagged_type: 'contact'` with generated colors.
  - Inserts tag mappings idempotently via conflict ignore.
  - Returns `added`, `existing`, `added_count`, `existing_count`.
  - Writes run audit.
- PRD direction:
  - Add project/task tag actions should create missing tag definitions and idempotently attach mappings, not fail on missing tags.
  - Match output shape and idempotency behavior from `contacts.add_tag`.
  - Use resource permissions appropriate to the target entity (`project:update`; task likely project update after project/task read scoping, matching existing project task actions).

## Tag action shape decision

- User decision: two resource-specific actions.
- PRD direction:
  - `projects.add_tag` attaches tags to a project.
  - `projects.add_task_tag` attaches tags to a project task.
  - Both mirror `contacts.add_tag` behavior and output shape.

## Ticket-to-task link decision

- User decision: workflow task-ticket link should write both `project_ticket_links` and `ticket_entity_links`.
- PRD direction:
  - Add action likely named `projects.link_ticket_to_task`.
  - Validate task, its phase/project, and ticket exist.
  - Require appropriate project update and ticket read permissions, matching existing UI behavior plus workflow business action conventions.
  - Insert `project_ticket_links` idempotently/best-effort where duplicate constraints exist.
  - Insert/ensure `ticket_entity_links` with `entity_type: 'project_task'`, `entity_id: task_id`, `link_type: 'project_task'`, and metadata containing project/phase IDs, matching `projects.create_task` precedent.
  - Return IDs and counts/created-vs-existing indicators if practical.

## Picker/editor support decision

- User decision: hybrid picker support.
- PRD direction:
  - Add workflow fixed-value picker/editor support for project, phase, project task, and project task status/status mapping where needed.
  - Keep tag entry as free-text string array, matching `contacts.add_tag`; no tag picker in this plan.
  - Use dependency metadata so phase/task/status pickers can depend on selected project/phase as applicable.

## PRD approval

- User approved the PRD scope on 2026-04-27.
- Estimated feature list size: medium/large workflow action expansion, roughly 60-75 atomic features because it spans handler schemas, action behavior, permissions/audit, tag/link helpers, and designer picker support.
- Test plan should be Pareto-focused: DB-backed action handler coverage for representative read/update/mutation/destructive paths, plus picker metadata/designer resource coverage.


## Implementation checkpoint — 2026-04-27 (Find/Search foundation)

### Completed features

- `F001`: Added shared workflow schemas in `shared/workflow/runtime/actions/businessOperations/projects.ts` for:
  - `projectSummarySchema`
  - `phaseSummarySchema`
  - `taskSummarySchema`
  - `statusMappingSummarySchema`
  - `tagResultSchema`
  - `assignmentResultSchema`
  - `linkResultSchema`
  Rationale: establishes canonical output schema contracts for new action family.

- `F002`: Added reusable entity/context loaders with standardized `NOT_FOUND` errors:
  - `ensureProjectExists`
  - `ensurePhaseExists`
  - `ensureTaskContext`
  - `ensureTicketExists`
  - `ensureStatusMappingExists`
  Rationale: avoid repeated ad-hoc lookup/error logic across action handlers.

- `F003`: Added reusable permission + narrowing helpers:
  - `requireProjectReadPermission`
  - `requireProjectUpdatePermission`
  - `requireProjectDeletePermission`
  - `canReadProject` / `assertProjectReadable`
  Rationale: centralizes project read/auth narrowing behavior and future-proofs update/delete action implementation.

- `F004`: Added project picker metadata helpers and kinds:
  - picker kinds: `project`, `project-phase`, `project-task`, `project-task-status`
  - helper: `withWorkflowPicker`
  Rationale: fixed-value mode can render dependency-aware project entity pickers.

- `F005` + `F006`: Implemented `projects.find` schema + handler:
  - supports `project_id`, exact `name`, optional `external_ref`, `on_not_found`
  - enforces tenant scoping + project read permission + auth narrowing
  - returns nullable `project` summary output

- `F007` + `F008`: Implemented `projects.search` schema + handler:
  - query + filters + pagination
  - deterministic ordering + `first_project` + `total`
  - authorization-filtered results

- `F009` + `F010`: Implemented `projects.find_phase` schema + handler:
  - supports `phase_id` or project-scoped exact `name`
  - supports `on_not_found`
  - enforces project read auth via phase->project context validation

- `F011` + `F012`: Implemented `projects.search_phases` schema + handler:
  - supports project scope, query, filters, pagination
  - deterministic ordering + `first_phase` + `total`
  - auth-filtered by parent project visibility

- `F013` + `F014`: Implemented `projects.find_task` schema + handler:
  - supports `task_id` or scoped exact task `name`
  - supports `on_not_found`
  - validates task->phase->project context and project read authorization

- `F015` + `F016`: Implemented `projects.search_tasks` schema + handler:
  - supports query + project/phase/status mapping/status/assignee/tag filters
  - returns `tasks`, `first_task`, page metadata, total
  - tenant-scoped + project-auth filtered

### Completed tests

- `T001`: Added `shared/workflow/runtime/actions/__tests__/registerProjectActionsMetadata.test.ts`
  - validates registration, labels, side-effect/idempotency metadata, category
  - validates picker metadata presence and dependencies for project/phase/task/status fields

- `T002` + `T003` + `T004`: Added DB-backed tests in
  `shared/workflow/runtime/actions/__tests__/businessOperations.projects.db.test.ts`
  - covers `projects.find` + `projects.search` happy paths, not-found behavior, pagination/tenant scoping
  - covers `projects.find_phase` + `projects.search_phases` project scoping and deterministic ordering
  - covers `projects.find_task` + `projects.search_tasks` scoped lookups, filters, first/total/page metadata

### Commands / runbook used

- Targeted test run:
  - `cd shared && npx vitest run workflow/runtime/actions/__tests__/registerProjectActionsMetadata.test.ts workflow/runtime/actions/__tests__/businessOperations.projects.db.test.ts`

### Gotchas discovered

- Shared runtime package does not resolve `@alga-psa/authorization/kernel` in this test runtime; switched to local schema-aware read narrowing helper.
- Test DB schema differs from legacy assumptions (`project_number` required; status column variants; user/client columns vary); test fixtures were made column-aware via `information_schema` checks.
- Throwing standardized action objects inside try/catch requires pass-through handling; otherwise generic rethrow path can incorrectly map to `INTERNAL_ERROR`.

## Implementation checkpoint — 2026-04-27 (Generic update actions)

### Completed features

- `F017` + `F018`: Implemented `projects.update` schema+handler:
  - non-empty patch validation (`project_name`, `description`)
  - project update permission + project read auth check
  - changed-field diffing + `no_op` support
  - output includes updated project summary + changed metadata
  - workflow run audit writes include `changed_fields` and `no_op`

- `F019` + `F020`: Implemented `projects.update_phase` schema+handler:
  - non-empty patch validation (`phase_name`, `description`)
  - phase->project context validation
  - project update permission + read auth check
  - changed-field output + `no_op` + run audit

- `F021` + `F022`: Implemented `projects.update_task` schema+handler:
  - non-empty patch validation for task `task_name` and `description`
  - excludes move/status relocation fields by schema design
  - task->phase->project context validation
  - project update permission + read auth check
  - changed-field output + `no_op` + run audit

### Completed tests

- `T006`: Added DB-backed coverage for update happy paths and audit writes:
  - validates name/description updates for project, phase, and task
  - checks returned changed fields/no-op flags
  - asserts audit log operation records exist for all three update actions

- `T007`: Added DB-backed validation/permission guard coverage:
  - empty patch rejects at schema parse time
  - missing project/phase/task returns `NOT_FOUND`
  - denied `project:update` returns `PERMISSION_DENIED`
  - verifies denied update does not mutate persisted project data

### Checklist correction

- `T001` was initially marked complete during the first checkpoint but that was premature because it requires registration coverage for the full final project action surface. Reset to `implemented:false` until the full action set is present.

## Implementation checkpoint — 2026-04-27 (Task move action)

### Completed features

- `F023`: Added `projects.move_task` input schema with:
  - `task_id`
  - `target_phase_id`
  - optional `target_project_status_mapping_id`
  - optional `target_project_id`
  - optional `before_task_id` / `after_task_id` (mutually exclusive)
  - picker metadata and dependency wiring for project/phase/task/status fields

- `F024` + `F025`: Implemented status remap/default resolution when explicit status mapping is omitted:
  - attempts same-project mapping reuse
  - attempts same underlying status id mapping in target project
  - falls back to first visible target project mapping by display order
  - cross-project path uses target-project mappings only

- `F026`: Implemented move-time WBS/order metadata updates:
  - regenerates `wbs_code` based on target phase WBS + next ordinal
  - updates `order_key` when supported by schema

- `F027`: Implemented `project_ticket_links` context rewrite on move:
  - updates `project_id` + `phase_id` for all links tied to moved `task_id`

- `F028`: Added move output schema/result payload with previous/current project/phase/status mapping/status ids plus updated WBS/order/updated_at.

- `F029`: Added permission checks, validation errors, and workflow run audit logging for `projects.move_task`.

### Completed tests

- `T008`: DB-backed same-project move test validates:
  - phase relocation
  - status mapping/status resolution non-null path
  - WBS/order metadata change
  - move audit record creation

- `T009`: DB-backed cross-project move test validates:
  - target project/phase assignment
  - status mapping resolution in target project
  - `project_ticket_links` project/phase context updates

- `T010`: DB-backed validation guard test validates:
  - missing task => `NOT_FOUND`
  - missing target phase => `NOT_FOUND`
  - invalid explicit target mapping => `VALIDATION_ERROR`

### Gotchas discovered

- Ticket fixture schema for this branch requires adaptive field population (e.g., `client_id` constraints and varying timestamp columns), so the test helper was made schema-aware via `information_schema`.
- Same-project status remap behavior can legitimately keep source mapping in some fixture shapes; tests were adjusted to verify remap outcomes without over-constraining mapping identity.

## Implementation checkpoint — 2026-04-27 (Task assignment action)

### Completed features

- `F030`: Added `projects.assign_task` input schema:
  - `task_id`
  - `primary_user_id`
  - `additional_user_ids` (array; deduped)
  - optional `reason`
  - `no_op_if_already_assigned` default `true`
  - optional `idempotency_key`
  - schema guard that rejects `additional_user_ids` containing the primary user

- `F031`: Added assignment user resolution helper for active tenant users:
  - validates primary user exists and is active
  - validates all additional users exist and are active
  - enforces internal-user filtering where user schema supports `user_type`
  - returns deterministic deduped/sorted additional user ids

- `F032`: Implemented no-op comparison for assignment requests:
  - compares current `project_tasks.assigned_to`
  - compares current `task_resources.additional_user_id` set
  - honors `no_op_if_already_assigned` (default true)

- `F033`: Implemented assignment mutation and additional-user reconciliation:
  - updates `project_tasks.assigned_to`
  - clears `assigned_team_id` when present
  - replaces `task_resources` rows for the task with the resolved additional users

- `F034`: Implemented assign action output shape:
  - `task_id`, `assigned_to`, `additional_user_ids`, `no_op`, `updated_at`

- `F035`: Added permission checks and run audit logging for `projects.assign_task`:
  - requires `project:update`
  - validates project readability through task->phase->project context
  - writes `workflow_action:projects.assign_task` audit rows for both no-op and mutation paths

### Completed tests

- `T011`: Added DB-backed happy-path assignment test validating:
  - primary assignee change
  - additional-user reconciliation in `task_resources`
  - deterministic output
  - audit record creation

- `T012`: Added DB-backed no-op test validating:
  - identical requested assignment returns `no_op: true`
  - task `updated_at` unchanged when no-op short-circuits

- `T013`: Added DB-backed validation failure test validating:
  - inactive primary user rejected
  - missing additional user rejected
  - no partial mutation of `project_tasks.assigned_to` or existing `task_resources`

### Commands/runbook used

- `cd shared && npx vitest run workflow/runtime/actions/__tests__/registerProjectActionsMetadata.test.ts workflow/runtime/actions/__tests__/businessOperations.projects.db.test.ts`

### Gotchas discovered

- `task_resources` has no uniqueness constraint on (`task_id`, `additional_user_id`), so reconciliation uses delete+reinsert to keep assignment state canonical.
- UUID lexical ordering is non-semantic; tests were adjusted to compare additional-user sets order-insensitively where needed.

## Implementation checkpoint — 2026-04-27 (Task duplicate action)

### Completed features

- `F036`: Added `projects.duplicate_task` input schema with:
  - `source_task_id`
  - `target_phase_id`
  - optional `target_project_status_mapping_id`
  - copy toggles for primary assignee, additional assignees, checklist, and ticket links

- `F037`: Implemented core duplicate behavior:
  - clones source task into target phase
  - appends ` (Copy)` suffix to task name
  - preserves estimated hours when schema supports it
  - resets actual hours to `0` when schema supports it
  - resolves target status mapping/status similarly to move semantics

- `F038`: Implemented optional checklist copy:
  - copies `task_checklist_items` rows to new task with new ids/timestamps
  - returns copied checklist count

- `F039`: Implemented optional assignment copy:
  - optional primary assignment copy to `project_tasks.assigned_to`
  - optional additional assignment copy via `task_resources`
  - clears `assigned_team_id` on duplicates when that column exists

- `F040`: Implemented optional ticket link copy with permission-aware filtering:
  - checks `ticket:read` permission before copying links
  - copies `project_ticket_links` into target project/phase/task context
  - writes matching `ticket_entity_links` records for duplicated task links

- `F041`: Added duplicate action output schema:
  - source/new task ids
  - target project/phase/status mapping/status ids
  - copied relation counts
  - `created_at`

- `F042`: Added permission checks and run audit logging:
  - requires `project:create` and project read checks for source/target context
  - writes `workflow_action:projects.duplicate_task` audit with target ids and copied counts

### Completed tests

- `T014`: DB-backed duplicate core behavior test validates:
  - new task creation in target phase/project
  - ` (Copy)` suffix
  - description copy
  - estimated-hours preservation + actual-hours reset when columns exist
  - status mapping/status target metadata in output

- `T015`: DB-backed optional relation copy test validates:
  - checklist copy count and persisted copied checklist rows
  - primary/additional assignment copy count and `task_resources` rows
  - ticket-link copy count and copied `project_ticket_links` target context

### Commands/runbook used

- `cd shared && npx vitest run workflow/runtime/actions/__tests__/registerProjectActionsMetadata.test.ts workflow/runtime/actions/__tests__/businessOperations.projects.db.test.ts`

### Gotchas discovered

- `task_checklist_items`/`task_resources`/`project_tasks` schemas vary slightly across migrations in this branch; test fixtures and assertions were kept column-aware to avoid false failures.
- `task_resources` assignment rows are easiest to keep coherent via full-row clone with refreshed ids/timestamps and target task id, while overriding `assigned_to` according to copy options.

## Implementation checkpoint — 2026-04-27 (Delete task/phase/project actions)

### Completed features

- `F043`: Added `projects.delete_task` input/output schemas with cleanup count fields:
  - input: `task_id`
  - output: `task_id`, `deleted`, `deleted_ticket_link_count`, `deleted_checklist_item_count`

- `F044`: Implemented delete-task guard for associated project task time entries:
  - checks `time_entries` by `work_item_type='project_task'` and `work_item_id=task_id`
  - rejects with `VALIDATION_ERROR` when entries exist

- `F045`: Implemented delete-task cleanup flow mirroring UI semantics:
  - deletes task ticket links
  - deletes task checklist items
  - removes task resources and task-side ticket entity links before deleting task row

- `F046`: Added delete-task permission checks and audit logging:
  - requires `project:delete`
  - validates task->project context readability
  - writes `workflow_action:projects.delete_task` run audit

- `F047`: Added `projects.delete_phase` input/output and handler:
  - input: `phase_id`
  - output: `phase_id`, `project_id`, `deleted`
  - deletes phase with project context validation

- `F048`: Added delete-phase validation, permissions, standardized errors, and audit logging:
  - requires `project:delete`
  - validates phase + project context and readability
  - writes `workflow_action:projects.delete_phase` run audit

- `F049`: Added `projects.delete` input/output schemas exposing validation/result fields:
  - input: `project_id`
  - output includes `success`, `deleted`, `can_delete`, `code`, `message`, `dependencies`, `alternatives`

- `F050`: Implemented project delete handler with cleanup behavior:
  - collects phase/task descendants
  - blocks delete when descendant task time entries exist
  - cleans up project tags + task tags (`tag_mappings`)
  - cleans up project/task ticket links and project email reply tokens
  - removes descendant tasks/phases then project row

- `F051`: Added delete-project permission checks, failure shape, and run audit logging:
  - requires `project:delete`
  - returns structured validation failure result when blocked
  - writes `workflow_action:projects.delete` run audit on mutation path

### Completed tests

- `T016`: DB-backed destructive task-delete happy path validates:
  - ticket-link + checklist cleanup counts
  - task row removed
  - related checklist/link rows removed

- `T017`: DB-backed destructive guard test validates:
  - task delete rejected when project_task time entries exist
  - task/checklist/link rows remain intact

- `T018`: DB-backed destructive phase/project delete coverage validates:
  - phase delete happy path
  - project delete happy path including cleanup of project/task tags, project ticket links, and email reply tokens
  - project delete validation-failure path when descendant task time entries exist

### Commands/runbook used

- `cd shared && npx vitest run workflow/runtime/actions/__tests__/registerProjectActionsMetadata.test.ts workflow/runtime/actions/__tests__/businessOperations.projects.db.test.ts`

### Gotchas discovered

- `time_entries` schema in this branch requires additional non-null columns (e.g., `work_date`, `work_timezone`), so destructive guard fixtures needed column-aware inserts.
- Project delete cleanup needs to tolerate optional tables (`email_reply_tokens`, `task_resources`, `ticket_entity_links`) across schema variants; helper deletion logic was made table-existence-aware.
