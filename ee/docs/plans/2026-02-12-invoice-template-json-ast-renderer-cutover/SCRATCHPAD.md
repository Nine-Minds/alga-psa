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

### 2026-02-12 — F009 implemented

- Upgraded evaluator failure handling to structured error model in `packages/billing/src/lib/invoice-template-ast/evaluator.ts`.
- Added `InvoiceTemplateEvaluationIssue` and enriched `InvoiceTemplateEvaluationError` with:
  - canonical error code,
  - operationId (where applicable),
  - issue list payload for multi-error contexts.
- Covered required failure classes:
  - `SCHEMA_VALIDATION_FAILED` (integrated runtime schema validation before evaluation),
  - `MISSING_BINDING` (undefined source binding),
  - `UNKNOWN_STRATEGY` / `STRATEGY_EXECUTION_FAILED`,
  - `INVALID_TRANSFORM_INPUT`,
  - `INVALID_OPERAND` (e.g., unresolved aggregate references).
- Added evaluator tests asserting explicit codes and structured issue payloads in `packages/billing/src/lib/invoice-template-ast/evaluator.test.ts`.

Rationale:

- Preview/PDF pipeline error surfacing needs explicit, machine-readable evaluator errors rather than ad hoc thrown strings.

Commands run:

- `npx vitest run packages/billing/src/lib/invoice-template-ast/evaluator.test.ts` (pass).

### 2026-02-12 — F010 implemented

- Added shared React renderer module in `packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`.
- Implemented renderer component + server-safe static markup helper:
  - `InvoiceTemplateAstRenderer`
  - `renderEvaluatedInvoiceTemplateAst(ast, evaluation) -> { html, css }`
- Supported node rendering for:
  - `document`, `section`, `stack`, `text`, `field`, `image`, `divider`, `table`, `dynamic-table`, `totals`.
- Implemented expression/value resolution against evaluator bindings and row scope.
- Implemented class/token CSS generation from AST style catalog.
- Added renderer tests in `packages/billing/src/lib/invoice-template-ast/react-renderer.test.tsx` for:
  - static text/field/table/totals rendering,
  - style/class consistency,
  - unsafe content escaping in output HTML.

Rationale:

- This is the shared rendering surface required for both interactive preview and backend PDF paths.

Commands run:

- `npx vitest run packages/billing/src/lib/invoice-template-ast/react-renderer.test.tsx packages/billing/src/lib/invoice-template-ast/evaluator.test.ts packages/billing/src/lib/invoice-template-ast/schema.test.ts packages/billing/src/lib/invoice-template-ast/strategies.test.ts` (pass).

### 2026-02-12 — F011 implemented

- Added server-side HTML document wrapper helper in `packages/billing/src/lib/invoice-template-ast/server-render.ts`.
- Implemented `renderInvoiceTemplateAstHtmlDocument(ast, evaluation, options)` to:
  - call the shared React renderer (`renderEvaluatedInvoiceTemplateAst`),
  - wrap output in a complete `<!doctype html><html><head><body>` document,
  - include generated CSS + optional additional CSS,
  - support configurable title/body class with HTML escaping.
- Added unit test `packages/billing/src/lib/invoice-template-ast/server-render.test.ts` validating complete wrapper output for headless PDF use.

Rationale:

- PDF pipeline needs a full HTML document entrypoint, but should reuse the exact same AST React renderer output to maintain parity.

Commands run:

- `npx vitest run packages/billing/src/lib/invoice-template-ast/*.test.ts packages/billing/src/lib/invoice-template-ast/*.test.tsx` (pass).

### 2026-02-12 — F012 implemented

- Added designer workspace -> AST exporter in:
  - `packages/billing/src/components/invoice-designer/ast/workspaceAst.ts`
  - with helper `exportWorkspaceToInvoiceTemplateAst(workspace)` and JSON helper.
- Export mapping now emits versioned `InvoiceTemplateAst` directly from visual workspace (no IR step).
- Updated `InvoiceTemplateEditor` visual save/export path (`packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx`):
  - replaced IR/AssemblyScript generation in code-view projection with AST JSON projection,
  - on save with GUI designer enabled, persists canonical `templateAst` payload directly from workspace export,
  - keeps legacy `assemblyScriptSource` comment persistence only as temporary compatibility scaffolding.
