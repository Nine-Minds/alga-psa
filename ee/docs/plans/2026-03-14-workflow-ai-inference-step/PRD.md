# PRD — Workflow AI Inference Step

- Slug: `workflow-ai-inference-step`
- Date: `2026-03-14`
- Status: Draft

## Summary

Add a first-class AI inference step to Workflow V2 using the existing `action.call` architecture. The new step will let workflow authors provide a prompt and define an inline per-step JSON Schema for the model output. That output schema must be available to downstream steps exactly like any other saved step result through `vars.<saveAs>`.

V1 should optimize for the common case: authors primarily use a simple structured schema builder rooted at an object, while advanced users may switch to raw JSON Schema editing. Runtime execution should reuse the current OpenAI-compatible provider infrastructure and request schema-constrained structured outputs instead of freeform text.

## Problem

Workflow V2 can already orchestrate typed business actions and transform steps, but it cannot ask an AI model to produce structured data that later steps can consume safely. Teams that want classification, extraction, summarization-into-fields, or light decision support currently have to leave the workflow system or fall back to untyped text outputs that do not integrate well with mapping, autocomplete, or downstream validation.

The current runtime and designer also assume that a step's output schema is mostly fixed at action-registration time. That works for normal actions, but it breaks down for AI inference because the useful output shape is defined by the workflow author per step.

## Goals

- Add a new AI grouped action to Workflow Designer, implemented on top of `action.call`.
- Let authors provide a prompt string for inference using the existing action input authoring model.
- Let authors define an inline per-step output schema.
- Provide a simple schema-builder experience for common object-shaped outputs.
- Preserve an advanced raw JSON Schema escape hatch for complex cases.
- Make the resolved AI output schema available to downstream mapping, reference browsing, and expression autocomplete through normal `vars.<saveAs>` behavior.
- Reuse the existing OpenAI-compatible provider infrastructure rather than introducing a second AI integration stack.
- Validate model output against the declared schema before it becomes workflow state.
- Preserve compatibility with existing non-AI workflows and existing `action.call` execution semantics.

## Non-goals

- Introducing a brand-new workflow node type for AI in v1.
- Supporting schema refs or reusable shared output-schema libraries in v1.
- Supporting root-level non-object schemas in the simple builder.
- Supporting full arbitrary JSON Schema round-tripping in the simple builder.
- Adding multi-turn chat, streaming output, tool-calling, or agentic behavior.
- Adding per-step provider or model selection in v1.
- Adding tenant-specific AI provider credential selection in v1.
- Building a generic JSON Schema authoring framework for the whole product.
- New observability platforms, rollout infrastructure, or feature-flag work beyond what the workflow system already uses.

## Users and Primary Flows

1. Workflow author adds an AI step
- User opens Workflow Designer.
- User drags an `AI` tile into the workflow.
- The inserted step is an `action.call` step scoped to the AI group.
- The properties panel shows the selected AI inference action, prompt input, save-as controls, and output schema section.

2. Workflow author defines a simple structured output
- User keeps schema mode on `Simple`.
- User adds fields like `summary`, `sentiment`, or `next_action`.
- User marks fields as required, chooses primitive types, and optionally nests objects or arrays.
- The designer generates inline JSON Schema automatically.
- Downstream steps can browse those fields through `vars.<saveAs>`.

3. Workflow author defines a more complex schema
- User switches schema mode to `Advanced`.
- User edits raw JSON Schema directly.
- The designer validates the schema, shows errors if unsupported or invalid, and uses the resolved schema for downstream typing when valid.

4. Workflow author references workflow data in the prompt
- User configures the prompt through the existing action input editor.
- Prompt values may use references or advanced expressions just like other action inputs.
- Published workflow runs resolve the prompt from the current workflow context at runtime.

5. Workflow author edits an existing AI step
- User reopens a workflow draft or published version.
- If the saved schema fits the supported simple-builder subset, the simple builder rehydrates.
- If not, the designer opens the step in advanced mode and preserves the raw schema without data loss.

## UX / UI Notes

- Add an `AI` grouped tile in the workflow palette alongside the existing grouped business and transform tiles.
- The inserted AI step should continue to be represented as `action.call` for runtime compatibility.
- Reuse the existing right-side properties panel structure:
  - grouped action selector
  - step save/output section
  - prompt/input authoring via the existing action input section
  - AI-specific output schema section
  - schema preview/reference section
- The output schema section should offer two modes:
  - `Simple`
  - `Advanced`
- `Simple` mode constraints for v1:
  - root schema is always `type: object`
  - supported field types: `string`, `number`, `integer`, `boolean`, `object`, `array`
  - arrays may be arrays of primitives or arrays of objects
  - fields may include description and required state
  - no `oneOf`, `anyOf`, `$ref`, tuple arrays, or map-style schemas in simple mode
- `Advanced` mode should expose raw JSON Schema editing with inline validation.
- The designer should show the resolved output schema preview that will drive downstream typing, not just the static registry schema for the AI action.
- If an advanced schema cannot be represented in simple mode, the designer should say so explicitly instead of attempting a lossy conversion.

## Requirements

### Functional Requirements

- Add a new AI grouped action record to the workflow designer catalog.
- Register a new workflow action, such as `ai.infer`, in the shared Workflow V2 action registry.
- Keep AI inference modeled as `action.call`; do not introduce a separate `Step['type']` in v1.
- The AI action must accept a prompt input authored through the existing action input mapping model.
- The AI step must persist an inline output schema in step config rather than through schema refs.
- The AI step must persist which authoring mode the designer is using for the output schema.
- The designer must provide a simple schema builder for object-rooted output schemas.
- The simple schema builder must support:
  - top-level fields
  - primitive field types
  - required flags
  - field descriptions
  - nested objects
  - arrays of primitives
  - arrays of objects
