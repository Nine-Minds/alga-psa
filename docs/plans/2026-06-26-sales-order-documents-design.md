# Sales Order Documents — Design

**Date:** 2026-06-26
**Branch:** feature/inventory-module
**Status:** Approved (brainstorming) → ready for implementation plan

## Summary

Give Sales Orders printable, brandable **documents** by reusing the existing invoice/quote
template + render + PDF pipeline in `packages/billing` — **not** the WYSIWYG designer as an
*editor* of the order, but the same `TemplateAst` → HTML → PDF machinery the designer authors.

The first document is an **Order Confirmation**. It is **designable** in the existing WYSIWYG
designer (the full vision), built behind a **generic, document-type-keyed spine** so we add a
third document type without a third near-verbatim copy of the invoice/quote stack.

## Decisions (settled during brainstorming)

1. **First document:** Order Confirmation (customer-facing: ordered items, unit prices, totals,
   expected ship date, branding). Closest analog to a quote/invoice; highest pipeline reuse.
2. **Customization:** Fully designable in the existing WYSIWYG designer (DB-stored per-tenant
   templates), like invoices and quotes — the end state, reached in phases.
3. **Architecture — Approach C (generic spine, SO first):** build a small document-type registry
   + generic template tables/actions/components/route; register Sales Order as the *first*
   registered type. **Invoice and quote are left untouched** (no migration), but the spine is
   shaped so they could migrate later. Avoids a third copy of the ~20-artifact quote stack and
   honors the repo's leverage/layering mandate, without risking the billing-critical money paths.

## Why this is feasible (grounding)

The render/PDF pipeline is already generic; only the render-*model builder* is invoice-coupled:

- `evaluateTemplateAst(ast, model)` → `renderEvaluatedTemplateAst` → `renderTemplateAstHtmlDocument`
  → `pdfGenerationService.generatePDFBuffer(html, ast)` accept **any** AST + **any** data object.
- `generatePDF()` already branches on `invoiceId | quoteId | documentId`.
- **Quotes are the proven blueprint**: a designable document type was already added once. Per the
  code survey, "Quote → Sales Order is mostly a rename-and-rebind exercise." Per-type artifacts:
  3 tables, a view-model + adapter, a binding catalog, standard template AST(s), template
  selection, a model, actions, a preview action, a PDF-service branch, a management route + 2
  components, and a one-line designer registration (`documentKind.ts`).

Key reference files (read-only survey):
- `packages/billing/src/lib/invoice-template-ast/server-render.ts` — `renderTemplateAstHtmlDocument`
- `packages/billing/src/services/pdfGenerationService.ts` — `generatePDF`, `generatePDFBuffer`, `getQuoteHtml`
- `packages/billing/src/lib/adapters/quoteAdapters.ts` — `mapDbQuoteToViewModel` (adapter blueprint)
- `packages/billing/src/lib/quote-template-ast/{bindings,standardTemplates,templateSelection}.ts`
- `packages/billing/src/components/invoice-designer/utils/documentKind.ts` — designer type discriminator
- `packages/billing/src/components/billing-dashboard/quotes/QuoteDocumentTemplate{sPage,Editor}.tsx`
- `server/src/app/msp/quote-document-templates/page.tsx` — management route
- Sales Order model: `packages/types/src/interfaces/inventory.interfaces.ts` (ISalesOrder/ISalesOrderLine),
  tables `sales_orders` / `sales_order_lines`; SO→invoice already exists via
  `packages/billing/src/actions/salesOrderInvoicingActions.ts` (`generateInvoiceForSalesOrder`).

## Phasing

### Phase 1 — Render MVP (build now; identical under any architecture choice)

A Sales Order produces a branded confirmation PDF from a **code-defined standard template** —
no DB, no designer. (A standard AST renders with no storage; even quotes fall back to a code AST.)

Pieces (all in `packages/billing` except the trigger):