- Added exporter tests:
  - `packages/billing/src/components/invoice-designer/ast/workspaceAst.test.ts`.

Rationale:

- This establishes AST as the designer export artifact and removes compiler-IR coupling from the visual export path.

Commands run:

- `npx vitest run packages/billing/src/components/invoice-designer/ast/workspaceAst.test.ts` (pass).
- `npx vitest run packages/billing/src/components/invoice-designer/ast/workspaceAst.test.ts packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.previewWorkspace.test.tsx packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.authoritativeFlow.test.tsx` (fails due existing React 19 test harness issue: `React.act is not a function` from `@testing-library/react`/`react-dom-test-utils` in this environment).

### 2026-02-12 — F013 implemented

- Extended AST utility module (`packages/billing/src/components/invoice-designer/ast/workspaceAst.ts`) with import/hydration support:
  - `importInvoiceTemplateAstToWorkspace(ast)` builds designer workspace snapshot from persisted AST.
- Updated `InvoiceTemplateEditor` hydration flow (`packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx`):
  - prefers `templateAst` payload hydration when available,
  - falls back to legacy embedded-source/localStorage workspace hydration only if AST hydration is unavailable or fails.
- Added AST import coverage in `packages/billing/src/components/invoice-designer/ast/workspaceAst.test.ts`.
- Added editor integration expectation for `templateAst` hydration in `packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.previewWorkspace.test.tsx` (execution blocked by existing act-compat issue in current test harness).

Rationale:

- Save/reopen flow should hydrate editor state from canonical AST representation as cutover progresses.

Commands run:

- `npx vitest run packages/billing/src/components/invoice-designer/ast/workspaceAst.test.ts` (pass).
- `npx vitest run packages/billing/src/components/invoice-designer/ast/workspaceAst.test.ts packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.previewWorkspace.test.tsx packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.authoritativeFlow.test.tsx` (editor test files fail due existing `React.act is not a function` harness issue).

### 2026-02-12 — F014 implemented

- Confirmed `InvoiceTemplateEditor` no longer imports or calls:
  - `extractInvoiceDesignerIr`
  - `generateAssemblyScriptFromIr`
- Save path now uses AST exporter (`exportWorkspaceToInvoiceTemplateAst`) instead of IR/compiler generation.

Verification:

- `rg -n "extractInvoiceDesignerIr|generateAssemblyScriptFromIr" packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx` (no matches).

### 2026-02-12 — F015 implemented

- Updated shared and server invoice template contracts to include canonical AST payload:
  - `packages/types/src/interfaces/invoice.interfaces.ts`
  - `server/src/interfaces/invoice.interfaces.ts`
- Contract updates:
  - added `templateAst?: InvoiceTemplateAst | null`
  - relaxed `assemblyScriptSource` from required to optional (`assemblyScriptSource?: string`) for cutover compatibility.
- Added type contract test:
  - `packages/types/src/interfaces/invoice-template-ast-contract.typecheck.test.ts`
  - verifies `IInvoiceTemplate` accepts AST payload without requiring legacy AssemblyScript source.

Commands run:

- `npx vitest run packages/types/src/interfaces/invoice-template-ast-contract.typecheck.test.ts` (pass).

### 2026-02-12 — F016 implemented

- Added DB migration for tenant template AST persistence:
  - `server/migrations/20260212143000_add_template_ast_to_invoice_templates.cjs`
  - introduces nullable `templateAst` JSONB column on `invoice_templates`.
- Updated template read/write repository/model paths:
  - `packages/billing/src/actions/invoiceTemplates.ts`
    - `getInvoiceTemplate` now selects `templateAst`,
    - `saveInvoiceTemplate` now treats `templateAst` payload as canonical and skips compile gating for AST templates.
  - `packages/billing/src/models/invoice.ts`
    - tenant template list path includes `templateAst`,
    - upsert merge list includes `templateAst`.
- Updated API schema contract:
  - `server/src/lib/api/schemas/invoiceSchemas.ts`
  - `assemblyScriptSource` optional, `templateAst` optional nullable object payload.
