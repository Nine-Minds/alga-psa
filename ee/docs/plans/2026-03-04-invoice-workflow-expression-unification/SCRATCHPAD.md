# SCRATCHPAD — Invoice Workflow Expression Binding Unification

- Plan slug: `invoice-workflow-expression-unification`
- Created: `2026-03-04`

## What This Is

Working notes for unifying invoice designer bindings and Workflow v2 expression authoring on a shared expression foundation while preserving each runtime/storage contract.

## Decisions

- (2026-03-04) Use a shared abstraction centered on typed context paths + expression modes (`path-only`, `template`, `expression`) instead of forcing one persisted expression format across products.
- (2026-03-04) Shared primitives module location: `shared/workflow/expression-authoring/*` so both invoice (`packages/billing`) and workflow designer (`ee/server`) can import through `@shared/workflow/...`.
- (2026-03-04) Shared context contract includes explicit `SharedExpressionContextRoot` and `SharedExpressionPathOption` interfaces plus deterministic root serialization to stabilize cross-editor behavior/tests.
- (2026-03-04) Shared path discovery contract uses deterministic lexical traversal with explicit array item marker segments (`[]`) and additional-property wildcard (`*`) to produce stable picker options.
- (2026-03-04) Shared insertion helper is split into pure value insertion (`insertTextIntoValue`) plus environment-specific adapters (`insertTextIntoDomControl`, `insertTextIntoMonacoEditor`) with explicit no-op reasons.
- (2026-03-04) Shared validation contract (`SharedExpressionValidationResult`) normalizes severity ordering and preserves path/root/range attribution for downstream UI rendering.
- (2026-03-04) Invoice adapter roots stay domain-native (`invoice`, `customer`, `tenant`, `item`) for this migration to preserve existing author mental model and template bindings.
- (2026-03-04) Workflow adapter includes dynamic loop roots (`itemVar`, `indexVar`) so forEach-scoped expressions can use the same shared path options as global roots.
- (2026-03-04) Invoice palette fields now derive from `buildInvoiceExpressionPathOptions(...)`; static catalog import path is no longer used in rendering/search.
- (2026-03-04) Invoice FIELDS panel grouping now maps directly to shared root keys (`invoice/customer/tenant/item`) and only renders leaf path options from the shared model.
- (2026-03-04) `DesignerShell` now uses `insertTextIntoDomControl` and target-path mode inference: inspector fields ending in `bindingKey` receive raw path insertion (`path-only`).
- (2026-03-04) Invoice text fallback insertion path also uses shared insertion primitives (`insertTextIntoValue`) and enforces template token formatting for text/label nodes.
- (2026-03-04) Workspace AST export now parses moustache text edits into dynamic expressions: full-token moustache becomes `path`, mixed literal+moustache becomes `template` with deterministic arg keys.
- (2026-03-04) Existing roundtrip suites (`workspaceAst.roundtrip.*`) remain green after adapter/insertion changes, confirming deterministic export/import behavior.
- (2026-03-04) Shared path validator (`validateSourcePaths`) now powers invoice insertion feedback; unknown paths emit informational diagnostics without breaking insertion flow.
- (2026-03-04) Workflow step config validation now derives shared path options from `DataContext` via `buildWorkflowExpressionPathOptions(...)` and uses `validateSourcePaths(...)` in place of legacy `${...}` scanners.
- (2026-03-04) Workflow step validation UI now consumes shared diagnostic objects directly (`severity`, `code`, `message`, `path`) and renders grouped Error/Warning/Info cards from the shared contract.
- (2026-03-04) Runtime function allowlist is now centralized in `shared/workflow/runtime/expressionFunctions.ts` and consumed by both runtime validation and Monaco completion generation.
- (2026-03-04) Workflow function completion/snippet suggestions are now constrained to runtime-allowlisted helpers (`$nowIso`, `$coalesce`, `$len`, `$toString`, `$append`).
- (2026-03-04) Workflow diagnostics now validate `$function(...)` tokens against runtime-allowlisted helpers only; non-allowlisted JSONata built-ins are flagged as unknown in-editor.
- (2026-03-04) Workflow persisted expression shape remains `{ $expr: string }`; migration changes were limited to authoring/validation paths and retained `ensureExpr` + runtime schema guards.
- (2026-03-04) Added focused runtime guardrail tests (`expressionEngine.test.ts`) to lock function allowlist rejection, timeout enforcement, JSON-serializable result checks, and max output size checks.
- (2026-03-04) Shared schema/context-aware path checks (`validateSourcePaths`) are now used in both designers where author-time validation exists:
  - invoice insertion feedback (`DesignerShell`)
  - workflow step config validation (`WorkflowDesigner`)
