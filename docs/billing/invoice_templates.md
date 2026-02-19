# Invoice Template System Documentation

**Related Documentation:**
- [billing.md](./billing.md)
- [billing_cycles.md](./billing_cycles.md)
- [invoice_finalization.md](./invoice_finalization.md)
- [PRD: JSON AST renderer cutover](../../ee/docs/plans/2026-02-12-invoice-template-json-ast-renderer-cutover/PRD.md)

## 1. Overview

Invoice templates are now treated as declarative data. The canonical format is a versioned `InvoiceTemplateAst` payload persisted with each template. The same evaluator + renderer modules are used in both preview and server-side/PDF rendering.

Template execution no longer compiles or runs user-authored code. This removes the AssemblyScript -> Wasm runtime surface and keeps rendering deterministic, testable, and tenant-safe.

## 2. Canonical AST Model

Core contracts:
- `packages/types/src/lib/invoice-template-ast.ts`
- `packages/types/src/interfaces/invoice.interfaces.ts`
- `server/src/interfaces/invoice.interfaces.ts`

Runtime modules:
- Schema validation: `packages/billing/src/lib/invoice-template-ast/schema.ts`
- Evaluator: `packages/billing/src/lib/invoice-template-ast/evaluator.ts`
- Strategy allowlist: `packages/billing/src/lib/invoice-template-ast/strategies.ts`
- Shared React renderer: `packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`
- Server HTML wrapper for PDF/headless: `packages/billing/src/lib/invoice-template-ast/server-render.ts`

Designer conversion:
- Workspace export/import: `packages/billing/src/components/invoice-designer/ast/workspaceAst.ts`

`InvoiceTemplateAst` supports:
- Explicit schema versioning.
- Layout tree (`document`, `section`, `text`, `field`, `dynamic-table`, `totals`, etc.).
- Style tokens/classes and inline style declarations.
- Bindings for invoice values and collections.
- Declarative transform operations (`filter`, `sort`, `group`, `aggregate`, `computed-field`, `totals-compose`).
- Optional `strategyId` extension points on transform operations.

## 3. Runtime Flow

### 3.1 Design -> Preview

1. `DesignerVisualWorkspace` exports workspace state to AST.
2. Preview action validates AST.
3. Evaluator shapes invoice data.
4. Shared renderer emits HTML/CSS.
5. Preview UI surfaces shape/render/verify phase state and diagnostics.

Key entry point:
- `packages/billing/src/actions/invoiceTemplatePreview.ts`

### 3.2 Save -> Reopen

- Template save/load actions persist and read `templateAst` as canonical payload.
- Designer hydration reconstructs workspace directly from persisted AST.

Key entry points:
- `packages/billing/src/actions/invoiceTemplates.ts`
- `packages/billing/src/models/invoice.ts`
- `packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx`

### 3.3 PDF Generation

- PDF invoice rendering uses the same AST evaluator + renderer path (server wrapper produces full HTML document for headless browser rendering).

Key entry point:
- `server/src/services/pdf-generation.service.ts`

## 4. Strategy Extension Model (No Arbitrary Code)

`strategyId` is an optional transform hook for vetted advanced behavior. Resolution is allowlisted only.

Rules:
- Unknown strategy IDs fail fast with structured `UNKNOWN_STRATEGY` errors.
- Strategy handlers are explicit functions in the registry, not tenant-authored code.
- Preview and PDF paths share the same strategy resolution behavior.

This preserves extensibility without re-introducing arbitrary template execution.

## 5. Error and Diagnostics Model

The AST path uses structured diagnostics for:
- Schema validation failures (field path + error code/message).
- Evaluator failures (missing bindings, invalid operands, unknown strategies, strategy failures).
- Render stage failures.

Preview diagnostics are surfaced in the UI with AST/evaluator context.

## 6. Persistence and Compatibility

Canonical runtime field:
- `templateAst`

Compatibility fields may still exist temporarily for migration safety:
- `assemblyScriptSource`
- `wasmBinary`
- `sha`

Runtime rendering paths do not consume Wasm artifacts. AST is the only render input used by preview, server render actions, and PDF generation.

## 7. Removed Architecture Layers

The following billing modules were removed as part of cutover:
- `packages/billing/src/components/invoice-designer/compiler/guiIr.ts`
- `packages/billing/src/components/invoice-designer/compiler/assemblyScriptGenerator.ts`
- `packages/billing/src/components/invoice-designer/compiler/diagnostics.ts`
- `packages/billing/src/lib/invoice-template-compiler/assemblyScriptCompile.ts`
- `packages/billing/src/lib/invoice-renderer/wasm-executor.ts`
- `packages/billing/src/lib/invoice-renderer/quickjs-executor.ts`
- `packages/billing/src/lib/invoice-renderer/host-functions.ts`
- Preview compile cache module:
  - `packages/billing/src/actions/invoiceTemplatePreviewCache.ts`

Operational implications:
- No save-time AssemblyScript compile gating for AST templates.
- No preview compile artifact cache lifecycle.
- No runtime `getCompiledWasm` dependency in invoice render paths.

## 8. Testing Coverage Pointers

AST schema/evaluator/renderer:
- `packages/billing/src/lib/invoice-template-ast/schema.test.ts`
- `packages/billing/src/lib/invoice-template-ast/evaluator.test.ts`
- `packages/billing/src/lib/invoice-template-ast/react-renderer.test.tsx`
- `packages/billing/src/lib/invoice-template-ast/server-render.test.ts`

Preview/PDF/runtime cutover wiring and parity:
- `packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts`
- `packages/billing/src/actions/invoiceTemplatePreview.inv005.sanity.test.ts`
- `packages/billing/src/actions/renderTemplateOnServer.ast.integration.test.ts`
- `packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts`
- `packages/billing/src/actions/invoicePreviewPdfParity.integration.test.ts`
- `packages/billing/src/actions/invoiceLegacyCompilerRemoval.test.ts`
- `packages/billing/src/actions/invoiceTemplatePreviewCacheRemoval.test.ts`
