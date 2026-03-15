# Scratchpad — Workflow Fixed-Value Editor System

## Context

- User wants prompt editing to support a larger dialog-based authoring experience in addition to inline editing.
- User also wants this generalized so picker-backed fields and future rich editors use one system.
- User explicitly wants this new system to subsume today’s picker metadata.

## Simplification Cascade

- Current variations:
  - standard literal inputs
  - picker metadata
  - presentation metadata like multiline
  - future dialog/popout editors
- Unifying insight:
  - all of these are fixed-value editor surfaces for a field
- Result:
  - one schema-driven editor contract
  - one normalization path
  - one fixed-value editor shell
  - multiple editor kinds and surfaces inside that shell

## Recommended Direction

- Introduce one top-level schema extension such as `x-workflow-editor`.
- Normalize both new metadata and legacy picker metadata into one `field.editor`.
- Keep source mode as the outer shell.
- Make fixed-value editor rendering entirely switch on the unified editor model.

## Proposed First Consumer

- `ai.infer.prompt`
  - inline multiline editor
  - dialog editor for larger prompt authoring

## Migration Strategy

1. Introduce editor normalization and adapter from current picker metadata.
2. Migrate prompt first.
3. Route current picker fields through the unified editor shell.
4. Later replace legacy picker metadata emission with the unified editor contract at the schema source.

## Relevant Files

- `ee/server/src/components/workflow-designer/actionInputEditorState.ts`
- `ee/server/src/components/workflow-designer/mapping/InputMappingEditor.tsx`
- `ee/server/src/components/workflow-designer/WorkflowActionInputFixedPicker.tsx`
- `shared/workflow/runtime/jsonSchemaMetadata.ts`
- `shared/workflow/runtime/actions/businessOperations/tickets.ts`

## Notes

- This should stay designer-only metadata and not alter runtime semantics.
- The contract must support both inline and dialog surfaces without parallel picker/editor systems.

## Implementation Log

### 2026-03-14

- Introduced shared `x-workflow-editor` metadata in `shared/workflow/runtime/jsonSchemaMetadata.ts`.
  - Contract supports `kind`, inline surface metadata, dialog surface metadata, dependencies, fixed-value hints, dynamic-reference allowances, and picker resource metadata.
  - Kept legacy `x-workflow-picker-*` annotations intact so existing action schemas and tests continue to export the old shape during migration.
- Moved `ai.infer.prompt` onto the new schema contract at the source in `shared/workflow/runtime/actions/registerAiActions.ts`.
  - Prompt now emits `kind: "text"` with inline `textarea` plus dialog `large-text`.
- Kept a designer-side hint adapter in `ee/server/src/components/workflow-designer/workflowActionPresentation.ts`.
  - Rationale: if any registry payload still lacks the new prompt metadata, the designer injects the same unified editor contract instead of reviving `x-workflow-input-control`.
- Replaced field-level `picker`/`presentation` normalization with a single `field.editor` model in `ee/server/src/components/workflow-designer/actionInputEditorState.ts`.
  - New metadata is normalized directly.
  - Legacy picker metadata is adapted into `kind: "picker"` with inline `picker-summary`.
  - This is the compatibility layer for incremental migration.
- Refactored fixed-value rendering in `ee/server/src/components/workflow-designer/mapping/InputMappingEditor.tsx`.
  - Added `FixedValueEditorShell` to host inline-only, dialog-only, and inline-plus-dialog surfaces.
  - String editors now render from unified editor metadata.
  - Prompt dialog uses the same fixed-value contract as inline editing and writes back through the same `onChange` path.
  - Added narrow component-boundary fallback helpers so older test fixtures using `picker`/`presentation` still exercise the unified shell during migration.
- Updated picker rendering and source-mode defaults to read unified editor metadata first.
  - Files:
    - `ee/server/src/components/workflow-designer/WorkflowActionInputFixedPicker.tsx`
    - `ee/server/src/components/workflow-designer/WorkflowActionInputSourceMode.tsx`
- Regression coverage added/updated:
  - `shared/workflow/runtime/__tests__/jsonSchemaMetadata.test.ts`
  - `shared/workflow/runtime/actions/__tests__/registerAiActions.test.ts`
  - `shared/workflow/runtime/actions/__tests__/registerTicketActionPickerMetadata.test.ts`
  - `ee/server/src/components/workflow-designer/__tests__/actionInputEditorState.test.ts`
  - `ee/server/src/components/workflow-designer/__tests__/workflowActionPresentation.test.ts`
  - `ee/server/src/components/workflow-designer/__tests__/TransformActionInputEditor.test.tsx`
  - `ee/server/src/components/workflow-designer/__tests__/InputMappingEditorUnifiedEditor.test.tsx`
  - `ee/server/src/components/workflow-designer/__tests__/InputMappingEditorPickerFields.test.tsx`
  - `ee/server/src/components/workflow-designer/__tests__/WorkflowActionInputSourceMode.test.tsx`

## Commands / Validation

- `npx vitest run workflow/runtime/__tests__/jsonSchemaMetadata.test.ts`
- `npx vitest run workflow/runtime/actions/__tests__/registerAiActions.test.ts workflow/runtime/actions/__tests__/registerTicketActionPickerMetadata.test.ts`
- `cd ee/server && npx vitest run src/components/workflow-designer/__tests__/actionInputEditorState.test.ts src/components/workflow-designer/__tests__/workflowActionPresentation.test.ts src/components/workflow-designer/__tests__/TransformActionInputEditor.test.tsx src/components/workflow-designer/__tests__/InputMappingEditorUnifiedEditor.test.tsx src/components/workflow-designer/__tests__/InputMappingEditorPickerFields.test.tsx src/components/workflow-designer/__tests__/WorkflowActionInputSourceMode.test.tsx`

## Gotchas

- `ee/server` and `shared` use different Vitest roots; targeted test commands must be run from each package directory.
- Prompt-dialog behavior is implemented only for `dialog.mode === "large-text"` in this phase; picker/browser dialog infrastructure is represented in metadata but intentionally not shipped as a second editor implementation yet.
