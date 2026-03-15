# Scratchpad — Workflow AI Inference Step

- Plan slug: `workflow-ai-inference-step`
- Created: `2026-03-14`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also update earlier notes when a decision changes.

## Decisions

- (2026-03-14) Model AI inference as a new grouped `action.call` action rather than a brand-new workflow node type. This reuses palette insertion, save-as handling, runtime execution, and most designer plumbing.
- (2026-03-14) Store AI output schemas inline per step instead of through schema refs in v1.
- (2026-03-14) Default schema authoring to a simple builder rooted at `type: object`, with advanced raw JSON Schema as an escape hatch.
- (2026-03-14) V1 simple mode only supports a constrained JSON Schema subset: primitive fields, nested objects, arrays of primitives, arrays of objects, required flags, and descriptions.
- (2026-03-14) V1 uses the existing app-level OpenAI-compatible provider resolution and does not add per-step provider or model selection.
- (2026-03-14) Preserve advanced-mode raw JSON text separately as `aiOutputSchemaText` so advanced-only schemas round-trip without lossy reformatting, while still caching parsed JSON in `aiOutputSchema` when valid.
- (2026-03-14) Reuse the normal `action.call` Zod passthrough object output contract for runtime storage safety and let the inference service own strict inline-schema validation.
- (2026-03-14) Factor publish-time output typing through a shared `resolveActionCallOutputSchema` helper so AI steps use inline schemas and non-AI steps continue using registry output schemas.

## Discoveries / Constraints

- (2026-03-14) Workflow Designer already centers grouped business and transform steps on `action.call`; grouped tiles are catalog-driven from `shared/workflow/runtime/designer/actionCatalog.ts`.
- (2026-03-14) Downstream `vars.<saveAs>` typing in the designer currently comes from action-registry output schemas, with transform actions as the existing precedent for per-step dynamic output-schema inference in `ee/server/src/components/workflow-designer/workflowDataContext.ts`.
- (2026-03-14) Publish-time best-effort typing in `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts` also assumes registry-level static output schemas, so AI support needs an override seam there as well.
- (2026-03-14) Runtime `action.call` already validates both action input and action output via Zod in `shared/workflow/runtime/runtime/workflowRuntimeV2.ts`.
- (2026-03-14) Current server-side AI infrastructure has provider resolution in `ee/server/src/services/chatProviderResolver.ts`, but no reusable structured-output inference service yet.
- (2026-03-14) Existing chat services use OpenAI-compatible chat completions, but not JSON-schema structured-output helpers yet.
- (2026-03-14) Workflow bundle dependency logic is action/node oriented; inline AI schemas should avoid introducing new schema-ref dependencies if kept fully inline.
- (2026-03-14) `action.call` needed a `stepConfig` handoff from node execution into action handlers so `ai.infer` can read inline schema config at runtime without introducing a new node type.
- (2026-03-14) The cleanest reusable server-side inference seam lives in `packages/ee/src/services/workflowInferenceService.ts`, with `ee/server/src/services/workflowInferenceService.ts` as a thin re-export for server imports.
- (2026-03-14) Bundle import/export already preserves arbitrary step config verbatim; AI bundle work only needed tests plus a guard that dependency summaries do not treat inline AI schemas as schema refs.
- (2026-03-14) Server integration suites in this repo are noisy and some broader publish tests already fail for unrelated reasons, so AI verification is more reliable when run as focused `vitest -t ... --coverage.enabled=false` slices.

## Commands / Runbooks

- (2026-03-14) Inventory workflow designer/runtime seams:
  - `rg -n "action.call|outputSchema|saveAs|designer-catalog|workflowDataContext" ee/server/src/components/workflow-designer ee/packages/workflows/src/actions shared/workflow/runtime`
- (2026-03-14) Inventory current AI provider infrastructure:
  - `rg -n "chatProviderResolver|chat.completions.create|response_format|json_schema" ee/server/src/services ee/server/src/models`
