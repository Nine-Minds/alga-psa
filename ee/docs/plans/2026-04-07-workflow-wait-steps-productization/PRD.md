# PRD — Workflow Wait Steps Productization

- Slug: `workflow-wait-steps-productization`
- Date: `2026-04-07`
- Status: Draft

## Summary

Productize the existing workflow wait primitive so workflow authors can naturally pause on business events and time. V1 should formalize and extend the existing `event.wait` node, add a sibling `time.wait` node, expose both as first-class steps in the workflow designer, and keep runtime matching event-driven rather than query- or polling-based.

## Problem

The workflow system already supports `event.wait` in runtime, tests, and parts of the UI, but it is not a complete product surface. Authors cannot naturally build lifecycle workflows such as onboarding follow-up cadences because:

- `event.wait` is partially implemented and not presented as a polished first-class step.
- matching is limited to event name plus correlation key; there is no structured payload filter layer.
- there is no sibling `time.wait` step for “wait 2 days” or “wait until Monday at 9 AM.”
- the current shape pushes users toward manual schedules and external orchestration for workflows that should stay inside the workflow engine.

For onboarding and customer-success workflows, this creates unnecessary composition overhead and makes otherwise natural automations awkward.

## Goals

- Make `Wait for Event` a first-class workflow step built on the existing runtime primitive.
- Support structured payload filters with a constrained operator set.
- Support entity-aware wait-filter value pickers where event fields provide presentation metadata.
- Add `Wait for Time` for duration- and absolute-time waits.
- Keep the runtime model event-driven and deterministic.
- Preserve backward compatibility for existing `event.wait` definitions.
- Give workflow authors a clear designer experience, summaries, and validation for both wait types.

## Non-goals

- No generic “wait until arbitrary database condition” engine.
- No polling-based entity rechecks.
- No nested boolean filter groups in v1.
- No matching inside arrays or collections in event payloads in v1.
- No “wait for N matching events” semantics in v1.
- No broad observability or metrics program beyond the existing workflow run/event surfaces.

## Users and Primary Flows

Primary users:

- Workflow builders creating onboarding, customer-success, and operational automations
- Internal product and solutions teams validating real-world lifecycle workflows

Primary flows:

1. Author selects `Wait for Event`, picks an event from the catalog, sets a correlation key expression, adds payload filters, and continues the workflow when the first matching event arrives.
2. Author selects `Wait for Time`, chooses either a duration or an until-expression, and resumes the workflow when the deadline is reached.
3. Author inspects run details and can clearly see what a run is waiting on, when it will timeout or resume, and what event resumed it.

## UX / UI Notes

- Expose `Wait for Event` and `Wait for Time` directly in the workflow designer palette.
- Keep them implemented as node-backed steps, not `control.*` blocks.
- Add curated config panels rather than relying only on the generic schema form.

`Wait for Event` fields:

- `Event`
- `Correlation Key Expression`
- `Payload Filters`
- `Timeout`
- `Assign On Resume`

`Wait for Time` fields:

- `Mode` (`Duration` or `Until`)
- `Duration` or `Until Expression`
- optional resume assignment only if clearly useful; otherwise omit in v1

Pipeline and run UI should show concise summaries:

- event name
- filter count
- timeout or scheduled resume time

## Requirements

### Functional Requirements

1. The runtime must continue to support existing `event.wait` definitions without requiring migration.
2. The shared workflow model must explicitly recognize `event.wait` as a supported step type rather than relying on it only as an untyped generic node.
3. `event.wait` config must support an optional `filters` array.
4. Supported filter operators in v1 must be:
   - `=`
   - `!=`
   - `in`
   - `not_in`
   - `exists`
   - `not_exists`
   - `>`
   - `>=`
   - `<`
   - `<=`
   - `contains`
   - `starts_with`
   - `ends_with`
5. Filter evaluation must apply only to scalar payload fields in v1.
6. Array literals on the right-hand side must be allowed for `in` and `not_in`.
7. All filter clauses must be ANDed in v1.
8. Event ingestion must resume the first waiting run whose `eventName`, `correlationKey`, tenant scope, and filters all match.
9. `event.wait` timeout behavior must remain supported and compatible with existing timeout and try/catch handling.
10. A new `time.wait` step must be introduced.
11. `time.wait` must support waiting for a relative duration.
12. `time.wait` must support waiting until a computed or provided date/time value.
13. The worker/runtime scheduler must resume due `time.wait` entries.
14. The workflow designer palette must expose both wait steps as first-class choices.
15. The workflow designer must provide custom configuration UI for both wait steps.
16. Designer summaries and run details must show useful wait metadata.
17. Publish-time validation must cover invalid assignment paths and malformed wait configuration for both wait steps.
18. Event-catalog-driven authoring must remain compatible with `event.wait`, including event selection and schema-informed payload path authoring.
19. Event-backed wait filters must support field presentation metadata so eligible fields can render typed value pickers instead of raw text or JSON inputs.
20. V1 wait-filter picker behavior must fall back cleanly when event fields do not provide picker metadata.

