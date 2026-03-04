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