- (2026-03-14) Focused shared/runtime verification:
  - `npx vitest run --config shared/vitest.config.ts shared/workflow/runtime/actions/__tests__/actionOutputSchemaResolver.test.ts shared/workflow/runtime/actions/__tests__/registerAiActions.test.ts shared/workflow/runtime/ai/__tests__/aiSchema.test.ts packages/ee/src/services/__tests__/workflowInferenceService.test.ts`
- (2026-03-14) Focused designer verification:
  - `cd ee/server && npx vitest run --config vitest.config.ts src/components/workflow-designer/__tests__/WorkflowActionInputSection.test.tsx src/components/workflow-designer/__tests__/WorkflowAiSchemaSection.test.tsx src/components/workflow-designer/__tests__/workflowReferenceOptions.test.ts src/components/workflow-designer/__tests__/workflowReferenceContext.test.ts src/components/workflow-designer/__tests__/workflowAiStepUtils.test.ts src/components/workflow-designer/__tests__/workflowDataContext.test.ts src/components/workflow-designer/__tests__/ActionSchemaReference.test.tsx src/components/workflow-designer/__tests__/groupedActionStep.test.ts`
- (2026-03-14) Focused server verification:
  - `cd server && npx vitest run --config vitest.config.ts --coverage.enabled=false src/test/unit/workflowRuntimeV2.unit.test.ts -t 'T027|T028|T029'`
  - `cd server && npx vitest run --config vitest.config.ts --coverage.enabled=false src/test/integration/workflowRuntimeV2.publish.integration.test.ts -t 'T041|T042'`
  - `cd server && npx vitest run --config vitest.config.ts --coverage.enabled=false src/test/integration/workflowDesignerGroupedPersistence.integration.test.ts -t 'T008/T020/T031'`
  - `cd server && npx vitest run --config vitest.config.ts --coverage.enabled=false src/test/integration/workflowBundleV1.importExport.integration.test.ts -t 'T032/T033/T045'`

## Links / References

- Designer entrypoint: [WorkflowDesigner.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/server/src/components/workflow-designer/WorkflowDesigner.tsx)
- Designer data context: [workflowDataContext.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/server/src/components/workflow-designer/workflowDataContext.ts)
- Grouped step helper: [groupedActionStep.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/server/src/components/workflow-designer/groupedActionStep.ts)
- Action registry: [actionRegistry.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/shared/workflow/runtime/registries/actionRegistry.ts)
- Runtime init: [init.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/shared/workflow/runtime/init.ts)
- Runtime execution: [workflowRuntimeV2.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/shared/workflow/runtime/runtime/workflowRuntimeV2.ts)
- Publish / registry server actions: [workflow-runtime-v2-actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts)
- Provider resolver: [chatProviderResolver.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/server/src/services/chatProviderResolver.ts)
- AI schema helpers: [aiSchema.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/shared/workflow/runtime/ai/aiSchema.ts)
- AI action registration: [registerAiActions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/shared/workflow/runtime/actions/registerAiActions.ts)
- Publish-time output typing helper: [actionOutputSchemaResolver.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/shared/workflow/runtime/actions/actionOutputSchemaResolver.ts)
- Inference service: [workflowInferenceService.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/packages/ee/src/services/workflowInferenceService.ts)
- AI schema panel: [WorkflowAiSchemaSection.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/server/src/components/workflow-designer/WorkflowAiSchemaSection.tsx)
- Recent analogous workflow-designer plan: [PRD.md](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/docs/plans/2026-03-13-workflow-designer-grouped-palette-inline-inputs-transform-actions/PRD.md)

## Open Questions

- How much of advanced JSON Schema should be accepted for v1 when provider behavior differs between OpenRouter and Vertex?
- Should advanced mode preserve raw JSON text formatting, or is parsed-and-normalized JSON acceptable?
- Should the AI action eventually expose optional system instructions or sampling controls in a follow-up?
