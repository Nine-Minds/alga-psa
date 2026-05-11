# PRD — Workflow Regex Transform + AI-Assisted Authoring

- Slug: `2026-05-09-workflow-regex-transform-ai-authoring`
- Date: `2026-05-09`
- Status: Draft

## Summary

Add first-class regex transform actions to the workflow system so authors can match, extract, and replace text using deterministic JavaScript regular expressions. The feature should mirror the JSON transform pattern: pure Transform actions in the workflow runtime, normal `action.call` input mappings, normal `saveAs` outputs, useful Run Studio errors, designer-friendly inputs/outputs, and Quick Ask guidance for regex syntax and safe usage. AI should help authors write patterns, but saved workflow execution must remain deterministic and independent of AI.

## Problem

Workflow authors frequently need to parse semi-structured text: email subjects, alert bodies, ticket descriptions, webhook text fields, hostnames, asset tags, invoice references, phone numbers, and vendor incident IDs. Today they can combine basic text transforms or expressions, but there is no workflow-native regex action with clear inputs, captures, replacement semantics, output schemas, and actionable runtime errors. This makes common automation patterns harder than necessary and encourages brittle ad hoc expressions.

## Goals

- Add pure, side-effect-free regex Transform actions for matching, extracting captures, and replacing text.
- Use JavaScript `RegExp` syntax and flags so runtime behavior is predictable in TypeScript/Node.
- Return structured match/capture outputs that can be saved and referenced by downstream workflow steps.
- Provide guardrails for invalid patterns, unsupported flags, oversized inputs, excessive matches, and pathological regex risk where feasible.
- Improve designer behavior so regex pattern, flags, replacement, and saveAs outputs are clear to workflow authors.
- Preserve existing workflow runtime and designer behavior for all current actions.
- Add Quick Ask guidance that explains JavaScript regex syntax, capture groups, named groups, flags, replacement strings, and deterministic workflow-safe usage.

## Non-goals

- No new workflow node type; use the existing `action.call` Transform action model.
- No external text loading from URLs/files/blobs.
- No AI-dependent runtime behavior.
- No full visual regex builder in this phase.
- No guarantee that every possible catastrophic JavaScript regex can be safely interrupted once execution starts; guardrails should prevent common risky inputs/patterns before execution.
- No PCRE-only syntax support beyond what JavaScript `RegExp` supports.

## Users and Primary Flows

### MSP workflow author: extract an incident ID from text

1. Adds a Transform action.
2. Selects `Regex Extract`.
3. Maps `text` from a workflow payload field such as `payload.email.subject`.
4. Enters a pattern such as `INC-(\d{6})`.
5. Saves output as `payload.parsedIncident`.
6. Uses `payload.parsedIncident.first.groups[0]` or named captures in a later ticket/client lookup action.

### MSP workflow author: detect whether text matches a policy

1. Adds `Regex Match`.
2. Maps `text` from a ticket title or alert body.
3. Enters a pattern and flags.
4. Saves output as `vars.regexResult`.
5. Uses `vars.regexResult.matched` in a `control.if` branch.

### MSP workflow author: normalize text

1. Adds `Regex Replace`.
2. Maps source text from a payload or previous action output.
3. Enters a pattern like `\s+`, replacement ` `, and replace-all behavior.
4. Saves the normalized text for downstream actions.

### AI-assisted workflow author

1. Opens existing Quick Ask or contextual workflow AI affordance if present.
2. Asks: “Write a workflow regex to extract the device hostname and serial number from this alert.”
3. Alga explains which regex Transform action to use, provides a JavaScript regex pattern, explains groups/flags, and tells the user where to paste it.
4. User stores deterministic action config in the workflow designer.

## UX / UI Notes

- Regex actions appear under the existing Transform palette group.
- Inputs should render with helpful labels/descriptions:
  - `text`: source text to inspect or modify
  - `pattern`: JavaScript regular expression body, without surrounding `/.../`
  - `flags`: JavaScript regex flags, constrained to supported values
  - `replacement`: replacement string for replace action
  - `maxMatches`: match cap for extract
  - `requireMatch`: optional failure behavior for extract/match
- If the editor has specialized action input support, regex pattern fields should use multiline/text input with helper text rather than a tiny one-line generic field.
- Save output paths should continue to validate scoped paths such as `payload.*`, `vars.*`, and `meta.*`.
- Downstream reference trees should expose stable output fields such as `matched`, `first`, `matches`, `text`, and `replacementCount`. Named capture inference is desirable but can be implemented as a second step if generic outputs are shipped first.
- Run Studio should surface action-level regex errors first, especially invalid pattern/flag errors and require-match failures.

## Requirements

### Functional Requirements

