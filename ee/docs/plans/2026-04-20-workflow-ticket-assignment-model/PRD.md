# Workflow Ticket Assignment Model

## Problem

The workflow ticket actions currently expose multiple overlapping assignment concepts:

- `tickets.create.assigned_to`
- `tickets.create.assignee`
- `tickets.update_fields.patch.assigned_to`
- `tickets.assign.assignee`

This is confusing in the workflow editor, makes team-aware assignment inconsistent across actions, and does not provide a clean way to manage additional ticket assignees (`ticket_resources`) through workflows.

## Goals

1. Replace the legacy ticket workflow assignment fields with one canonical assignment model.
2. Make the workflow editor render assignment pickers consistently, including nested picker-backed fields.
3. Support additional assigned MSP users in workflow actions.
4. Make assignment updates deterministic and idempotent.
5. Keep team assignment semantics intuitive:
   - primary assignee resolved from the chosen team/queue/user
   - team members unioned with explicit additional users
   - duplicates removed
   - primary assignee never duplicated as an additional assignee

## Non-goals

1. Preserving backwards compatibility for old workflow assignment schemas.
2. Adding a broader assignment abstraction for non-ticket workflow actions in this change.
3. Redesigning ticket assignment behavior outside workflow actions.

## Canonical assignment model

All ticket workflow actions should use:

```ts
assignment: {
  primary: {
    type: 'user' | 'team' | 'queue',
    id: string
  } | null,
  additional_user_ids: string[]
}
```

## Action-specific requirements

### `tickets.create`
- Remove `assigned_to` and `assignee`.
- Add top-level `assignment`.
- `assignment.primary` may be null.
- If `assignment.primary` is null, `additional_user_ids` must be empty.
- Persist `assignment.primary` to `tickets.assigned_to` / `tickets.assigned_team_id` as appropriate.
- Persist `additional_user_ids` to `ticket_resources`.

### `tickets.update_fields`
- Remove `patch.assigned_to`.
- Add `patch.assignment`.
- `patch.assignment` is atomic replacement of workflow-visible assignment state.
- If present, it replaces both the primary assignment and the additional-user set.

### `tickets.assign`
- Remove legacy `assignee` input.
- Add top-level `assignment`.
- `assignment.primary` is required.
- Team/queue assignment keeps current primary-resolution behavior, but now also supports explicit `additional_user_ids`.
- Final additional-user set = team/queue expansion union explicit `additional_user_ids`, minus the primary assignee.

## Validation rules

1. All referenced users must exist in the tenant and be active internal MSP users.
2. Team primary assignment must resolve to a valid active lead.
3. Queue primary assignment must resolve according to current queue behavior.
4. `additional_user_ids` is replace-only and fully deterministic.
5. Duplicates are removed.
6. The resolved primary assignee is removed from the final additional-user set.

## Workflow editor requirements

1. Nested picker metadata must survive schema resolution for nullable/object-backed fields.
2. `assignment.primary.type` renders as a fixed enum/select field.
3. `assignment.primary.id` renders as a picker that depends on `assignment.primary.type`.
4. `assignment.additional_user_ids` renders as a multi-user picker.
5. The update-fields patch editor must support `patch.assignment` as structured input, not raw JSON-only authoring.

## Technical design

1. Add shared assignment schema builders/helpers in `shared/workflow/runtime/actions/businessOperations/tickets.ts`.
2. Add one shared assignment resolver for workflow ticket actions.
3. Add one shared ticket-resource reconciliation helper for workflow ticket actions.
4. Update workflow editor field extraction/resolution so `x-workflow-picker-*` metadata is preserved when `anyOf` nullable wrappers are unwrapped.
5. Extend the fixed-value workflow input editor to support multi-user picker editing for array fields.

## Acceptance criteria

1. No ticket workflow action input schema contains the legacy create/update/assign assignment fields.
2. The workflow editor shows assignment pickers for the new model.
3. `tickets.create`, `tickets.update_fields`, and `tickets.assign` all persist assignment state through the same canonical resolution rules.
4. Additional assigned users are supported and reconciled deterministically.
5. Team assignment plus explicit additional users uses union semantics.
6. The resolved primary assignee is never duplicated into `ticket_resources`.