- (2026-03-04) Preserve persisted contracts:
  - Invoice keeps AST value expressions (`literal|binding|path|template`).
  - Workflow keeps `{ $expr: string }`.
- (2026-03-04) Migrate incrementally via adapters; no big-bang rewrite.
- (2026-03-04) Treat runtime allowlist as source of truth for workflow function capability; editor metadata must conform to it.
- (2026-03-04) Keep plan scope focused on logic/functionality and correctness; exclude metrics/observability/production-readiness additions.
- (2026-03-04) Replace doc-only feature/test entries with explicit test implementation standards and enforceable meta-tests (framework, selector strategy, anti-tautology, feature-test traceability).

## Discoveries / Constraints

- (2026-03-04) This branch already had uncommitted invoice-designer WIP focused on static `templateVariableCatalog` and local insertion logic; foundational shared abstractions were still missing.
- (2026-03-04) Invoice currently uses multiple authoring paths:
  - `metadata.bindingKey` (path string)
  - moustache text in `metadata.text`
  - AST conversion in `workspaceAst.ts`.
- (2026-03-04) Invoice preview now resolves moustache interpolation in canvas preview path but this is distinct from export compilation.
- (2026-03-04) Workflow currently has duplicated expression validation paths:
  - Monaco diagnostics provider
  - Legacy `${...}` extraction/validation in `WorkflowDesigner.tsx`.
- (2026-03-04) `WorkflowDesigner.tsx` no longer defines `extractExpressionPaths` / `validateExpressionPath`; step validation now emits issues from shared validation diagnostics.
- (2026-03-04) Editor metadata previously exposed broad JSONata helpers; completion hints were not runtime-aligned until runtime allowlist filtering was introduced.
- (2026-03-04) Workflow editor function metadata includes many JSONata functions, while runtime currently allowlists only a small helper set in `shared/workflow/runtime/expressionEngine.ts`.
- (2026-03-04) Removing drift between workflow editor and runtime is required to avoid misleading UX.

## Commands / Runbooks

- Implement F001 shared mode contract:
  - `shared/workflow/expression-authoring/modes.ts` (`EXPRESSION_MODES`, `ExpressionMode`, `isExpressionMode`)
- Implement F002 context and path option contracts:
  - `shared/workflow/expression-authoring/context.ts`
- Implement F003 path discovery helper:
  - `shared/workflow/expression-authoring/pathDiscovery.ts`
- Implement F004 insertion helper API:
  - `shared/workflow/expression-authoring/insertion.ts`
- Implement F005 validation result contract:
  - `shared/workflow/expression-authoring/validation.ts`
- Implement F006 invoice adapter:
  - `shared/workflow/expression-authoring/adapters/invoiceContextAdapter.ts`
- Implement F007 workflow adapter:
  - `shared/workflow/expression-authoring/adapters/workflowContextAdapter.ts`
- Validate invoice field palette integration after adapter wiring:
  - `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/palette/ComponentPalette.fields.integration.test.tsx`
- Validate invoice shell + fields insertion wiring:
  - `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/palette/ComponentPalette.fields.integration.test.tsx ../packages/billing/src/components/invoice-designer/DesignerShell.selectedContext.integration.test.tsx`