- Added wiring tests:
  - `packages/billing/src/actions/invoiceTemplateAstPersistenceWiring.test.ts`.

Rationale:

- Persistence/read paths now treat AST as first-class template payload while keeping legacy fields for transition compatibility.

Commands run:

- `npx vitest run packages/billing/src/actions/invoiceTemplateAstPersistenceWiring.test.ts` (pass).
- `npx vitest run packages/billing/src/actions/invoiceTemplateCompileParity.test.ts packages/types/src/interfaces/invoice-template-ast-contract.typecheck.test.ts packages/billing/src/components/invoice-designer/ast/workspaceAst.test.ts` (pass).

### 2026-02-12 — F017 implemented

- Added AST-based standard template definitions:
  - `packages/billing/src/lib/invoice-template-ast/standardTemplates.ts`
  - includes `standard-default` and `standard-detailed` canonical AST payloads.
- Added DB migration for standard template AST persistence:
  - `server/migrations/20260212143500_add_template_ast_to_standard_invoice_templates.cjs`
- Updated standard template read/update wiring:
  - `packages/billing/src/models/invoice.ts` now selects `templateAst` for standard templates and falls back to AST definitions by standard code.
  - `packages/billing/src/actions/invoiceTemplates.ts` now writes canonical `templateAst` during `compileStandardTemplate` updates.
- Added tests:
  - `packages/billing/src/lib/invoice-template-ast/standardTemplates.test.ts`
  - extended `packages/billing/src/actions/invoiceTemplateAstPersistenceWiring.test.ts` for standard-template AST wiring assertions.

Rationale:

- Standard templates now have AST-native source representations, enabling unified renderer/evaluator behavior with tenant templates.

Commands run:

- `npx vitest run packages/billing/src/lib/invoice-template-ast/standardTemplates.test.ts packages/billing/src/actions/invoiceTemplateAstPersistenceWiring.test.ts` (pass).

### 2026-02-12 — F018 implemented

- Rewrote authoritative preview execution path in `packages/billing/src/actions/invoiceTemplatePreview.ts`:
  - replaced GUI IR + AssemblyScript compile + Wasm execution path inside `runAuthoritativeInvoiceTemplatePreview`,
  - now exports workspace to AST (`exportWorkspaceToInvoiceTemplateAst`), validates schema (`validateInvoiceTemplateAst`), evaluates transforms (`evaluateInvoiceTemplateAst`), and renders HTML/CSS via shared React renderer (`renderEvaluatedInvoiceTemplateAst`).
- Preview response semantics for this stage:
  - `sourceHash` now hashes canonical AST JSON,
  - `generatedSource` now carries AST JSON,
  - compile section is retained for compatibility but no longer performs compilation (`cacheHit=false`, diagnostics reflect AST/evaluator issues).
- Updated integration coverage in `packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts`:
  - now asserts AST validation+evaluator+renderer execution and rendered output presence,
  - invocation adjusted to pass mocked auth/context args because `withAuth` is mocked as identity in this suite.

Rationale:

- This completes the preview runtime cutover for authoritative rendering while preserving response shape compatibility for downstream UI wiring.

Commands run:

- `pnpm vitest packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts` (pass).
- `pnpm vitest packages/billing/src/lib/invoice-template-ast/schema.test.ts packages/billing/src/lib/invoice-template-ast/evaluator.test.ts packages/billing/src/lib/invoice-template-ast/react-renderer.test.tsx` (tests pass; run exits non-zero in this environment due pre-existing coverage temp dir `server/coverage/.tmp` ENOENT after reporting).

### 2026-02-12 — F019 implemented

- Preserved Sample/Existing source-selection semantics for preview UX after AST backend cutover.
- Added source-mode specific test coverage in pure preview state/status modules:
  - `packages/billing/src/components/invoice-designer/preview/previewStatus.test.ts`
    - sample source validity now explicitly verified to depend on preview sample payload.
  - `packages/billing/src/components/invoice-designer/preview/previewSessionState.test.ts`
    - source toggle flow verifies sample selection is preserved across Sample <-> Existing transitions.

Rationale:

