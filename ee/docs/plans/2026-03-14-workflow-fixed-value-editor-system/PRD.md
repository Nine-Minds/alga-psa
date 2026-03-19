# PRD — Workflow Fixed-Value Editor System

- Slug: `workflow-fixed-value-editor-system`
- Date: `2026-03-14`
- Status: Draft

## Summary

Unify workflow fixed-value editing under a single schema-driven editor contract that subsumes today’s picker metadata and supports both inline editing and larger popout editing surfaces. Use that contract to keep simple cases inline, while allowing richer editors such as a large prompt editor dialog, ticket picker browsers, and future controls like color pickers.

## Problem

The workflow designer currently has multiple overlapping concepts for fixed-value editing:

- generic literal inputs
- picker metadata for ticket/client-style selection
- presentation-only handling for multiline prompt text

This split creates special cases, duplicate rendering paths, and awkward rollout decisions when a field needs both a compact inline control and a richer, larger editing experience.

Prompts are the immediate example:

- quick edits should still work inline
- larger prompt authoring needs a dialog-sized editing surface

If we continue adding separate metadata systems, future rich fields like color pickers, JSON builders, notification bodies, or email content will accumulate one-off handling.

## Goals

- Replace separate picker metadata and presentation metadata with one unified workflow editor contract for fixed-value fields.
- Support both inline editor surfaces and popout/dialog editor surfaces from the same field metadata.
- Keep the existing source-mode shell intact so fixed/reference/expression remains consistent.
- Make prompt editing support both inline editing and a larger dialog-based editing experience.
- Provide a migration path that allows existing picker-backed fields to continue working while moving onto the unified model.

## Non-goals

- No change to workflow runtime behavior or persisted mapping shape.
- No change to expression mode or reference mode semantics.
- No immediate broad rollout of custom editors across every candidate field.
- No plugin marketplace or unbounded third-party editor loading system in this first phase.

## Users and Primary Flows

- Workflow authors configuring AI steps, ticket steps, notification steps, and similar action inputs.

Primary flows:

- User edits a prompt inline for quick changes.
- User opens a larger prompt editor dialog for long-form prompt authoring.
- User uses picker-backed fields through the same editor system rather than a separate picker path.
- Future fields such as color values or structured content can opt into richer editors without new fixed-value rendering branches.

## UX / UI Notes

- Source mode remains the outer control: fixed, reference, expression, secret where applicable.
- Fixed mode hosts a single editor shell that can render:
  - inline only
  - dialog only
  - inline plus dialog affordance
- Prompt should use:
  - inline textarea for quick edits
  - dialog affordance for larger editing
- Picker-backed fields should continue to feel compact inline, with optional browse/select dialogs where appropriate.
- Inline and dialog surfaces for the same field must read/write the same value contract.

## Requirements

### Functional Requirements

- The workflow designer must support a single schema-driven fixed-value editor contract for action input fields.
- The unified editor contract must subsume current picker metadata so picker-backed fields are represented through the same field editor model as prompts and future rich editors.
- The normalized field editor model must support both inline editor surfaces and dialog/popout surfaces.
- The workflow designer must expose the normalized editor model on `ActionInputField` so all downstream UI uses the same representation.
- The fixed-value editor renderer must switch on the normalized editor model rather than on separate picker and presentation metadata paths.
- Prompt editing must support both inline multiline editing and a larger dialog editing surface.
- Existing picker-backed ticket/client-style fields must continue working via a compatibility adapter during migration.

### Non-functional Requirements

- The editor contract remains designer-only metadata and must not affect runtime execution behavior.
- The design should reduce special cases rather than add parallel systems.
- The migration path should permit incremental rollout without requiring all existing fields to migrate at once.
- The approach should remain EE-only where workflow authoring features are owned.

## Proposed Editor Contract

Unified metadata shape, schema-driven and designer-focused:

```ts
x-workflow-editor: {
  kind: 'text' | 'picker' | 'color' | 'json' | 'custom';
  inline?: { mode: 'input' | 'textarea' | 'picker-summary' | 'swatch' };
  dialog?: { mode: 'large-text' | 'picker-browser' | 'custom' };
  dependencies?: string[];
  allowsDynamicReference?: boolean;
  fixedValueHint?: 'search' | 'select';
  picker?: { resource: 'ticket' | 'client' | 'board' | 'user' | 'contact' | 'custom' };
}
```

Notes:

- The exact shape can be refined during implementation, but it must be one top-level editor contract.
- Existing picker metadata should be normalized into this structure rather than remaining a separate downstream concept.

## Architecture

- Schema metadata
  - new unified editor metadata becomes the primary authoring contract
  - legacy picker metadata is adapted into the unified editor contract during normalization
- Normalization
  - a single normalization layer converts action schema JSON into a unified `field.editor`
- Rendering
  - fixed-value editing uses one editor shell
  - the editor shell renders inline UI, dialog UI, or both
- Migration
  - prompt adopts the new contract first
  - legacy picker-backed fields continue through an adapter
  - later migration removes picker-specific metadata handling once all fields are moved

## Data / API / Integrations

- No backend API contract changes required for runtime behavior.
- Designer action-schema payloads will carry the new unified editor metadata over time.
- Short-term compatibility adapter maps current picker metadata into the unified editor model on the client/designer side.

## Risks

- If the compatibility adapter is partial, picker fields could regress during rollout.
- If dialog and inline editors do not share exactly one value/update path, the UI will drift.
- If the new editor contract is too narrow, future controls will immediately require exceptions again.

## Rollout / Migration

Phase 1:

- Introduce unified editor normalization.
- Add adapter from legacy picker metadata.
- Move prompt onto unified editor metadata.
- Add inline plus dialog text editor support for prompts.

Phase 2:

- Migrate picker-backed fields to emit only the unified editor metadata.
- Remove legacy picker metadata handling once coverage is complete.

## Open Questions

- Exact final metadata keys and nesting can still be refined during implementation.
- We should decide whether color/json/custom editors ship as stubbed infrastructure or remain future consumers of the new system.

## Acceptance Criteria

- Workflow fixed-value editing uses one schema-driven editor model.
- Prompt supports both inline multiline editing and a larger dialog editing surface.
- Existing picker-backed fields continue working through the unified editor path.
- The fixed-value rendering path no longer depends on separate picker vs presentation concepts.
- The plan includes explicit migration steps and regression coverage for legacy picker behavior.
