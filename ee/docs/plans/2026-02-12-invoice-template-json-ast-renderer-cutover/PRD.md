# PRD — Invoice Template Execution Abstraction Cutover (JSON AST + Shared React Renderer)

- Slug: `invoice-template-json-ast-renderer-cutover`
- Date: `2026-02-12`
- Status: Draft
- Supersedes: `ee/docs/plans/2026-02-09-invoice-template-designer-preview-workspace/`

## Summary

Replace the current invoice template execution pipeline (GUI IR -> AssemblyScript generation -> Wasm compile -> Wasm/QuickJS execution) with a declarative JSON AST and one shared React/TypeScript renderer.

The template is data, not executable code. The Designer should output a versioned JSON AST. Rendering should run through one shared renderer in both:

1. interactive preview in the app, and
2. backend PDF generation via headless browser.

The system must still support future customization of invoice line-item calculations and groupings by expressing those behaviors declaratively (and optionally via whitelisted strategy hooks), not by embedding arbitrary per-template code.

## Problem

Current architecture requires maintaining multiple custom layers for one invoice output path:

- GUI state compiler IR
- AssemblyScript source generation
- AssemblyScript compilation orchestration
- runtime module loading/execution (Wasm/QuickJS)
- host function glue and compile artifact caching

This increases complexity, testing surface, runtime failure modes, and maintenance burden. It also creates a conceptual mismatch: an invoice layout definition is fundamentally declarative data.

## Insight

An invoice template is a declarative UI/data-shaping structure, not a program.

## Goals

- Make Designer the source of truth for a versioned JSON AST.
- Implement one generic invoice renderer in React/TS that consumes AST + invoice data.
- Use identical render logic for preview and PDF generation.
- Preserve extensibility for future custom line-item calculations/groupings through declarative transform specs and optional whitelisted strategy hooks.
- Remove compiler/executor layers and their operational burden.
- Eliminate generated Wasm artifact management and cache concerns.

## Non-goals

- Supporting arbitrary user-authored executable code in templates.
- Full migration tooling for tenant custom templates (none exist yet).
- Replatforming invoice data sources or billing domain logic.
- Reworking unrelated billing UI flows outside template render/edit/preview/PDF paths.

## Users and Primary Flows

Primary personas:

- Billing admins designing invoice templates.
- Implementers maintaining template rendering reliability.

Primary flows:

1. **Design -> Preview**
   - User edits template in visual designer.
   - Designer emits AST snapshot.
   - Shared data-shaping evaluator + renderer produces preview output.

2. **Save -> Reopen**
   - User saves template AST.
   - Reopening editor hydrates from persisted AST.

3. **Invoice PDF generation**
   - Invoice generation selects template AST.
   - Same renderer path generates HTML/CSS in headless browser.
   - PDF output matches preview behavior.

4. **Future customization (calculation/grouping)**
   - Template AST declares group/filter/sort/aggregate/computed-field rules.
   - Evaluator applies them consistently in preview and PDF.
   - Optional `strategyId` can route to vetted server-side functions for advanced behavior.

## UX / UI Notes

- Keep top-level editor tabs (`Visual`, `Code`) unless product decides otherwise.
- In `Visual -> Preview`, retain source selection UX (`Sample` / `Existing`) and status surface.
- Preview status terminology should reflect new phases (`shape`, `render`, `verify`) instead of compile.
- If `Code` tab remains for GUI templates, show generated/read-only AST JSON (or remove tab in a follow-up).

## Requirements

### Functional Requirements

- Define a versioned `InvoiceTemplateAst` schema with runtime validation.
- AST must represent layout tree, style tokens, bindings, and repeatable item regions.
- AST must support declarative data-shaping blocks for:
  - filtering,
  - sorting,
  - grouping,
  - aggregations,
  - computed fields,
  - totals composition.