- Validate moustache-to-AST behavior:
  - `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/ast/workspaceAst.test.ts`
- Validate roundtrip determinism:
  - `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/ast/workspaceAst.roundtrip.templates.test.ts ../packages/billing/src/components/invoice-designer/ast/workspaceAst.roundtrip.nodes.test.ts ../packages/billing/src/components/invoice-designer/ast/workspaceAst.roundtrip.styles.test.ts`
- Validate invoice insertion + validation integration:
  - `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/ast/workspaceAst.test.ts ../packages/billing/src/components/invoice-designer/palette/ComponentPalette.fields.integration.test.tsx ../packages/billing/src/components/invoice-designer/DesignerShell.selectedContext.integration.test.tsx`
- Validate workflow editor test baseline after validation migration:
  - `cd ee/server && npx vitest run src/components/workflow-designer/expression-editor/__tests__/completionProvider.test.ts src/components/workflow-designer/expression-editor/__tests__/diagnosticsProvider.test.ts`
- Validate workflow designer type safety after shared validation UI refactor:
  - `cd ee/server && npm run -s typecheck`
- Validate allowlisted function completions and diagnostics baseline:
  - `cd ee/server && npx vitest run src/components/workflow-designer/expression-editor/__tests__/completionProvider.test.ts src/components/workflow-designer/expression-editor/__tests__/diagnosticsProvider.test.ts`
- Validate diagnostics allowlist behavior and type safety:
  - `cd ee/server && npx vitest run src/components/workflow-designer/expression-editor/__tests__/diagnosticsProvider.test.ts`
  - `cd ee/server && npm run -s typecheck`
- Audit persisted expression contract usage:
  - `rg -n '\\$expr' ee/server/src/components/workflow-designer/WorkflowDesigner.tsx shared/workflow/runtime -g'*.ts*'`
- Validate runtime expression guardrails:
  - `npx vitest run --config shared/vitest.config.ts shared/workflow/runtime/__tests__/expressionEngine.test.ts shared/workflow/runtime/__tests__/mappingResolver.test.ts`
- Audit shared path-validator usage in both designers:
  - `rg -n "validateSourcePaths\\(" packages/billing/src/components/invoice-designer ee/server/src/components/workflow-designer -g'*.ts*'`
- Compare invoice/workflow binding/expression surfaces:
  - `rg -n "binding|template|\{\{|\$expr|validateExpressionSource" packages/billing/src/components/invoice-designer ee/server/src/components/workflow-designer shared/workflow/runtime -g"*.ts*"`
- Review workflow designer expression sections:
  - `sed -n '820,980p' ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
  - `sed -n '6060,6665p' ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
- Review workflow runtime constraints:
  - `sed -n '1,220p' shared/workflow/runtime/expressionEngine.ts`
- Review invoice AST compile/render paths:
  - `sed -n '104,340p' packages/billing/src/components/invoice-designer/ast/workspaceAst.ts`
  - `sed -n '210,290p' packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`

## Links / References

- Workflow designer:
  - `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
  - `ee/server/src/components/workflow-designer/expression-editor/`
- Workflow runtime:
  - `shared/workflow/runtime/expressionEngine.ts`
  - `shared/workflow/runtime/types.ts`
- Invoice designer:
  - `packages/billing/src/components/invoice-designer/DesignerShell.tsx`
  - `packages/billing/src/components/invoice-designer/palette/ComponentPalette.tsx`
  - `packages/billing/src/components/invoice-designer/ast/workspaceAst.ts`
- Invoice AST renderer:
  - `packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`

## Open Questions

- Should invoice roots stay domain-native (`invoice/customer/tenant/item`) or converge on workflow-style roots for long-term consistency?
- Should workflow function metadata be hard-pruned immediately to runtime allowlist, or staged with compatibility warnings first?
- Should shared validation include a true parser abstraction now, or remain an interface with domain-specific parser implementations?
- Is invoice drag/drop path insertion in scope for this plan, or deferred after click-insert parity?
