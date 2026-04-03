# Scratchpad: PDF Generation Consolidation

## Key Discoveries

### Current State (uncommitted on `fix/designer_image_support`)
- `packages/billing/src/services/pdfGenerationService.ts` — **already consolidated** into a single `PDFGenerationService` class handling invoices, quotes, and documents
- `packages/billing/src/services/quotePdfGenerationService.ts` — **deleted**; deprecated alias `createQuotePDFGenerationService` points to `createPDFGenerationService`
- `server/src/services/pdf-generation.service.ts` — **deleted**; was the original invoice/document PDF service living in the server package

### What Was Already Unified
- Single `generatePDFBuffer()` (Puppeteer orchestration) — no more duplication
- Single `generateAndStore()` — handles invoice, quote, document via discriminated options
- Single `generatePDF()` — dispatches to `getInvoiceHtml`, `getQuoteHtml`, `getDocumentHtml`
- `renderQuotePreview()` — lives on `PDFGenerationService` alongside invoice methods
- Workflow event publishing happens for all source types in `generateAndStore()`

### Shared Infrastructure (unchanged)
- `renderInvoiceTemplateAstHtmlDocument()` in `server-render.ts` — used by both invoice and quote paths
- `evaluateInvoiceTemplateAst()` — evaluator is type-agnostic despite "invoice" naming
- `renderEvaluatedInvoiceTemplateAst()` — React renderer, also type-agnostic
- `resolveInvoicePdfPrintOptionsFromAst()` — print settings from AST
- `browserPoolService` — singleton browser pool
- Image inlining via `inlineDocumentImages()` in `server-render.ts` — converts `/api/documents/view/{fileId}` to base64 data URIs for Puppeteer

### Committed Work (on branch, 1 commit `6523c096`)
- `workspaceAst.ts`: Image node import/export preserves AST expressions (src/alt) with change detection
- `server-render.ts`: Added `<base href>` tag using NEXTAUTH_URL for relative URL resolution in Puppeteer

### Key File Paths
- **Consolidated service**: `packages/billing/src/services/pdfGenerationService.ts`
- **Service exports**: `packages/billing/src/services/index.ts`
- **Server render**: `packages/billing/src/lib/invoice-template-ast/server-render.ts`
- **React renderer**: `packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`
- **Evaluator**: `packages/billing/src/lib/invoice-template-ast/evaluator.ts`
- **Print settings**: `packages/billing/src/lib/invoice-template-ast/printSettings.ts`
- **Invoice adapters**: `packages/billing/src/lib/adapters/invoiceAdapters.ts`
- **Quote adapters**: `packages/billing/src/lib/adapters/quoteAdapters.ts`
- **Quote template selection**: `packages/billing/src/lib/quote-template-ast/templateSelection.ts`
- **Quote bindings**: `packages/billing/src/lib/quote-template-ast/bindings.ts`
- **Quote standard templates**: `packages/billing/src/lib/quote-template-ast/standardTemplates.ts`

### Callers of PDF Generation
- `server/src/lib/api/services/InvoiceService.ts` — imports `PDFGenerationService, createPDFGenerationService`
- `server/src/lib/jobs/handlers/invoiceEmailHandler.ts` — imports `PDFGenerationService, createPDFGenerationService`
- `server/src/lib/jobs/handlers/invoiceZipHandler.ts` — imports `PDFGenerationService, createPDFGenerationService`
- `packages/billing/src/actions/quoteActions.ts` — imports `createPDFGenerationService`
- `packages/billing/src/actions/invoiceJobActions.ts` — imports `createPDFGenerationService`
- `packages/client-portal/src/actions/client-portal-actions/client-billing.ts` — imports from billing services

### Tests
- `packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts` — source-code wiring assertions (checks imports exist)
- `server/src/services/pdf-generation.service.printSettings.test.ts` — print settings tests, updated mocks to point at `@alga-psa/billing` paths
- `packages/billing/tests/quote/quotePdfGenerationService.test.ts` — quote PDF generation tests
- `packages/billing/src/services/pdfGenerationService.printSettings.test.ts` — exists (check if new or moved)

### Decisions
- (2026-03-31) Consolidation approach: single class with internal dispatch rather than base class + subclasses. Simpler, avoids inheritance complexity.
- (2026-03-31) Workflow events fire for all source types (invoice, quote, document) — previously only invoices published `DOCUMENT_GENERATED`.
- (2026-03-31) Deprecated aliases (`createQuotePDFGenerationService`, `QuotePDFGenerationService` type) kept for backward compat during transition.

### Remaining Work
1. Verify all callers compile and work with consolidated service
2. Ensure `server/src/services/pdf-generation.service.ts` deletion doesn't break any remaining imports
3. Update/migrate tests that referenced old service paths
4. Consider adding `renderInvoicePreview()` method (parity with quote preview)
5. Consider renaming "Invoice" in shared AST types to be entity-agnostic (follow-up)