1. Register `transform.regex_match` as a pure Transform action.
2. `transform.regex_match` accepts at least `text`, `pattern`, optional `flags`, and optional `requireMatch`.
3. `transform.regex_match` returns at least `{ matched, match, index, groups, namedGroups }`, where missing match fields are `null` or empty in a consistent documented shape.
4. Register `transform.regex_extract` as a pure Transform action.
5. `transform.regex_extract` accepts at least `text`, `pattern`, optional `flags`, optional `maxMatches`, and optional `requireMatch`.
6. `transform.regex_extract` returns at least `{ matched, count, first, matches }`, where each match contains `{ text, index, groups, namedGroups }`.
7. `transform.regex_extract` supports numbered capture groups.
8. `transform.regex_extract` supports JavaScript named capture groups where the runtime supports them.
9. Register `transform.regex_replace` as a pure Transform action.
10. `transform.regex_replace` accepts at least `text`, `pattern`, optional `flags`, `replacement`, and optional `replaceAll`.
11. `transform.regex_replace` returns at least `{ text, replacementCount }`.
12. `transform.regex_replace` supports JavaScript replacement tokens such as `$1`, `$2`, `$<name>`, and `$$`, or explicitly documents any limits.
13. Regex actions validate pattern syntax before execution and fail with actionable messages for invalid patterns.
14. Regex actions validate flags and reject unsupported or duplicate flags with actionable messages.
15. Regex actions enforce guardrails for max source text length, max pattern length, and max match count.
16. Regex actions avoid infinite loops for zero-width global matches.
17. No-match behavior is deterministic: by default no match is a successful result with `matched: false` / empty matches; `requireMatch` turns no match into an action failure.
18. All regex transform actions are `sideEffectful: false` and use engine-provided idempotency.
19. Action schemas are explicit enough for the catalog/designer to expose input and output field names.
20. Outputs save through existing `action.call.saveAs`; no new assignment behavior is required.
21. The workflow designer exposes regex transform outputs in downstream workflow references.
22. Run Studio displays useful regex action failure messages before generic wrapper errors.
23. Quick Ask guidance covers action names, JavaScript regex pattern syntax, flags, numbered captures, named captures, replacement strings, `saveAs` examples, guardrails, and deterministic runtime behavior.
24. Regex actions are available regardless of AI entitlement; AI assistance remains gated by existing AI Assistant/Quick Ask access.

### Non-functional Requirements

- Runtime behavior must be deterministic and tenant-agnostic.
- Actions must not access the database, network, filesystem, or secrets directly.
- Regex execution must fail fast on invalid inputs and protect workflow workers from obvious expensive patterns/inputs.
- Error messages should distinguish invalid pattern, invalid flags, guardrail limit, no match with `requireMatch`, and replacement errors.
- Existing workflows and transform actions must remain backward-compatible.

## Data / API / Integrations

- No database migration is required.
- Main runtime registration should live in `shared/workflow/runtime/actions/registerTransformActions.ts`, following existing transform action patterns.
- If EE has a separate workflow runtime action registration or exposure layer, mirror the JSON feature integration in `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts` as needed.
- Designer work should follow the JSON transform/editor changes in:
  - `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
  - `ee/server/src/components/workflow-designer/actionInputEditorState.ts`
  - `ee/server/src/components/workflow-designer/workflowDataContext.ts`
  - `ee/server/src/components/workflow-designer/WorkflowStepSaveOutputSection.tsx`
  - `ee/server/src/components/workflow-designer/workflowSaveAsPath.ts`
  - `ee/server/src/components/workflow-designer/mapping/InputMappingEditor.tsx`
- Run Studio error display should follow the JSON feature pattern in `workflowRunDisplayError.ts` and `WorkflowRunDetailsPanel.tsx`.
- AI guidance should follow the JSON guidance pattern, likely with a new regex-specific guidance module or an expanded workflow transform guidance module.

## Security / Permissions

- Regex Transform actions are not AI-gated.
- Quick Ask/AI guidance remains gated by existing AI Assistant feature/add-on checks.
- Regex outputs may persist sensitive content into workflow state through `saveAs`; guidance should warn users not to save secret-derived or sensitive captures unless intentional.
- Regex patterns should be treated as workflow configuration, not executable code, but JavaScript regex can still be expensive; guardrails are required.

## Observability

No new production observability is required for MVP. Existing workflow action failure logs and Run Studio details should be sufficient. Tests should assert the action-level error messages that users see.

## Rollout / Migration

- No migration required.
- Existing workflows are unaffected.
- New actions appear in the Transform catalog after registration.
- AI guidance improvements apply automatically to entitled Quick Ask users.

## Open Questions

- Do we include named capture output schema inference in the first implementation, or only generic `namedGroups` records?
- Should we add a safe-regex/static-analysis dependency, or rely on source length, pattern length, flags, and match-count limits?
- Should `regex_match` and `regex_extract` be separate actions, or should one action cover both? Current recommendation is separate for clearer authoring.
- Should `regex_replace` support both JavaScript replacement-token mode and literal replacement mode?

## Acceptance Criteria (Definition of Done)

- Workflow authors can match text with regex and branch on a saved boolean result.
- Workflow authors can extract numbered and named captures and reference them downstream.
- Workflow authors can replace text with regex and save normalized output.
- Invalid patterns/flags and require-match misses fail with clear action-level messages in Run Studio.
- Regex actions appear under Transform with explicit input/output schemas and saveAs support.
- Quick Ask can explain how to author regex workflow transforms without implying AI runs inside workflow execution.
- Unit/integration tests cover happy paths, failures, guardrails, catalog registration, saveAs/downstream references, Run Studio error display, and Quick Ask guidance.
