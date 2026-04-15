# Scratchpad — Workflow Wait Steps Productization

- Plan slug: `workflow-wait-steps-productization`
- Created: `2026-04-07`

## What This Is

Working notes for productizing workflow wait steps in the EE workflow system.

## Decisions

- (2026-04-07) V1 is not a new generic condition engine. It productizes and extends the existing `event.wait` primitive and adds a sibling `time.wait`.
- (2026-04-07) Event waits remain event-driven. Matching should use event name, correlation key, tenant scope, and structured payload filters, not polling.
- (2026-04-07) V1 event filters support a constrained operator set with AND semantics only.
- (2026-04-07) V1 resumes on the first matching event only. No “wait for N matches” semantics.
- (2026-04-07) V1 does not support collection/array traversal in payload filters; only scalar payload fields are supported.
- (2026-04-07) Wait steps should stay node-backed rather than being introduced as new `control.*` block types.
- (2026-04-07) Structural event schema is not enough for entity-aware filter pickers; wait filters also need field presentation metadata, ideally attached to event fields in schema annotations for v1.

## Discoveries / Constraints

- (2026-04-07) `event.wait` already exists in runtime node registration in [registerDefaultNodes.ts](/Users/roberisaacs/alga-psa/shared/workflow/runtime/nodes/registerDefaultNodes.ts).
- (2026-04-07) Publish validation already has explicit `event.wait` handling in [publishValidation.ts](/Users/roberisaacs/alga-psa/shared/workflow/runtime/validation/publishValidation.ts).
- (2026-04-07) Runtime event submission already resolves the first matching wait by event name and correlation key in [workflow-runtime-v2-actions.ts](/Users/roberisaacs/alga-psa/ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts).
- (2026-04-07) Wait persistence already has `payload`, `timeout_at`, `event_name`, `key`, and `wait_type`, which should be enough for v1 without broad schema churn in [workflowRunWaitModelV2.ts](/Users/roberisaacs/alga-psa/shared/workflow/persistence/workflowRunWaitModelV2.ts).
- (2026-04-07) Designer pipeline and run UIs already recognize `event.wait`, but the step is not fully productized in the main designer experience.
- (2026-04-07) Shared workflow `Step` typing does not explicitly model `event.wait`; it currently falls through as a generic node step in [types.ts](/Users/roberisaacs/alga-psa/shared/workflow/runtime/types.ts).
- (2026-04-07) The existing workflow designer generic `SchemaForm` can render enums and primitives, but array/object fields fall back to JSON editing, so a naive `filters` addition would not produce a usable picker-based wait-filter UI.
- (2026-04-07) The designer already has reusable picker infrastructure for action inputs in [WorkflowActionInputFixedPicker.tsx](/Users/roberisaacs/alga-psa/ee/server/src/components/workflow-designer/WorkflowActionInputFixedPicker.tsx), including ticket status and entity pickers. Wait filters should reuse this pattern rather than invent a second picker model.

## Commands / Runbooks

- (2026-04-07) Inspect workflow designer/runtime wait surfaces:
  - `rg -n "event\\.wait|workflow_run_waits|findEventWait|timeout_at|WorkflowDesigner" ee packages shared server/src/test`
- (2026-04-07) Inspect runtime node registration:
  - `sed -n '1,230p' shared/workflow/runtime/nodes/registerDefaultNodes.ts`
- (2026-04-07) Inspect publish validation:
  - `sed -n '260,390p' shared/workflow/runtime/validation/publishValidation.ts`
- (2026-04-07) Inspect wait persistence:
  - `sed -n '1,260p' shared/workflow/persistence/workflowRunWaitModelV2.ts`
- (2026-04-07) Inspect event submission/resume path:
  - `sed -n '3040,3165p' ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`

## Links / References