### Non-functional Requirements

- Matching must stay event-driven and avoid broad polling loops.
- Wait resolution must remain tenant-scoped.
- The design must reuse existing workflow run wait persistence where practical.
- The change should avoid unnecessary schema churn; use existing `payload` and `timeout_at` columns when possible.

## Data / API / Integrations

Current relevant surfaces:

- Runtime wait persistence in [workflowRunWaitModelV2.ts](/Users/roberisaacs/alga-psa/shared/workflow/persistence/workflowRunWaitModelV2.ts)
- Runtime node registration in [registerDefaultNodes.ts](/Users/roberisaacs/alga-psa/shared/workflow/runtime/nodes/registerDefaultNodes.ts)
- Publish validation in [publishValidation.ts](/Users/roberisaacs/alga-psa/shared/workflow/runtime/validation/publishValidation.ts)
- Event submission and wait resolution in [workflow-runtime-v2-actions.ts](/Users/roberisaacs/alga-psa/ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts)
- Designer UI in [WorkflowDesigner.tsx](/Users/roberisaacs/alga-psa/ee/server/src/components/workflow-designer/WorkflowDesigner.tsx)

Recommended persistence model:

- Keep using `workflow_run_waits`
- store event filters in `payload`
- store `time.wait` metadata in `payload`
- use a new `wait_type` value such as `time` for time waits
- keep `timeout_at` as the wake-up deadline for `time.wait` and timeout deadline for `event.wait`

Recommended event-wait runtime model:

1. Event is submitted and recorded as today.
2. Candidate waits are selected by `event_name`, `correlation_key`, tenant, and wait type.
3. Candidates are evaluated in created order against filter clauses.
4. The first matching wait is resolved and its run is resumed.

Recommended time-wait runtime model:

1. `time.wait` computes a due timestamp.
2. Runtime publishes a `time` wait row with `timeout_at = due timestamp`.
3. Worker picks up due time waits and resumes the run.

Recommended event-field authoring model:

- Keep structural field discovery in the event catalog payload schema.
- Add field-level presentation metadata for wait-filter authoring, for example schema annotations that describe:
  - editor kind
  - picker resource
  - picker dependencies
- Use those annotations only for designer rendering; they must not change runtime event matching semantics.

Recommended wait-filter UI fallback order:

1. Typed picker when event field metadata declares a supported picker resource.
2. Enum dropdown when the schema declares `enum`.
3. Primitive fallback by type:
   - boolean toggle
   - number input
   - text input

## Security / Permissions

- Reuse existing workflow permissions for read/manage/publish/admin.
- Do not expand secret-handling semantics.
- Continue to validate assignment paths and expression usage.
- Preserve tenant scoping when resolving waits from incoming events.

## Observability

Use existing workflow run, wait, and event surfaces rather than introducing a new observability feature set. The main product requirement here is clarity:

- run details should show wait type, event name, correlation key, timeout/scheduled time, and resolution status
- event surfaces should continue to show matched run and wait information

## Rollout / Migration

- Backward compatibility for existing `event.wait` definitions is required.
- Prefer no database migration if `filters` and `time.wait` metadata can live in the existing `payload` column and time waits can use a new `wait_type`.
- Roll out in phases:
  1. formalize shared typing and runtime schema
  2. extend `event.wait` filter matching
  3. add `time.wait`
  4. finish designer productization

## Open Questions

- Should `time.wait` support assignment on resume in v1, or should that wait until a clearer use case appears?
- Should `time.wait` use `wait_type='time'` or reuse an existing type with different payload semantics? `time` is cleaner.
- Should the designer allow raw schema editing fallback for wait steps, or force the curated editor only?
- Should event field picker metadata live entirely in event schemas, or do we need a supplemental registry for event producers that cannot reasonably own UI annotations?

## Acceptance Criteria (Definition of Done)

- Workflow authors can create a `Wait for Event` step from the palette and configure event name, correlation key, filters, timeout, and resume assignments.
- When event fields provide supported picker metadata, the wait-filter editor renders typed value controls such as status or entity pickers instead of only raw inputs.
- When event fields do not provide picker metadata, the wait-filter editor falls back to enum or primitive controls without blocking authoring.
- Event ingestion resumes the first waiting run whose event name, correlation key, tenant, and filters all match.
- Existing `event.wait` workflows continue to publish and execute.
- Workflow authors can create a `Wait for Time` step from the palette and configure either a duration or an until-expression.
- Due time waits resume successfully through the worker/runtime path.
- Publish validation and designer UI make invalid wait configuration understandable before runtime.
- Run and event detail surfaces show enough wait metadata for debugging without inspecting raw database rows.