- Add optional `strategyId` hooks that resolve only to whitelisted server-side implementations.
- Implement a shared evaluator that transforms invoice view-model data according to AST shape rules.
- Evaluator output must be deterministic for equivalent inputs.
- Implement one shared React renderer that consumes evaluated AST context and renders invoice HTML/CSS.
- `DesignerVisualWorkspace` export path must persist AST directly (no IR->AssemblyScript generation).
- Template save/get actions must use AST as canonical template payload.
- Preview action must run evaluator + shared renderer (no Wasm compile/execute).
- Preview must continue supporting sample and existing-invoice sources.
- Backend PDF generation must use the same renderer output path in headless browser.
- Remove compile-cache behavior tied to generated Wasm artifacts.
- Remove runtime dependency on custom compiler/executor modules listed in this PRD.
- Preserve clear, structured errors for schema, evaluator, strategy, and rendering failures.

### Non-functional Requirements

- Preview and PDF rendering should remain functionally consistent for the same template + invoice data.
- Rendering path should be fast enough for iterative design/preview usage.
- Renderer/evaluator modules must be unit-testable without external compiler toolchains.
- Architecture should reduce moving parts versus current compiler + runtime stack.

## Data / API / Integrations

- Update invoice template type contracts to include canonical AST payload.
- Keep invoice data retrieval and mapping (`fetchInvoicesPaginated`, `getInvoiceForRendering`, adapter mapping) intact.
- Introduce shared modules for:
  - AST schema,
  - evaluator,
  - React invoice renderer,
  - server-side render-to-html wrapper for PDF.
- Update save/load/query paths in billing actions/models to use AST as primary source.
- Standard templates should be represented in AST form for this cutover path.

## Security / Permissions

- No template execution of arbitrary code.
- `strategyId` resolution must be allowlisted, tenant-safe, and auditable.
- Existing tenant isolation requirements for invoice/template access remain unchanged.
- Preview and PDF rendering must remain read-only relative to invoice mutation.

## Deleted / Eliminated Layers

Delete these modules and remove call paths:

- `packages/billing/src/components/invoice-designer/compiler/guiIr.ts`
- `packages/billing/src/components/invoice-designer/compiler/assemblyScriptGenerator.ts`
- `packages/billing/src/components/invoice-designer/compiler/diagnostics.ts`
- `packages/billing/src/lib/invoice-template-compiler/assemblyScriptCompile.ts`
- `packages/billing/src/lib/invoice-renderer/wasm-executor.ts`
- `packages/billing/src/lib/invoice-renderer/quickjs-executor.ts`
- `packages/billing/src/lib/invoice-renderer/host-functions.ts`

And eliminate generated Wasm module caching/management (including preview compile cache concerns).

## Rollout / Migration

- No tenant custom templates currently exist, so no backfill migration is required for custom template payloads.
- Implement as a forward cutover for template authoring/rendering pipeline.
- Keep legacy columns/artifacts only as temporary compatibility scaffolding if needed during implementation; prioritize runtime cutover first.

## Risks

- Functional parity drift between old and new rendering semantics.
- Ambiguity in declarative transform expressiveness for advanced grouping/calc scenarios.
- Under-specified strategy hook boundaries could reintroduce ad hoc execution behavior.

## Open Questions

1. Should `Code` tab for GUI templates become read-only AST JSON immediately, or be hidden in this cutover?
2. Which initial strategy hooks are required in MVP (`none`, `custom-group-key`, `custom-aggregate`, etc.)?
3. Do we keep layout verification in MVP, and if yes, does it compare AST-intended constraints to rendered DOM geometry?

## Acceptance Criteria (Definition of Done)

- [ ] Designer persists a validated JSON AST as canonical template representation.
- [ ] Preview pipeline uses shared evaluator + React renderer (no compiler/Wasm executor path).
- [ ] PDF generation uses same renderer path in headless browser and matches preview semantics.
- [ ] Declarative grouping/calculation rules are supported in AST evaluator.
- [ ] Optional whitelisted `strategyId` hooks are supported without arbitrary code execution.
- [ ] Legacy compiler/executor modules listed above are deleted and no longer referenced.
- [ ] No generated Wasm compile cache/module lifecycle remains in invoice template pipeline.
- [ ] Automated tests cover AST validation, evaluator behavior, preview/PDF parity, and error handling.