- [WorkflowDesigner.tsx](/Users/roberisaacs/alga-psa/ee/server/src/components/workflow-designer/WorkflowDesigner.tsx)
- [PipelineComponents.tsx](/Users/roberisaacs/alga-psa/ee/server/src/components/workflow-designer/pipeline/PipelineComponents.tsx)
- [RunStudioShell.tsx](/Users/roberisaacs/alga-psa/ee/server/src/components/workflow-run-studio/RunStudioShell.tsx)
- [registerDefaultNodes.ts](/Users/roberisaacs/alga-psa/shared/workflow/runtime/nodes/registerDefaultNodes.ts)
- [publishValidation.ts](/Users/roberisaacs/alga-psa/shared/workflow/runtime/validation/publishValidation.ts)
- [types.ts](/Users/roberisaacs/alga-psa/shared/workflow/runtime/types.ts)
- [workflowRunWaitModelV2.ts](/Users/roberisaacs/alga-psa/shared/workflow/persistence/workflowRunWaitModelV2.ts)
- [workflow-runtime-v2-actions.ts](/Users/roberisaacs/alga-psa/ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts)
- [actionInputEditorState.ts](/Users/roberisaacs/alga-psa/ee/server/src/components/workflow-designer/actionInputEditorState.ts)
- [WorkflowActionInputFixedPicker.tsx](/Users/roberisaacs/alga-psa/ee/server/src/components/workflow-designer/WorkflowActionInputFixedPicker.tsx)

## Open Questions

- Should `time.wait` support assignment on resume in v1, or should that be deferred?
- Should the wait-step editor fully hide the generic schema form for these steps, or allow an advanced fallback?
- Are there onboarding-critical domain events missing from the event catalog that should be added in the same milestone, or should that be follow-on work?

## Progress Log — 2026-04-07 (Implementation Pass 1)

### Completed Plan Items

- Features completed in this pass: `F001`–`F014`, `F018`, `F020`.
- Tests implemented in this pass: `T001`–`T006`.

### Key Decisions (with rationale)

- Formalized `event.wait` and `time.wait` in shared `Step` typing with dedicated config schemas to avoid hidden generic-node behavior and provide explicit validation at definition parse time.
- Standardized event wait filter shape to `{ path, op, value? }` with strict schema-level operator/value constraints so malformed filters fail at publish-time.
- Kept event wait matching event-driven and first-match by created order by querying candidate waits and evaluating filters in-process; this preserves non-polling semantics and existing wait persistence model.
- Reused existing `workflow_run_waits.payload` for both event filters and time-wait metadata, and introduced/used `wait_type='time'` for due-time wakeups, avoiding schema churn.
- Implemented `time.wait` resume using existing worker tick path and `resume_event_*` fields (not `resume_error`) so time waits are normal continuation points, not failures.
- Preserved timeout semantics for `event.wait` by keeping existing timeout worker behavior (`resume_error: TimeoutError`) and try/catch compatibility.

### Discoveries / Constraints

- `WorkflowDesigner` already sources palette node choices from node registry, so registering `time.wait` makes it immediately palette-available.
- Existing designer step config panel is still generic-`SchemaForm` for wait nodes; curated wait editors (`F015`, `F016`) and picker-backed filter authoring (`F021`, `F022`) remain open.
- Local workspace is missing installed vitest binaries/deps in this environment; direct execution of targeted tests failed due missing local toolchain bindings.

### Files Changed (high-signal)

- Shared runtime typing + schemas:
  - `shared/workflow/runtime/types.ts`
- Event-filter evaluation utility:
  - `shared/workflow/runtime/utils/eventWaitFilters.ts`
  - `shared/workflow/runtime/index.ts` (export)
- Node runtime behavior:
  - `shared/workflow/runtime/nodes/registerDefaultNodes.ts`
  - `shared/workflow/runtime/registries/nodeTypeRegistry.ts`
  - `shared/workflow/runtime/runtime/workflowRuntimeV2.ts`
  - `shared/workflow/runtime/validation/publishValidation.ts`
