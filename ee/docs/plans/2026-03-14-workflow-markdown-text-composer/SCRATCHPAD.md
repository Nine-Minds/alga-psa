# Scratchpad — Workflow Markdown Text Composer

## Context

- User wants a standard workflow primitive for composing prompts, email text, summaries, and similar text artifacts.
- User explicitly does not want prompt-specific composition layered into `ai.infer`.
- User wants pure string outputs for now, not structured chat/message payloads.
- User wants multiple outputs per compose step to reduce workflow sprawl and pricing friction.
- User wants author-facing output names to be freeform.
- User wants missing references to fail execution explicitly, not silently render empty strings.
- User wants to invest now in a richer authoring UX using BlockNote, but only as an editor surface.
- User explicitly does not want BlockNote concepts to leak into persisted workflow config or runtime output strings.
- User wants markdown value from the editor because markdown is useful both for AI prompts and downstream HTML rendering in email-like consumers.
- User explicitly does not want media in the editor.

## Key Decisions

- New primitive: `transform.compose_text`
  - standard transform action
  - not AI-specific
  - dedicated action editor only
- Output model:
  - multiple outputs per step
  - freeform author labels
  - generated stable reference-safe keys for downstream workflow paths
- Authoring model:
  - constrained BlockNote-based editor
  - inline reference chips
  - markdown-safe rich text subset only
  - no media, attachments, or heavy document affordances
- Persistence model:
  - Alga-owned template document structure
  - no stored BlockNote JSON
- Runtime model:
  - render template document to markdown strings
  - resolve only simple references
  - fail hard if any reference is missing

## Important Constraint Discovered

- Current downstream reference handling is path-based and assumes identifier-safe segments.
- Relevant code:
  - `ee/server/src/components/workflow-designer/workflowDataContext.ts`
  - `ee/server/src/components/workflow-designer/WorkflowActionInputSourceMode.tsx`
- Evidence:
  - `resolveReferenceSchema()` splits paths on `.`
  - `isSimpleFieldReferenceExpression()` only accepts identifier-like dot segments and numeric bracket indexes
- Consequence:
  - “Freeform output names” cannot be used directly as runtime field keys if they include spaces or punctuation.
- Plan implication:
  - preserve freeform author labels
  - generate stable reference-safe keys for downstream paths such as `vars.composed.prompt_body`
  - show both label and stable key in the UI

## Relevant Existing Files

- Runtime transforms:
  - `shared/workflow/runtime/actions/registerTransformActions.ts`
  - `shared/workflow/runtime/actions/__tests__/registerTransformActions.test.ts`
- Dynamic output schema resolution:
  - `shared/workflow/runtime/actions/actionOutputSchemaResolver.ts`
  - `shared/workflow/runtime/actions/__tests__/actionOutputSchemaResolver.test.ts`
- Workflow designer data context / reference browsing:
  - `ee/server/src/components/workflow-designer/workflowDataContext.ts`
  - `ee/server/src/components/workflow-designer/workflowReferenceContext.ts`
  - `ee/server/src/components/workflow-designer/workflowReferenceOptions.ts`
- Existing BlockNote inline-content pattern:
  - `packages/ui/src/editor/Mention.tsx`
  - `packages/ui/src/editor/TextEditor.tsx`

## Design Notes

- Earlier brainstorming started with “ordered literal/reference segments”.
- Rich markdown authoring adds one more layer:
  - persisted model likely needs an Alga-owned block/inline template document rather than a flat segment array
  - runtime still emits plain markdown strings
- Keep the authoring model narrower than a general-purpose document editor.
- Good default markdown-safe subset for v1:
  - paragraphs
  - headings (possibly limited)
  - bullet/ordered lists
  - blockquote
  - code block
  - bold / italic / code / links
- Avoid underline-specific storage because it is not naturally markdown-native.

## Open Implementation Questions To Revisit

- Exact allowed markdown block subset for v1.
- Whether to expose explicit stable-key regeneration in the first UX pass.
- Whether to show serialized markdown preview in the editor or rely on the main WYSIWYG surface plus copy-path affordances.

## Validation / Commands

- Inspect existing transform action patterns:
  - `sed -n '1,430p' shared/workflow/runtime/actions/registerTransformActions.ts`
- Inspect dynamic output schema resolution:
  - `sed -n '1,220p' shared/workflow/runtime/actions/actionOutputSchemaResolver.ts`
