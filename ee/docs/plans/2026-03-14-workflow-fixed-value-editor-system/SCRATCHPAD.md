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
