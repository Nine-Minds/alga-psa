# Scratchpad — Workflow JSON Transform + AI-Assisted Authoring

- Plan slug: `2026-05-09-workflow-json-transform-ai-authoring`
- Created: `2026-05-09`

## What This Is

Working notes for adding deterministic JSON Transform actions and AI-assisted authoring through existing Quick Ask.

## Decisions

- (2026-05-09) Start with JSON from workflow values or static literals only. No URL/file/blob loading in Transform actions.
- (2026-05-09) Do not build a visual mapper for this phase. Use deterministic JSONata-based actions and teach existing Alga AI/Quick Ask how to help users write expressions.
- (2026-05-09) JSON Transform runtime must be independent of AI. AI only helps author expressions/configuration.
- (2026-05-09) Keep JSON transforms in the existing `action.call` + Transform action model rather than adding a new node type.
- (2026-05-09) Use existing AI entitlement and feature gating for Quick Ask / optional Ask AI trigger. Do not gate the JSON Transform actions themselves behind AI.

## Discoveries / Constraints

- (2026-05-09) Transform actions live in `shared/workflow/runtime/actions/registerTransformActions.ts` and are pure, non-side-effectful actions registered in the ActionRegistry.
- (2026-05-09) `action.call` resolves input mappings, calls the action registry, and saves outputs through `saveAs` using `applyAssignments` in `shared/workflow/runtime/nodes/registerDefaultNodes.ts`.
- (2026-05-09) Existing expression engine uses JSONata in `shared/workflow/runtime/expressionEngine.ts`, with allow-listed functions, timeout checks, JSON-serializable result checks, and max output size checks.
- (2026-05-09) Dynamic action output schemas already have precedents in `ai.infer` and `transform.compose_text` via `shared/workflow/runtime/actions/actionOutputSchemaResolver.ts`, but JSON mapper MVP can use static wrapper outputs.
- (2026-05-09) Quick Ask is already gated by `aiAssistant` feature and `ADD_ONS.AI_ASSISTANT` in layout/chat routes. Optional Ask AI trigger should reuse this instead of introducing a new AI surface.
- (2026-05-09) Potential gotcha: input mapping can resolve `$secret` into action args, and `saveAs` could store parsed secret content into workflow state. Need to document or guard this before encouraging secret-backed JSON parsing.
- (2026-05-09) Git metadata for this worktree appears unhealthy: `git status --short` failed with `fatal: not a git repository: /Users/roberisaacs/alga-psa/.git/worktrees/support-regex-workflows`.

## Commands / Runbooks

- (2026-05-09) Relevant files inspected:
  - `shared/workflow/runtime/actions/registerTransformActions.ts`
  - `shared/workflow/runtime/expressionEngine.ts`
  - `shared/workflow/runtime/utils/mappingResolver.ts`
  - `shared/workflow/runtime/actions/actionOutputSchemaResolver.ts`
  - `shared/workflow/runtime/designer/actionCatalog.ts`
  - `shared/workflow/runtime/nodes/registerDefaultNodes.ts`
  - `ee/server/src/services/chatCompletionsService.ts`
  - `ee/server/src/components/chat/QuickAskOverlay.tsx`
  - `server/src/components/layout/DefaultLayout.tsx`
  - `packages/types/src/constants/addOns.ts`

## Links / References

- Plan PRD: `ee/docs/plans/2026-05-09-workflow-json-transform-ai-authoring/PRD.md`
- Feature checklist: `ee/docs/plans/2026-05-09-workflow-json-transform-ai-authoring/features.json`
- Test checklist: `ee/docs/plans/2026-05-09-workflow-json-transform-ai-authoring/tests.json`

## Open Questions

- Include `transform.stringify_json` in the first implementation or defer?
- Add optional defaults to `transform.query_json`, or rely on JSONata/coalesce patterns?
- Include optional Ask AI trigger in first implementation, or ship runtime actions + prompt update first?
- What existing UI context can Quick Ask see from the workflow designer without new plumbing?

## Implementation Updates (2026-05-09)

- Added `transform.parse_json`, `transform.query_json`, and `transform.stringify_json` to `shared/workflow/runtime/actions/registerTransformActions.ts`.
- `transform.parse_json` behavior:
  - Parses JSON strings to typed values.
  - Passes through plain literal objects/arrays unchanged.
  - Returns `{ value, type }` where `type` is one of `object|array|string|number|boolean|null`.
  - Throws actionable `JSON parse failed: ...` errors for invalid JSON and unsupported inputs.