- Inspect workflow reference-path assumptions:
  - `nl -ba ee/server/src/components/workflow-designer/workflowDataContext.ts | sed -n '406,417p'`
  - `nl -ba ee/server/src/components/workflow-designer/WorkflowActionInputSourceMode.tsx | sed -n '31,36p'`
- Inspect existing BlockNote inline content example:
  - `sed -n '1,80p' packages/ui/src/editor/Mention.tsx`

## Gotchas

- Do not promise “freeform runtime field names” unless the workflow reference grammar is expanded; current dot-path resolution does not support arbitrary string keys.
- Do not let BlockNote JSON become the persisted workflow contract just because it is convenient in the editor.
- Do not solve prompt composition only inside `ai.infer`; that would recreate the layering problem this plan is meant to avoid.
- Avoid making compose-text a generic expression engine; user explicitly wants simple references only in this phase.

## Implementation Log

- 2026-03-14: Completed runtime/schema milestone covering `F001`-`F005`, `F007`-`F011`, `F019`-`F025`.
  - Added shared compose-text runtime/model helpers in `shared/workflow/runtime/actions/composeText.ts`.
  - Registered `transform.compose_text` in `shared/workflow/runtime/actions/registerTransformActions.ts` with Transform metadata and broad string-record output validation.
  - Added `outputs` support plus compose-text config validation to `shared/workflow/runtime/nodes/registerDefaultNodes.ts`.
  - Extended runtime action execution context in `shared/workflow/runtime/registries/actionRegistry.ts` and `shared/workflow/runtime/runtime/workflowRuntimeV2.ts` so compose-text can resolve reference nodes against workflow context at execution time.
  - Extended config-derived output schema resolution in `shared/workflow/runtime/actions/actionOutputSchemaResolver.ts` and downstream vars typing in `ee/server/src/components/workflow-designer/workflowDataContext.ts`.
  - Exported compose-text helpers through `shared/workflow/runtime/index.ts` and `ee/packages/workflows/src/authoring/index.ts`.
- Decision: keep persisted compose-text outputs on `action.call` config as top-level `outputs`.
  - Rationale: this matches the PRD’s persisted config shape and keeps the stored contract independent from `inputMapping`.
  - Consequence: the runtime action reads `ctx.stepConfig.outputs`, and the generic `action.call` node schema now allows/validates `outputs` for compose-text steps.
- Decision: resolve compose-text references with a dedicated simple-path resolver instead of full expression evaluation.
  - Rationale: missing paths need deterministic “missing reference” semantics, while full expression evaluation converts `undefined` into a generic serialization error.
  - Consequence: reference nodes stay limited to simple workflow paths and fail with explicit output/reference context.
- Decision: spread `env.vars` into the action expression context root in `WorkflowRuntimeV2`.
  - Rationale: compose-text simple references and existing designer reference affordances both allow bare variable roots like loop item vars.
  - Consequence: action handlers can resolve `vars.*` and bare saved-variable roots from the same runtime context.

## Verification

- Runtime/unit tests:
  - `cd shared && pnpm vitest run workflow/runtime/actions/__tests__/composeText.test.ts workflow/runtime/actions/__tests__/registerTransformActions.test.ts workflow/runtime/actions/__tests__/actionOutputSchemaResolver.test.ts`
- Designer vars-context test:
  - `cd ee/server && pnpm vitest run src/components/workflow-designer/__tests__/workflowDataContext.test.ts`
- Targeted lint:
  - `pnpm eslint shared/workflow/runtime/actions/composeText.ts shared/workflow/runtime/actions/registerTransformActions.ts shared/workflow/runtime/actions/actionOutputSchemaResolver.ts shared/workflow/runtime/registries/actionRegistry.ts shared/workflow/runtime/runtime/workflowRuntimeV2.ts shared/workflow/runtime/nodes/registerDefaultNodes.ts ee/server/src/components/workflow-designer/workflowDataContext.ts shared/workflow/runtime/actions/__tests__/composeText.test.ts shared/workflow/runtime/actions/__tests__/registerTransformActions.test.ts shared/workflow/runtime/actions/__tests__/actionOutputSchemaResolver.test.ts ee/server/src/components/workflow-designer/__tests__/workflowDataContext.test.ts`
  - Result: warnings only from pre-existing broad files; no new eslint errors in the touched code.

## Implementation Log Continued

