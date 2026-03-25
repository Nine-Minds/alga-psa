# Invoice Layout System Documentation

**Related Documentation:**
- [billing.md](./billing.md)
- [billing_cycles.md](./billing_cycles.md)
- [invoice_finalization.md](./invoice_finalization.md)
- [quoting-system.md](./quoting-system.md) — the quoting system reuses the AST engine for quote document templates

## 1. Overview

Invoice layouts (called **"Invoice Layouts"** in the UI) define how invoices are rendered as PDF documents and in-browser previews. Each layout is a declarative `InvoiceTemplateAst` JSON payload — a tree of layout nodes, style declarations, and data bindings that the evaluator and renderer process deterministically.

The AST engine is shared across document types. Both invoice and quote document templates use the same schema, evaluator, and renderer pipeline. Quote templates extend the binding catalog with quote-specific fields (see [quoting-system.md](./quoting-system.md)).

There is no user-authored code execution — no compilation, no Wasm, no sandboxed runtimes. Templates are pure data.

## 2. Canonical AST Model

### Core Contracts

| File | Purpose |
|------|---------|
| `packages/types/src/lib/invoice-template-ast.ts` | TypeScript types for the AST node tree, style declarations, bindings |
| `packages/types/src/interfaces/invoice.interfaces.ts` | `IInvoiceTemplate`, `WasmInvoiceViewModel` |
| `server/src/interfaces/invoice.interfaces.ts` | Server-side invoice interfaces |

### Runtime Modules

| File | Purpose |
|------|---------|
| `packages/billing/src/lib/invoice-template-ast/schema.ts` | Zod schema validation for AST payloads |
| `packages/billing/src/lib/invoice-template-ast/evaluator.ts` | Evaluates AST against view model data, resolves bindings and transforms |
| `packages/billing/src/lib/invoice-template-ast/strategies.ts` | Strategy allowlist for vetted transform extensions |
| `packages/billing/src/lib/invoice-template-ast/react-renderer.tsx` | Shared React renderer (used in preview and server render) |
| `packages/billing/src/lib/invoice-template-ast/server-render.ts` | Server HTML wrapper for PDF/headless rendering |

### Designer

| File | Purpose |
|------|---------|
| `packages/billing/src/components/invoice-designer/ast/workspaceAst.ts` | Workspace export/import (designer state to/from AST) |
| `packages/billing/src/components/invoice-designer/DesignerShell.tsx` | Main designer UI shell |

### AST Capabilities

- Explicit schema versioning
- Layout tree: `document`, `section`, `text`, `field`, `dynamic-table`, `totals`, etc.
- Style tokens/classes and inline style declarations
- Bindings for invoice values and collections (extensible — quote bindings added for the quoting system)
- Declarative transform operations: `filter`, `sort`, `group`, `aggregate`, `computed-field`, `totals-compose`
- Optional `strategyId` extension points on transform operations

### Style Declaration Properties

The `InvoiceTemplateStyleDeclaration` supports:
- **Layout**: `display`, `flexDirection`, `justifyContent`, `alignItems`, `flex`, `gap`, `width`, `height`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, `overflow`, `position`, `top`, `right`, `bottom`, `left`, `zIndex`
- **Spacing**: `padding`, `paddingTop/Right/Bottom/Left`, `margin`, `marginTop/Right/Bottom/Left`
- **Border**: `border`, `borderTop/Right/Bottom/Left`, `borderRadius`, `borderColor`
- **Grid**: `gridTemplateColumns`, `gridTemplateRows`, `gridAutoFlow`
- **Visual**: `color`, `backgroundColor`, `aspectRatio`, `objectFit`
- **Typography**: `fontSize`, `fontWeight`, `fontFamily`, `fontStyle`, `lineHeight`, `textAlign`

## 3. Runtime Flow

### 3.1 Design -> Preview

1. `DesignerVisualWorkspace` exports workspace state to AST.
2. Preview action validates AST against Zod schema.
3. Evaluator resolves bindings and transforms against invoice/quote view model data.
4. Shared React renderer emits HTML/CSS.
5. Preview UI surfaces shape/render/verify phase state and diagnostics.

The preview pipeline accepts any view model type (invoice or quote) — the `previewStatus.ts` helpers use generic type signatures to support both document types.

Key entry point:
- `packages/billing/src/actions/invoiceTemplatePreview.ts`

### 3.2 Save -> Reopen

- Template save/load actions persist and read `templateAst` as the canonical payload.
- Designer hydration reconstructs workspace directly from persisted AST.

Key entry points:
- `packages/billing/src/actions/invoiceTemplates.ts`
- `packages/billing/src/models/invoice.ts`
- `packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx`

### 3.3 PDF Generation

