# Scratchpad — Workflow Multiline Fixed Inputs

- Plan slug: `workflow-multiline-fixed-inputs`
- Created: `2026-03-14`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-14) Use an explicit schema-driven hint for multiline rendering instead of inferring from field names like `prompt` or `body`.
- (2026-03-14) Keep the hint presentation-only so the first pass changes only designer rendering, not runtime semantics.
- (2026-03-14) Limit initial adoption to `ai.infer.prompt`; audit of notification/email body fields is intentionally deferred.

## Discoveries / Constraints

- (2026-03-14) The fixed-value control for workflow action inputs is chosen in `ee/server/src/components/workflow-designer/mapping/InputMappingEditor.tsx` under the string literal branch.
- (2026-03-14) Action input field metadata already preserves workflow-specific picker hints in `ee/server/src/components/workflow-designer/actionInputEditorState.ts`, so presentation hints can follow the same extraction path.
- (2026-03-14) `ai.infer.prompt` currently uses the generic single-line string editor, which is the user-visible pain point.

## Commands / Runbooks

- (2026-03-14) Reproduce current behavior by opening an `ai.infer` step in the workflow designer and viewing the fixed-value editor for `prompt`.
- (2026-03-14) Validate visually in algadev browser pane after editing the workflow designer input component.

## Links / References

- Key files:
- `ee/server/src/components/workflow-designer/mapping/InputMappingEditor.tsx`
- `ee/server/src/components/workflow-designer/actionInputEditorState.ts`
- `shared/workflow/runtime/actions/registerAiActions.ts`

## Open Questions

- Follow-up only: audit whether notification/email body fields should also opt into multiline after the prompt-only pass lands.
