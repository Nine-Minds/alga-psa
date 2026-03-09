# PRD — Invoice Template Transforms Designer

- Slug: `invoice-template-transforms-designer`
- Date: `2026-03-08`
- Status: Draft

## Summary

Add a first-class `Transforms` authoring surface to the invoice template editor so billing admins can shape invoice collection data before it is rendered. V1 is aggregation-first: support `filter`, `sort`, `group`, and `aggregate` on any collection binding, with live output preview and dynamic-table binding to transformed output. The current generated JSON code view remains read-only.

## Problem

The invoice template AST already supports collection transforms, but the visual template editor cannot author or preserve them. Users who want aggregated invoice rows, grouped lists, or shaped output for tables have no supported path to create that behavior in the UI. Saving through the visual workspace currently drops `templateAst.transforms`, which makes the feature effectively unavailable to non-engineers and unsafe even for manually patched templates.

## Goals

- Let template authors create transform pipelines visually without editing AST JSON.
- Preserve authored transforms through load, preview, save, and reopen flows.
- Support the main invoice use case of rolling up repeated line items into grouped or aggregated rows.
- Let layout components, especially dynamic tables, bind to transformed output collections.
- Show enough source/output data preview that users can understand what their pipeline is doing.

## Non-goals

- Editable raw AST or editable full-code authoring in v1.
- Exposing every AST transform operation in v1.
- Introducing multiple independent transform pipelines per template.
- Redesigning the existing design canvas or authoritative preview pipeline beyond what is needed to support transforms.
- Adding observability, metrics, rollout flags, or operational tooling beyond normal error handling.

## Users and Primary Flows

### Primary user

- Billing admin or template author configuring invoice templates for tenant-specific invoice presentation.

### Primary flows

1. Open an existing template, switch to `Transforms`, choose a source collection, and build a pipeline that groups and aggregates invoice items.
2. Inspect the transformed output preview, then switch back to `Design` and point a dynamic table at the transform output binding.
3. Save the template, reopen it later, and continue editing without losing transform configuration.
4. Use `Preview` to verify the full rendered invoice honors the configured transforms.

## UX / UI Notes

- Add a top-level `Transforms` tab beside `Design` and `Preview`.
- The transforms tab should have four areas:
  - source data panel
  - transform pipeline panel
  - selected transform inspector
  - output preview and table-binding summary
- Keep responsibilities separate:
  - `Design` edits layout
  - `Transforms` edits collection shaping
  - `Preview` verifies rendered output
- The code tab remains generated/read-only and should display the authored `transforms` block when present.
- The source/output panels should prefer guided selection and previews over free-text path entry wherever practical.

## Requirements

### Functional Requirements

- `FR-001` Add a `Transforms` tab to the invoice template editor without regressing existing `Design` and `Preview` flows.
- `FR-002` Represent transform authoring state as first-class visual workspace data so it can be edited, exported, and saved.
- `FR-003` Import existing `templateAst.transforms` into workspace state when loading a template.
- `FR-004` Export workspace transforms back into `templateAst.transforms` when generating AST for preview and save.
- `FR-005` Preserve templates that have no transforms; opening and saving them must remain safe.
- `FR-006` Let the user select any collection binding as the source collection for the transform pipeline.
- `FR-007` Show source collection metadata including binding ID, row count, and discovered fields using sample preview data when available.
- `FR-008` Let the user add, reorder, duplicate, and delete transform operations within a single ordered pipeline.
- `FR-009` Support authoring `filter` operations.
- `FR-010` Support authoring `sort` operations.
- `FR-011` Support authoring `group` operations.
- `FR-012` Support authoring `aggregate` operations.
- `FR-013` Let the user define an output binding ID for the transform pipeline.
- `FR-014` Show a live output preview that reflects the transformed binding shape, including grouped rows and aggregate values.
- `FR-015` Let dynamic-table layout nodes bind to the transformed output collection instead of only raw source collections.
- `FR-016` Expose transformed row paths in table column binding/mapping UI so grouped outputs can be rendered without manual path guesswork.
- `FR-017` Prevent or clearly reject illegal transform sequences in the UI before save where the AST evaluator would fail.
- `FR-018` Surface AST validation/evaluation issues in the transforms tab in a way that points to the offending transform.
- `FR-019` Ensure the authoritative preview path compiles and renders templates with transforms.
- `FR-020` Show the generated `transforms` block in the read-only code tab.
- `FR-021` Preserve transforms through reopen/save round-trips so visual editing no longer strips the AST transform block.

### Non-functional Requirements

- `NFR-001` Export/import behavior must remain deterministic for stable round-trip tests.
- `NFR-002` Existing templates and previews must continue to work when no transforms are configured.
- `NFR-003` V1 must use the existing invoice template AST schema and evaluator contracts; no AST wire-format migration is required.
- `NFR-004` Transform authoring should favor guided controls over raw string editing for common operations.

## Data / API / Integrations

- Use the existing `templateAst.transforms` structure already defined in the invoice template AST schema.
- Extend the designer workspace/store snapshot to carry:
  - source binding ID
  - output binding ID
  - ordered transform operations
- Reuse existing preview inputs and authoritative preview actions; do not introduce a new backend API for transform authoring.
- Dynamic-table authoring must be able to reference the transform output binding and transformed row paths.

## Security / Permissions

- No new permission model is introduced.
- Existing invoice template edit permissions continue to govern access to `Design`, `Transforms`, `Preview`, and save behavior.

## Observability

- No new observability scope is included in v1 beyond normal client/server error surfacing in the editor and preview pipeline.

## Rollout / Migration

- No data migration is required because the AST schema already supports transforms.
- Existing templates without transforms remain valid and unchanged.
- Templates that already contain `transforms` should begin round-tripping safely once import/export support lands.

## Open Questions

- Future v2 question: whether to expose `computed-field` and `totals-compose` in the GUI after the aggregation-first surface is stable.
- Future v2 question: whether to add a limited advanced editor for the `transforms` block only.

## Acceptance Criteria (Definition of Done)

- A template author can create a transform pipeline in the editor using guided UI controls.
- A template author can group and aggregate invoice rows and see the transformed output before saving.
- A dynamic table can bind to the transformed output binding and render grouped/aggregated rows in preview.
- Saving and reopening a transformed template preserves the authored transform pipeline.
- Existing non-transformed templates remain unaffected.
- The read-only code tab reflects the generated `transforms` block for transformed templates.
