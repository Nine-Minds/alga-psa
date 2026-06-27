# SCRATCHPAD — Sales Order Documents

## Decisions
- 2026-06-26: Order Confirmation is the first document. Fully designable (Phase 2). Architecture =
  **Approach C** (generic document-type-keyed spine, SO = first registered type; invoice/quote
  untouched). Phasing: P1 render MVP (standard template, no DB/designer) → P2 generic designer +
  storage → P3 polish. Approved via brainstorming. Design: `docs/plans/2026-06-26-sales-order-documents-design.md`.

## Key reference code (the quote blueprint)
- Render: `packages/billing/src/lib/invoice-template-ast/server-render.ts` → `renderTemplateAstHtmlDocument(ast, evaluation, opts)`
- Evaluate: `evaluateTemplateAst(ast, model)` → `renderEvaluatedTemplateAst` (both data-agnostic)
- PDF: `packages/billing/src/services/pdfGenerationService.ts`
  - `generatePDF({ invoiceId | quoteId | documentId })` — add a `salesOrderId` branch
  - `generatePDFBuffer(html, ast?)` — generic Puppeteer step (reuse as-is)
  - `getQuoteHtml()` (line ~390) — the method to mirror as `getSalesOrderHtml()`
- Adapter blueprint: `packages/billing/src/lib/adapters/quoteAdapters.ts` → `mapDbQuoteToViewModel(knex, tenant, quoteId)`
- Quote bindings/std/selection: `packages/billing/src/lib/quote-template-ast/{bindings,standardTemplates,templateSelection}.ts`
- Designer kind discriminator: `packages/billing/src/components/invoice-designer/utils/documentKind.ts`
  (`DesignerDocumentKind`, `resolveDesignerDocumentKind`) — Phase 2 adds `'sales-order'`
- Quote mgmt UI (Phase 2 analog): `server/src/app/msp/quote-document-templates/page.tsx`,
  `packages/billing/src/components/billing-dashboard/quotes/QuoteDocumentTemplate{sPage,Editor}.tsx`
- Quote actions (Phase 2 analog): `packages/billing/src/actions/quoteDocumentTemplates.ts`

## Sales Order data
- Types: `packages/types/src/interfaces/inventory.interfaces.ts` — `ISalesOrder`, `ISalesOrderLine`.
- Tables: `sales_orders` (so_id, so_number, client_id, status, order_date, expected_ship_date,
  ship_to jsonb, currency_code, client_po_number, invoice_mode, allocation_mode, notes),
  `sales_order_lines` (so_line_id, service_id, quantity_ordered, quantity_fulfilled,
  quantity_invoiced, unit_price [cents], cost_snapshot, tax_rate_id).
- SO→invoice already exists: `packages/billing/src/actions/salesOrderInvoicingActions.ts` (`generateInvoiceForSalesOrder`).
- Inventory SO UI: `packages/inventory/src/components/SalesOrdersManager.tsx` (Download button goes here).

## Open questions / gotchas
- **Package dep direction (F018):** can `packages/inventory` (client component) import a
  `packages/billing` server action? If not, expose `downloadSalesOrderPDF` via an API route
  (`server/src/app/api/v1/sales-orders/[id]/document/route.ts`) like the invoice PDF route, or
  place the action where both reach it. CHECK before wiring the button.
- **Tax (F006):** SO lines have `tax_rate_id`, not a stored tax amount. Mirror how quotes/invoices
  resolve tax; if no tax engine call is cheap in Phase 1, render tax = 0 and total = subtotal and
  note it (don't fabricate a tax number).
- **Money:** `unit_price` is integer cents. Reuse the same money formatting the templates use.
- **Verify live:** dev server caches `'use server'` modules — touch the importing route to force a
  rebuild when the action doesn't hot-reload (known quirk on this stack). Dev server: port 3345.

## Commands
- Typecheck billing: `cd packages/billing && npx tsc --noEmit`
- Typecheck inventory: `cd packages/inventory && npx tsc --noEmit`
- Inventory tests: `cd packages/inventory && npx vitest run`
- DB (scripts): knex from repo-root node_modules; host localhost:5472, db 'server', creds from
  `server/.env.local` (DB_USER_ADMIN/DB_PASSWORD_ADMIN). Tenant 6d178771-ad9a-4d43-8809-83992745f8f9.

## Progress log
- 2026-06-26: Plan created (PRD + features + tests). Starting Phase 1.