- The designer must derive canonical JSON Schema from the simple builder and store that JSON inline on the step.
- The designer must provide an advanced raw JSON Schema editor as an escape hatch.
- The designer must be able to rehydrate simple mode from saved inline schemas when the schema stays within the supported subset.
- The designer must gracefully fall back to advanced mode when a saved schema is outside the supported simple-builder subset.
- The resolved AI output schema must drive:
  - downstream reference browsing
  - expression autocomplete
  - type compatibility checks for later mappings
  - schema preview in the properties panel
- Publish validation must reject invalid or unsupported inline AI schemas.
- Publish-time downstream typing logic must use the resolved per-step AI schema instead of only the static action-registry output schema.
- Runtime inference must use the current OpenAI-compatible provider infrastructure already used by the product.
- Runtime inference must submit a structured-output request that uses the step's inline JSON Schema as the output contract.
- Runtime inference must validate returned model output against the declared schema before storing it.
- AI inference failures must surface as structured workflow runtime failures consistent with the existing action error model.
- AI outputs saved with `saveAs` must be available to later steps exactly like other step outputs.
- Workflow save/load, publish, import/export, and bundle serialization must preserve the inline AI schema config.
- Existing workflows and non-AI grouped actions must remain compatible.

### Non-functional Requirements

- Reuse the current provider resolution and OpenAI client infrastructure instead of introducing a parallel AI stack.
- Keep the AI step within the existing `action.call` runtime and persistence model.
- Preserve deterministic downstream typing based on the resolved inline schema for a given workflow definition version.
- Simple-mode authoring should not require users to write JSON for common extraction/classification schemas.
- Advanced-mode authoring should preserve raw schema text or JSON structure without lossy transformations.

## Data / API / Integrations

- Designer catalog:
  - extend [actionCatalog.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/shared/workflow/runtime/designer/actionCatalog.ts) with an AI grouped record
- Shared runtime:
  - register the AI action from `shared/workflow/runtime/actions/`
  - wire registration through [init.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/shared/workflow/runtime/init.ts)
- Workflow designer:
  - extend [WorkflowDesigner.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/server/src/components/workflow-designer/WorkflowDesigner.tsx)
  - extend [workflowDataContext.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/server/src/components/workflow-designer/workflowDataContext.ts)
  - extend [ActionSchemaReference.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/server/src/components/workflow-designer/ActionSchemaReference.tsx)
- Publish / registry projection:
  - extend [workflow-runtime-v2-actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts)
- Runtime execution:
  - reuse [workflowRuntimeV2.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/shared/workflow/runtime/runtime/workflowRuntimeV2.ts)
  - add a new server-side inference service in `ee/server/src/services/`
- AI provider plumbing:
  - reuse [chatProviderResolver.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/server/src/services/chatProviderResolver.ts)

Suggested step-config shape, subject to implementation details:

```json
{
  "actionId": "ai.infer",
  "version": 1,
  "saveAs": "classificationResult",
  "inputMapping": {
    "prompt": {
      "$expr": "payload.message"
    }
  },
  "aiOutputSchemaMode": "simple",
  "aiOutputSchema": {
    "type": "object",
    "properties": {
      "category": { "type": "string" },
      "confidence": { "type": "number" }
    },
    "required": ["category"]
  }
}
```

## Security / Permissions

- Existing workflow read/write/publish permissions should continue to govern who can configure AI steps.
- V1 uses the current app-level provider configuration; there is no per-tenant provider selection in this scope.
- Prompt values continue to flow through the existing workflow action input-resolution model, including current secret-reference behavior.
- AI output schema validation must prevent malformed or unsupported schemas from reaching runtime execution.

## Observability

- Reuse existing workflow action invocation and run-log infrastructure.
- No net-new observability platform work is required in this scope.
- At minimum, AI inference failures should be distinguishable as structured workflow action failures with actionable error messages.

## Rollout / Migration

- This is a net-new workflow capability.
- Existing workflows must continue to load, publish, export, and execute unchanged.
- Existing grouped action and transform flows must continue to use the current static-schema behavior unless a step has explicit dynamic schema logic.
- No migration to schema refs is required because AI schemas are inline in v1.

## Open Questions

- How strict should the supported advanced JSON Schema subset be when provider behavior differs between OpenRouter and Vertex?
- Should the advanced editor preserve raw JSON text formatting, or is parsed-and-reformatted JSON acceptable for v1?
- Should the AI action eventually support optional system instructions or model parameters, or remain prompt-only until a follow-up?

## Acceptance Criteria (Definition of Done)

- Workflow authors can add an AI inference step from the workflow designer palette.
- The AI step is persisted and executed as `action.call`.
- Workflow authors can define an inline output schema in simple mode for common object outputs.
- Workflow authors can switch to advanced JSON Schema mode when needed.
- Saved AI steps reopen without losing prompt or schema configuration.
- When the saved schema is simple-compatible, the simple builder rehydrates.
- When the saved schema is not simple-compatible, the designer falls back to advanced mode without data loss.
- Downstream steps can reference AI output fields through `vars.<saveAs>` exactly like other step outputs.
- Publish validation blocks invalid or unsupported AI schemas.
- Runtime inference uses the current OpenAI-compatible provider infrastructure and validates model output against the inline schema before storing it.
- Workflow import/export and bundle persistence preserve the AI step configuration.
- Existing non-AI workflows remain unaffected.