- `transform.query_json` behavior:
  - Evaluates JSONata expression from `expression` against `source` and returns `{ value }`.
  - Uses existing safe expression engine path via `compileExpression`.
  - Exposes `source` and preserves workflow expression context (`payload`, `vars`, `meta`, `error`) through handler context merge.
  - Distinguishes error class in messages:
    - `JSON query expression validation failed: ...`
    - `JSON query expression evaluation failed: ...`
- `transform.stringify_json` behavior:
  - Serializes JSON-compatible values to `{ text }`.
  - Supports optional pretty spacing (`0..8`).
  - Throws `JSON stringify failed: ...` on non-serializable inputs.
- Added reusable expression helper `evaluateExpressionSource(source, ctx, timeoutMs?)` in `shared/workflow/runtime/expressionEngine.ts`.

## AI Guidance Updates (2026-05-09)

- Added `ee/server/src/services/chatWorkflowJsonTransformGuidance.ts` and injected guidance into Quick Ask system prompt in `ee/server/src/services/chatCompletionsService.ts`.
- Guidance explicitly includes:
  - Action names (`transform.parse_json`, `transform.query_json`, `transform.stringify_json`).
  - JSONata examples (extract, object construction, coalesce, array filter/map).
  - Where to paste expression (`transform.query_json.inputMapping.expression`).
  - `saveAs` patterns for `payload/vars`.
  - Deterministic runtime statement that AI does not execute inside workflow runtime.
  - Security warning about persisting secret-derived parsed JSON into workflow state.

## Tests Added/Updated (2026-05-09)

- Updated: `shared/workflow/runtime/actions/__tests__/registerTransformActions.test.ts`
  - Added parse/query/stringify happy-path and failure-path coverage.
  - Added schema metadata checks for new actions.
- Added: `shared/workflow/runtime/nodes/__tests__/actionCallTransformJsonSaveAsRuntime.test.ts`
  - Validates `action.call` + `saveAs` + downstream expression mapping integration.
- Updated: `shared/workflow/runtime/__tests__/expressionEngine.test.ts`
  - Added custom-context helper test for `evaluateExpressionSource`.
- Added: `ee/server/src/services/__tests__/chatWorkflowJsonTransformGuidance.test.ts`
  - Validates guidance content coverage and deterministic-runtime messaging.

## Runbook / Commands (2026-05-09)

- Test command used:
  - `npx vitest run --config vitest.json-transform.config.mts`
- Note: root/server Vitest config include globs do not include `shared/workflow/runtime/**` by default, so a local targeted config was used to execute these tests in one run.

## Optional Ask AI Trigger Decision (2026-05-09)

- Deferred for this PRD slice; no new trigger UI introduced.
- Existing Quick Ask entitlement gating remains unchanged (AI add-on + feature access checks remain existing behavior).

## Review Fixes (2026-05-09)

- Replaced bare `z.unknown()` JSON action source/value schemas with a recursive JSON value schema so required fields are enforced by Zod and emitted in JSON Schema.
- Added JSON transform schema regression assertions for missing `source`/`value` fields.
- Moved the Quick Ask JSON guidance unit test from `ee/server/src/services/__tests__` to `ee/server/src/__tests__/services` so it is included by `ee/server/vitest.config.ts`.
- Corrected plan checklist state: optional Ask AI trigger features/tests are deferred, not implemented.
- Reverted unrelated `package-lock.json` changes.

## Validation (2026-05-09 Review Fixes)

- `npx vitest run --config shared/vitest.config.ts workflow/runtime/actions/__tests__/registerTransformActions.test.ts workflow/runtime/__tests__/expressionEngine.test.ts workflow/runtime/nodes/__tests__/actionCallTransformJsonSaveAsRuntime.test.ts`
  - Passed: 3 files, 15 tests.
- `cd ee/server && npx vitest run --config vitest.config.ts src/__tests__/services/chatWorkflowJsonTransformGuidance.test.ts`
  - Passed: 1 file, 2 tests.

## Review Fix Follow-up (2026-05-09)

- Fixed `transform.parse_json` numeric overflow handling: JSON strings such as `1e999` now fail with `JSON parse failed: parsed value is not a finite JSON value` instead of returning `Infinity` and failing later during output validation.
- Added regression coverage for JSON numeric overflow.

## Validation (2026-05-09 Numeric Overflow Fix)

- `npx vitest run --config shared/vitest.config.ts workflow/runtime/actions/__tests__/registerTransformActions.test.ts workflow/runtime/__tests__/expressionEngine.test.ts workflow/runtime/nodes/__tests__/actionCallTransformJsonSaveAsRuntime.test.ts`
  - Passed: 3 files, 15 tests.
