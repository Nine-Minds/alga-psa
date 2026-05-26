# Workflow Reference Scope Selector Design

## Summary
Replace the flat `Reference` field picker with a staged selection flow:

1. Choose source scope
2. If needed, choose source group or step
3. Choose a field from that scope

This keeps the reference UI aligned with the actual workflow data model and reduces the number of irrelevant choices shown at once.

## Goals
- Reduce cognitive load in `Reference` mode.
- Avoid presenting a single flat list of every possible workflow path.
- Let step outputs use a step-first flow.
- Allow field lists to be filtered to compatible target types.
- Keep `Browse sources` as the secondary/manual tree browser.

## Source Model
The first selector is `Source scope`.

Supported scopes:
- `Payload`
- `Step output`
- `Workflow meta`
- `Error`
- `Loop context`

Scope visibility rules:
- `Error` only appears when the current step is inside a catch block.
- `Loop context` only appears when the current step is inside a for-each block.
- `Step output` appears whenever prior saved outputs exist.

## Selection Flow
### Payload
- Show payload-backed fields directly.
- Filter to exact/coercible target types by default.

### Step output
- Show a second selector for the saved step output (`vars.<saveAs>`).
- After selecting a step, show that step’s available fields.
- Filter to exact/coercible target types by default.

### Workflow meta
- Show metadata fields directly.

### Error
- Show catch-context error fields directly.

### Loop context
- Show loop item and loop index references directly.

## Filtering
- Default field list shows exact and coercible matches first.
- Incompatible fields are hidden by default.
- If needed later, add a `Show all fields` affordance as an escape hatch.

## Browse Sources
- `Browse sources` remains available in `Reference` mode.
- It is no longer the default primary flow.
- It should open scoped to the currently selected source scope when possible.

## Persistence
- The staged selector still writes the same persisted value shape:
  - `{ $expr: "payload.foo" }`
  - `{ $expr: "vars.ticketResult.ticket_id" }`
  - `{ $expr: "meta.traceId" }`

No runtime contract changes are required.

## Component Impact
- `InputMappingEditor`
  - Replace the flat reference picker with staged selectors.
  - Track source scope and selected step for each reference field.
- `MappingPanel`
  - Continue to pass grouped source context.
- `SourceDataTree`
  - Remains the secondary browser surface.

## Testing
- Reference mode renders `Source scope` first.
- Choosing `Step output` reveals the step selector.
- Choosing a step reveals only that step’s fields.
- Field lists prefer compatible types.
- Payload/meta/error/loop scopes only show valid options for the current context.
- Existing saved `$expr` references rehydrate into the correct staged scope.
