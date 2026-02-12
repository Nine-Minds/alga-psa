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

### 2026-02-12 — F002 implemented

- Added runtime AST schema parser in `packages/billing/src/lib/invoice-template-ast/schema.ts`.
- Implemented strict Zod schemas for:
  - AST root (`kind`, `version`, `metadata`, `styles`, `bindings`, `transforms`, `layout`),
  - recursive layout nodes,
  - expressions, predicates, and transform operation payloads.
- Added structured validation model:
  - `InvoiceTemplateAstValidationError` (`code`, `path`, `message`),
  - `validateInvoiceTemplateAst(input)` returning success/error union,
  - `parseInvoiceTemplateAst(input)` throwing a consolidated message for invalid payloads.
- Added targeted validator tests in `packages/billing/src/lib/invoice-template-ast/schema.test.ts`.

Rationale:

- Runtime schema validation is required before evaluator/renderer cutover so preview/PDF pipelines can fail fast with actionable diagnostics.
- Strict object validation prevents accidental schema drift and catches unknown fields early.

Commands run:

- `npx vitest run packages/billing/src/lib/invoice-template-ast/schema.test.ts` (pass).

### 2026-02-12 — F003 implemented

- Extended AST node model with explicit repeatable region support:
  - Added `dynamic-table` node type in `packages/types/src/lib/invoice-template-ast.ts`.
  - Added `InvoiceTemplateRepeatRegionBinding` with required `sourceBinding` and `itemBinding`.
- Updated runtime validator in `packages/billing/src/lib/invoice-template-ast/schema.ts`:
  - Added `dynamic-table` schema variant.
  - Enforced required repeat metadata (`repeat.sourceBinding`, `repeat.itemBinding`).
- Added/extended tests in `packages/billing/src/lib/invoice-template-ast/schema.test.ts` to ensure:
  - missing repeat binding metadata fails with structured path-aware errors,
  - valid dynamic table payload passes.

Rationale:

- Repeatable line-item regions should be first-class AST semantics, not implicit conventions on generic tables.
- Explicit repeat metadata is required for deterministic evaluator behavior in upcoming features.

Commands run:

- `npx vitest run packages/billing/src/lib/invoice-template-ast/schema.test.ts` (pass).

### 2026-02-12 — F004 implemented

- Completed declarative transform operation representation in AST:
  - Existing transform union now enforced as strict runtime schema in `packages/billing/src/lib/invoice-template-ast/schema.ts`.
  - Supported operations: `filter`, `sort`, `group`, `aggregate`, `computed-field`, `totals-compose`.
- Strengthened runtime payload constraints:
  - `transforms.operations` must be non-empty.
  - `sort.keys`, `aggregate.aggregations`, `computed-field.fields`, `totals-compose.totals` must be non-empty.
  - logical predicates require at least one condition.
- Added transform-shape tests in `packages/billing/src/lib/invoice-template-ast/schema.test.ts`:
  - invalid empty `sort.keys` rejected with structured path errors,
  - valid composed filter/sort/group/aggregate/computed payload accepted.

Rationale:

- This locks in declarative transform expressiveness before evaluator implementation and catches malformed transform configs early.

Commands run:

- `npx vitest run packages/billing/src/lib/invoice-template-ast/schema.test.ts` (pass).

### 2026-02-12 — F005 implemented

- Confirmed/retained `strategyId?: string` on transform operation base model in:
  - `packages/types/src/lib/invoice-template-ast.ts`
  - `packages/billing/src/lib/invoice-template-ast/schema.ts`
- Added runtime acceptance test in `packages/billing/src/lib/invoice-template-ast/schema.test.ts` ensuring `strategyId` is valid on grouped/aggregate transforms.

Rationale:

- Declares extension points in AST shape now, while deferring actual strategy resolution/execution to allowlisted registry implementation.

Commands run:

- `npx vitest run packages/billing/src/lib/invoice-template-ast/schema.test.ts` (pass).

### 2026-02-12 — F006 implemented

- Added allowlisted strategy registry in `packages/billing/src/lib/invoice-template-ast/strategies.ts`.
- Implemented explicit APIs:
  - `listAllowlistedInvoiceTemplateStrategyIds()`
  - `isAllowlistedInvoiceTemplateStrategy(strategyId)`
  - `resolveInvoiceTemplateStrategy(strategyId)`
  - `executeInvoiceTemplateStrategy(strategyId, input)`
- Added strict unknown-strategy rejection with typed error:
  - `InvoiceTemplateStrategyResolutionError`
  - error code: `STRATEGY_NOT_ALLOWLISTED`.
- Seeded initial allowlisted strategies for upcoming evaluator usage:
  - `custom-group-key`
  - `custom-aggregate`
- Added unit tests in `packages/billing/src/lib/invoice-template-ast/strategies.test.ts` for known/unknown strategy behavior.

Rationale:

- Strategy execution must be explicit and allowlisted to preserve non-arbitrary-code security posture while enabling controlled extensibility.

Commands run:

- `npx vitest run packages/billing/src/lib/invoice-template-ast/schema.test.ts packages/billing/src/lib/invoice-template-ast/strategies.test.ts` (pass).

### 2026-02-12 — F007 implemented

- Added shared AST evaluator in `packages/billing/src/lib/invoice-template-ast/evaluator.ts`.
- Implemented declarative transform execution over invoice collections:
  - `filter` via predicate evaluation
  - `sort` via stable multi-key ordering
  - `group` with optional strategy hook support
  - `aggregate` for `sum/count/avg/min/max` (overall + per-group aggregates)
  - `computed-field` for derived numeric expressions
  - `totals-compose` for totals from aggregate refs/computation expressions
- Evaluator exports:
  - `evaluateInvoiceTemplateAst(ast, invoiceData)`
  - `evaluateAstTransforms(ast, invoiceData)` alias
  - typed result with `output`, `groups`, `aggregates`, `totals`, and resolved `bindings`.
- Added evaluator test suite in `packages/billing/src/lib/invoice-template-ast/evaluator.test.ts`.

Rationale:

- Central evaluator module is the core abstraction needed to unify preview and PDF behavior around AST data-shaping semantics.

Commands run:

- `npx vitest run packages/billing/src/lib/invoice-template-ast/evaluator.test.ts packages/billing/src/lib/invoice-template-ast/schema.test.ts packages/billing/src/lib/invoice-template-ast/strategies.test.ts` (pass).

### 2026-02-12 — F008 implemented

- Added deterministic output normalization in evaluator (`packages/billing/src/lib/invoice-template-ast/evaluator.ts`):
  - recursive plain-object key sorting before returning `output`, `groups`, `aggregates`, `totals`, and `bindings`.
  - stable sort implementation already used index tie-break to preserve deterministic ordering.
- Added explicit determinism test in `packages/billing/src/lib/invoice-template-ast/evaluator.test.ts`:
  - repeated evaluation of identical AST+input yields byte-for-byte identical JSON payload.

Rationale:

- Deterministic evaluation output is required for reproducible preview/PDF parity checks and reliable caching/verification logic.

Commands run:

- `npx vitest run packages/billing/src/lib/invoice-template-ast/evaluator.test.ts` (pass).
