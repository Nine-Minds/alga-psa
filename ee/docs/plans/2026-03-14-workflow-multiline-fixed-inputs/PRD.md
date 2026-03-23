# PRD — Workflow Multiline Fixed Inputs

- Slug: `workflow-multiline-fixed-inputs`
- Date: `2026-03-14`
- Status: Implemented

## Summary

Introduce an explicit, presentation-only workflow action input hint for multiline fixed-value editing in the EE workflow designer. Implement the hint generically in the fixed-value editor, but only opt in the `ai.infer.prompt` field in this first pass.

## Problem

The workflow designer currently renders all fixed string inputs with the same single-line text input control. This is a poor fit for authoring AI prompts and other longer freeform text values. Users lose readability, editing comfort, and confidence when entering multiline content into controls intended for short strings.

The current behavior also lacks an explicit schema-level concept for input presentation. Without that concept, future multiline-capable fields would likely be handled through field-name heuristics or ad hoc UI exceptions, which would be brittle and would weaken layering in the workflow designer.

## Goals

- Add an explicit schema-driven presentation hint for workflow action input fields to request a multiline fixed-value editor.
- Make the fixed-value editor render a textarea when that hint is present on a string field.
- Apply the hint to `ai.infer.prompt` so AI prompt authoring uses a multiline input immediately.
- Keep the change EE-only and aligned with workflow ownership boundaries.

## Non-goals

- No heuristics based on field names like `prompt`, `body`, or `text`.
- No change to expression mode, reference mode, picker mode, or structured JSON editors.
- No broad audit and rollout of other candidate fields in this change.
- No change to workflow runtime behavior, persistence shape, or validation semantics.

## Users and Primary Flows

- Workflow authors configuring AI inference steps in the EE workflow designer.
- Primary flow:
  - User adds or edits an `ai.infer` action step.
  - User selects fixed-value input mode for `prompt`.
  - User enters a multiline prompt comfortably in a textarea.

## UX / UI Notes

- The fixed-value control for hinted string fields should use the existing design-system `TextArea`.
- Existing labels, required-state indicators, and field descriptions should remain unchanged.
- The control swap should be local to the fixed-value editor branch only.
- Prompt-only first pass: no visible changes to other workflow fields yet.

## Requirements

### Functional Requirements

- The workflow designer must support a presentation-only schema hint for workflow action input fields indicating that fixed-value editing should use a multiline control.
- The schema-to-designer field extraction path must preserve that hint in the action input field metadata used by the mapping editor.
- The fixed-value literal editor must render a `TextArea` instead of an `Input` when:
  - the field type is `string`, and
  - the multiline presentation hint is present.
- The `ai.infer.prompt` action input schema must opt into the multiline hint.
- Fields without the hint must continue using the current single-line string input behavior.

### Non-functional Requirements

- The new metadata must remain presentation-only and must not alter runtime parsing or action execution behavior.
- The change must stay within the EE workflow package/UI surfaces and must not reintroduce mixed client/server runtime layering.
- Existing workflow editor tests must remain valid except where explicitly updated for the new textarea behavior.

## Data / API / Integrations

- No database changes.
- No API contract changes.
- Schema metadata change only:
  - add a workflow-specific presentation hint on selected input schema properties.
- UI metadata flow:
  - action schema -> extracted `ActionInputField` metadata -> fixed-value editor rendering branch.

## Security / Permissions

- No permission changes.
- No secret-handling changes.
- No new user-provided content execution surface beyond existing string editing.

## Observability

- No new observability work in scope for this change.

## Rollout / Migration

- No migration required.
- Existing workflows remain valid because the hint only affects authoring presentation.
- Only newly rendered designer sessions for `ai.infer.prompt` will display the textarea.

## Open Questions

- None for this first pass. Future follow-up can audit other candidate fields such as notification bodies and outbound email text/html fields.

## Acceptance Criteria (Definition of Done)

- The workflow designer supports a presentation-only multiline hint for fixed string inputs.
- `ai.infer.prompt` renders with a multiline textarea in fixed-value mode.
- Non-hinted string fields still render the existing single-line text input.
- No workflow runtime or persistence behavior changes.
- Relevant designer tests cover the new hint propagation and textarea rendering behavior.
