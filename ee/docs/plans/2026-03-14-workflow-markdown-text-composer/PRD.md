# PRD — Workflow Markdown Text Composer

- Slug: `workflow-markdown-text-composer`
- Date: `2026-03-14`
- Status: Draft

## Summary

Add a standard workflow transform action for composing one or more named markdown text outputs from literal content plus simple workflow references. Authoring should use a constrained BlockNote-based inline chip editor for a high-quality WYSIWYG experience, while persistence and runtime should use an Alga-owned template document model and emit plain markdown strings.

## Problem

Workflow authors currently have two poor options when they need richer text composition:

- write a single literal string directly in a consuming field such as `ai.infer.prompt`
- wire a single reference into that field from elsewhere

That breaks down when authors need to build prompts, email bodies, summaries, or notification text from several pieces of workflow context. Prompt-specific templating inside `ai.infer` would solve the symptom in one place but would create improper layering and leave email and notification composition unsolved.

The workflow system already has a transform category for building derived values. Text composition belongs there, but the current text transforms are scalar utilities such as concat, replace, join, or trim. They do not provide:

- multi-output authoring
- inline reference placeholders
- markdown-capable editing
- explicit missing-reference failure semantics

There is also a UX gap. Placeholder-string editing in a plain text box is easy for engineering, but not ideal for authors. We already have BlockNote infrastructure and custom inline content patterns in the repo, which can support a more natural authoring surface if we keep BlockNote confined to the UI layer.

## Goals

- Introduce a dedicated standard transform action for text composition rather than adding prompt-specific behavior to `ai.infer`.
- Support multiple related text outputs in a single step.
- Let authors use freeform output labels while preserving stable downstream reference paths.
- Provide a constrained BlockNote-based editor with inline reference placeholders for authoring.
- Persist an Alga-owned template document model rather than BlockNote JSON.
- Render composed outputs to markdown strings at runtime.
- Fail execution explicitly when any referenced value is missing.
- Surface composed outputs in downstream workflow reference browsing and validation.

## Non-goals

- No AI-specific prompt builder embedded into consuming actions.
- No inline launch of the composer from `ai.infer.prompt` or other fixed-value fields in this phase.
- No generic expression segments, nested transform invocation, or arbitrary code execution inside templates.
- No media, attachments, tables, or other document-heavy BlockNote concepts in the composer.
- No HTML output from the transform itself; markdown-to-HTML conversion remains the responsibility of downstream consumers.
- No broad reusable rich-editor platform for all workflow fields in this phase.

## Users and Primary Flows

- Workflow authors building AI prompts, email bodies, customer-facing summaries, internal notes, or notification text from payload and prior step outputs.

Primary flows:

- Author adds a `transform.compose_text` step and saves it as `composed`.
- Author creates several related outputs in the same step such as “Prompt”, “Email Body”, and “Summary”.
- Author writes markdown-friendly text with inline reference placeholders chosen from the workflow source browser.
- Author maps downstream action fields by reference, for example `vars.composed.prompt`.
- Workflow runtime resolves references, renders markdown strings, and fails the step if a referenced value is missing.

## UX / UI Notes

- The composer exists only as a dedicated transform action editor.
- The editor shows a list of outputs, each with:
  - freeform author label
  - generated stable reference key
  - constrained BlockNote editing surface
- The UI should present the author label prominently and the stable reference key secondarily, including a copyable downstream reference path.
- The editing surface should feel WYSIWYG:
  - inline reference chips instead of raw placeholder syntax
  - markdown-safe text formatting only
  - no media insertion affordances
- Authors should be able to:
  - add, rename, delete, and reorder outputs
  - add literal text
  - insert simple references from existing workflow data context
  - see validation issues for duplicate labels, duplicate keys, or invalid references
- The UI may show a serialized markdown preview or reference summary, but v1 does not need resolved runtime-value preview.

## Requirements

### Functional Requirements

- The workflow runtime must register a new dedicated transform action for text composition under the Transform category.
- The action must support multiple named outputs inside one step.
- Each authored output must have a freeform display label.
- Each authored output must also have a stable, reference-safe key used for downstream paths and schema fields.
- Stable keys must be generated automatically from display labels and remain stable across later label edits unless the user explicitly regenerates them.
- The persisted action config must store an Alga-owned template document model rather than BlockNote JSON.
- The template document model must support markdown-capable text structure plus inline reference nodes without leaking BlockNote-specific node shapes.
- Reference nodes must only allow simple workflow references, not arbitrary expressions or nested transform definitions.
- The dedicated editor must use a constrained BlockNote-based surface for authoring and must round-trip between BlockNote UI state and the Alga-owned template document model.
- The constrained editor must disable media and other unsupported content types.
- Runtime execution must resolve references against workflow context and render each output to a markdown string.
- Runtime execution must fail the step if any referenced value is missing, identifying the output and reference that failed.
- The action result must be a plain object of markdown strings keyed by stable reference-safe keys.
- Workflow output schema derivation must reflect the configured composed outputs so downstream reference browsing and validation expose the correct fields.
- Downstream actions such as `ai.infer`, email actions, and notifications must consume composed outputs via ordinary reference mode with no special-case integration.

