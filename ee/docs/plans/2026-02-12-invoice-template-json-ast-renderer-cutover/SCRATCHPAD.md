# SCRATCHPAD — Invoice Template JSON AST Renderer Cutover

## Context

- Plan folder: `ee/docs/plans/2026-02-12-invoice-template-json-ast-renderer-cutover/`
- Date started: `2026-02-12`
- Status: Draft
- Supersedes architecture direction in: `ee/docs/plans/2026-02-09-invoice-template-designer-preview-workspace/`

## Key Decisions

- Treat invoice templates as declarative data (AST), not executable code.
- Keep future calculation/grouping flexibility via declarative transform specs.
- Add optional `strategyId` hooks only through explicit allowlist resolution.
- Use one shared React renderer for preview and backend PDF generation.
- Keep migration effort minimal: no custom tenant templates exist that require backfill.

## Scope Boundaries

In scope:

- AST schema + evaluator + renderer cutover.
- Preview + save/load + PDF pipeline updates.
- Deletion of compiler and custom executor layers.

Out of scope:

- Arbitrary per-template code execution.
- Complex migration tooling for existing tenant custom templates.

## Existing Code Paths Reviewed

- Preview pipeline:
  - `packages/billing/src/actions/invoiceTemplatePreview.ts`
  - `packages/billing/src/actions/invoiceTemplatePreviewCache.ts`
- Designer/editor coupling:
  - `packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx`
  - `packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.tsx`
  - `packages/billing/src/components/invoice-designer/compiler/guiIr.ts`
  - `packages/billing/src/components/invoice-designer/compiler/assemblyScriptGenerator.ts`
  - `packages/billing/src/components/invoice-designer/compiler/diagnostics.ts`
- Runtime + rendering:
  - `packages/billing/src/lib/invoice-renderer/wasm-executor.ts`
  - `packages/billing/src/lib/invoice-renderer/quickjs-executor.ts`
  - `packages/billing/src/lib/invoice-renderer/host-functions.ts`
  - `packages/billing/src/lib/invoice-renderer/layout-renderer.ts`
- Compile orchestration:
  - `packages/billing/src/lib/invoice-template-compiler/assemblyScriptCompile.ts`
- PDF path:
  - `server/src/services/pdf-generation.service.ts`
- Persistence/types:
  - `packages/billing/src/models/invoice.ts`
  - `packages/types/src/interfaces/invoice.interfaces.ts`
  - `server/src/interfaces/invoice.interfaces.ts`

## Risks To Watch

- Parity drift while replacing compile/runtime pipeline.
- AST transform model underpowered for future grouping/calc edge cases.
- Strategy hook design becoming an unbounded execution escape hatch.

## Notes for Implementation Phase

- Start with pure declarative transform operations.
- Introduce strategy hooks only where declarative operations are insufficient.
- Keep strategy registry narrow and explicit.
- Preserve tenant-safe data access boundaries.

## Verification Commands

- Plan lint/shape:
  - `python3 scripts/validate_plan.py ee/docs/plans/2026-02-12-invoice-template-json-ast-renderer-cutover`
- Spot-check references:
  - `rg -n "guiIr|assemblyScriptGenerator|assemblyScriptCompile|wasm-executor|quickjs-executor|host-functions" packages/billing/src server/src`

## Open Questions Tracking

1. Final `Code` tab behavior for GUI templates (AST JSON read-only vs hidden).
2. Initial strategy hook set for MVP.
3. MVP expectation for layout verification under AST renderer path.

## Progress Log

### 2026-02-12 — F001 implemented

- Implemented shared AST type system in `packages/types/src/lib/invoice-template-ast.ts`.
- Added explicit versioning root model:
  - `INVOICE_TEMPLATE_AST_VERSION = 1`
  - `InvoiceTemplateAst` with `kind`, `version`, `metadata`, `styles`, `bindings`, `transforms`, `layout`.
- Added discriminated node model for layout tree:
  - `document`, `section`, `stack`, `text`, `field`, `image`, `divider`, `table`, `totals`.
- Added style model:
  - token catalog and class declarations via `InvoiceTemplateStyleCatalog`.
  - node style references via `InvoiceTemplateNodeStyleRef`.
- Added binding model:
  - value and collection binding catalogs, binding refs, and value expression union.
- Added transform model shape:
  - `filter`, `sort`, `group`, `aggregate`, `computed-field`, `totals-compose`.
  - transform base includes optional `strategyId` as schema surface for later allowlisted hook implementation.
- Exported new AST type module from `packages/types/src/index.ts`.

Rationale:

- `@alga-psa/types` is the correct shared location for contracts consumed by both app and server paths.
- Defining versioned AST and explicit discriminated unions up front reduces ambiguity before schema/runtime evaluator implementation.

Commands run:

- `npm -w @alga-psa/types run build` (fails with existing TS2209 rootDir/export-map ambiguity in this workspace).
- `npx tsc -p packages/types/tsconfig.json --noEmit` (same existing TS2209 issue).
- `npm -w @alga-psa/types test` (fails on existing unrelated `src/interfaces/barrel.test.ts` stray `tax.interfaces` export).

Gotchas:

- `@alga-psa/types` package currently has baseline build/test failures unrelated to AST changes; continue with targeted feature implementation and track failures in commit notes.
