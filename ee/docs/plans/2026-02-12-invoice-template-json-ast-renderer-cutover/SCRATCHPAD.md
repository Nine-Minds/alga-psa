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

### 2026-02-12 — F026 implemented

- Removed save-time AssemblyScript compile and Wasm persistence behavior from invoice template actions:
  - `packages/billing/src/actions/invoiceTemplates.ts`
- `saveInvoiceTemplate` now persists template metadata directly (AST canonical) without compile gating.
- `compileAndSaveTemplate` retained as compatibility API shape but now performs direct metadata save (no compile command, no Wasm generation).
- `compileStandardTemplate` now updates `assemblyScriptSource`/`templateAst`/`sha` only and no longer writes compiled `wasmBinary` artifacts.
- Updated startup sync behavior accordingly:
  - `server/src/lib/startupTasks.ts` no longer treats missing `wasmBinary` as a recompilation trigger.
- Updated wiring tests to enforce no save-time compile path:
  - `packages/billing/src/actions/invoiceTemplateAstPersistenceWiring.test.ts`
  - `packages/billing/src/actions/invoiceTemplateCompileParity.test.ts`

Rationale:

- Template save/update behavior now reflects AST-as-data architecture and avoids compiler lifecycle during persistence.

Commands run:

- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoiceTemplateAstPersistenceWiring.test.ts packages/billing/src/actions/invoiceTemplateCompileParity.test.ts packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts` (pass).
- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts packages/billing/src/actions/invoiceTemplatePreview.inv005.sanity.test.ts packages/billing/src/actions/invoiceLegacyCompilerRemoval.test.ts` (pass).

### 2026-02-12 — F027 implemented

- Removed runtime dependency on `getCompiledWasm` for invoice rendering paths.
- Active render entry points now use AST evaluator/renderer stack and do not fetch compiled Wasm:
  - `packages/billing/src/actions/invoiceTemplates.ts` (`renderTemplateOnServer`)
  - `server/src/services/pdf-generation.service.ts`
  - `packages/billing/src/actions/invoiceTemplatePreview.ts`
- `getCompiledWasm` action remains only as an explicit unsupported guard path and is not used by rendering flows.
- Added/updated wiring assertions to prevent regressions:
  - `packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts`
  - `packages/billing/src/actions/invoiceLegacyCompilerRemoval.test.ts`

Rationale:

- Invoice runtime rendering no longer depends on Wasm artifact retrieval lifecycle.

Commands run:

- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoiceTemplateAstPersistenceWiring.test.ts packages/billing/src/actions/invoiceTemplateCompileParity.test.ts packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts` (pass).
- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts packages/billing/src/actions/invoiceTemplatePreview.inv005.sanity.test.ts packages/billing/src/actions/invoiceLegacyCompilerRemoval.test.ts` (pass).

### 2026-02-12 — F028 implemented

- Defined and verified compatibility behavior where legacy template columns may coexist with canonical AST payloads.
- Runtime rendering paths now explicitly treat `templateAst` as canonical and do not consume legacy `assemblyScriptSource`/`wasmBinary` columns:
  - `server/src/services/pdf-generation.service.ts`
  - `packages/billing/src/actions/invoiceTemplates.ts` (`renderTemplateOnServer`)
- Extended wiring coverage:
  - `packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts`
  - new assertion checks render-action block uses `template.templateAst` and does not depend on legacy runtime columns.

Rationale:

- Legacy columns remain available as temporary scaffolding, but runtime cutover behavior is AST-first and deterministic.

Commands run:

- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts` (pass).

### 2026-02-12 — F029 implemented

- Reinforced no-arbitrary-code security posture at runtime by exercising strategy allowlist enforcement through preview action integration.
- Added preview integration coverage for non-allowlisted strategy rejection:
  - `packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts`
  - mocks AST export with an invalid `strategyId` and asserts structured `UNKNOWN_STRATEGY` evaluator diagnostics are returned.
- Existing strategy registry/evaluator guardrails remain in place:
  - allowlist checks in `packages/billing/src/lib/invoice-template-ast/strategies.ts`
  - evaluator rejection path in `packages/billing/src/lib/invoice-template-ast/evaluator.ts`.

Rationale:

- Strategy execution remains constrained to explicit allowlisted functions and rejects arbitrary IDs in runtime paths.

Commands run:

- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts` (pass).

### 2026-02-12 — F030 implemented

- Expanded evaluator unit coverage for transform semantics and edge behavior in:
  - `packages/billing/src/lib/invoice-template-ast/evaluator.test.ts`
- Added coverage for:
  - explicit composition order behavior (`filter -> sort -> group -> aggregate`),
  - empty-item edge case behavior for grouping/aggregate/totals composition outputs.
- Existing AST schema + strategy + evaluator unit suites now cover core transform semantics comprehensively.

Rationale:

- These tests harden deterministic transform semantics and prevent regressions in composition/edge-case handling.

Commands run:

- `pnpm vitest --coverage.enabled=false packages/billing/src/lib/invoice-template-ast/evaluator.test.ts packages/billing/src/lib/invoice-template-ast/schema.test.ts packages/billing/src/lib/invoice-template-ast/strategies.test.ts` (pass).

### 2026-02-12 — F031 implemented

- Established integration coverage for AST-based preview pipeline in:
  - `packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts`
  - `packages/billing/src/actions/invoiceTemplatePreview.inv005.sanity.test.ts`
- Covered integration behaviors include:
  - end-to-end preview action success over AST validation -> evaluator -> renderer,
  - schema diagnostic surfacing,
  - evaluator diagnostic surfacing,
  - strategy allowlist rejection surfaced through preview diagnostics,
  - realistic invoice fixture rendering sanity via mapped invoice payload.

Rationale:

- Preview integration tests now exercise the AST pipeline directly without compiler/Wasm execution dependencies.

Commands run:

- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts` (pass).
- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoiceTemplatePreview.inv005.sanity.test.ts` (pass).

### 2026-02-12 — F032 implemented

- Added integration-style coverage for shared AST renderer in server-side invoice render action:
  - `packages/billing/src/actions/renderTemplateOnServer.ast.integration.test.ts`
- Coverage verifies:
  - canonical `templateAst` payload renders HTML/CSS through `renderTemplateOnServer`,
  - missing AST payloads fail explicitly, preventing silent legacy runtime fallback.

Rationale:

- PDF/server rendering path now has executable tests validating AST renderer behavior beyond static wiring assertions.

Commands run:

- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/renderTemplateOnServer.ast.integration.test.ts` (pass).

### 2026-02-12 — F033 implemented

- Added preview/PDF parity integration test:
  - `packages/billing/src/actions/invoicePreviewPdfParity.integration.test.ts`
- Test exercises both render entry points with identical AST + invoice fixture:
  - preview action: `runAuthoritativeInvoiceTemplatePreview`
  - server render action: `renderTemplateOnServer`
- Parity assertions include:
  - exact HTML/CSS equality,
  - totals value parity (`Grand Total`),
  - grouped section ordering parity (`Products` before `Services`).

Rationale:

- This provides direct automated guardrails against semantic drift between preview and PDF/server render pipelines.

Commands run:

- `pnpm vitest --coverage.enabled=false packages/billing/src/actions/invoicePreviewPdfParity.integration.test.ts` (pass).

### 2026-02-12 — F034 implemented

- Replaced outdated invoice template architecture documentation with AST cutover documentation:
  - `docs/billing/invoice_templates.md`
- Documentation now describes:
  - canonical `InvoiceTemplateAst` model and runtime modules,
  - shared preview/PDF evaluator+renderer pipeline,
  - allowlisted `strategyId` extension mechanism,
  - compatibility behavior for legacy columns,
  - explicit deletion/removal notes for compiler/Wasm stack.

Rationale:

- Prior docs still described AssemblyScript/Wasm execution path and removed modules. Updated docs now align with runtime reality and PRD cutover architecture.

Verification:

- Manual doc review of `docs/billing/invoice_templates.md` for AST pipeline and removal notes coverage.

### 2026-02-12 — T001 implemented

- Marked minimal valid AST schema acceptance as implemented via schema unit coverage.
- Evidence: packages/billing/src/lib/invoice-template-ast/schema.test.ts::validates a minimal AST document

Verification:

-   \ WARN  Unsupported engine: wanted: {"node":">=20 <25"} (current: {"node":"v25.5.0","pnpm":"9.15.9"})

 RUN  v3.2.4 /Users/roberisaacs/alga-psa.worktrees/codex/feature-invoice-designer
      Running tests with seed "1770925966224"

Environment file path: /Users/roberisaacs/alga-psa.worktrees/codex/feature-invoice-designer/.env.localtest
stdout | ee/server/src/lib/extensions/__tests__/assets/url.shared.test.ts > buildExtUiSrc > honors public base override
[ext-ui][buildExtUiSrc] {
  extensionId: 'ext-1',
  mode: 'rust',
  clientPath: '/',
  tenantId: 'tenant-123',
  overrideBase: 'http://localhost:8085',
  runnerBase: undefined,
  publicBase: 'http://localhost:8085'
}

stdout | ee/server/src/lib/extensions/__tests__/assets/url.shared.test.ts > buildExtUiSrc > supports relative public base for gateway proxy
[ext-ui][buildExtUiSrc] {
  extensionId: 'ext-1',
  mode: 'rust',
  clientPath: '/',
  tenantId: undefined,
  overrideBase: null,
  runnerBase: '/runner',
  publicBase: '/runner'
}

stdout | ee/server/src/lib/extensions/__tests__/assets/url.shared.test.ts > buildExtUiSrc > uses absolute public base when provided
[ext-ui][buildExtUiSrc] {
  extensionId: 'ext-1',
  mode: 'rust',
  clientPath: '/settings',
  tenantId: undefined,
  overrideBase: null,
  runnerBase: 'https://runner.dev/alga',
  publicBase: 'https://runner.dev/alga'
}

stdout | ee/server/src/lib/extensions/__tests__/assets/url.shared.test.ts > buildExtUiSrc > appends tenant when provided
[ext-ui][buildExtUiSrc] {
  extensionId: 'ext-1',
  mode: 'rust',
  clientPath: '/',
  tenantId: 'tenant-123',
  overrideBase: null,
  runnerBase: undefined,
  publicBase: '/runner'
}

stdout | ee/server/src/lib/extensions/__tests__/assets/url.shared.test.ts > buildExtUiSrc > falls back to /runner when no public base is set
[ext-ui][buildExtUiSrc] {
  extensionId: 'ext-1',
  mode: 'rust',
  clientPath: '/',
  tenantId: undefined,
  overrideBase: null,
  runnerBase: undefined,
  publicBase: '/runner'
}

 ✓ ee/server/src/lib/extensions/__tests__/assets/url.shared.test.ts (5 tests) 3ms 36 MB heap used
 ✓ packages/billing/src/lib/invoice-template-ast/react-renderer.test.tsx (3 tests) 8ms 41 MB heap used
 ✓ packages/billing/src/lib/invoice-template-ast/strategies.test.ts (2 tests) 1ms 42 MB heap used
 ✓ ee/server/src/__tests__/unit/tenant-creation.test.ts (4 tests) 1ms 43 MB heap used
 ✓ packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts (4 tests) 6ms 68 MB heap used
 ✓ ee/server/src/__tests__/unit/routeParams.resolveInstallId.test.ts (3 tests) 0ms 52 MB heap used
 ❯ ee/temporal-workflows/src/activities/__tests__/email-activities-simple.test.ts (24 tests | 17 failed) 914ms 79 MB heap used
   × Email Activities - Simple Tests > generateTemporaryPassword > should generate password with default length of 12 0ms
     → expected Promise{…} to have property 'length'
   × Email Activities - Simple Tests > generateTemporaryPassword > should generate password with custom length 0ms
     → expected Promise{…} to have property 'length'
   ✓ Email Activities - Simple Tests > generateTemporaryPassword > should generate different passwords each time 0ms
   × Email Activities - Simple Tests > generateTemporaryPassword > should contain at least one character from each category 0ms
     → .toMatch() expects to receive a string, but got object
   × Email Activities - Simple Tests > generateTemporaryPassword > should not contain ambiguous characters 0ms
     → .toMatch() expects to receive a string, but got object
   × Email Activities - Simple Tests > generateTemporaryPassword > should handle minimum length of 4 0ms
     → expected Promise{…} to have property 'length'
   ✓ Email Activities - Simple Tests > generateTemporaryPassword > should generate secure passwords with high entropy 0ms
   × Email Activities - Simple Tests > MockEmailService > should send emails successfully 101ms
     → Cannot read properties of undefined (reading 'info')
   ✓ Email Activities - Simple Tests > MockEmailService > should validate email addresses correctly 0ms
   × Email Activities - Simple Tests > MockEmailService > should track sent emails for testing 102ms
     → Cannot read properties of undefined (reading 'info')
   × Email Activities - Simple Tests > MockEmailService > should filter emails by recipient 101ms
     → Cannot read properties of undefined (reading 'info')
   ✓ Email Activities - Simple Tests > MockEmailService > should simulate failures when configured 101ms
   × Email Activities - Simple Tests > MockEmailService > should handle invalid email addresses 100ms
     → Cannot read properties of undefined (reading 'info')
   × Email Activities - Simple Tests > MockEmailService > should handle multiple recipients 100ms
     → Cannot read properties of undefined (reading 'info')
   ✓ Email Activities - Simple Tests > MockEmailService > should throw error when no valid recipients 101ms
   × Email Activities - Simple Tests > MockEmailService > should support email service configuration 0ms
     → expected Promise{…} to be an instance of MockEmailService
   ✓ Email Activities - Simple Tests > MockEmailService > should return email templates for testing 0ms
   ✓ Email Activities - Simple Tests > MockEmailService > should return null for unknown templates 0ms
   × Email Activities - Simple Tests > MockEmailService > should support clearing sent emails 100ms
     → Cannot read properties of undefined (reading 'info')
   × Email Activities - Simple Tests > MockEmailService > should handle delay configuration 102ms
     → Cannot read properties of undefined (reading 'info')
   × Email Activities - Simple Tests > Email Service Factory > should create mock service by default 0ms
     → expected Promise{…} to be an instance of MockEmailService
   × Email Activities - Simple Tests > Email Service Factory > should create mock service when explicitly requested 0ms
     → expected Promise{…} to be an instance of MockEmailService
   × Email Activities - Simple Tests > Email Service Factory > should throw error for unknown providers 0ms
     → expected [Function] to throw an error
   × Email Activities - Simple Tests > Email Service Factory > should pass options to mock service 2ms
     → expected Promise{…} to be an instance of MockEmailService
 ✓ server/src/test/unit/readAssistantContentFromSse.test.ts (1 test) 2ms 81 MB heap used
stdout | server/src/test/e2e/api/projects.e2e.test.ts > Projects API E2E Tests
Initializing secret provider (legacy mode with composite fallback). Using read chain [env, filesystem] with write provider filesystem
EnvSecretProvider initialized without prefix

stdout | server/src/test/e2e/api/projects.e2e.test.ts > Projects API E2E Tests
CompositeSecretProvider initialized with 2 read providers and 1 write provider

stdout | server/src/test/e2e/api/projects.e2e.test.ts > Projects API E2E Tests
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/projects.e2e.test.ts > Projects API E2E Tests
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/projects.e2e.test.ts > Projects API E2E Tests
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/projects.e2e.test.ts > Projects API E2E Tests
Retrieved secret 'db_password_server' from configured provider.

 ❯ server/src/test/e2e/api/projects.e2e.test.ts (22 tests | 22 skipped) 24ms 109 MB heap used
   ↓ Projects API E2E Tests > Authentication > should reject requests without API key
   ↓ Projects API E2E Tests > Authentication > should reject requests with invalid API key
   ↓ Projects API E2E Tests > Authentication > should accept requests with valid API key
   ↓ Projects API E2E Tests > CRUD Operations > should create a project
   ↓ Projects API E2E Tests > CRUD Operations > should get a project by ID
   ↓ Projects API E2E Tests > CRUD Operations > should update a project
   ↓ Projects API E2E Tests > CRUD Operations > should delete a project
   ↓ Projects API E2E Tests > CRUD Operations > should list projects with pagination
   ↓ Projects API E2E Tests > Project Search > should search projects by query
   ↓ Projects API E2E Tests > Project Statistics > should get project statistics
   ↓ Projects API E2E Tests > Project Tasks and Tickets > should get project tasks
   ↓ Projects API E2E Tests > Project Tasks and Tickets > should get project tickets
   ↓ Projects API E2E Tests > Error Handling > should return 404 for non-existent project
   ↓ Projects API E2E Tests > Error Handling > should return 400 for invalid project data
   ↓ Projects API E2E Tests > Error Handling > should return 400 for invalid UUID
   ↓ Projects API E2E Tests > Filtering > should filter projects by status
   ↓ Projects API E2E Tests > Filtering > should filter projects by type
   ↓ Projects API E2E Tests > Filtering > should filter projects by client
   ↓ Projects API E2E Tests > Project Export > should export projects as CSV
   ↓ Projects API E2E Tests > Project Export > should export projects as JSON
   ↓ Projects API E2E Tests > Permissions > should enforce read permissions for listing
   ↓ Projects API E2E Tests > Permissions > should enforce create permissions
 ✓ server/src/test/unit/billingPlanSelection.test.ts (5 tests | 1 skipped) 1ms 117 MB heap used
stdout | packages/client-portal/src/actions/client-portal-actions/client-tickets.responseSource.test.ts > addClientTicketComment response source metadata > T001: stores metadata.responseSource=client_portal when inserting a client comment
Usage statistics enabled (user IDs anonymized)

stdout | packages/client-portal/src/actions/client-portal-actions/client-tickets.responseSource.test.ts > addClientTicketComment response source metadata > T001: stores metadata.responseSource=client_portal when inserting a client comment
Converted markdown content for client comment: markdown-content

 ❯ packages/client-portal/src/actions/client-portal-actions/client-tickets.responseSource.test.ts (1 test | 1 failed) 210ms 127 MB heap used
   × addClientTicketComment response source metadata > T001: stores metadata.responseSource=client_portal when inserting a client comment 210ms
     → Failed to add comment
 ✓ server/src/test/unit/docs/contractPurchaseOrderSupport.docs.test.ts (1 test) 1ms 129 MB heap used
 ✓ server/src/test/unit/workflowsCeStubEntry.unit.test.tsx (1 test) 0ms 131 MB heap used
 ✓ packages/projects/src/lib/timeEntryContext.test.ts (1 test) 0ms 135 MB heap used
 ✓ packages/billing/src/components/invoice-designer/state/designerStore.layout.test.ts (5 tests) 3ms 112 MB heap used
 ✓ packages/billing/src/actions/invoiceTemplatePreviewCacheRemoval.test.ts (2 tests) 0ms 119 MB heap used
 ✓ sdk/samples/component/invoicing-demo/tests/handler.test.ts (4 tests) 1ms 122 MB heap used
 ✓ server/src/test/unit/ui/reopenForEdits.test.ts (2 tests) 1ms 123 MB heap used
 ❯ packages/ui/src/context/SchedulingContext.test.tsx (4 tests | 4 failed) 1ms 136 MB heap used
   × SchedulingContext > returns default callbacks when no provider is present 0ms
     → document is not defined
   × SchedulingContext > renders fallback alert element for agent schedule by default 0ms
     → document is not defined
   × SchedulingContext > shows a toast when launching time entry without provider 0ms
     → document is not defined
   × SchedulingContext > uses provider callbacks when SchedulingCallbackProvider is present 1ms
     → document is not defined
stdout | server/src/test/unit/project-actions/phaseReordering.test.ts > Phase Reordering Logic > Real-world Phase Drag Scenario > should handle dragging phase to before the first phase
Moving Phase 3 before Phase 1: new key = Zz

stdout | server/src/test/unit/project-actions/phaseReordering.test.ts > Phase Reordering Logic > Fractional Indexing Key Generation > should handle multiple insertions at the beginning
Keys after multiple insertions at beginning: [ 'Zv', 'Zw', 'Zx', 'Zy', 'Zz', 'a0' ]

stdout | server/src/test/unit/project-actions/phaseReordering.test.ts > Phase Reordering Logic > Fractional Indexing Key Generation > should generate correct key when placing phase at the end
Key for placing after last: a6 (should be > a5)

stdout | server/src/test/unit/project-actions/phaseReordering.test.ts > Phase Reordering Logic > Fractional Indexing Key Generation > should generate correct key when placing phase between two phases
Key for placing between: a1V (should be between a1 and a2)

stdout | server/src/test/unit/project-actions/phaseReordering.test.ts > Phase Reordering Logic > Fractional Indexing Key Generation > should generate correct key when placing phase at the beginning
Key for placing before first: Zz (should be < a0)

 ✓ server/src/test/unit/project-actions/phaseReordering.test.ts (9 tests) 1ms 138 MB heap used
 ✓ packages/event-bus/src/index.pending.test.ts (1 test) 18ms 120 MB heap used
 ✓ sdk/samples/component/scheduler-demo/tests/handler.test.ts (6 tests) 1ms 127 MB heap used
 ✓ packages/billing/src/components/invoice-designer/state/designerStore.labelText.test.ts (4 tests) 2ms 140 MB heap used
 ❯ server/src/test/unit/timePeriodSuggester.test.ts (10 tests | 10 failed) 10ms 155 MB heap used
   × TimePeriodSuggester > suggestNewTimePeriod > should suggest monthly periods with no existing periods 0ms
     → expected undefined to be '2026-02-12' // Object.is equality
   × TimePeriodSuggester > suggestNewTimePeriod > should suggest monthly periods with existing periods 0ms
     → expected undefined to be '2025-02-01' // Object.is equality
   × TimePeriodSuggester > suggestNewTimePeriod > should suggest weekly periods 1ms
     → expected undefined to be '2026-02-12' // Object.is equality
   × TimePeriodSuggester > suggestNewTimePeriod > should suggest yearly periods 0ms
     → expected undefined to be '2026-02-12' // Object.is equality
   × TimePeriodSuggester > suggestNewTimePeriod > should handle multiple semi-monthly settings together 1ms
     → expected undefined to be '2025-01-01' // Object.is equality
   × TimePeriodSuggester > suggestNewTimePeriod > should handle February correctly in leap years 1ms
     → expected undefined to be '2024-02-01' // Object.is equality
   × TimePeriodSuggester > suggestNewTimePeriod > should select settings based on period start date, not current date 1ms
     → expected undefined to be '2025-01-15' // Object.is equality
   × TimePeriodSuggester > suggestNewTimePeriod > should handle current date before next period start date in semi-monthly periods 0ms
     → expected undefined to be '2025-01-15' // Object.is equality
   × TimePeriodSuggester > suggestNewTimePeriod > should suggest next period after existing periods 5ms
     → expected undefined to be '2025-01-14' // Object.is equality
   × TimePeriodSuggester > suggestNewTimePeriod > should suggest period starting in the future after current date 0ms
     → expected undefined to be '2025-06-01' // Object.is equality
stdout | server/src/test/integration/accounting/exportDashboard.integration.test.ts
Initializing secret provider (legacy mode with composite fallback). Using read chain [env, filesystem] with write provider filesystem
EnvSecretProvider initialized without prefix

stdout | server/src/test/integration/accounting/exportDashboard.integration.test.ts
CompositeSecretProvider initialized with 2 read providers and 1 write provider

stdout | server/src/test/integration/accounting/exportDashboard.integration.test.ts
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/integration/accounting/exportDashboard.integration.test.ts
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/integration/accounting/exportDashboard.integration.test.ts
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/integration/accounting/exportDashboard.integration.test.ts
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/integration/accounting/exportDashboard.integration.test.ts
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/integration/accounting/exportDashboard.integration.test.ts
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/teams.e2e.test.ts > Teams API E2E Tests
Initializing secret provider (legacy mode with composite fallback). Using read chain [env, filesystem] with write provider filesystem
EnvSecretProvider initialized without prefix

stdout | server/src/test/e2e/api/teams.e2e.test.ts > Teams API E2E Tests
CompositeSecretProvider initialized with 2 read providers and 1 write provider

stdout | server/src/test/e2e/api/teams.e2e.test.ts > Teams API E2E Tests
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/teams.e2e.test.ts > Teams API E2E Tests
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/teams.e2e.test.ts > Teams API E2E Tests
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/teams.e2e.test.ts > Teams API E2E Tests
Retrieved secret 'db_password_server' from configured provider.

 ❯ server/src/test/e2e/api/teams.e2e.test.ts (36 tests | 36 skipped) 2ms 200 MB heap used
   ↓ Teams API E2E Tests > Authentication > should require API key for all endpoints
   ↓ Teams API E2E Tests > Authentication > should reject invalid API key
   ↓ Teams API E2E Tests > CRUD Operations > Create Team (POST /api/v1/teams) > should create a new team
   ↓ Teams API E2E Tests > CRUD Operations > Create Team (POST /api/v1/teams) > should validate required fields
   ↓ Teams API E2E Tests > CRUD Operations > Create Team (POST /api/v1/teams) > should validate manager_id is a valid user
   ↓ Teams API E2E Tests > CRUD Operations > Get Team (GET /api/v1/teams/:id) > should retrieve a team by ID
   ↓ Teams API E2E Tests > CRUD Operations > Get Team (GET /api/v1/teams/:id) > should return 404 for non-existent team
   ↓ Teams API E2E Tests > CRUD Operations > Get Team (GET /api/v1/teams/:id) > should not return teams from other tenants
   ↓ Teams API E2E Tests > CRUD Operations > Update Team (PUT /api/v1/teams/:id) > should update a team
   ↓ Teams API E2E Tests > CRUD Operations > Update Team (PUT /api/v1/teams/:id) > should return 404 when updating non-existent team
   ↓ Teams API E2E Tests > CRUD Operations > Update Team (PUT /api/v1/teams/:id) > should validate update data
   ↓ Teams API E2E Tests > CRUD Operations > Delete Team (DELETE /api/v1/teams/:id) > should delete a team
   ↓ Teams API E2E Tests > CRUD Operations > Delete Team (DELETE /api/v1/teams/:id) > should return 404 when deleting non-existent team
   ↓ Teams API E2E Tests > CRUD Operations > Delete Team (DELETE /api/v1/teams/:id) > should handle teams with members
   ↓ Teams API E2E Tests > List Teams (GET /api/v1/teams) > should list all teams with default pagination
   ↓ Teams API E2E Tests > List Teams (GET /api/v1/teams) > should support pagination parameters
   ↓ Teams API E2E Tests > List Teams (GET /api/v1/teams) > should filter by search query
   ↓ Teams API E2E Tests > List Teams (GET /api/v1/teams) > should sort teams
   ↓ Teams API E2E Tests > Team Manager Assignment > Assign Team Manager (PUT /api/v1/teams/:id/manager) > should assign manager and automatically add them as team member
   ↓ Teams API E2E Tests > Team Manager Assignment > Assign Team Manager (PUT /api/v1/teams/:id/manager) > should not duplicate member if manager is already a team member
   ↓ Teams API E2E Tests > Team Creation with Manager > should automatically add manager as team member when creating team
   ↓ Teams API E2E Tests > Team Members > Add Team Member (POST /api/v1/teams/:id/members) > should add a member to a team
   ↓ Teams API E2E Tests > Team Members > Add Team Member (POST /api/v1/teams/:id/members) > should prevent duplicate members
   ↓ Teams API E2E Tests > Team Members > Add Team Member (POST /api/v1/teams/:id/members) > should validate user exists
   ↓ Teams API E2E Tests > Team Members > List Team Members (GET /api/v1/teams/:id/members) > should list team members
   ↓ Teams API E2E Tests > Team Members > Remove Team Member (DELETE /api/v1/teams/:id/members/:userId) > should remove a member from team
   ↓ Teams API E2E Tests > Team Members > Remove Team Member (DELETE /api/v1/teams/:id/members/:userId) > should return 404 for non-existent member
   ↓ Teams API E2E Tests > Team Statistics > should get team statistics
   ↓ Teams API E2E Tests > Error Handling > should handle invalid UUID format
   ↓ Teams API E2E Tests > Error Handling > should handle invalid query parameters
   ↓ Teams API E2E Tests > Error Handling > should handle missing required fields on create
   ↓ Teams API E2E Tests > Permissions > should enforce read permissions for listing
   ↓ Teams API E2E Tests > Permissions > should enforce create permissions
   ↓ Teams API E2E Tests > Permissions > should enforce update permissions
   ↓ Teams API E2E Tests > Permissions > should enforce delete permissions
   ↓ Teams API E2E Tests > Multi-tenancy > should isolate teams by tenant
stdout | server/src/test/integration/contractWizard.integration.test.ts > createClientContractFromWizard
Initializing secret provider (legacy mode with composite fallback). Using read chain [env, filesystem] with write provider filesystem
EnvSecretProvider initialized without prefix

stdout | server/src/test/integration/contractWizard.integration.test.ts > createClientContractFromWizard
CompositeSecretProvider initialized with 2 read providers and 1 write provider

stdout | server/src/test/integration/contractWizard.integration.test.ts > createClientContractFromWizard
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/integration/contractWizard.integration.test.ts > createClientContractFromWizard
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/integration/contractWizard.integration.test.ts > createClientContractFromWizard
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/integration/contractWizard.integration.test.ts > createClientContractFromWizard
Retrieved secret 'db_password_server' from configured provider.

 ❯ server/src/test/integration/contractWizard.integration.test.ts (1 test | 1 skipped) 2ms 207 MB heap used
   ↓ createClientContractFromWizard > creates downstream client records for fixed-fee contracts
 ✓ server/src/test/unit/workflowBundleCli.unit.test.ts (2 tests) 4ms 244 MB heap used
 ✓ packages/core/src/lib/logger.test.ts (1 test) 0ms 247 MB heap used
stdout | server/src/test/integration/billing/contractPurchaseOrderSupport.integration.test.ts > Contract Purchase Order Support
Initializing secret provider (legacy mode with composite fallback). Using read chain [env, filesystem] with write provider filesystem
EnvSecretProvider initialized without prefix

stdout | server/src/test/integration/billing/contractPurchaseOrderSupport.integration.test.ts > Contract Purchase Order Support
CompositeSecretProvider initialized with 2 read providers and 1 write provider

stdout | server/src/test/integration/billing/contractPurchaseOrderSupport.integration.test.ts > Contract Purchase Order Support
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/integration/billing/contractPurchaseOrderSupport.integration.test.ts > Contract Purchase Order Support
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/integration/billing/contractPurchaseOrderSupport.integration.test.ts > Contract Purchase Order Support
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/integration/billing/contractPurchaseOrderSupport.integration.test.ts > Contract Purchase Order Support
Retrieved secret 'db_password_server' from configured provider.

 ❯ server/src/test/integration/billing/contractPurchaseOrderSupport.integration.test.ts (5 tests | 5 skipped) 2ms 251 MB heap used
   ↓ Contract Purchase Order Support > T001: invoices table includes po_number + client_contract_id
   ↓ Contract Purchase Order Support > T002: invoice creation snapshots client_contracts.po_number onto invoices.po_number
   ↓ Contract Purchase Order Support > T003: invoice generation blocks when po_required=true and po_number is missing
   ↓ Contract Purchase Order Support > T004: PO consumption sums finalized invoices and unconsumes when status changes away from finalized
   ↓ Contract Purchase Order Support > T005: overage calculation uses invoice total_amount and contract po_amount (authorized total spend)
 ✓ server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts (10 tests) 7ms 216 MB heap used
stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Time Tracking > should stop a tracking session
Initializing secret provider (legacy mode with composite fallback). Using read chain [env, filesystem] with write provider filesystem
EnvSecretProvider initialized without prefix

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Time Tracking > should stop a tracking session
CompositeSecretProvider initialized with 2 read providers and 1 write provider

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Time Tracking > should stop a tracking session
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Time Tracking > should stop a tracking session
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Time Tracking > should stop a tracking session
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Time Tracking > should stop a tracking session
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Time Tracking > should start a tracking session
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Time Tracking > should start a tracking session
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Time Tracking > should start a tracking session
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Time Tracking > should start a tracking session
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by user
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by user
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by user
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by user
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should sort by date
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should sort by date
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should sort by date
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should sort by date
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should support pagination parameters
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should support pagination parameters
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should support pagination parameters
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should support pagination parameters
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by date range
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by date range
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by date range
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by date range
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by billable status
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by billable status
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by billable status
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by billable status
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should list time entries with default pagination
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should list time entries with default pagination
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should list time entries with default pagination
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should list time entries with default pagination
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Export > should export time entries to JSON
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Export > should export time entries to JSON
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Export > should export time entries to JSON
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Export > should export time entries to JSON
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Export > should export time entries to CSV
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Export > should export time entries to CSV
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Export > should export time entries to CSV
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Export > should export time entries to CSV
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Templates > should list time entry templates
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Templates > should list time entry templates
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Templates > should list time entry templates
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Templates > should list time entry templates
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce delete permissions
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce delete permissions
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce delete permissions
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce delete permissions
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce create permissions
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce create permissions
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce create permissions
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce create permissions
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce update permissions
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce update permissions
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce update permissions
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce update permissions
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce read permissions for listing
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce read permissions for listing
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce read permissions for listing
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Permissions > should enforce read permissions for listing
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Bulk Operations > should bulk delete time entries
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Bulk Operations > should bulk delete time entries
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Bulk Operations > should bulk delete time entries
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Bulk Operations > should bulk delete time entries
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Bulk Operations > should bulk update time entries
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Bulk Operations > should bulk update time entries
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Bulk Operations > should bulk update time entries
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Bulk Operations > should bulk update time entries
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Bulk Operations > should bulk create time entries
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Bulk Operations > should bulk create time entries
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Bulk Operations > should bulk create time entries
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Bulk Operations > should bulk create time entries
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Multi-tenancy > should isolate time entries by tenant
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Multi-tenancy > should isolate time entries by tenant
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Multi-tenancy > should isolate time entries by tenant
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Multi-tenancy > should isolate time entries by tenant
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should not allow deleting approved entries
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should not allow deleting approved entries
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should not allow deleting approved entries
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should not allow deleting approved entries
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should return 404 when deleting non-existent entry
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should return 404 when deleting non-existent entry
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should return 404 when deleting non-existent entry
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should return 404 when deleting non-existent entry
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should delete a time entry
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should delete a time entry
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should delete a time entry
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should delete a time entry
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should not return time entries from other tenants
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should not return time entries from other tenants
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should not return time entries from other tenants
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should not return time entries from other tenants
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should return 404 for non-existent time entry
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should return 404 for non-existent time entry
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should return 404 for non-existent time entry
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should return 404 for non-existent time entry
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should retrieve a time entry by ID
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should retrieve a time entry by ID
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should retrieve a time entry by ID
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should retrieve a time entry by ID
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should not allow updating approved entries
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should not allow updating approved entries
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should not allow updating approved entries
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should not allow updating approved entries
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should return 404 when updating non-existent entry
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should return 404 when updating non-existent entry
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should return 404 when updating non-existent entry
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should return 404 when updating non-existent entry
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should update a time entry
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should update a time entry
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should update a time entry
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should update a time entry
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should validate time periods overlap
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should validate time periods overlap
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should validate time periods overlap
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should validate time periods overlap
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should compute work_date in user timezone and bucket to the correct period
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should compute work_date in user timezone and bucket to the correct period
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should compute work_date in user timezone and bucket to the correct period
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should compute work_date in user timezone and bucket to the correct period
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should validate required fields
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should validate required fields
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should validate required fields
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should validate required fields
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should create a new time entry
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should create a new time entry
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should create a new time entry
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should create a new time entry
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Statistics > should get time entry statistics
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Statistics > should get time entry statistics
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Statistics > should get time entry statistics
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Statistics > should get time entry statistics
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Error Handling > should handle invalid date format
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Error Handling > should handle invalid date format
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Error Handling > should handle invalid date format
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Error Handling > should handle invalid date format
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Error Handling > should handle invalid query parameters
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Error Handling > should handle invalid query parameters
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Error Handling > should handle invalid query parameters
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Error Handling > should handle invalid query parameters
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Error Handling > should handle invalid UUID format
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Error Handling > should handle invalid UUID format
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Error Handling > should handle invalid UUID format
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Error Handling > should handle invalid UUID format
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Authentication > should reject invalid API key
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Authentication > should reject invalid API key
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Authentication > should reject invalid API key
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Authentication > should reject invalid API key
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Authentication > should require API key for all endpoints
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Authentication > should require API key for all endpoints
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Authentication > should require API key for all endpoints
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/e2e/api/time-entries.e2e.test.ts > Time Entries API E2E Tests > Authentication > should require API key for all endpoints
Retrieved secret 'db_password_server' from configured provider.

 ❯ server/src/test/e2e/api/time-entries.e2e.test.ts (40 tests | 38 failed | 2 skipped) 33ms 236 MB heap used
   × Time Entries API E2E Tests > Authentication > should require API key for all endpoints 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Authentication > should reject invalid API key 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should create a new time entry 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should compute work_date in user timezone and bucket to the correct period 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should validate required fields 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > CRUD Operations > Create Time Entry (POST /api/v1/time-entries) > should validate time periods overlap 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should retrieve a time entry by ID 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should return 404 for non-existent time entry 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > CRUD Operations > Get Time Entry (GET /api/v1/time-entries/:id) > should not return time entries from other tenants 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should update a time entry 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should return 404 when updating non-existent entry 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > CRUD Operations > Update Time Entry (PUT /api/v1/time-entries/:id) > should not allow updating approved entries 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should delete a time entry 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should return 404 when deleting non-existent entry 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > CRUD Operations > Delete Time Entry (DELETE /api/v1/time-entries/:id) > should not allow deleting approved entries 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should list time entries with default pagination 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should support pagination parameters 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by date range 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by user 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should filter by billable status 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > List Time Entries (GET /api/v1/time-entries) > should sort by date 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Time Tracking > should start a tracking session 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Time Tracking > should stop a tracking session 2ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   ↓ Time Entries API E2E Tests > Approval Workflow > should approve time entries
   ↓ Time Entries API E2E Tests > Approval Workflow > should reject invalid entry IDs for approval
   × Time Entries API E2E Tests > Export > should export time entries to CSV 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Export > should export time entries to JSON 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Statistics > should get time entry statistics 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Templates > should list time entry templates 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Bulk Operations > should bulk create time entries 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Bulk Operations > should bulk update time entries 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Bulk Operations > should bulk delete time entries 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Error Handling > should handle invalid UUID format 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Error Handling > should handle invalid query parameters 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Error Handling > should handle invalid date format 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Permissions > should enforce read permissions for listing 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Permissions > should enforce create permissions 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Permissions > should enforce update permissions 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Permissions > should enforce delete permissions 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
   × Time Entries API E2E Tests > Multi-tenancy > should isolate time entries by tenant 1ms
     → 
     → Cannot read properties of undefined (reading 'cleanup')
 ✓ server/src/test/unit/menuConfig.experimentalFeatures.test.ts (1 test) 0ms 143 MB heap used
 ✓ packages/billing/src/actions/invoiceTemplateAstPersistenceWiring.test.ts (3 tests) 1ms 145 MB heap used
 ✓ packages/billing/tests/deleteContractPermissions.test.ts (1 test) 18ms 150 MB heap used
 ✓ shared/lib/utils/emailFileConversion.test.ts (4 tests) 4ms 156 MB heap used
 ✓ ee/server/extensions/samples/ui-kit-showcase/test/scaffold.test.ts (8 tests) 1ms 170 MB heap used
stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 59, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 58, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 57, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 56, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 55, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 54, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 53, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 52, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 51, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 50, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 49, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 48, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 47, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 46, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 45, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 44, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 43, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 42, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 41, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 40, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 39, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 38, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 37, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 36, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 35, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 34, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 33, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 32, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 31, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 30, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 29, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 28, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 27, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 26, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 25, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 24, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 23, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 22, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 21, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 20, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 19, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 18, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 17, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 16, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 15, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 14, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 13, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 12, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 11, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 10, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 9, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 8, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 7, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 6, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 5, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 4, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 3, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 2, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 1, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 0, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Sustained Rate > should allow sustained rate equal to refill rate
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 0, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 59, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 58, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 57, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 56, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 55, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 54, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 53, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 52, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 51, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 50, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 49, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 48, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 47, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 46, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 45, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 44, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 43, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 42, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 41, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 40, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 39, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 38, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 37, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 36, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 35, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 34, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 33, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 32, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 31, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 30, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 29, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 28, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 27, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 26, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 25, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 24, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 23, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 22, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 21, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 20, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 19, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 18, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 17, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 16, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 15, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 14, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 13, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 12, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 11, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 10, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 9, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 8, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 7, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 6, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 5, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 4, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 3, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 2, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 1, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 0, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > Token Bucket vs Sliding Window Comparison > Burst Handling > should allow burst up to maxTokens
[TokenBucketRateLimiter] Rate limit exceeded {
  tenantId: 'tenant-1',
  userId: undefined,
  remaining: 0,
  needed: 1,
  retryAfterMs: 999
}

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should track tokens separately per user within a tenant
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should track tokens separately per user within a tenant
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: 'user-1', remaining: 1, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should track tokens separately per user within a tenant
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: 'user-1', remaining: 0, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should track tokens separately per user within a tenant
[TokenBucketRateLimiter] Rate limit exceeded {
  tenantId: 'tenant-1',
  userId: 'user-1',
  remaining: 0,
  needed: 1,
  retryAfterMs: 1000
}

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should track tokens separately per user within a tenant
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: 'user-2', remaining: 1, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should allow multiple requests until bucket is empty
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should allow multiple requests until bucket is empty
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 2, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should allow multiple requests until bucket is empty
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 1, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should allow multiple requests until bucket is empty
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 0, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should allow multiple requests until bucket is empty
[TokenBucketRateLimiter] Rate limit exceeded {
  tenantId: 'tenant-1',
  userId: undefined,
  remaining: 0,
  needed: 1,
  retryAfterMs: 1000
}

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should track tokens separately per tenant
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should track tokens separately per tenant
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 1, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should track tokens separately per tenant
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 0, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should track tokens separately per tenant
[TokenBucketRateLimiter] Rate limit exceeded {
  tenantId: 'tenant-1',
  userId: undefined,
  remaining: 0,
  needed: 1,
  retryAfterMs: 1000
}

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should track tokens separately per tenant
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-2', userId: undefined, remaining: 1, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should allow request when bucket has tokens
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Consumption > should allow request when bucket has tokens
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 59, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Shutdown > should cleanup on shutdown
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Shutdown > should cleanup on shutdown
[TokenBucketRateLimiter] Shutdown complete

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Refill > should not exceed maxTokens when refilling
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Refill > should not exceed maxTokens when refilling
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 4, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Refill > should refill tokens over time
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Refill > should refill tokens over time
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 1, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Refill > should refill tokens over time
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 0, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Refill > should refill tokens over time
[TokenBucketRateLimiter] Rate limit exceeded {
  tenantId: 'tenant-1',
  userId: undefined,
  remaining: 0,
  needed: 1,
  retryAfterMs: 100
}

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Token Refill > should refill tokens over time
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 1, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Retry After Calculation > should include reason when rate limited
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Retry After Calculation > should include reason when rate limited
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 0, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Retry After Calculation > should include reason when rate limited
[TokenBucketRateLimiter] Rate limit exceeded {
  tenantId: 'tenant-1',
  userId: undefined,
  remaining: 0,
  needed: 1,
  retryAfterMs: 1000
}

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Retry After Calculation > should return correct retryAfterMs when rate limited
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Retry After Calculation > should return correct retryAfterMs when rate limited
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 0, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Retry After Calculation > should return correct retryAfterMs when rate limited
[TokenBucketRateLimiter] Rate limit exceeded {
  tenantId: 'tenant-1',
  userId: undefined,
  remaining: 0,
  needed: 1,
  retryAfterMs: 1000
}

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Get State > should return full bucket for new tenant
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Get State > should return current bucket state
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Get State > should return current bucket state
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 9, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Get State > should return current bucket state
[TokenBucketRateLimiter] Token consumed { tenantId: 'tenant-1', userId: undefined, remaining: 8, consumed: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Initialization > should warn if initialized twice
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

stdout | server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts > TokenBucketRateLimiter > Initialization > should initialize with Redis client
[TokenBucketRateLimiter] Initialized successfully { defaultMaxTokens: 60, defaultRefillRate: 1 }

 ✓ server/src/test/unit/notifications/tokenBucketRateLimiter.test.ts (17 tests) 4ms 176 MB heap used
 ✓ packages/clients/src/lib/durationHelpers.test.ts (7 tests) 0ms 179 MB heap used
 ❯ server/src/test/unit/clientContractActions.overlapExclusive.test.ts (3 tests | 3 failed) 1ms 182 MB heap used
   × Client contract overlap validation ([start, end) semantics) > does not treat touching boundaries as overlap (start == invoiced period end) 0ms
     → Missing "./models/clientContract" specifier in "@alga-psa/clients" package
   × Client contract overlap validation ([start, end) semantics) > does not treat touching boundaries as overlap (end exclusive == invoiced period start) 0ms
     → Missing "./models/clientContract" specifier in "@alga-psa/clients" package
   × Client contract overlap validation ([start, end) semantics) > rejects true overlaps with an invoiced period 1ms
     → Missing "./models/clientContract" specifier in "@alga-psa/clients" package
stdout | ee/server/src/__tests__/integration/extensionProxyFlow.test.ts > Extension Proxy Flow Integration > Host Bridge (Client -> Host) > should handle Gateway errors and return error message to Client
iframeBridge: received message { type: 'apiproxy', origin: 'http://localhost:3000' }
iframeBridge: handling apiproxy { requestId: 'req-error', route: '/error-route' }

stdout | ee/server/src/__tests__/integration/extensionProxyFlow.test.ts > Extension Proxy Flow Integration > Host Bridge (Client -> Host) > should handle Gateway errors and return error message to Client
iframeBridge: fetch completed {
  status: 500,
  ok: false,
  url: '/api/ext-proxy/test-extension-id/error-route'
}

stdout | ee/server/src/__tests__/integration/extensionProxyFlow.test.ts > Extension Proxy Flow Integration > Host Bridge (Client -> Host) > should handle Gateway errors and return error message to Client
iframeBridge: posting apiproxy_response { requestId: 'req-error', targetOrigin: '*' }

stdout | ee/server/src/__tests__/integration/extensionProxyFlow.test.ts > Extension Proxy Flow Integration > Host Bridge (Client -> Host) > should forward "apiproxy" message to Gateway and return response to Client
iframeBridge: received message { type: 'apiproxy', origin: 'http://localhost:3000' }
iframeBridge: handling apiproxy { requestId: 'req-123', route: '/tickets' }

stdout | ee/server/src/__tests__/integration/extensionProxyFlow.test.ts > Extension Proxy Flow Integration > Host Bridge (Client -> Host) > should forward "apiproxy" message to Gateway and return response to Client
iframeBridge: fetch completed {
  status: undefined,
  ok: true,
  url: '/api/ext-proxy/test-extension-id/tickets'
}

stdout | ee/server/src/__tests__/integration/extensionProxyFlow.test.ts > Extension Proxy Flow Integration > Host Bridge (Client -> Host) > should forward "apiproxy" message to Gateway and return response to Client
iframeBridge: posting apiproxy_response (reader) { requestId: 'req-123', targetOrigin: '*' }

 ❯ ee/server/src/__tests__/integration/extensionProxyFlow.test.ts (4 tests | 2 failed) 198ms 92 MB heap used
   ✓ Extension Proxy Flow Integration > Host Bridge (Client -> Host) > should forward "apiproxy" message to Gateway and return response to Client 55ms
   ✓ Extension Proxy Flow Integration > Host Bridge (Client -> Host) > should handle Gateway errors and return error message to Client 59ms
   × Extension Proxy Flow Integration > Gateway Handler (Host -> Runner) > should forward request to RunnerBackend and propagate response headers/body 0ms
     → Failed to resolve import "@alga-psa/db/models/UserSession" from "packages/auth/src/lib/nextAuthOptions.ts". Does the file exist?
   × Extension Proxy Flow Integration > Gateway Handler (Host -> Runner) > should handle Runner errors gracefully 84ms
     → Failed to resolve import "@alga-psa/db/models/UserSession" from "packages/auth/src/lib/nextAuthOptions.ts". Does the file exist?
stdout | server/src/test/unit/billing/BillingCyclesDashboardSummary.ui.test.tsx
Initializing secret provider (legacy mode with composite fallback). Using read chain [env, filesystem] with write provider filesystem
EnvSecretProvider initialized without prefix

stdout | server/src/test/unit/billing/BillingCyclesDashboardSummary.ui.test.tsx
CompositeSecretProvider initialized with 2 read providers and 1 write provider

stdout | server/src/test/unit/billing/BillingCyclesDashboardSummary.ui.test.tsx
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/unit/billing/BillingCyclesDashboardSummary.ui.test.tsx
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/unit/billing/BillingCyclesDashboardSummary.ui.test.tsx
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/unit/billing/BillingCyclesDashboardSummary.ui.test.tsx
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/unit/billing/BillingCyclesDashboardSummary.ui.test.tsx
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/unit/billing/BillingCyclesDashboardSummary.ui.test.tsx
Retrieved secret 'db_password_server' from configured provider.

 ✓ packages/projects/tests/projectInfoDrawer.test.tsx (1 test) 63ms 104 MB heap used
 ✓ server/src/test/unit/components/AssetNotesPanel.test.tsx (1 test) 7ms 108 MB heap used
stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.ui.test.tsx
Initializing secret provider (legacy mode with composite fallback). Using read chain [env, filesystem] with write provider filesystem
EnvSecretProvider initialized without prefix

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.ui.test.tsx
CompositeSecretProvider initialized with 2 read providers and 1 write provider

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.ui.test.tsx
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.ui.test.tsx
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.ui.test.tsx
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.ui.test.tsx
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.ui.test.tsx
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.ui.test.tsx
Retrieved secret 'db_password_server' from configured provider.

 ❯ server/src/test/unit/Chat.streamingIncrementalState.test.tsx (9 tests | 8 failed) 81ms 137 MB heap used
   × EE Chat (streaming state) > updates the in-progress assistant message as tokens arrive 4ms
     → Found multiple elements with the placeholder text of: Send a message

Here are the matching elements:

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_0_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_1_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_2_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_3_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_4_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_5_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_6_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_7_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_8_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...
   ✓ EE Chat (streaming state) > aborts the streaming request when Stop is clicked 40ms
   × EE Chat (streaming state) > stops updating token display and ends generation state after Stop 6ms
     → Found multiple elements with the placeholder text of: Send a message

Here are the matching elements:

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_0_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_1_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_2_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...
   × EE Chat (streaming state) > shows a streaming cursor while receiving tokens 3ms
     → Found multiple elements with the placeholder text of: Send a message

Here are the matching elements:

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_0_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_1_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_2_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_3_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_4_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_5_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...
   × EE Chat (streaming state) > removes the streaming cursor when done is received 6ms
     → Found multiple elements with the placeholder text of: Send a message

Here are the matching elements:

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_0_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_1_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_2_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_3_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_4_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_5_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_6_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...
   × EE Chat (streaming state) > shows the partial response when a network error occurs mid-stream 8ms
     → Found multiple elements with the placeholder text of: Send a message

Here are the matching elements:

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_0_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_1_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50 group"[39m
            [33mtype[39m=[32m"button"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"14"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"14"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"p-6 pt-0 undefined"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"min-h-[200px]"[39m
        [36m/>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"chat-container"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"chats"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"mb-auto w-full"[39m
        [36m>[39m
          [36m<div[39m
            [33mclass[39m=[32m"message-wrapper message-wrapper--user"[39m
          [36m>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-row message-row--user"[39m
            [36m>[39m
              [36m<div[39m
                [33mclass[39m=[32m"message-body message-body--user"[39m
              [36m>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-bubble message-bubble--user"[39m
                [36m>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-header"[39m
                  [36m>[39m
                    [36m<div[39m
                      [33mclass[39m=[32m"message-header__left"[39m
                    [36m>[39m
                      [36m<span[39m
                        [33mclass[39m=[32m"message-author"[39m
                      [36m>[39m
                        [0mYou[0m
                      [36m</span>[39m
                    [36m</div>[39m
                  [36m</div>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-content"[39m
                  [36m>[39m
                    [36m<p>[39m
                      [0mPing[0m
                    [36m</p>[39m
                  [36m</div>[39m
                [36m</div>[39m
                [36m<div[39m
                  [33maria-hidden[39m=[32m"true"[39m
                  [33mclass[39m=[32m"message-avatar message-avatar--user"[39m
                [36m>[39m
                  [36m<svg[39m
                    [33mfill[39m=[32m"none"[39m
                    [33mstroke[39m=[32m"currentColor"[39m
                    [33mstroke-linecap[39m=[32m"round"[39m
                    [33mstroke-linejoin[39m=[32m"round"[39m
                    [33mstroke-width[39m=[32m"2"[39m
                    [33mstyle[39m=[32m"width: 60%; height: 60%;"[39m
                    [33mviewBox[39m=[32m"0 0 24 24"[39m
                  [36m>[39m
                    [36m<path[39m
                      [33md[39m=[32m"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"[39m
                    [36m/>[39m
                    [36m<circle[39m
                      [33mcx[39m=[32m"12"[39m
                      [33mcy[39m=[32m"7"[39m
                      [33mr[39m=[32m"4"[39m
                    [36m/>[39m
                  [36m</svg>[39m
                [36m</div>[39m
              [36m</div>[39m
            [36m</div>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-feedback message-feedback--user"[39m
            [36m/>[39m
          [36m</div>[39m
          [36m<div[39m
            [33mclass[39m=[32m"message-wrapper message-wrapper--assistant"[39m
          [36m>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-row message-row--assistant"[39m
            [36m>[39m
              [36m<div[39m
                [33mclass[39m=[32m"message-body"[39m
              [36m>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-avatar message-avatar--assistant"[39m
                [36m/>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-bubble message-bubble--assistant"[39m
                [36m>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-header"[39m
                  [36m>[39m
                    [36m<div[39m
                      [33mclass[39m=[32m"message-header__left"[39m
                    [36m>[39m
                      [36m<span[39m
                        [33mclass[39m=[32m"message-author"[39m
                      [36m>[39m
                        [0mAlga[0m
                      [36m</span>[39m
                    [36m</div>[39m
                  [36m</div>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-content"[39m
                  [36m>[39m
                    [36m<p>[39m
                      [0mHi[0m
                    [36m</p>[39m
                  [36m</div>[39m
                [36m</div>[39m
              [36m</div>[39m
            [36m</div>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-feedback message-feedback--assistant"[39m
            [36m>[39m
              [36m<div[39m
                [33mclass[39m=[32m"feedback-container"[39m
              [36m>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"thumbs-container"[39m
                [36m/>[39m
              [36m</div>[39m
            [36m</div>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<footer[39m
        [33mclass[39m=[32m"chat-footer"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"chat-footer__inner"[39m
        [36m>[39m
          [36m<div[39m
            [33mclass[39m=[32m"chat-footer__input"[39m
          [36m>[39m
            [36m<textarea[39m
              [33maria-busy[39m=[32m"false"[39m
              [33maria-label[39m=[32m"Message Alga"[39m
              [33mclass[39m=[32m"chat-input"[39m
              [33mdata-automation-id[39m=[32m"chat-input"[39m
              [33mid[39m=[32m"_r_0_"[39m
              [33mplaceholder[39m=[32m"Send a message"[39m
              [33mrows[39m=[32m"3"[39m
              [33mstyle[39m=[32m"height: 0px;"[39m
            [36m/>[39m
            [36m<p[39m
              [33mclass[39m=[32m"chat-input__hint"[39m
            [36m>[39m
              [0mPress Ctrl+Enter or ⌘+Enter to send.[0m
            [36m</p>[39m
          [36m</div>[39m
          [36m<button[39m
            [33mclass[39m=[32m"chat-action chat-action--send"[39m
            [33mtype[39m=[32m"submit"[39m
          [36m>[39m
            [0mSEND[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</footer>[39m
      [36m<div>[39m
        [36m<div>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-sm text-gray-700"[39m
          [36m/>[39m
        [36m</div>[39m
        [36m<div>[39m
          [36m<button[39m
            [33mid[39m=[32m"chat-empty-message-dialog-ok"[39m
          [36m>[39m
            [0mOK[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"chat-container"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"chats"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"mb-auto w-full"[39m
        [36m>[39m
          [36m<div[39m
            [33mclass[39m=[32m"m-auto justify-center flex items-center text-center"[39m
            [33mstyle[39m=[32m"min-height: 300px;"[39m
          [36m>[39m
            [36m<div[39m
              [33mclass[39m=[32m"initial-alga"[39m
            [36m>[39m
              [36m<h1[39m
                [33mclass[39m=[32m"mt-6 text-2xl mx-1"[39m
              [36m>[39m
                [0mI am Alga! Your favorite AI assistant. Ask me a question.[0m
              [36m</h1>[39m
            [36m</div>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<footer[39m
        [33mclass[39m=[32m"chat-footer"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"chat-footer__inner"[39m
        [36m>[39m
          [36m<div[39m
            [33mclass[39m=[32m"chat-footer__input"[39m
          [36m>[39m
            [36m<textarea[39m
              [33maria-busy[39m=[32m"false"[39m
              [33maria-label[39m=[32m"Message Alga"[39m
              [33mclass[39m=[32m"chat-input"[39m
              [33mdata-automation-id[39m=[32m"chat-input"[39m
              [33mid[39m=[32m"_r_1_"[39m
              [33mplaceholder[39m=[32m"Send a message"[39m
              [33mrows[39m=[32m"3"[39m
              [33mstyle[39m=[32m"height: 0px;"[39m
            [36m/>[39m
            [36m<p[39m
              [33mclass[39m=[32m"chat-input__hint"[39m
            [36m>[39m
              [0mPress Ctrl+Enter or ⌘+Enter to send.[0m
            [36m</p>[39m
          [36m</div>[39m
          [36m<button[39m
            [33mclass[39m=[32m"chat-action chat-action--send"[39m
            [33mtype[39m=[32m"submit"[39m
          [36m>[39m
            [0mSEND[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</footer>[39m
      [36m<div>[39m
        [36m<div>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-sm text-gray-700"[39m
          [36m/>[39m
        [36m</div>[39m
        [36m<div>[39m
          [36m<button[39m
            [33mid[39m=[32m"chat-empty-message-dialog-ok"[39m
          [36m>[39m
            [0mOK[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
[36m</body>[39m
   × EE Chat (streaming state) > shows an interruption indicator when the stream ends without done=true 5ms
     → Found multiple elements with the placeholder text of: Send a message

Here are the matching elements:

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_0_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_1_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_2_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_3_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_4_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_5_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_6_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_7_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...
   × EE Chat (streaming state) > persists the assistant message after streaming completes 4ms
     → Found multiple elements with the placeholder text of: Send a message

Here are the matching elements:

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_0_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_1_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_2_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_3_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...
   × EE Chat (streaming state) > persists assistant content matching the final streamed tokens 4ms
     → Found multiple elements with the placeholder text of: Send a message

Here are the matching elements:

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_0_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_1_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_2_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_3_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_4_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...
stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.poBanner.ui.test.tsx
Initializing secret provider (legacy mode with composite fallback). Using read chain [env, filesystem] with write provider filesystem
EnvSecretProvider initialized without prefix

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.poBanner.ui.test.tsx
CompositeSecretProvider initialized with 2 read providers and 1 write provider

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.poBanner.ui.test.tsx
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.poBanner.ui.test.tsx
Retrieved secret 'db_password_server' from configured provider.

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.poBanner.ui.test.tsx
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.poBanner.ui.test.tsx
Retrieved secret 'postgres_password' from configured provider.

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.poBanner.ui.test.tsx
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | server/src/test/unit/billing/contractPurchaseOrderSupport.poBanner.ui.test.tsx
Retrieved secret 'db_password_server' from configured provider.

 ❯ server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx (9 tests | 6 failed) 4079ms 149 MB heap used
   × ExperimentalFeaturesSettings > shows 'AI Assistant' name and description 1012ms
     → Found multiple elements with the text: AI Assistant

Here are the matching elements:

Ignored nodes: comments, script, style
[36m<div[39m
  [33mclass[39m=[32m"font-medium"[39m
[36m>[39m
  [0mAI Assistant[0m
[36m</div>[39m

Ignored nodes: comments, script, style
[36m<div[39m
  [33mclass[39m=[32m"font-medium"[39m
[36m>[39m
  [0mAI Assistant[0m
[36m</div>[39m

Ignored nodes: comments, script, style
[36m<div[39m
  [33mclass[39m=[32m"font-medium"[39m
[36m>[39m
  [0mAI Assistant[0m
[36m</div>[39m

Ignored nodes: comments, script, style
[36m<div[39m
  [33mclass[39m=[32m"font-medium"[39m
[36m>[39m
  [0mAI Assistant[0m
[36m</div>[39m

Ignored nodes: comments, script, style
[36m<div[39m
  [33mclass[39m=[32m"font-medium"[39m
[36m>[39m
  [0mAI Assistant[0m
[36m</div>[39m

Ignored nodes: comments, script, style
[36m<div[39m
  [33mclass[39m=[32m"font-medium"[39m
[36m>[39m
  [0mAI Assistant[0m
[36m</div>[39m

Ignored nodes: comments, script, style
[36m<div[39m
  [33mclass[39m=[32m"font-medium"[39m
[36m>[39m
  [0mAI Assistant[0m
[36m</div>[39m

Ignored nodes: comments, script, style
[36m<div[39m
  [33mclass[39m=[32m"font-medium"[39m
[36m>[39m
  [0mAI Assistant[0m
[36m</div>[39m

Ignored nodes: comments, script, style
[36m<div[39m
  [33mclass[39m=[32m"font-medium"[39m
[36m>[39m
  [0mAI Assistant[0m
[36m</div>[39m

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...
   ✓ ExperimentalFeaturesSettings > defaults AI Assistant toggle to off 10ms
   × ExperimentalFeaturesSettings > renders experimental features warning banner 1006ms
     → Found multiple elements with the text: Experimental

Here are the matching elements:

Ignored nodes: comments, script, style
[36m<h5[39m
  [33mclass[39m=[32m"mb-1 font-medium leading-none tracking-tight"[39m
[36m>[39m
  [0mExperimental[0m
[36m</h5>[39m

Ignored nodes: comments, script, style
[36m<h5[39m
  [33mclass[39m=[32m"mb-1 font-medium leading-none tracking-tight"[39m
[36m>[39m
  [0mExperimental[0m
[36m</h5>[39m

Ignored nodes: comments, script, style
[36m<h5[39m
  [33mclass[39m=[32m"mb-1 font-medium leading-none tracking-tight"[39m
[36m>[39m
  [0mExperimental[0m
[36m</h5>[39m

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...
   × ExperimentalFeaturesSettings > calls updateExperimentalFeatures() with current toggle states on save 1011ms
     → Found multiple elements with the role "button" and name "Save"

Here are the matching elements:

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50 group"[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [36m<svg[39m
    [33mclass[39m=[32m"lucide lucide-save"[39m
    [33mfill[39m=[32m"none"[39m
    [33mheight[39m=[32m"14"[39m
    [33mstroke[39m=[32m"currentColor"[39m
    [33mstroke-linecap[39m=[32m"round"[39m
    [33mstroke-linejoin[39m=[32m"round"[39m
    [33mstroke-width[39m=[32m"2"[39m
    [33mviewBox[39m=[32m"0 0 24 24"[39m
    [33mwidth[39m=[32m"14"[39m
    [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
  [36m>[39m
    [36m<path[39m
      [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
    [36m/>[39m
    [36m<path[39m
      [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
    [36m/>[39m
    [36m<path[39m
      [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
    [36m/>[39m
  [36m</svg>[39m
  [0mSave[0m
[36m</button>[39m

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] h-10 py-2 px-4 group"[39m
  [33mdisabled[39m=[32m""[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [0mSave[0m
[36m</button>[39m

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] h-10 py-2 px-4 group"[39m
  [33mdisabled[39m=[32m""[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [0mSave[0m
[36m</button>[39m

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] h-10 py-2 px-4 group"[39m
  [33mdisabled[39m=[32m""[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [0mSave[0m
[36m</button>[39m

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] h-10 py-2 px-4 group"[39m
  [33mdisabled[39m=[32m""[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [0mSave[0m
[36m</button>[39m

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] h-10 py-2 px-4 group"[39m
  [33mdisabled[39m=[32m""[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [0mSave[0m
[36m</button>[39m

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] h-10 py-2 px-4 group"[39m
  [33mdisabled[39m=[32m""[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [0mSave[0m
[36m</button>[39m

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...
   × ExperimentalFeaturesSettings > shows success feedback after saving 1013ms
     → Found multiple elements with the role "button" and name "Save"

Here are the matching elements:

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50 group"[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [36m<svg[39m
    [33mclass[39m=[32m"lucide lucide-save"[39m
    [33mfill[39m=[32m"none"[39m
    [33mheight[39m=[32m"14"[39m
    [33mstroke[39m=[32m"currentColor"[39m
    [33mstroke-linecap[39m=[32m"round"[39m
    [33mstroke-linejoin[39m=[32m"round"[39m
    [33mstroke-width[39m=[32m"2"[39m
    [33mviewBox[39m=[32m"0 0 24 24"[39m
    [33mwidth[39m=[32m"14"[39m
    [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
  [36m>[39m
    [36m<path[39m
      [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
    [36m/>[39m
    [36m<path[39m
      [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
    [36m/>[39m
    [36m<path[39m
      [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
    [36m/>[39m
  [36m</svg>[39m
  [0mSave[0m
[36m</button>[39m

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] h-10 py-2 px-4 group"[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [0mSave[0m
[36m</button>[39m

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] h-10 py-2 px-4 group"[39m
  [33mdisabled[39m=[32m""[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [0mSave[0m
[36m</button>[39m

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] h-10 py-2 px-4 group"[39m
  [33mdisabled[39m=[32m""[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [0mSave[0m
[36m</button>[39m

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] h-10 py-2 px-4 group"[39m
  [33mdisabled[39m=[32m""[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [0mSave[0m
[36m</button>[39m

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] h-10 py-2 px-4 group"[39m
  [33mdisabled[39m=[32m""[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [0mSave[0m
[36m</button>[39m

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] h-10 py-2 px-4 group"[39m
  [33mdisabled[39m=[32m""[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [0mSave[0m
[36m</button>[39m

Ignored nodes: comments, script, style
[36m<button[39m
  [33mclass[39m=[32m"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] h-10 py-2 px-4 group"[39m
  [33mdisabled[39m=[32m""[39m
  [33mtype[39m=[32m"button"[39m
[36m>[39m
  [0mSave[0m
[36m</button>[39m

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"space-y-2 mb-1"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center justify-between"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-5"[39m
        [36m>[39m
          [36m<div>[39m
            [0m← Back to Projects[0m
          [36m</div>[39m
          [36m<span[39m
            [33mclass[39m=[32m"text-sm font-medium text-gray-600"[39m
          [36m>[39m
            [0mPRJ-100[0m
          [36m</span>[39m
          [36m<h1[39m
            [33mclass[39m=[32m"text-xl font-bold"[39m
          [36m>[39m
            [0mTest Project[0m
          [36m</h1>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center gap-2"[39m
        [36m>[39m
          [36m<button[39m
            [33mid[39m=[32m"save-as-template-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave as Template[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"project-materials-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [0mMaterials[0m
          [36m</button>[39m
          [36m<button[39m
            [33mid[39m=[32m"edit-project-button"[39m
            [33mtype[39m=[32m"button"[39m
            [33mvariant[39m=[32m"outline"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-pen h-4 w-4 mr-2"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"24"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"24"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mEdit[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex items-center space-x-8"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mClient:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mClient One[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mContact:[0m
          [36m</h5>[39m
          [36m<p[39m
            [33mclass[39m=[32m"text-base text-gray-800"[39m
          [36m>[39m
            [0mN/A[0m
          [36m</p>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex items-center space-x-2 flex-1"[39m
        [36m>[39m
          [36m<h5[39m
            [33mclass[39m=[32m"font-bold text-gray-800"[39m
          [36m>[39m
            [0mBudget:[0m
          [36m</h5>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex items-center space-x-3 flex-1"[39m
          [36m>[39m
            [36m<span[39m
              [33mclass[39m=[32m"text-base text-gray-800 whitespace-nowrap"[39m
            [36m>[39m
              [0m0.0[0m
              [0m of [0m
              [0m0.0[0m
              [0m hours[0m
            [36m</span>[39m
            [36m<div[39m
              [33mclass[39m=[32m"flex-1"[39m
            [36m/>[39m
          [36m</div>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hov...
   ✓ ExperimentalFeaturesSettings > updates local state when toggled 8ms
   ✓ ExperimentalFeaturesSettings > loads current settings on mount 4ms
   × ExperimentalFeaturesSettings > renders list of features with toggles 11ms
     → expected [ <button …(8)>…(1)</button>, …(7) ] to have a length of 2 but got 8
   × ExperimentalFeaturesSettings > disables AI Assistant toggle when not allowed 5ms
     → expected 'true' to be 'false' // Object.is equality
 ❯ packages/billing/tests/contractWizardResume.test.tsx (14 tests | 14 failed) 48ms 167 MB heap used
   × ContractWizard resume behavior > starts at Step 1 (Contract Basics) when opened (T033) 1ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

   × ContractWizard resume behavior > step 1 shows pre-populated client selection from draft (T034) 2ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

   × ContractWizard resume behavior > step 1 shows pre-populated contract name from draft (T035) 2ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

   × ContractWizard resume behavior > step 1 shows pre-populated dates from draft (T036) 2ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

   × ContractWizard resume behavior > step 2 (Fixed Fee) shows pre-populated services from draft (T037) 1ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

   × ContractWizard resume behavior > step 3 (Products) shows pre-populated products from draft (T038) 2ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

   × ContractWizard resume behavior > step 4 (Hourly) shows pre-populated hourly services from draft (T039) 2ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

   × ContractWizard resume behavior > step 5 (Usage) shows pre-populated usage services from draft (T040) 1ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

   × ContractWizard resume behavior > step 6 (Review) shows complete draft data for review (T041) 1ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

   × ContractWizard resume behavior > clicking Save Draft in resumed wizard updates existing draft (T042) 2ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

   × ContractWizard resume behavior > save draft does not create a duplicate contract (T043) 1ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

   × ContractWizard resume behavior > save draft preserves the original contract_id (T044) 26ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

   × ContractWizard resume behavior > completing resumed wizard sets contract status to 'active' (T045) 2ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

   × ContractWizard resume behavior > completing resumed wizard sets is_active to true (T046) 2ms
     → [vitest] No "DialogContent" export is defined on the "@alga-psa/ui/components/Dialog" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

 ✓ packages/projects/src/components/__tests__/TaskQuickAddPrefill.test.tsx (1 test) 2ms 170 MB heap used
stdout | packages/tickets/src/components/ticket/__tests__/TicketDetailsCreateTask.test.tsx
Initializing secret provider (legacy mode with composite fallback). Using read chain [env, filesystem] with write provider filesystem
EnvSecretProvider initialized without prefix

stdout | packages/tickets/src/components/ticket/__tests__/TicketDetailsCreateTask.test.tsx
CompositeSecretProvider initialized with 2 read providers and 1 write provider

stdout | packages/tickets/src/components/ticket/__tests__/TicketDetailsCreateTask.test.tsx
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | packages/tickets/src/components/ticket/__tests__/TicketDetailsCreateTask.test.tsx
Retrieved secret 'db_password_server' from configured provider.

stdout | packages/tickets/src/components/ticket/__tests__/TicketDetailsCreateTask.test.tsx
CompositeSecretProvider found app secret 'postgres_password' from provider 1

stdout | packages/tickets/src/components/ticket/__tests__/TicketDetailsCreateTask.test.tsx
Retrieved secret 'postgres_password' from configured provider.

stdout | packages/tickets/src/components/ticket/__tests__/TicketDetailsCreateTask.test.tsx
CompositeSecretProvider found app secret 'db_password_server' from provider 1

stdout | packages/tickets/src/components/ticket/__tests__/TicketDetailsCreateTask.test.tsx
Retrieved secret 'db_password_server' from configured provider.

 ❯ server/src/test/unit/RightSidebar.streaming.test.tsx (1 test | 1 failed) 1009ms 170 MB heap used
   × RightSidebar (streaming) > renders streaming Chat and posts to the streaming completions endpoint 1008ms
     → Found multiple elements with the placeholder text of: Send a message

Here are the matching elements:

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_0_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_1_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_2_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_3_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_4_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_5_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_6_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_7_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_8_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

Ignored nodes: comments, script, style
[36m<textarea[39m
  [33maria-busy[39m=[32m"false"[39m
  [33maria-label[39m=[32m"Message Alga"[39m
  [33mclass[39m=[32m"chat-input"[39m
  [33mdata-automation-id[39m=[32m"chat-input"[39m
  [33mid[39m=[32m"_r_a_"[39m
  [33mplaceholder[39m=[32m"Send a message"[39m
  [33mrows[39m=[32m"3"[39m
  [33mstyle[39m=[32m"height: 0px;"[39m
[36m/>[39m

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50 group"[39m
            [33mtype[39m=[32m"button"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"14"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"14"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"p-6 pt-0 undefined"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"min-h-[200px]"[39m
        [36m/>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"chat-container"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"chats"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"mb-auto w-full"[39m
        [36m>[39m
          [36m<div[39m
            [33mclass[39m=[32m"message-wrapper message-wrapper--user"[39m
          [36m>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-row message-row--user"[39m
            [36m>[39m
              [36m<div[39m
                [33mclass[39m=[32m"message-body message-body--user"[39m
              [36m>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-bubble message-bubble--user"[39m
                [36m>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-header"[39m
                  [36m>[39m
                    [36m<div[39m
                      [33mclass[39m=[32m"message-header__left"[39m
                    [36m>[39m
                      [36m<span[39m
                        [33mclass[39m=[32m"message-author"[39m
                      [36m>[39m
                        [0mYou[0m
                      [36m</span>[39m
                    [36m</div>[39m
                  [36m</div>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-content"[39m
                  [36m>[39m
                    [36m<p>[39m
                      [0mPing[0m
                    [36m</p>[39m
                  [36m</div>[39m
                [36m</div>[39m
                [36m<div[39m
                  [33maria-hidden[39m=[32m"true"[39m
                  [33mclass[39m=[32m"message-avatar message-avatar--user"[39m
                [36m>[39m
                  [36m<svg[39m
                    [33mfill[39m=[32m"none"[39m
                    [33mstroke[39m=[32m"currentColor"[39m
                    [33mstroke-linecap[39m=[32m"round"[39m
                    [33mstroke-linejoin[39m=[32m"round"[39m
                    [33mstroke-width[39m=[32m"2"[39m
                    [33mstyle[39m=[32m"width: 60%; height: 60%;"[39m
                    [33mviewBox[39m=[32m"0 0 24 24"[39m
                  [36m>[39m
                    [36m<path[39m
                      [33md[39m=[32m"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"[39m
                    [36m/>[39m
                    [36m<circle[39m
                      [33mcx[39m=[32m"12"[39m
                      [33mcy[39m=[32m"7"[39m
                      [33mr[39m=[32m"4"[39m
                    [36m/>[39m
                  [36m</svg>[39m
                [36m</div>[39m
              [36m</div>[39m
            [36m</div>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-feedback message-feedback--user"[39m
            [36m/>[39m
          [36m</div>[39m
          [36m<div[39m
            [33mclass[39m=[32m"message-wrapper message-wrapper--assistant"[39m
          [36m>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-row message-row--assistant"[39m
            [36m>[39m
              [36m<div[39m
                [33mclass[39m=[32m"message-body"[39m
              [36m>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-avatar message-avatar--assistant"[39m
                [36m/>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-bubble message-bubble--assistant"[39m
                [36m>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-header"[39m
                  [36m>[39m
                    [36m<div[39m
                      [33mclass[39m=[32m"message-header__left"[39m
                    [36m>[39m
                      [36m<span[39m
                        [33mclass[39m=[32m"message-author"[39m
                      [36m>[...

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50 group"[39m
            [33mtype[39m=[32m"button"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"14"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"14"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"p-6 pt-0 undefined"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"min-h-[200px]"[39m
        [36m/>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"chat-container"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"chats"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"mb-auto w-full"[39m
        [36m>[39m
          [36m<div[39m
            [33mclass[39m=[32m"message-wrapper message-wrapper--user"[39m
          [36m>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-row message-row--user"[39m
            [36m>[39m
              [36m<div[39m
                [33mclass[39m=[32m"message-body message-body--user"[39m
              [36m>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-bubble message-bubble--user"[39m
                [36m>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-header"[39m
                  [36m>[39m
                    [36m<div[39m
                      [33mclass[39m=[32m"message-header__left"[39m
                    [36m>[39m
                      [36m<span[39m
                        [33mclass[39m=[32m"message-author"[39m
                      [36m>[39m
                        [0mYou[0m
                      [36m</span>[39m
                    [36m</div>[39m
                  [36m</div>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-content"[39m
                  [36m>[39m
                    [36m<p>[39m
                      [0mPing[0m
                    [36m</p>[39m
                  [36m</div>[39m
                [36m</div>[39m
                [36m<div[39m
                  [33maria-hidden[39m=[32m"true"[39m
                  [33mclass[39m=[32m"message-avatar message-avatar--user"[39m
                [36m>[39m
                  [36m<svg[39m
                    [33mfill[39m=[32m"none"[39m
                    [33mstroke[39m=[32m"currentColor"[39m
                    [33mstroke-linecap[39m=[32m"round"[39m
                    [33mstroke-linejoin[39m=[32m"round"[39m
                    [33mstroke-width[39m=[32m"2"[39m
                    [33mstyle[39m=[32m"width: 60%; height: 60%;"[39m
                    [33mviewBox[39m=[32m"0 0 24 24"[39m
                  [36m>[39m
                    [36m<path[39m
                      [33md[39m=[32m"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"[39m
                    [36m/>[39m
                    [36m<circle[39m
                      [33mcx[39m=[32m"12"[39m
                      [33mcy[39m=[32m"7"[39m
                      [33mr[39m=[32m"4"[39m
                    [36m/>[39m
                  [36m</svg>[39m
                [36m</div>[39m
              [36m</div>[39m
            [36m</div>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-feedback message-feedback--user"[39m
            [36m/>[39m
          [36m</div>[39m
          [36m<div[39m
            [33mclass[39m=[32m"message-wrapper message-wrapper--assistant"[39m
          [36m>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-row message-row--assistant"[39m
            [36m>[39m
              [36m<div[39m
                [33mclass[39m=[32m"message-body"[39m
              [36m>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-avatar message-avatar--assistant"[39m
                [36m/>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-bubble message-bubble--assistant"[39m
                [36m>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-header"[39m
                  [36m>[39m
                    [36m<div[39m
                      [33mclass[39m=[32m"message-header__left"[39m
                    [36m>[39m
                      [36m<span[39m
                        [33mclass[39m=[32m"message-author"[39m
                      [36m>[...
 ✓ packages/billing/src/components/invoice-designer/DesignerShell.constraints.test.tsx (23 tests) 602ms 253 MB heap used
 ✓ packages/billing/src/components/invoice-designer/canvas/DesignCanvas.previewMode.test.tsx (15 tests) 50ms 260 MB heap used
 ❯ packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.previewWorkspace.test.tsx (11 tests | 1 failed) 1140ms 237 MB heap used
   ✓ InvoiceTemplateEditor preview workspace integration > preserves nested visual workspace state when switching Visual -> Code -> Visual 17ms
   ✓ InvoiceTemplateEditor preview workspace integration > hydrates workspace from source-embedded designer state 6ms
   ✓ InvoiceTemplateEditor preview workspace integration > hydrates workspace from localStorage fallback when source has no embedded state 11ms
   ✓ InvoiceTemplateEditor preview workspace integration > hydrates workspace from persisted templateAst payload 7ms
   ✓ InvoiceTemplateEditor preview workspace integration > keeps save payload behavior while preview sub-tab is active 20ms
   ✓ InvoiceTemplateEditor preview workspace integration > does not trigger save writes from preview interactions alone 6ms
   ✓ InvoiceTemplateEditor preview workspace integration > allows preview workspace access for new templates before name validation 10ms
   ✓ InvoiceTemplateEditor preview workspace integration > keeps Code tab generated/read-only for GUI templates 30ms
   × InvoiceTemplateEditor preview workspace integration > enables visual designer in local QA via forceInvoiceDesigner=1 when feature flag is off 1010ms
     → Unable to find an element by: [data-testid="designer-visual-workspace"]

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<iframe[39m
    [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
    [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
  [36m/>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
        [36m>[39m
          [36m<h3[39m
            [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
          [36m>[39m
            [0mNotes & Quick Info[0m
          [36m</h3>[39m
          [36m<button[39m
            [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50 group"[39m
            [33mtype[39m=[32m"button"[39m
          [36m>[39m
            [36m<svg[39m
              [33mclass[39m=[32m"lucide lucide-save"[39m
              [33mfill[39m=[32m"none"[39m
              [33mheight[39m=[32m"14"[39m
              [33mstroke[39m=[32m"currentColor"[39m
              [33mstroke-linecap[39m=[32m"round"[39m
              [33mstroke-linejoin[39m=[32m"round"[39m
              [33mstroke-width[39m=[32m"2"[39m
              [33mviewBox[39m=[32m"0 0 24 24"[39m
              [33mwidth[39m=[32m"14"[39m
              [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
            [36m>[39m
              [36m<path[39m
                [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
              [36m/>[39m
              [36m<path[39m
                [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
              [36m/>[39m
            [36m</svg>[39m
            [0mSave[0m
          [36m</button>[39m
        [36m</div>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"p-6 pt-0 undefined"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"min-h-[200px]"[39m
        [36m/>[39m
      [36m</div>[39m
    [36m</div>[39m
  [36m</div>[39m
  [36m<div>[39m
    [36m<div[39m
      [33mclass[39m=[32m"chat-container"[39m
    [36m>[39m
      [36m<div[39m
        [33mclass[39m=[32m"chats"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"mb-auto w-full"[39m
        [36m>[39m
          [36m<div[39m
            [33mclass[39m=[32m"message-wrapper message-wrapper--user"[39m
          [36m>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-row message-row--user"[39m
            [36m>[39m
              [36m<div[39m
                [33mclass[39m=[32m"message-body message-body--user"[39m
              [36m>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-bubble message-bubble--user"[39m
                [36m>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-header"[39m
                  [36m>[39m
                    [36m<div[39m
                      [33mclass[39m=[32m"message-header__left"[39m
                    [36m>[39m
                      [36m<span[39m
                        [33mclass[39m=[32m"message-author"[39m
                      [36m>[39m
                        [0mYou[0m
                      [36m</span>[39m
                    [36m</div>[39m
                  [36m</div>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-content"[39m
                  [36m>[39m
                    [36m<p>[39m
                      [0mPing[0m
                    [36m</p>[39m
                  [36m</div>[39m
                [36m</div>[39m
                [36m<div[39m
                  [33maria-hidden[39m=[32m"true"[39m
                  [33mclass[39m=[32m"message-avatar message-avatar--user"[39m
                [36m>[39m
                  [36m<svg[39m
                    [33mfill[39m=[32m"none"[39m
                    [33mstroke[39m=[32m"currentColor"[39m
                    [33mstroke-linecap[39m=[32m"round"[39m
                    [33mstroke-linejoin[39m=[32m"round"[39m
                    [33mstroke-width[39m=[32m"2"[39m
                    [33mstyle[39m=[32m"width: 60%; height: 60%;"[39m
                    [33mviewBox[39m=[32m"0 0 24 24"[39m
                  [36m>[39m
                    [36m<path[39m
                      [33md[39m=[32m"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"[39m
                    [36m/>[39m
                    [36m<circle[39m
                      [33mcx[39m=[32m"12"[39m
                      [33mcy[39m=[32m"7"[39m
                      [33mr[39m=[32m"4"[39m
                    [36m/>[39m
                  [36m</svg>[39m
                [36m</div>[39m
              [36m</div>[39m
            [36m</div>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-feedback message-feedback--user"[39m
            [36m/>[39m
          [36m</div>[39m
          [36m<div[39m
            [33mclass[39m=[32m"message-wrapper message-wrapper--assistant"[39m
          [36m>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-row message-row--assistant"[39m
            [36m>[39m
              [36m<div[39m
                [33mclass[39m=[32m"message-body"[39m
              [36m>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-avatar message-avatar--assistant"[39m
                [36m/>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-bubble message-bubble--assistant"[39m
                [36m>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-header"[39m
                  [36m>[39m
                    [36m<div[39m
                      [33mclass[39m=[32m"message-header__left"[39m
                    [36m>[39m
                      [36m<span[39m
                        [33mclass[39m=[32m"message-author"[39m
                      [36m>[...

Ignored nodes: comments, script, style
[36m<html>[39m
  [36m<head />[39m
  [36m<body>[39m
    [36m<iframe[39m
      [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
      [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
    [36m/>[39m
    [36m<iframe[39m
      [33msandbox[39m=[32m"allow-scripts, allow-same-origin"[39m
      [33msrc[39m=[32m"http://localhost:3000/ext-ui/test-extension-id/hash/index.html"[39m
    [36m/>[39m
    [36m<div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"rounded-lg border bg-card text-card-foreground shadow-sm bg-white"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"flex flex-col space-y-1.5 p-6 pb-2"[39m
        [36m>[39m
          [36m<div[39m
            [33mclass[39m=[32m"flex flex-row items-center justify-between"[39m
          [36m>[39m
            [36m<h3[39m
              [33mclass[39m=[32m"text-lg font-semibold leading-none tracking-tight undefined"[39m
            [36m>[39m
              [0mNotes & Quick Info[0m
            [36m</h3>[39m
            [36m<button[39m
              [33mclass[39m=[32m"inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background relative px-3 rounded-md h-8 gap-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50 group"[39m
              [33mtype[39m=[32m"button"[39m
            [36m>[39m
              [36m<svg[39m
                [33mclass[39m=[32m"lucide lucide-save"[39m
                [33mfill[39m=[32m"none"[39m
                [33mheight[39m=[32m"14"[39m
                [33mstroke[39m=[32m"currentColor"[39m
                [33mstroke-linecap[39m=[32m"round"[39m
                [33mstroke-linejoin[39m=[32m"round"[39m
                [33mstroke-width[39m=[32m"2"[39m
                [33mviewBox[39m=[32m"0 0 24 24"[39m
                [33mwidth[39m=[32m"14"[39m
                [33mxmlns[39m=[32m"http://www.w3.org/2000/svg"[39m
              [36m>[39m
                [36m<path[39m
                  [33md[39m=[32m"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"[39m
                [36m/>[39m
                [36m<path[39m
                  [33md[39m=[32m"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"[39m
                [36m/>[39m
                [36m<path[39m
                  [33md[39m=[32m"M7 3v4a1 1 0 0 0 1 1h7"[39m
                [36m/>[39m
              [36m</svg>[39m
              [0mSave[0m
            [36m</button>[39m
          [36m</div>[39m
        [36m</div>[39m
        [36m<div[39m
          [33mclass[39m=[32m"p-6 pt-0 undefined"[39m
        [36m>[39m
          [36m<div[39m
            [33mclass[39m=[32m"min-h-[200px]"[39m
          [36m/>[39m
        [36m</div>[39m
      [36m</div>[39m
    [36m</div>[39m
    [36m<div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"chat-container"[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"chats"[39m
        [36m>[39m
          [36m<div[39m
            [33mclass[39m=[32m"mb-auto w-full"[39m
          [36m>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-wrapper message-wrapper--user"[39m
            [36m>[39m
              [36m<div[39m
                [33mclass[39m=[32m"message-row message-row--user"[39m
              [36m>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-body message-body--user"[39m
                [36m>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-bubble message-bubble--user"[39m
                  [36m>[39m
                    [36m<div[39m
                      [33mclass[39m=[32m"message-header"[39m
                    [36m>[39m
                      [36m<div[39m
                        [33mclass[39m=[32m"message-header__left"[39m
                      [36m>[39m
                        [36m<span[39m
                          [33mclass[39m=[32m"message-author"[39m
                        [36m>[39m
                          [0mYou[0m
                        [36m</span>[39m
                      [36m</div>[39m
                    [36m</div>[39m
                    [36m<div[39m
                      [33mclass[39m=[32m"message-content"[39m
                    [36m>[39m
                      [36m<p>[39m
                        [0mPing[0m
                      [36m</p>[39m
                    [36m</div>[39m
                  [36m</div>[39m
                  [36m<div[39m
                    [33maria-hidden[39m=[32m"true"[39m
                    [33mclass[39m=[32m"message-avatar message-avatar--user"[39m
                  [36m>[39m
                    [36m<svg[39m
                      [33mfill[39m=[32m"none"[39m
                      [33mstroke[39m=[32m"currentColor"[39m
                      [33mstroke-linecap[39m=[32m"round"[39m
                      [33mstroke-linejoin[39m=[32m"round"[39m
                      [33mstroke-width[39m=[32m"2"[39m
                      [33mstyle[39m=[32m"width: 60%; height: 60%;"[39m
                      [33mviewBox[39m=[32m"0 0 24 24"[39m
                    [36m>[39m
                      [36m<path[39m
                        [33md[39m=[32m"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"[39m
                      [36m/>[39m
                      [36m<circle[39m
                        [33mcx[39m=[32m"12"[39m
                        [33mcy[39m=[32m"7"[39m
                        [33mr[39m=[32m"4"[39m
                      [36m/>[39m
                    [36m</svg>[39m
                  [36m</div>[39m
                [36m</div>[39m
              [36m</div>[39m
              [36m<div[39m
                [33mclass[39m=[32m"message-feedback message-feedback--user"[39m
              [36m/>[39m
            [36m</div>[39m
            [36m<div[39m
              [33mclass[39m=[32m"message-wrapper message-wrapper--assistant"[39m
            [36m>[39m
              [36m<div[39m
                [33mclass[39m=[32m"message-row message-row--assistant"[39m
              [36m>[39m
                [36m<div[39m
                  [33mclass[39m=[32m"message-body"[39m
                [36m>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-avatar message-avatar--assistant"[39m
                  [36m/>[39m
                  [36m<div[39m
                    [33mclass[39m=[32m"message-bubble message-bubble--assistant"[39m
                  [36m>[39m
                    [36m<div[39m
                      [33...
   ✓ InvoiceTemplateEditor preview workspace integration > keeps production behavior when feature flag is off and no override is set 5ms
   ✓ InvoiceTemplateEditor preview workspace integration > keeps generated source synchronized with GUI model while switching Visual and Code 18ms
 ✓ server/src/test/unit/tickets/TicketEmailNotifications.ui.test.tsx (7 tests) 107ms 236 MB heap used
 ✓ packages/billing/src/components/invoice-designer/canvas/DesignCanvas.constraintHighlights.test.tsx (2 tests) 3ms 257 MB heap used
 ✓ packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.test.tsx (28 tests) 1578ms 291 MB heap used
   ✓ DesignerVisualWorkspace > calls paginated invoice search with status=all and query filters  317ms
   ✓ DesignerVisualWorkspace > renders loading, empty, and error states for existing invoice list  620ms
 ✓ packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.authoritativeFlow.test.tsx (2 tests) 287ms 289 MB heap used
 ✓ packages/billing/tests/draftContractsTable.test.tsx (30 tests) 1622ms 380 MB heap used
 ✓ packages/projects/tests/projectMaterialsDrawer.test.tsx (16 tests) 162ms 398 MB heap used
 ✓ server/src/test/unit/email/EmailLogsClient.ui.test.tsx (6 tests) 951ms 392 MB heap used
   ✓ EmailLogsClient > updates results when date range filter changes  307ms
   ✓ EmailLogsClient > updates results when recipient search changes  307ms
   ✓ EmailLogsClient > updates results when ticket filter changes  308ms
 ✓ server/src/test/unit/QuickAskOverlay.streaming.test.tsx (1 test) 14ms 411 MB heap used
 ✓ packages/billing/tests/contractsActivationFlow.test.tsx (2 tests) 186ms 395 MB heap used

 Test Files  558 failed | 43 passed (601)
      Tests  105 failed | 274 passed | 66 skipped | 1 todo (446)
     Errors  1 error
   Start at  14:52:46
   Duration  25.74s (transform 2.21s, setup 290ms, collect 2.93s, tests 13.48s, environment 235ms, prepare 52ms) (pass).

### 2026-02-12 — T001 implemented

- Marked minimal AST schema acceptance as implemented.
- Evidence: `packages/billing/src/lib/invoice-template-ast/schema.test.ts` (`validates a minimal AST document`).

Verification:

- `NODE_ENV=test pnpm vitest --coverage.enabled=false packages/billing/src/lib/invoice-template-ast/schema.test.ts` (pass).
