# Invoice Layout System Documentation

**Related Documentation:**
- [billing.md](./billing.md)
- [billing_cycles.md](./billing_cycles.md)
- [invoice_finalization.md](./invoice_finalization.md)
- [quoting-system.md](./quoting-system.md) — the quoting system reuses the AST engine for quote document templates
- [document-template-translation.md](./document-template-translation.md) — how standard templates render in the recipient's language

## 1. Overview

Invoice layouts (called **"Invoice Layouts"** in the UI) define how invoices are rendered as PDF documents and in-browser previews. Each layout is a declarative `TemplateAst` JSON payload — a tree of layout nodes, style declarations, and data bindings that the evaluator and renderer process deterministically.

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
- Layout tree: `document`, `section`, `stack`, `text`, `field`, `image`, `divider`, `table`, `dynamic-table`, `totals`
- **Repeatable stack**: the `stack` node accepts an optional `repeat: { sourceBinding, itemBinding, keyPath? }` — the stack (and all its children) renders once per item in the source collection, pushing the current item onto the render scope under `itemBinding`. Nested `path` expressions and inner `dynamic-table` nodes resolve against the per-iteration item. Without `repeat`, the stack renders its children once against the outer scope.
- Style tokens/classes and inline style declarations
- Bindings for invoice values and collections (extensible — quote bindings added for the quoting system)
- Declarative transform operations: `filter`, `sort`, `group`, `aggregate`, `computed-field`, `totals-compose`
- Optional `strategyId` extension points on transform operations

### Per-Location Grouping

Invoice and quote view models can expose a pre-computed `groupsByLocation` collection binding. Each group contains `{ name, address, items, subtotal }` where `subtotal` is the sum of the group's item totals. A `hasMultipleLocations` flag is also set on the view model.

- **Invoice**: `enrichInvoiceViewModelWithLocations` (in `packages/billing/src/lib/adapters/invoiceAdapters.ts`) resolves `location_id` on each line item to a client location and builds the groups.
- **Quote**: equivalent enrichment is applied by the quote adapter.

Templates consume the groups through a repeatable `stack` bound to `groupsByLocation` (outer iteration) with an inner `dynamic-table` bound to `group.items` — the pattern used by the `standard-invoice-by-location` and `standard-quote-by-location` templates to render a location header, line items, and a per-location subtotal row. See `buildStandardByLocationAst` in `packages/billing/src/lib/invoice-template-ast/standardTemplates.ts`.

### Ticket-Level Billed-Time Detail

Invoice view models expose a complete primary presentation and two optional detail collections built from **immutable snapshots** captured at invoice generation:

- **`ticketPresentationRows`** — the complete primary charge presentation: `label`, `description`, `quantity`, nullable `rate`, `rateKind`, `rateDisplay`, and `amount` (net minor units). Retained charges also preserve their service-period fields.

- **`timeEntries`** — one row per billed time entry: `id` (source entry id), `date`, `ticketNumber`, `title` (ticket title or project-task name), `description` (customer-visible ticket description), `billedMinutes`, `hours`, `rate` (minor units/hour), `amount` (net, minor units), `serviceName`.
- **`ticketGroups`** — the same entries grouped by source work item: `key`, `label` ("`<ticket number> — <title>`"), `ticketNumber`, `title`, `description`, `dateStart`/`dateEnd`, `totalMinutes`, `totalHours`, `totalAmount`, `rate`, `rateDisplay`, `hasMixedRates`, `entryCount`, and a nested `entries` array for per-entry detail tables. Grouping and ordering are deterministic (tickets by ticket number, then project tasks by name, then a single "Other billed time" fallback group); sums use integer minutes and minor currency units.

**Rolled up by default.** The standard by-ticket layout uses **Charges by Ticket** (`ticketPresentationRows`) as its single primary table. Eligible time across entries and services appears once per ticket. Project tasks group by task identity; ticketless time groups as Other billed time. Products, fees, usage, zero rows and signed adjustments retain their original rows. Totals and accounting exports continue to use canonical invoice charges.

**Exact coverage.** A charge can be replaced only when its frozen generation type is time, every persisted link has a supported valid snapshot, link ownership is unique and consistent with the invoice and tenant, and integer snapshot net amounts equal the entire canonical charge net amount. A partial, conflicting, adjusted or otherwise unproven charge stays whole, and none of its entries also appear in the primary rollup. No residual allocation is guessed. The row contribution metadata reconciles every removed charge independently. New generation records charge provenance; historical provenance is not backfilled.

