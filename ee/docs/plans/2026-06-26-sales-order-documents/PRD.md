# PRD — Sales Order Documents

**Date:** 2026-06-26 · **Branch:** feature/inventory-module
**Design source (approved):** `docs/plans/2026-06-26-sales-order-documents-design.md`

## Problem statement & user value

Sales Orders have no customer-facing paperwork. An MSP that confirms an order today has nothing
branded to send back — unlike Quotes and Invoices, which render to PDF through the WYSIWYG-designer
template pipeline. This gives Sales Orders the same first-class document treatment, starting with an
**Order Confirmation**, reusing the existing `TemplateAst → HTML → PDF` machinery rather than the
designer-as-order-editor.

## Goals

- A Sales Order produces a branded **Order Confirmation PDF** (Phase 1).
- The confirmation is **designable per-tenant** in the existing WYSIWYG designer (Phase 2).
- Build behind a **generic, document-type-keyed spine** (Approach C) so adding SO — and later types —
  does not require a third verbatim copy of the invoice/quote stack. Invoice/quote left untouched.

## Non-goals

- The WYSIWYG designer as the *order editor* (it edits document layout, not the order).
- SO → invoice generation (already exists: `generateInvoiceForSalesOrder`).
- Migrating invoice/quote onto the generic spine (the spine allows it later; not done now).
- Packing slip / pick list documents (Phase 3, additional registered types).

## Target users & primary flow

- **MSP billing/ops user** opens the Sales Orders screen, clicks **Download** on a row, and gets a
  branded confirmation PDF for that order.
- **Phase 2:** a tenant admin customizes the confirmation layout in the document-template designer,
  and downloads then reflect the custom template (with the standard template as fallback).

## UX/UI notes

- Phase 1: a **Download** action on the Sales Orders screen (`SalesOrdersManager`), matching the
  inventory module's existing row-action styling.
- Phase 2: a generic management route `/msp/document-templates/[type]` listing/editing templates,
  wrapping `DesignerShell`.

## Data model / integration notes

- **Inputs (read):** `sales_orders`, `sales_order_lines`, `service_catalog` (product names),
  client + `ship_to` (customer party), tenant company (branding). Types: `ISalesOrder`,
  `ISalesOrderLine` in `packages/types/src/interfaces/inventory.interfaces.ts`.
- **Render model:** new `SalesOrderViewModel` + `mapDbSalesOrderToViewModel(knex, tenant, soId)`,
  mirroring `mapDbQuoteToViewModel` (`packages/billing/src/lib/adapters/quoteAdapters.ts`).
- **Pipeline (reused, generic):** `evaluateTemplateAst → renderTemplateAstHtmlDocument →
  pdfGenerationService.generatePDFBuffer`. `generatePDF()` gains a `salesOrderId` branch.
- **Money:** `unit_price` integer cents; amounts = `quantity_ordered × unit_price`; subtotal/tax/total.
- **Phase 2 storage:** generic `document_templates`, `standard_document_templates`,
  `document_template_assignments` (all `document_type`-keyed) + a `documentRegistry`.

## Risks, rollout, open questions

- **Package-dependency direction:** can the inventory `SalesOrdersManager` import the billing
  `downloadSalesOrderPDF` action directly, or must it go via an API route? Resolve in F018.
- **Tax:** SO lines carry `tax_rate_id`, not a stored tax amount. Phase 1 may render tax as 0 /
  computed-if-available; confirm the tax source during implementation (mirror quote handling).
- **Designer coupling:** designer dirs are named `invoice-designer`; adding a third kind via
  `documentKind.ts` is proven by quotes but confirm the expression-path library accepts the new kind.

## Acceptance criteria / definition of done (Phase 1)

- Clicking **Download** on a Sales Order yields a non-empty PDF whose content includes the order
  number, customer name, each line (product name + qty + amount), and subtotal/total, with tenant
  branding — rendered from the code-defined standard confirmation template.
- SO-not-found / no-lines / render failure are handled with a clear message and no broken download.
- Adapter unit test + render smoke pass; typecheck clean; existing invoice/quote PDF paths unchanged.
