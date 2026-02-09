# Scratchpad — Invoice Template Designer Preview Workspace

- Plan slug: `invoice-template-designer-preview-workspace`
- Created: `2026-02-09`
- Scope status: `authoritative-preview-only`

## Scope Snapshot

Authoritative preview for invoice template designer:

1. GUI design -> compiler IR -> AssemblyScript source
2. AssemblyScript -> Wasm (same compile path/options as real templates)
3. Wasm -> HTML/CSS via real invoice rendering runtime
4. Layout verification compares rendered output vs expected design constraints

## Decisions

- (2026-02-09) Preview output must come from the real rendering pipeline; canvas placeholder preview is non-authoritative.
- (2026-02-09) GUI designer requires a compiler path that emits AssemblyScript template logic.
- (2026-02-09) Layout verification is required in preview scope (not optional).
- (2026-02-09) Preview interactions remain read-only and side-effect free; invoice/template writes only happen on explicit save.

## Key Constraints

- Reuse existing runtime rendering pipeline for parity (`renderTemplateOnServer` path and runtime dependencies).
- Reuse existing invoice data actions for preview inputs where possible (`fetchInvoicesPaginated`, `getInvoiceForRendering`).
- Avoid dual source-of-truth drift between GUI model and code model; source-of-truth behavior must be explicit.
- Verification must support tolerance rules so minor rendering variance is distinguishable from true layout regressions.

## Current Focus Areas

- Define compiler architecture: IR schema, deterministic codegen contract, diagnostics mapping.
- Wire preview orchestration: data load -> compile -> render -> verify lifecycle.
- Define layout verification model: expected constraints, rendered geometry extraction, comparator rules.
- Decide save gating behavior when verification reports issues.

## Runbooks

