# Scratchpad — Invoice Template Transforms Designer

- Plan slug: `invoice-template-transforms-designer`
- Created: `2026-03-08`

## What This Is

Working notes for adding a first-class transforms designer to the invoice template editor so collection shaping can be authored and preserved visually.

## Decisions

- (2026-03-08) V1 scope is aggregation-first, not full-AST authoring. The GUI will cover `filter`, `sort`, `group`, and `aggregate`.
- (2026-03-08) V1 targets any collection binding, even though invoice line aggregation is the main motivating case.
- (2026-03-08) The full AST code tab stays generated/read-only in v1; no raw editable transform JSON.
- (2026-03-08) The transforms surface should be a dedicated tab, not an overlay inside the design canvas.
- (2026-03-08) Dynamic tables are the primary transformed-output consumer in v1 and must be able to bind to the pipeline output.

## Discoveries / Constraints

- (2026-03-08) `InvoiceTemplateEditor.tsx` always saves by exporting the visual workspace to AST, so anything not represented in workspace state gets dropped on save.
- (2026-03-08) `workspaceAst.ts` currently imports/exports bindings and layout but does not preserve `ast.transforms`.
- (2026-03-08) The invoice template AST schema already supports a single template-level `transforms` block with `sourceBindingId`, `outputBindingId`, and ordered operations.
- (2026-03-08) The evaluator/renderer already support grouped output and transformed binding resolution, so the main gap is authoring + persistence.
- (2026-03-08) Grouped output rows expose `key`, `items`, and per-group `aggregates`, which is sufficient for grouped table rendering.
- (2026-03-08) Authoritative preview needed one additional export fix: when a dynamic-table node targets the authored transform output binding, AST export must preserve that binding ID directly instead of re-registering it as a synthetic `collection.<path>` binding, otherwise preview/render resolution breaks.
- (2026-03-08) The transforms surface is now fully represented in designer state, imported/exported through `workspaceAst.ts`, and exercised through visual editor save/reopen/code-tab tests.
- (2026-03-08) Dynamic-table authoring now resolves transformed/grouped row paths from previewed transform output, including grouped fields such as `item.key` and `item.aggregates.<aggregateId>`.

## Completed Work

- (2026-03-08) Added the top-level `Transforms` tab to the invoice template editor and preserved `Design` and `Preview` flows while switching tabs.
- (2026-03-08) Extended workspace/store snapshots and history to carry transform source binding, output binding, ordered operations, and selection state.
- (2026-03-08) Implemented full transforms authoring UI for `filter`, `sort`, `group`, and `aggregate`, including add/duplicate/delete/reorder controls, source metadata, output binding editing, live output preview, and inline validation/errors.
- (2026-03-08) Enabled dynamic tables to bind to transform output collections and surfaced transformed/grouped row-path suggestions in the table mapping UI.
- (2026-03-08) Fixed AST export so authoritative preview and renderer respect transform output bindings end to end, including grouped/aggregated table rendering.
- (2026-03-08) Completed regression, integration, renderer, and preview coverage for transforms authoring, save/reopen round-trips, code-tab generation, non-transform safety, and aggregation-first invoice workflows.

## Commands / Runbooks

- (2026-03-08) Inspect editor save flow:
  - `sed -n '1,260p' packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx`
- (2026-03-08) Inspect workspace AST import/export:
  - `sed -n '820,1180p' packages/billing/src/components/invoice-designer/ast/workspaceAst.ts`
- (2026-03-08) Inspect AST schema transform support:
  - `sed -n '430,520p' packages/billing/src/lib/invoice-template-ast/schema.ts`
- (2026-03-08) Inspect evaluator/renderer transform behavior:
  - `sed -n '430,640p' packages/billing/src/lib/invoice-template-ast/evaluator.ts`
  - `sed -n '330,460p' packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`
- (2026-03-08) Run targeted transforms/editor/preview verification:
  - `cd server && npx vitest run --coverage.enabled false ../packages/billing/src/components/invoice-designer/state/designerStore.exportWorkspace.test.ts ../packages/billing/src/components/invoice-designer/state/designerStore.loadWorkspace.legacy.test.ts ../packages/billing/src/components/invoice-designer/ast/workspaceAst.test.ts ../packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.test.tsx ../packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.previewWorkspace.test.tsx ../packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.authoritativeFlow.test.tsx ../packages/billing/src/components/invoice-designer/transforms/TransformsWorkspace.integration.test.tsx ../packages/billing/src/components/invoice-designer/inspector/TableEditorWidget.integration.test.tsx ../packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts ../packages/billing/src/lib/invoice-template-ast/react-renderer.test.tsx`
  - Result: `10` files passed, `99` tests passed.
- (2026-03-08) Run focused transforms workspace verification while stabilizing selector interactions:
  - `cd server && npx vitest run --coverage.enabled false ../packages/billing/src/components/invoice-designer/transforms/TransformsWorkspace.integration.test.tsx`
  - Result: passing; remaining output is limited to existing React `act(...)` warnings during select interactions.

## Links / References

- Prior planning pass in this conversation established:
  - aggregation-first v1
  - any collection binding
  - read-only code tab
- Key files:
  - `packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx`
  - `packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.tsx`
  - `packages/billing/src/components/invoice-designer/transforms/TransformsWorkspace.tsx`
  - `packages/billing/src/components/invoice-designer/transforms/transformWorkspace.ts`
  - `packages/billing/src/components/invoice-designer/ast/workspaceAst.ts`
  - `packages/billing/src/components/invoice-designer/state/designerStore.ts`
  - `packages/billing/src/components/invoice-designer/inspector/widgets/TableEditorWidget.tsx`
  - `packages/billing/src/lib/invoice-template-ast/schema.ts`
  - `packages/billing/src/lib/invoice-template-ast/evaluator.ts`
  - `packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`

## Open Questions

- Should v2 expose `computed-field` and `totals-compose` once the base transforms tab is stable?
- Should a future advanced mode allow editing only the `transforms` block while keeping the rest of the AST generated?
