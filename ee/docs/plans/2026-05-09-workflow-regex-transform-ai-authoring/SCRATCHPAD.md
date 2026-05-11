# Scratchpad — Workflow Regex Transform + AI-Assisted Authoring

- Plan slug: `2026-05-09-workflow-regex-transform-ai-authoring`
- Created: `2026-05-09`

## What This Is

Working notes for adding deterministic regex parsing/extraction/replacement Transform actions to the workflow system, modeled after the workflow JSON transform feature.

## Decisions

- (2026-05-09) Mirror the JSON transform lane: pure Transform actions, normal `action.call`, normal `saveAs`, deterministic runtime, and optional Quick Ask authoring help.
- (2026-05-09) Start with JavaScript RegExp syntax because the runtime is TypeScript/Node and workflow authors will paste JavaScript-style patterns/flags.
- (2026-05-09) MVP actions should be `transform.regex_match`, `transform.regex_extract`, and `transform.regex_replace`.
- (2026-05-09) Regex support must include guardrails for invalid patterns, unsupported flags, input length, match count, and pathological patterns where feasible. Regex execution is not safely interruptible once started in plain JS.
- (2026-05-09) Regex transform actions are not AI-gated. AI guidance remains gated by existing Quick Ask/AI Assistant entitlement.

## Discoveries / Constraints

- (2026-05-09) Existing transform actions live in `shared/workflow/runtime/actions/registerTransformActions.ts`.
- (2026-05-09) The JSON feature background indicates related editor/runtime surfaces now include `WorkflowDesigner.tsx`, `actionInputEditorState.ts`, `workflowDataContext.ts`, `WorkflowStepSaveOutputSection.tsx`, `workflowSaveAsPath.ts`, `workflowRunDisplayError.ts`, `WorkflowRunDetailsPanel.tsx`, `chatWorkflowJsonTransformGuidance.ts`, `Header.tsx`, `QuickAskContext.tsx`, and `InputMappingEditor.tsx`.
- (2026-05-09) Current expression editor already documents JSONata regex functions, but workflow Transform actions should not rely on users writing JSONata regex syntax for common parse/extract/replace tasks.
- (2026-05-09) There is unrelated untracked work in `packages/core/src/rateLimit/` at plan creation time; do not include it in this plan.

## Commands / Runbooks

- (2026-05-09) Context checks used:
  - `rg -n "regex|regexp|replace_text|matches|pattern|flags" shared/workflow/runtime ee/server/src/components/workflow-designer ee/packages/workflows/src/actions`
  - Read JSON transform plan at `ee/docs/plans/2026-05-09-workflow-json-transform-ai-authoring/`.

## Links / References

- Prior JSON feature plan: `ee/docs/plans/2026-05-09-workflow-json-transform-ai-authoring/`
- Planned PRD: `ee/docs/plans/2026-05-09-workflow-regex-transform-ai-authoring/PRD.md`
- Planned feature checklist: `ee/docs/plans/2026-05-09-workflow-regex-transform-ai-authoring/features.json`
- Planned test checklist: `ee/docs/plans/2026-05-09-workflow-regex-transform-ai-authoring/tests.json`

## Open Questions

- Should `transform.regex_extract` infer named capture output fields from named groups in the pattern for downstream references, or expose a stable generic `matches` array only in the first slice?
- Should we add a safe-regex dependency/static heuristic, or only enforce length/match-count limits for MVP?
- Should replacement support JavaScript replacement tokens (`$1`, `$<name>`, `$$`) exactly, or also offer a literal replacement mode?
- Should no-match extraction be success with empty results by default, or should there be a configurable `requireMatch` failure mode?

## 2026-05-10 Implementation Notes

### Decisions

- Added first-class `transform.regex_match`, `transform.regex_extract`, and `transform.regex_replace` inside `shared/workflow/runtime/actions/registerTransformActions.ts` using pure transform semantics (`sideEffectful: false`, engine idempotency).
- Used JavaScript `RegExp` runtime behavior directly and documented replacement-token support (`$1`, `$2`, `$<name>`, `$$`) in both runtime schema descriptions and Quick Ask guidance.
- `regex_extract` uses a deterministic bounded collector capped by `maxMatches`; it does not throw merely because more matches exist in source text. It throws when configured limits are invalid (e.g. `maxMatches` above system limit).
- Added explicit guardrails: max text length (`100000`), max pattern length (`2000`), max `maxMatches` input (`1000`), duplicate/unsupported flag validation, invalid pattern validation, and zero-width match progression protections.

### Key Files Changed

- `shared/workflow/runtime/actions/registerTransformActions.ts`
- `shared/workflow/runtime/actions/__tests__/registerTransformActions.test.ts`
- `shared/workflow/runtime/nodes/__tests__/actionCallTransformRegexSaveAsRuntime.test.ts`
- `ee/server/src/services/chatWorkflowRegexTransformGuidance.ts`
- `ee/server/src/__tests__/services/chatWorkflowRegexTransformGuidance.test.ts`
- `ee/server/src/services/chatCompletionsService.ts`
- `ee/server/src/components/workflow-run-studio/__tests__/workflowRunDisplayError.test.ts`
- `ee/server/src/components/workflow-designer/mapping/InputMappingEditor.tsx`
- `ee/server/src/components/workflow-designer/__tests__/TransformActionInputEditor.test.tsx`
- `ee/server/src/components/workflow-designer/__tests__/workflowDataContext.test.ts`

### Validation Commands

- `pnpm -s vitest run -c vitest.config.ts workflow/runtime/actions/__tests__/registerTransformActions.test.ts workflow/runtime/nodes/__tests__/actionCallTransformRegexSaveAsRuntime.test.ts` (from `shared/`)
- `pnpm -s vitest run src/components/workflow-run-studio/__tests__/workflowRunDisplayError.test.ts src/__tests__/services/chatWorkflowRegexTransformGuidance.test.ts src/components/workflow-designer/__tests__/workflowDataContext.test.ts` (from `ee/server/`)

### Gotchas

- `ee/server/src/components/workflow-designer/__tests__/TransformActionInputEditor.test.tsx` currently depends on broader module resolution that can fail in isolated runs due unresolved `@alga-psa/reference-data/actions` in this environment; targeted suites above were run successfully.


## Review Fixes (2026-05-10)

- Fixed `InputMappingEditor` regex action detection by moving the regex action-id helper to module scope so both field editor render paths can use it safely.
- Made regex `text` inputs required with a finite primitive text-source schema instead of bare `z.unknown()`, so missing text fails validation and JSON Schema marks it required.
- Reset regex state before replacement after match counting so sticky (`y`) regex replacements do not report a replacement count without changing text.
- Added regression coverage for required regex text inputs and sticky first-only replacement.
- Stabilized the workflow transform component test environment by mocking server-side action dependencies and patching React.act compatibility for this workspace's React/testing-library combination.

## Validation (2026-05-10 Review Fixes)

- `npx vitest run --config shared/vitest.config.ts workflow/runtime/actions/__tests__/registerTransformActions.test.ts workflow/runtime/nodes/__tests__/actionCallTransformRegexSaveAsRuntime.test.ts`
  - Passed: 2 files, 11 tests.
- `cd ee/server && npx vitest run --config vitest.config.ts src/__tests__/services/chatWorkflowRegexTransformGuidance.test.ts src/components/workflow-designer/__tests__/TransformActionInputEditor.test.tsx src/components/workflow-designer/__tests__/workflowDataContext.test.ts src/components/workflow-run-studio/__tests__/workflowRunDisplayError.test.ts`
  - Passed: 4 files, 28 tests.