1. **`SalesOrderViewModel`** type + **`mapDbSalesOrderToViewModel(knex, tenant, soId)`** adapter
   (mirrors `mapDbQuoteToViewModel`). Loads `sales_orders` + `sales_order_lines`; resolves client
   name/address (from `client_id` + `ship_to`), product names (`service_catalog`), line amounts
   (`quantity_ordered × unit_price`), subtotal/tax/total, and header fields (`so_number`,
   `order_date`, `expected_ship_date`, `currency_code`, `client_po_number`, `notes`).
2. **`sales-order-template-ast/bindings.ts`** — `SALES_ORDER_TEMPLATE_VALUE_BINDINGS`
   (orderNumber, orderDate, expectedShipDate, customerName/Address, tenant party, totals…) +
   `…_COLLECTION_BINDINGS` (lineItems).
3. **`sales-order-template-ast/standardTemplates.ts`** — `buildStandardSalesOrderConfirmationAst()`
   + `getStandardSalesOrderTemplateAstByCode()`.
4. **Render+PDF wiring** — `getSalesOrderHtml()` + a `salesOrderId` branch in `generatePDF()`,
   reusing `evaluateTemplateAst → renderTemplateAstHtmlDocument → generatePDFBuffer`. A stub
   `resolveSalesOrderTemplateAst()` that returns the standard AST (Phase 2 replaces it).
5. **Trigger** — `downloadSalesOrderPDF(soId)` server action + a **Download** action on the Sales
   Orders screen. (Wiring to verify: inventory component → billing action directly vs via an API
   route, per the package-dependency direction.)

Testing: adapter unit test (totals math, name/address resolution) + render smoke (standard AST
evaluates against a sample model → non-empty HTML, no throw).

### Phase 2 — Generic designer + storage layer (Approach C)

Makes the confirmation designable per-tenant.

- **Generic tables** (`document_type`-keyed):
  `document_templates`, `standard_document_templates`, `document_template_assignments`.
- **Registry:** `documentRegistry['sales-order'] = { label, bindings, standardTemplates,
  viewModelBuilder, sampleData, codePrefix }`. SO registers its Phase-1 artifacts here.
- **Generic, type-parameterized:** actions (`getDocumentTemplates(type)`, `saveDocumentTemplate`,
  `setDefaultDocumentTemplate`, `deleteDocumentTemplate`, `runAuthoritativeTemplatePreview`);
  resolution `resolveDocumentTemplateAst(type, entity)` (client override → tenant default →
  standard); a generic management route `/msp/document-templates/[type]` wrapping `DesignerShell`;
  designer registration (extend `DesignerDocumentKind` + `resolveDesignerDocumentKind` with
  `'sales-order'`).
- Invoice/quote stay on their existing tables; registry shaped to allow future migration.

### Phase 3 — Polish (out of scope now)

Client-level template overrides, by-location/standard variants, drop-ship vs from-stock line
nuances, multi-shipment packing slips, auto-attach the confirmation to SO emails. Also the other
documents (packing slip, pick list) as additional registered types.

## Data flow

SO id → `mapDbSalesOrderToViewModel` → `resolve…TemplateAst` (P1: standard; P2: registry +
assignments) → `evaluateTemplateAst` → `renderTemplateAstHtmlDocument` → `generatePDFBuffer` →
bytes → browser download.

## Error handling

- SO not found / no lines → clear toast, no PDF.
- evaluate/render throws → caught, surfaced as "Couldn't generate the document," logged.
- The standard template is always a valid fallback, so a missing/broken custom template degrades
  to standard rather than failing.

## Testing

- **Phase 1:** adapter unit test + render smoke.
- **Phase 2:** resolution precedence (override > tenant default > standard); generic action
  round-trip (save/list/setDefault/delete) scoped by `document_type`; `'sales-order'` designer-kind
  detection.

## Out of scope

The WYSIWYG designer as the *order editor*; SO→invoice generation (already exists); migrating
invoice/quote onto the generic spine; packing slip / pick list (Phase 3).
