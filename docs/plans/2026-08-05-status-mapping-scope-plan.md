# Prevent phase-scope status mappings from hiding project tasks

## Intent

Guarantee that every phase task remains visible when project-default and phase-specific status mappings diverge, while preventing writers from creating new cross-scope assignments.

## Code findings

The branch is clean at `860071a686`. Direct inspection confirmed effective mappings are scope-exclusive; Kanban and List bucket tasks by strict mapping-id equality; `ProjectDetail` already detects lookup misses but rendering paths still drop them. The phase-status writer, template application, and API task creation paths lack a shared scope invariant. `copyProjectStatusesToPhase` also matches nullable `status_id`, allowing all standard mappings to collapse onto the first clone.

## Implementation

1. Introduce a shared model/service validator that resolves a task's phase-effective mappings and rejects or remaps a `project_status_mapping_id` outside that set. Use stable semantic identity (standard status/type plus custom identity), never nullable `status_id` alone.
2. In `addStatusToProject`, when the first phase-scoped mapping changes a phase from defaults to custom mappings, clone/establish the complete effective set and transactionally remap existing phase tasks before returning.
3. Fix `copyProjectStatusesToPhase` to retain the explicit old-mapping-to-new-mapping correspondence created during cloning, eliminating the `NULL === NULL` collapse.
4. In `applyProjectTemplate`, choose mappings in the created task's phase scope and fail transactionally on an impossible template mapping rather than creating an orphan.
5. In `ProjectService.createTask`, validate tenant/project/phase ownership and phase-effective mapping membership before insert.
6. Add a visible fallback group shared by Kanban and List for legacy/orphan tasks. Label it as needing status assignment and preserve task interactions; never silently omit tasks. Keep total/done counts consistent with the visible buckets.
7. Add behavioral tests for: first phase-specific status added to a populated phase; multiple standard mappings copied without collapse; template application; API rejection of cross-scope mapping; and legacy orphan visibility in both Kanban and List.
8. Run focused project model/action/service/component tests and reproduce the ticket flow on the wired stack.

## Deliberate non-goals

- Do not add the unsupported `phase_id` query parameter to the project tasks endpoint in this change.
- Do not replace the existing task-status-mappings API.
- Do not silently mutate legacy records merely by reading them.

## Risks

Remapping must be transactional and deterministic, especially for custom statuses with duplicate labels. The fallback is a safety net, not a substitute for write-time invariants.