- 2026-03-14: Completed designer/editor milestone covering `F006`, `F012`-`F018`, `F026`-`F028`.
  - Added `ee/server/src/components/workflow-designer/workflowComposeTextUtils.ts` for empty-output creation, stable-key/reference-path helpers, template-document serialization/hydration, and shared authoring validation.
  - Added `ee/server/src/components/workflow-designer/WorkflowComposeTextDocumentEditor.tsx` as a constrained BlockNote authoring surface with a custom inline `workflowReference` chip and a markdown-safe schema subset only.
  - Added `ee/server/src/components/workflow-designer/WorkflowComposeTextSection.tsx` as the dedicated compose-text action editor with output list management, label/key controls, copyable downstream paths, inline validation, and reference insertion from `SourceDataTree`.
  - Wired the dedicated section into `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx` so compose-text remains action-specific and ordinary consumer fields continue using the existing generic reference mode.
  - Updated `ee/server/src/components/workflow-designer/workflowReferenceOptions.ts` so downstream browsing keeps stable-key paths while surfacing author-facing output labels.
  - Updated `ee/server/src/components/workflow-designer/groupedActionSelection.ts` so switching grouped action types clears stale AI-only and compose-text-only config payloads deterministically.
- Decision: expose manual stable-key editing plus an explicit regenerate affordance, but keep label edits non-destructive by default.
  - Rationale: downstream references must stay stable across label changes, yet authors still need a recovery path when the generated key is poor.
  - Consequence: the UI treats label and stable key as separate fields and only regenerates the key on deliberate author action.
- Decision: keep reference insertion constrained to the existing workflow source browser instead of supporting arbitrary inline path typing in the editor.
  - Rationale: that preserves the “simple references only” scope, reuses existing browsing UX, and avoids inventing a second validation path.
  - Consequence: invalid reference insertion is limited mostly to unsupported editor locations such as code blocks, which now produce explicit authoring feedback.

- 2026-03-14: Completed test milestone covering `T005`, `T011`-`T013`, `T024`, `T026`-`T044`.
  - Added `ee/server/src/components/workflow-designer/__tests__/workflowComposeTextUtils.test.ts` for stable-key preservation, template serialization/hydration, schema-subset enforcement, and persisted-config regression coverage.
  - Added `ee/server/src/components/workflow-designer/__tests__/WorkflowComposeTextSection.test.tsx` for multi-output list UX, add/reorder flows, key/path display, reference insertion/removal serialization, and inline validation coverage.
  - Added `ee/server/src/components/workflow-designer/__tests__/WorkflowComposeTextDocumentEditor.test.tsx` for inline reference insertion and unsupported BlockNote-affordance removal.
  - Extended `shared/workflow/runtime/actions/__tests__/actionOutputSchemaResolver.test.ts` for config-derived schema updates when output labels change but stable keys do not.
  - Extended `ee/server/src/components/workflow-designer/__tests__/groupedActionSelection.test.ts` and `workflowReferenceOptions.test.ts` for grouped-action cleanup and author-label reference browsing behavior.
  - Existing runtime registration/execution tests plus downstream vars-context tests now cover the ordinary-reference integration path for AI/email-like consumers without any consumer-specific compose-text wiring.

- Additional targeted verification:
  - `npx vitest run --config shared/vitest.config.ts shared/workflow/runtime/actions/__tests__/composeText.test.ts shared/workflow/runtime/actions/__tests__/registerTransformActions.test.ts shared/workflow/runtime/actions/__tests__/actionOutputSchemaResolver.test.ts`
  - `npx vitest run --config vitest.config.ts src/components/workflow-designer/__tests__/workflowDataContext.test.ts src/components/workflow-designer/__tests__/workflowReferenceOptions.test.ts src/components/workflow-designer/__tests__/groupedActionSelection.test.ts src/components/workflow-designer/__tests__/workflowComposeTextUtils.test.ts src/components/workflow-designer/__tests__/WorkflowComposeTextSection.test.tsx src/components/workflow-designer/__tests__/WorkflowComposeTextDocumentEditor.test.tsx src/components/workflow-designer/__tests__/WorkflowDesigner.smoke.test.tsx`
  - `cd ee/packages/workflows && npx vitest run src/authoring/__tests__/composeTextAuthoring.test.ts --coverage.enabled false`
  - Result: all targeted compose-text runtime and designer tests passed.

- 2026-03-14: Folded package-level authoring helpers into the final checkpoint.
  - Kept `ee/packages/workflows/src/authoring/composeTextAuthoring.ts` exported from `ee/packages/workflows/src/authoring/index.ts` so non-server authoring consumers can use the same compose-text helper/model conversions.
  - Verified `ee/packages/workflows/src/authoring/__tests__/composeTextAuthoring.test.ts` passes from the package root.