**Legacy and partial invoices.** Unavailable time detail leaves the complete service charge visible. A localized coverage note explains partial or unavailable detail. Version-1 snapshots remain immutable and their rates display as unavailable. Current tickets, time entries and contracts are never used to reconstruct billed history.

**Honest rates.** Version-2 snapshots capture `rateKind` (`uniform`, `mixed`, `unknown`) and a nullable proven `uniformRate`. Overtime can make even one entry mixed. One hour at 15000 minor units plus one at 22500 shows two hours and 37500 total with Mixed rates. Averages never establish uniformity. `rate` is null for mixed/unavailable detail; `rateDisplay` carries either numeric minor units or a localized label. Customer descriptions remain unchanged.

**Optional supporting detail.** In a custom layout, select Charges by Ticket to replace the primary charge table. To add a breakdown, create a separately titled **Billed-time detail — included in the charges above** section using **Billed Time Entries** (`timeEntries`) or nested `entries` under **Billed Time by Ticket** (`ticketGroups`). These supporting collections can be incomplete on older invoices and must not feed totals. Sort/filter preserves their field choices and runs before document localization. Filter mixed-rate time with `rateKind == mixed`; translated display labels such as `Tarifs variables` are presentation only and do not select rows. Declared nested collection aliases resolve their paths within the current ticket group. Invalid scalar or missing collection paths produce diagnostics; an empty collection or absent legacy time detail remains empty. Save and reopen the layout to reuse the source, columns and transforms. Existing custom layouts retain their authored structure.

The default recipient instruction is **Contact your service provider for a billed-time breakdown.** It does not promise an invoice-specific entry or rate ledger in the client portal.

**Privacy and accounting.** Snapshots include only approved customer-visible work-item fields. Internal ticket comments and time-entry notes are excluded. Presentation does not change canonical charge descriptions, service/account mappings, or accounting exports.

### Style Declaration Properties

The `TemplateStyleDeclaration` supports:
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
- `packages/billing/src/services/pdfGenerationService.ts`

### 3.4 Localization

A template label is either a literal or a `{ i18nKey, defaultValue }` reference. Standard templates use references, so their chrome — and the document's dates, numbers and currency — render in the recipient's locale (billing contact → client → tenant, English when nothing resolves). Customized templates are literals and render exactly as authored in every locale.

Key entry points:
- `packages/billing/src/lib/invoice-template-ast/i18nLabels.ts` — the single localization seam used by PDF generation and previews alike
- `server/public/locales/*/documents.json` — the label strings

Full detail: [document-template-translation.md](./document-template-translation.md)

## 4. Template Management

### Standard vs Custom Templates

There are two types of invoice layouts:

| Type | Source | Editable | Deletable |
|------|--------|----------|-----------|
| **Standard** | System-provided, seeded into `standard_invoice_templates` | No (read-only) | No |
| **Custom** | Tenant-created or cloned from standard | Yes | Yes |

### Standard Template Catalog

| Code | Purpose |
|------|---------|
| `standard-default` | Default single-table invoice layout |
| `standard-detailed` | Full branding + party blocks |
| `standard-grouped` | Recurring / one-time sections |
| `standard-invoice-by-location` | Per-location bands (address header, items, location subtotal) using the repeatable stack + `groupsByLocation` |
| `standard-invoice-by-ticket` | One primary table of eligible ticket rollups and retained charges using `ticketPresentationRows`; entry detail is optional |

A parallel set exists for quotes (`standard-quote-default`, `standard-quote-detailed`, `standard-quote-by-location`).

### Auto-Selection for Multi-Location Documents

When no custom tenant template is assigned, `autoSelectStandardInvoiceTemplateCode` (and the quote counterpart `autoSelectStandardQuoteTemplateCode`) picks the by-location standard template if the view model's `hasMultipleLocations` flag is true — i.e., the invoice/quote spans ≥2 distinct client locations. Otherwise the default template is used. Custom template assignments always win over auto-selection.

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
| Repeatable stack + `groupsByLocation` binding | `standard-invoice-by-location` | `standard-quote-by-location` |

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