- These tests guard the source-selection UX contract independently of the compile/runtime pipeline internals.

Commands run:

- `pnpm vitest packages/billing/src/components/invoice-designer/preview/previewStatus.test.ts packages/billing/src/components/invoice-designer/preview/previewSessionState.test.ts` (pass).
- `pnpm vitest packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts` (test passes; command exits non-zero in this environment due existing coverage temp dir issue: `server/coverage/.tmp` ENOENT).
- Attempted targeted `DesignerVisualWorkspace` component source-switch tests; blocked by pre-existing `React.act is not a function` compatibility issue in current React/testing-library stack.

### 2026-02-12 — F020 implemented

- Remapped preview pipeline phase semantics from `compile/render/verify` to `shape/render/verify` in designer preview state and UI surface.
- Updated preview state model and reducer:
  - `packages/billing/src/components/invoice-designer/preview/previewSessionState.ts`
  - renamed `compileStatus/compileError` -> `shapeStatus/shapeError`
  - phase enum now uses `'shape' | 'render' | 'verify'`.
- Updated phase display derivation:
  - `packages/billing/src/components/invoice-designer/preview/previewStatus.ts`
  - status snapshot now tracks `shapeStatus`.
- Updated `DesignerVisualWorkspace` status wiring and UX copy:
  - dispatches/reads `shape` phase state,
  - status label now reads `Shape`,
  - loading text updated to `Shaping and rendering preview...`,
  - automation IDs moved from `...preview-compile-*` to `...preview-shape-*` for status/error/diagnostics/cache markers.
- Updated related tests:
  - `previewSessionState.test.ts`
  - `previewStatus.test.ts`
  - string/automation-id expectations in `DesignerVisualWorkspace.test.tsx` aligned to `shape` terminology.

Rationale:

- Preview UX now reflects the AST pipeline's shaping step instead of a compiler phase.

Commands run:

- `pnpm vitest packages/billing/src/components/invoice-designer/preview/previewSessionState.test.ts packages/billing/src/components/invoice-designer/preview/previewStatus.test.ts` (pass).

### 2026-02-12 — F021 implemented

- Retained and strengthened structured preview diagnostics with AST/evaluator context in `runAuthoritativeInvoiceTemplatePreview`:
  - `packages/billing/src/actions/invoiceTemplatePreview.ts`
  - expanded diagnostic payload with `kind`, `code`, `path`, and `operationId` metadata.
  - schema validation failures now emit `kind: 'schema'` diagnostics with path/code context.
  - evaluator failures now emit `kind: 'evaluation'` diagnostics with operation/path/code context.
  - non-evaluator runtime failures now emit `kind: 'runtime'` diagnostics.
- Updated preview diagnostics rendering surface:
  - `packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.tsx`
  - diagnostics list now renders contextual `code/path/op` metadata alongside message severity.
- Added integration coverage for structured diagnostics:
  - `packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts`
  - validates schema diagnostic context mapping and evaluator diagnostic context mapping.

Rationale:

- Preview diagnostics now preserve machine-meaningful context needed for targeted AST/evaluator debugging without reverting to compiler-era error formats.

Commands run:

- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts` (pass).
- `pnpm vitest --coverage.enabled=false packages/billing/src/components/invoice-designer/preview/previewSessionState.test.ts packages/billing/src/components/invoice-designer/preview/previewStatus.test.ts` (pass).

### 2026-02-12 — F022 implemented

- Updated server PDF generation invoice path to use AST evaluator + shared renderer output instead of Wasm execution in:
  - `server/src/services/pdf-generation.service.ts`
- Changes made:
  - removed `getCompiledWasm`, `executeWasmTemplate`, and `renderLayout` usage/imports from invoice PDF rendering flow,
  - now requires canonical `templateAst` on selected template,
  - evaluates AST with `evaluateInvoiceTemplateAst`,
  - produces complete HTML document via `renderInvoiceTemplateAstHtmlDocument` for Puppeteer PDF generation.
- Added wiring coverage:
  - `packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts`
  - asserts PDF service uses AST helper path and no longer references Wasm execution helpers.

Rationale:

- Backend invoice PDF generation now consumes the declarative AST rendering path and removes runtime dependence on Wasm executor in the PDF service.

Commands run:

- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts` (pass).
- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts` (pass).

### 2026-02-12 — F023 implemented

- Aligned preview and PDF/server render paths onto shared AST evaluator/renderer modules.
- Updated template server-render action in:
  - `packages/billing/src/actions/invoiceTemplates.ts`
  - `renderTemplateOnServer` no longer executes Wasm; it now:
    - resolves template from tenant+standard template set,
    - requires canonical `templateAst`,
    - evaluates via `evaluateInvoiceTemplateAst`,
    - renders via `renderEvaluatedInvoiceTemplateAst`.
- Extended parity wiring assertions in:
  - `packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts`
  - verifies preview action, PDF service, and `renderTemplateOnServer` all use AST evaluator/renderer stack.

Rationale:

- This ensures preview and both server-side rendering entry points share the same rendering core and reduces parity drift risk.

Commands run:

- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts` (pass).
- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoiceTemplateAstPersistenceWiring.test.ts packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts` (pass).

### 2026-02-12 — F024 implemented

- Removed preview compile-cache/Wasm artifact cache logic from preview pipeline.
- Deleted cache module and its unit tests:
  - `packages/billing/src/actions/invoiceTemplatePreviewCache.ts` (deleted)
  - `packages/billing/src/actions/invoiceTemplatePreview.cache.test.ts` (deleted)
- Updated preview action contract and implementation:
  - `packages/billing/src/actions/invoiceTemplatePreview.ts`
  - removed cache imports and cache key resolution,
  - removed cached artifact lookup/set operations,
  - removed `cacheHit` fields from preview compile status payload,
  - removed preview input cache-bypass flag from authoritative preview path.
- Updated preview UI status behavior:
  - `packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.tsx`
  - removed cache-hit badge and cache-bypass request plumbing while preserving manual rerun behavior.
- Updated related tests and added explicit cache-removal wiring coverage:
  - `packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts`
  - `packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.test.tsx`
  - `packages/billing/src/actions/invoiceTemplatePreviewCacheRemoval.test.ts` (new).

Rationale:

- Preview execution no longer compiles or executes Wasm, so compile-artifact cache lifecycle is obsolete and removed.

Commands run:

- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts packages/billing/src/actions/invoiceTemplatePreviewCacheRemoval.test.ts` (pass).
- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts` (pass).

### 2026-02-12 — F025 implemented

- Deleted PRD-listed legacy compiler/executor modules from billing package:
  - `packages/billing/src/components/invoice-designer/compiler/guiIr.ts`
  - `packages/billing/src/components/invoice-designer/compiler/assemblyScriptGenerator.ts`
  - `packages/billing/src/components/invoice-designer/compiler/diagnostics.ts`
  - `packages/billing/src/lib/invoice-template-compiler/assemblyScriptCompile.ts`
  - `packages/billing/src/lib/invoice-renderer/wasm-executor.ts`
  - `packages/billing/src/lib/invoice-renderer/quickjs-executor.ts`
  - `packages/billing/src/lib/invoice-renderer/host-functions.ts`
- Removed associated dead test/snapshot scaffolding tied to deleted modules.
- Reworked affected action paths to remove imports of deleted modules:
  - `packages/billing/src/actions/invoiceTemplatePreview.ts` now only contains AST preview runtime path,
  - `packages/billing/src/actions/invoiceTemplates.ts` no longer imports compiler helper module.
- Added explicit removal wiring test:
  - `packages/billing/src/actions/invoiceLegacyCompilerRemoval.test.ts`.

Rationale:

- This removes the custom compiler/executor layer from billing runtime code and enforces absence via tests.

Commands run:

- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoiceLegacyCompilerRemoval.test.ts packages/billing/src/actions/invoiceTemplateCompileParity.test.ts packages/billing/src/actions/invoiceTemplateAstPersistenceWiring.test.ts` (pass).
- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts packages/billing/src/actions/invoiceTemplatePreview.inv005.sanity.test.ts packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts packages/billing/src/actions/invoiceTemplatePreviewCacheRemoval.test.ts` (pass).