PDF rendering uses the same AST evaluator + renderer path. The server wrapper produces a full HTML document for headless browser (Puppeteer) rendering.

Key entry point:
- `server/src/services/pdf-generation.service.ts`

## 4. Template Management

### Standard vs Custom Templates

There are two types of invoice layouts:

| Type | Source | Editable | Deletable |
|------|--------|----------|-----------|
| **Standard** | System-provided, seeded into `standard_invoice_templates` | No (read-only) | No |
| **Custom** | Tenant-created or cloned from standard | Yes | Yes |

### Standard Template Editing ("Edit as Copy")

Standard templates cannot be edited directly. When a user clicks "Edit" on a standard template (or clicks the row), the system automatically:
1. Clones the template with name "Copy of {original name}"
2. Saves the clone as a custom template
3. Navigates to the editor for the new custom copy

This preserves the original standard template while giving the user a fully editable starting point.

### Template Actions

| Action | Standard | Custom |
|--------|----------|--------|
| View/Preview | Yes | Yes |
| Edit | Clone-and-edit | Direct edit |
| Clone | Yes | Yes |
| Set as Default | Clone first, then set | Yes |
| Delete | No | Yes |

### UI Components

| File | Purpose |
|------|---------|
| `packages/billing/src/components/billing-dashboard/InvoiceTemplates.tsx` | Template list with actions dropdown |
| `packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx` | Template editor (create/edit) |

### Billing Dashboard Tab

Invoice layouts are accessed via the **"Invoice Layouts"** tab in the billing dashboard (`/msp/billing?tab=invoice-templates`).

## 5. Strategy Extension Model

`strategyId` is an optional transform hook for vetted advanced behavior. Resolution is allowlisted only.

Rules:
- Unknown strategy IDs fail fast with structured `UNKNOWN_STRATEGY` errors.
- Strategy handlers are explicit functions in the registry, not tenant-authored code.
- Preview and PDF paths share the same strategy resolution behavior.

This provides extensibility without arbitrary template code execution.

## 6. Error and Diagnostics Model

The AST path uses structured diagnostics for:
- **Schema validation failures**: Include detailed field path and error message in the thrown exception (e.g., `"lineItems[0].quantity: Expected number, received string"`). Validation details are logged to console for debugging.
- **Evaluator failures**: Missing bindings, invalid operands, unknown strategies, strategy failures.
- **Render stage failures**: Component-level rendering errors.

Preview diagnostics are surfaced in the UI with AST/evaluator context.

## 7. Persistence

Each template stores a single canonical field:
- `templateAst` — the full AST JSON payload

This is the only render input used by preview, server render actions, and PDF generation.

## 8. Invoice Preview Panel

The invoice preview panel (`InvoicePreviewPanel.tsx`) renders a selected invoice with its assigned template. Key features:

- Template selector dropdown for switching between available layouts
- Tax source display
- Purchase order summary banner
- **Source quote link**: If the invoice was created via quote conversion, a "View Source Quote" button links back to the originating quote

Key file: `packages/billing/src/components/billing-dashboard/invoicing/InvoicePreviewPanel.tsx`

## 9. Shared Engine: Quote Document Templates

The quoting system reuses the AST engine for its own document templates. The shared components are:

| Shared | Invoice-specific | Quote-specific |
|--------|-----------------|----------------|
| AST schema + validation | Invoice bindings | Quote bindings (`quoteNumber`, `validUntil`, `lineItems` with `is_optional`/`is_recurring`) |
| Evaluator | Invoice view model | Quote view model |
| React renderer | Invoice sample scenarios | Quote sample scenarios (`quoteSampleScenarios.ts`) |
| Server HTML wrapper | `invoice_templates` table | `quote_document_templates` table |

Quote template details: [quoting-system.md](./quoting-system.md#document-templates-and-pdf-generation)

## 10. Testing

### AST Schema / Evaluator / Renderer

- `packages/billing/src/lib/invoice-template-ast/schema.test.ts`
- `packages/billing/src/lib/invoice-template-ast/evaluator.test.ts`
- `packages/billing/src/lib/invoice-template-ast/react-renderer.test.tsx`
- `packages/billing/src/lib/invoice-template-ast/server-render.test.ts`

### Preview / PDF / Integration

- `packages/billing/src/actions/invoiceTemplatePreview.integration.test.ts`
- `packages/billing/src/actions/invoiceTemplatePreview.inv005.sanity.test.ts`
- `packages/billing/src/actions/renderTemplateOnServer.ast.integration.test.ts`
- `packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts`
- `packages/billing/src/actions/invoicePreviewPdfParity.integration.test.ts`

### Quote Template Tests

- `packages/billing/tests/quote/quoteTemplateAst.test.ts`
- `packages/billing/tests/quote/quoteTemplateSelection.test.ts`