- Validate plan folder:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-02-09-invoice-template-designer-preview-workspace`
- Validate JSON files:
  - `jq empty ee/docs/plans/2026-02-09-invoice-template-designer-preview-workspace/features.json`
  - `jq empty ee/docs/plans/2026-02-09-invoice-template-designer-preview-workspace/tests.json`

## References

- `ee/docs/plans/2026-02-09-invoice-template-designer-preview-workspace/PRD.md`
- `packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx`
- `packages/billing/src/components/invoice-designer/DesignerShell.tsx`
- `packages/billing/src/actions/invoiceTemplates.ts`
- `packages/billing/src/actions/invoiceQueries.ts`
- `packages/billing/src/lib/invoice-renderer/wasm-executor.ts`
- `docs/billing/invoice_templates.md`

## Open Questions

- Should code-tab editing be read-only for GUI-authored templates to prevent drift?
- What tolerance thresholds define pass/fail for layout verification?
- Should verification failure block save, or warn-and-allow in MVP?
- Should verification run automatically on every preview render or support manual trigger for heavier templates?

## Execution Log

- (2026-02-09) F001 completed by verification: nested `Design`/`Preview` tabs already existed inside `Visual` mode and are wired through `DesignerVisualWorkspace`.
  - Evidence files: `packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx`, `packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.tsx`
  - Validation command: `npx vitest run packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.test.tsx packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.previewWorkspace.test.tsx`
  - Result: 21/21 tests passed.
- (2026-02-09) F002 completed by verification: top-level `Visual`/`Code` tabs keep behavior and preserve nested visual sub-tab state while switching.
  - Evidence file: `packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx`
  - Validation command: `npx vitest run packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.previewWorkspace.test.tsx`
  - Result: 6/6 tests passed.
- (2026-02-09) F003 implemented: preview session state now models compile/render/verify lifecycle phases with explicit `idle|running|success|error` status and per-phase error fields.
  - Rationale: later preview orchestration can dispatch phase transitions without overloading invoice list/detail loading flags.
  - Files: `packages/billing/src/components/invoice-designer/preview/previewSessionState.ts`, `packages/billing/src/components/invoice-designer/preview/previewSessionState.test.ts`
  - Validation command: `npx vitest run packages/billing/src/components/invoice-designer/preview/previewSessionState.test.ts packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.test.tsx`
  - Result: 19/19 tests passed.
- (2026-02-09) F004 completed by verification: preview supports `Sample`/`Existing` source toggling through explicit control state in `DesignerVisualWorkspace`.
  - Evidence file: `packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.tsx`
  - Validation command: `npx vitest run packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.test.tsx`
  - Result: 15/15 tests passed.
- (2026-02-09) F005 completed by verification: curated sample scenario catalog is present and wired as default preview source.
  - Evidence file: `packages/billing/src/components/invoice-designer/preview/sampleScenarios.ts`
  - Validation command: `npx vitest run packages/billing/src/components/invoice-designer/preview/sampleScenarios.test.ts`
  - Result: 2/2 tests passed.
- (2026-02-09) F006 completed by verification: Existing source selector queries invoice pages, supports search term filtering, and exposes pagination controls in preview workspace.
  - Evidence file: `packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.tsx`
  - Validation command: `npx vitest run packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.test.tsx`
  - Result: 15/15 tests passed.
- (2026-02-09) F007 completed by verification: selected existing invoice details are fetched and normalized with `mapDbInvoiceToWasmViewModel` before use in preview bindings.
  - Evidence files: `packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.tsx`, `packages/billing/src/lib/adapters/invoiceAdapters.ts`
  - Validation command: `npx vitest run packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.test.tsx packages/billing/src/lib/adapters/invoiceAdapters.test.ts`
  - Result: 17/17 tests passed.
  - Gotcha: running multiple `vitest` processes in parallel with coverage can race on `server/coverage/.tmp`; run related test files in a single `vitest run` invocation instead.
- (2026-02-09) F008 implemented: added compiler IR extraction module that converts workspace nodes into deterministic flat/tree IR with normalized metadata and canonicalized constraints.
  - Rationale: GUI compiler stages need stable node ordering and predictable metadata shape to produce deterministic codegen output.
  - Files: `packages/billing/src/components/invoice-designer/compiler/guiIr.ts`, `packages/billing/src/components/invoice-designer/compiler/guiIr.test.ts`
  - Validation command: `npx vitest run packages/billing/src/components/invoice-designer/compiler/guiIr.test.ts`
  - Result: 2/2 tests passed.
- (2026-02-09) F009 implemented: added deterministic AssemblyScript generator for GUI IR with stable node factory symbol emission and deterministic source hash output.
  - Files: `packages/billing/src/components/invoice-designer/compiler/assemblyScriptGenerator.ts`, `packages/billing/src/components/invoice-designer/compiler/assemblyScriptGenerator.test.ts`
  - Validation command: `npx vitest run packages/billing/src/components/invoice-designer/compiler/guiIr.test.ts packages/billing/src/components/invoice-designer/compiler/assemblyScriptGenerator.test.ts`
  - Result: 4/4 tests passed.
- (2026-02-09) F010 implemented: generator now emits binding helper functions and node-level binding expressions for field/table/totals metadata.
  - Field bindings: `resolveInvoiceBinding(...)` emitted from `bindingKey` + `format`.
  - Table bindings: per-column row emission uses `resolveItemBinding(...)`.
  - Totals bindings: totals rows/containers emit subtotal/tax/total expressions from invoice model.
  - Validation command: `npx vitest run packages/billing/src/components/invoice-designer/compiler/assemblyScriptGenerator.test.ts packages/billing/src/components/invoice-designer/compiler/guiIr.test.ts`
  - Result: 5/5 tests passed.
- (2026-02-09) F011 implemented: generator emits layout/style declarations from GUI node geometry + layout metadata through deterministic `applyGeneratedLayoutStyle(...)` calls.
  - Includes width/height markers, position-derived spacing, and layout align/justify hints.
  - Validation command: `npx vitest run packages/billing/src/components/invoice-designer/compiler/assemblyScriptGenerator.test.ts packages/billing/src/components/invoice-designer/compiler/guiIr.test.ts`
  - Result: 6/6 tests passed.
- (2026-02-09) F012 implemented: added per-node source map segments in codegen plus diagnostics parser/linker that maps AssemblyScript compile errors back to GUI node IDs.
  - Files: `packages/billing/src/components/invoice-designer/compiler/assemblyScriptGenerator.ts`, `packages/billing/src/components/invoice-designer/compiler/diagnostics.ts`
  - Validation command: `npx vitest run packages/billing/src/components/invoice-designer/compiler/diagnostics.test.ts packages/billing/src/components/invoice-designer/compiler/assemblyScriptGenerator.test.ts packages/billing/src/components/invoice-designer/compiler/guiIr.test.ts`
  - Result: 8/8 tests passed.
- (2026-02-09) F013 implemented: introduced transient preview compile action and shared compile-command helper to keep preview and production on the same `asc` options path.
  - Shared helper: `packages/billing/src/lib/invoice-template-compiler/assemblyScriptCompile.ts`
  - Preview compile action: `packages/billing/src/actions/invoiceTemplatePreview.ts`
  - Production compile wiring updated in `packages/billing/src/actions/invoiceTemplates.ts` to use the shared command builder.
  - Validation command: `npx vitest run packages/billing/src/lib/invoice-template-compiler/assemblyScriptCompile.test.ts packages/billing/src/actions/invoiceTemplateCompileParity.test.ts`
  - Result: 3/3 tests passed.
- (2026-02-09) F014 implemented: preview compile now uses an in-memory LRU cache keyed by source hash to skip recompilation for unchanged generated sources.
  - Cache controls exposed for tests via `__previewCompileCacheTestUtils`.
  - Validation command: `npx vitest run packages/billing/src/actions/invoiceTemplatePreview.cache.test.ts packages/billing/src/actions/invoiceTemplateCompileParity.test.ts packages/billing/src/lib/invoice-template-compiler/assemblyScriptCompile.test.ts`
  - Result: 5/5 tests passed.
- (2026-02-09) F015 implemented: preview pipeline now surfaces structured compiler diagnostics (severity/message/node mapping) and compile error details in Preview UI status panel.
  - Diagnostics come from AssemblyScript stderr parsing + GUI-node source map linking.
  - UI automation IDs: `invoice-designer-preview-compile-error`, `invoice-designer-preview-compile-diagnostics-list`, `invoice-designer-preview-compile-diagnostic-item`.
- (2026-02-09) F016 completed by implementation review: preview compile/render action path (`invoiceTemplatePreview.ts`) is transient-only and performs no invoice/template DB writes.
  - The pipeline uses temp files + wasm execution/rendering only, and does not import tenant DB helpers (`createTenantKnex`, `withTransaction`) in preview action module.
- (2026-02-09) F017 implemented: preview now runs authoritative runtime path in `runAuthoritativeInvoiceTemplatePreview`:
  1. GUI workspace -> IR -> AssemblyScript source
  2. AssemblyScript -> Wasm compile (`compilePreviewAssemblyScript`)
  3. Wasm execution (`executeWasmTemplate`) + HTML/CSS rendering (`renderLayout`)
  - UI now renders real output in `invoice-designer-preview-render-iframe`.
- (2026-02-09) F018 implemented: removed `DesignCanvas` preview rendering from Preview tab; authoritative output now comes from server-rendered HTML/CSS iframe only.
- (2026-02-09) F019 implemented: authoritative preview run effect is driven by debounced workspace nodes (`useDebouncedValue(nodes, 140)`), preventing unbounded compile/render churn during rapid edits.
- (2026-02-09) F020 implemented: Preview status panel includes manual `Re-run` control (`invoice-designer-preview-rerun`) that retriggers compile/render/verify and bypasses compile cache on demand.
- (2026-02-09) F021 implemented: Preview UI now has explicit loading/empty/error states across the pipeline:
  - Data load states for existing invoice list/detail (existing behavior retained)
  - Pipeline states for compile/render/verify (`invoice-designer-preview-*-status`)
  - Render empty/loading/error panels and verification error banner
- (2026-02-09) F022 implemented: preview rendering surface is now isolated `iframe` output with no designer interaction hooks (drag, resize, select) wired in Preview mode.
- (2026-02-09) F023 implemented: expected verification constraints are derived from GUI compiler IR via `extractExpectedLayoutConstraintsFromIr` (x/y/width/height constraint set per node).