- Wait persistence + worker pickup:
  - `shared/workflow/persistence/workflowRunWaitModelV2.ts`
  - `shared/workflow/workers/WorkflowRuntimeV2Worker.ts`
- Event ingestion matching:
  - `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
- Designer/runtime surfaces (incremental metadata + labels):
  - `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
  - `ee/server/src/components/workflow-designer/pipeline/PipelineComponents.tsx`
  - `ee/server/src/components/workflow-designer/workflowDataContext.ts`
  - `ee/server/src/components/workflow-run-studio/RunStudioShell.tsx`
- Test helpers + e2e coverage:
  - `server/src/test/helpers/workflowRuntimeV2TestHelpers.ts`
  - `server/src/test/e2e/workflowRuntimeV2.e2e.test.ts`

### Commands / Runbook Notes

- Attempted targeted runtime e2e run:
  - `pnpm vitest server/src/test/e2e/workflowRuntimeV2.e2e.test.ts --runInBand` (failed: vitest command unavailable in workspace)
  - `npm run test:local -- src/test/e2e/workflowRuntimeV2.e2e.test.ts --runInBand` in `server/` (failed: vitest not found)
  - `npx vitest --config vitest.config.ts src/test/e2e/workflowRuntimeV2.e2e.test.ts` in `server/` (failed during config/package resolution because local dependency graph is not installed for this worktree)

### Gotchas

- Avoid blindly mass-editing plan JSON booleans; use explicit ID-based updates.
- `time.wait` until-mode requires guardrails both in schema and handler because runtime may still receive invalid/legacy drafts.

## Progress Log — 2026-04-07 (Implementation Pass 2)

### Completed Plan Items

- Additional features completed in this pass: `F015`, `F016`, `F019`.

### What Changed

- Added curated `event.wait` editor in `StepConfigPanel`:
  - event catalog-backed event selector
  - correlation key expression field
  - structured filter row editor (`path`, `op`, `value`)
  - timeout input
  - assign-on-resume mapping editor
- Added schema-informed filter field authoring:
  - resolves selected event payload schema (registry ref preferred, event-catalog inline fallback)
  - extracts scalar payload paths for field selection
  - preserves free-text path fallback when schema fields are unavailable
- Added curated `time.wait` editor in `StepConfigPanel`:
  - mode selector (`duration`/`until`)
  - mode-specific duration input or until-expression editor
  - assign-on-resume mapping editor
- Disabled generic `SchemaForm` rendering for `event.wait`/`time.wait` to avoid conflicting duplicate controls.

### Notes

- `F021` / `F022` remain open: this pass adds schema-informed field selection and primitive/enum value controls, but does not yet implement picker-metadata-driven typed controls for wait filters.
- `F017` remains open pending broader run-detail metadata surfacing beyond current pipeline summaries.

## Progress Log — 2026-04-07 (Implementation Pass 3)

### Completed Plan Items

- Additional feature completed: `F017`, `F021`, `F022`.
- Additional tests implemented: `T007`, `T008`, `T009`, `T010`.

### What Changed

- Enhanced wait metadata rendering in run details:
  - event waits now show filter count from wait payload
  - time waits now show mode and scheduled resume timestamp
- Extended wait filter field extraction to honor event schema picker metadata:
  - supports `x-workflow-picker-kind`
  - supports `x-workflow-editor.picker.resource`
  - passes optional dependencies and fixed value hints into picker controls
- Updated wait filter value editor fallback order:
  1) typed picker when picker metadata exists
  2) enum dropdown when schema enum exists
  3) primitive controls (boolean/number/text)
- Added focused workflow wait editor component tests in:
  - `ee/server/src/components/workflow-designer/__tests__/WorkflowWaitEditors.test.tsx`
- Added onboarding-style first-match integration test (`T008`) in runtime E2E test suite.

### Remaining

- Feature checklist: all complete.
- Test checklist: all complete.