### Non-functional Requirements

- The composer must stay reusable and not introduce AI-specific layering into workflow actions.
- BlockNote must remain an authoring-only dependency for this feature; runtime contracts and stored step config must remain independent of BlockNote internals.
- The chosen markdown-capable editing subset must be intentionally constrained to features that round-trip cleanly through the Alga-owned model and markdown renderer.
- Validation and schema derivation must remain deterministic so downstream references do not drift after author label edits.

## Architecture

- Runtime layer:
  - new `transform.compose_text` action definition
  - config schema for outputs and template document structure
  - runtime renderer from template document model to markdown strings
  - missing-reference failure handling
- Designer layer:
  - dedicated compose-text step editor
  - constrained BlockNote schema with inline reference placeholder node
  - serialization/deserialization between editor content and template document model
  - output list management and stable key affordances
- Schema / reference layer:
  - dynamic output schema derivation for configured composed outputs
  - workflow data context and reference browser support for `vars.<saveAs>.<stableKey>`

## Data / API / Integrations

Recommended persisted config shape:

```ts
type ComposeTextStepConfig = {
  actionId: 'transform.compose_text';
  version: 1;
  outputs: Array<{
    id: string;
    label: string;
    stableKey: string;
    document: TemplateDocument;
  }>;
};

type TemplateDocument = {
  version: 1;
  blocks: TemplateBlock[];
};

type TemplateBlock =
  | { type: 'paragraph'; children: TemplateInlineNode[] }
  | { type: 'bullet_list_item'; children: TemplateInlineNode[] }
  | { type: 'ordered_list_item'; children: TemplateInlineNode[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: TemplateInlineNode[] }
  | { type: 'blockquote'; children: TemplateInlineNode[] }
  | { type: 'code_block'; text: string };

type TemplateInlineNode =
  | { type: 'text'; text: string; marks?: Array<'bold' | 'italic' | 'code' | 'link'>; href?: string }
  | { type: 'reference'; path: string; label: string };
```

Notes:

- The exact block subset can be refined, but it must remain markdown-compatible and must exclude media-heavy nodes.
- `label` is author-facing and freeform.
- `stableKey` is reference-safe and immutable by default so downstream `vars.<saveAs>.<stableKey>` paths do not break when the author changes the display label.
- The registry output schema may be broad at definition time, but publish-time/designer-time output schema resolution must override it with a config-derived object schema containing one string field per configured `stableKey`.

## Security / Permissions

- No new permissions are introduced.
- Existing workflow authoring and workflow read/update permission gates continue to govern access.
- The composer must not allow arbitrary expression execution or secret resolution outside the existing workflow reference/runtime mechanisms.

## Observability

- No new observability or metrics work is in scope for this phase.

## Rollout / Migration

- Add the new transform action without changing existing actions.
- Existing workflows remain untouched.
- New workflows may adopt `transform.compose_text` incrementally.
- AI prompt composition, email body composition, and similar use cases should migrate by adding an upstream compose-text step rather than modifying consuming action contracts.

## Open Questions

- Exact markdown-capable formatting subset for v1 should be finalized during implementation, but it should remain deliberately narrower than a full document editor.
- Whether the UI should expose explicit “regenerate stable key” behavior on rename or keep that as an advanced secondary control needs a final UX call.
- Whether a serialized markdown preview adds enough value in v1 to justify the extra UI surface remains optional.

## Acceptance Criteria (Definition of Done)

- Workflow authors can add a dedicated transform action that composes one or more markdown text outputs from literal content and simple references.
- The authoring experience uses a constrained BlockNote-based editor with inline reference placeholders and no media affordances.
- The stored step config uses an Alga-owned template document model rather than BlockNote JSON.
- Each output has a freeform author label and a stable downstream reference-safe key.
- Runtime execution renders each configured output to a markdown string.
- Missing referenced values fail the step explicitly instead of silently producing empty strings.
- Downstream workflow authoring surfaces expose composed outputs under `vars.<saveAs>.<stableKey>`.
- Consuming actions continue to use ordinary string references and require no prompt-specific or email-specific composition logic.
