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
