# PRD — Workflow JSON Transform + AI-Assisted Authoring

- Slug: `2026-05-09-workflow-json-transform-ai-authoring`
- Date: `2026-05-09`
- Status: Draft approved for implementation

## Summary

Add workflow-native JSON parsing and transformation as deterministic Transform actions, then make those actions easy to use through the existing Alga AI Quick Ask experience. The workflow runtime should support JSON from workflow values or static literals, transform it with the existing JSONata expression model, and expose results to downstream steps through normal `saveAs` behavior. AI assistance should be guidance/authoring help only; saved workflow behavior must remain deterministic and executable without AI.

## Problem

Workflow authors often receive structured JSON in webhook-like payloads, email-derived text, custom fields, static literals, or previous action outputs. Today they can use expressions and basic object/text transforms, but there is no clear first-class way to parse a JSON string, query/reshape JSON, or ask Alga how to write the transform syntax. This makes Rewst-style data shaping difficult without adding a large visual mapper.

## Goals

- Add pure, side-effect-free JSON Transform actions for parsing and querying JSON.
- Reuse the existing JSONata expression engine rather than introducing Jinja or another transform language.
- Allow users to save parsed/transformed results into `payload`, `vars`, or `meta` through existing `action.call.saveAs` behavior.
- Update Alga AI prompt/context so Quick Ask can explain workflow JSON transform syntax and generate safe expressions for users.
- Optionally add a lightweight workflow-designer “Ask AI” trigger for entitled tenants that simply opens/seeds existing Quick Ask.
- Keep the designer implementation small; do not build a visual mapper in this phase.

## Non-goals

- No visual path picker, mapping-row builder, or array mapping UI in this phase.
- No external JSON loading from URL, file, blob, or remote APIs as part of these Transform actions.
- No AI-dependent runtime behavior; the workflow must store deterministic action config and expression text.
- No broad redesign of workflow input mapping, node execution, Temporal execution, or action registration.
- No new general-purpose scripting language.

## Users and Primary Flows

### MSP workflow author

1. Adds a Transform action.
2. Chooses `Parse JSON` to turn a JSON string or static literal into structured workflow data.
3. Saves the result as something like `payload.parsedRequest`.
4. Adds `Query JSON` to reshape the parsed object into a downstream-ready object.
5. Saves the result as `payload.normalizedRequest`.
6. Uses `payload.normalizedRequest.value.customerEmail` or similar in later action input mappings.

### AI-assisted workflow author

1. Opens existing Quick Ask, or clicks a lightweight “Ask AI” trigger if present.
2. Asks: “How do I extract customer.email and all asset tags from this JSON?”
3. Alga explains which Transform actions to use and provides a JSONata expression.
4. User pastes the expression into the workflow designer and uses the normal preview/publish validation flow.

## UX / UI Notes

- The JSON Transform actions appear under the existing Transform palette group.
- No special AI-first designer panel is required.
- The existing Quick Ask overlay remains the primary AI surface.
- If an “Ask AI” trigger is added, it should be small and contextual near expression/action input areas, visible only when the tenant has AI assistant entitlement and feature access. It should seed Quick Ask with workflow-transform help context rather than implement a separate chat UI.
- Non-AI users can still manually configure JSON Transform actions.

## Requirements

### Functional Requirements

1. `transform.parse_json` parses JSON text and passes through literal objects/arrays.
2. `transform.parse_json` returns a typed wrapper with at least `{ value, type }`, where `type` is one of `object`, `array`, `string`, `number`, `boolean`, or `null`.
3. Invalid JSON fails fast with an actionable action error by default.
4. `transform.query_json` evaluates a JSONata expression against a provided source value and returns `{ value }`.
5. `transform.query_json` must use the same expression safety model as existing workflow expressions: allow-listed functions, timeout enforcement, JSON-serializable output, and max output size.
6. The query expression should have a clear root variable convention. Recommended: expose the supplied source value as `source`, while still making the current workflow expression context available as `payload`, `vars`, `meta`, and `error` when needed.
7. `transform.stringify_json` should be included if low-cost, returning `{ text }` from a JSON-serializable source with optional pretty-print spacing.
8. All new actions are pure, stateless, `sideEffectful: false`, and use engine-provided idempotency.
9. Action schemas must be explicit enough for the action catalog and designer mapping UI to show inputs/outputs.
10. Saved outputs use existing `action.call.saveAs`; no new assignment semantics are required.
11. Alga AI prompt/context must include workflow JSON transform guidance when relevant, including action names, JSONata syntax examples, allowed helper functions, and recommended `saveAs` patterns.
12. Chat behavior must answer authoring questions without inventing runtime capabilities or undocumented action fields.
13. If the optional “Ask AI” trigger is implemented, it must not appear unless the AI Assistant add-on and `aiAssistant` feature access are available.

### Non-functional Requirements

- Runtime behavior must be deterministic and tenant-agnostic.
- Transform actions must not read from the database, network, filesystem, or secrets directly.
- Error messages should identify whether failure occurred during JSON parse, expression validation, or expression evaluation.
- Implementation should preserve existing workflow publish/runtime behavior for all current action types.

## Data / API / Integrations

- No database migration is required.
- Register new actions in `shared/workflow/runtime/actions/registerTransformActions.ts`.
- Reuse the existing action catalog and designer registry plumbing.
- Reuse existing Quick Ask/chat endpoints and AI entitlement checks.
- Likely AI prompt touchpoint: `ee/server/src/services/chatCompletionsService.ts` prompt/context construction.
- Likely designer touchpoints, only if adding the optional trigger: workflow designer action input/expression sections and existing Quick Ask open mechanics.

## Security / Permissions

- JSON Transform actions are available to workflow users regardless of AI entitlement.
- AI assistance remains gated by the existing `aiAssistant` feature flag and `ADD_ONS.AI_ASSISTANT` add-on checks.
- The actions should not resolve secrets themselves. If users pass secret-derived text through normal input mapping, saved outputs could expose parsed secret content; implementation should either document this clearly or add redaction propagation before encouraging secret-backed JSON parsing.
- Do not add arbitrary function execution to JSONata.

## Observability

No new production observability is required for MVP. Existing workflow action failures and chat debug logging should be sufficient. Unit tests should verify the actionable error shapes.

## Rollout / Migration

- No migration required.
- Existing workflows are unaffected.
- New actions appear in the Transform catalog after registration.
- AI prompt improvements apply automatically to entitled Quick Ask users.

## Open Questions

- Should `transform.stringify_json` be included in the first implementation or deferred if parse/query are enough?
- Should `transform.query_json` support an optional default value for empty/undefined results, or should users use JSONata/default/coalesce patterns?
- Should the optional “Ask AI” trigger be included in the first PR, or should the first PR limit itself to runtime actions plus prompt guidance?
- How much current workflow designer context can Quick Ask receive today without new plumbing?

## Acceptance Criteria (Definition of Done)

- Workflow authors can parse a JSON string or literal object/array using a Transform action.
- Workflow authors can query/reshape parsed JSON with JSONata and save the result for later steps.
- Invalid JSON and invalid/disallowed expressions fail with clear errors.
- New actions appear in the Transform designer catalog with input/output schemas.
- Quick Ask can explain the JSON transform workflow and provide copy-pasteable JSONata examples.
- AI assistance is optional and gated; deterministic workflow execution does not require AI.
- Unit tests cover happy paths, failure paths, expression safety, and catalog registration.
