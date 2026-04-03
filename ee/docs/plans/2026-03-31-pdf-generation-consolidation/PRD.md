# PRD: PDF Generation Service Consolidation

## Problem Statement

The invoice and quote PDF generation services evolved independently, resulting in two separate service files with nearly identical Puppeteer orchestration, storage/persist logic, and rendering pipelines. Both use the same shared template AST evaluator, renderer, and server-render infrastructure. This duplication increases maintenance burden — bug fixes (e.g., image inlining, base href for Puppeteer) must be applied in multiple places, and new entity types (e.g., proposals) would require yet another copy.

## Goals

1. **Single PDF generation service** that handles invoices, quotes, and documents through one unified class
2. **Eliminate duplicated Puppeteer orchestration** (`generatePDFBuffer`) and storage logic (`generateAndStore`)
3. **Preserve all existing behavior**: invoice workflow events, quote preview rendering, document HTML wrapping
4. **Delete the old server-side service** (`server/src/services/pdf-generation.service.ts`) and the standalone quote service (`quotePdfGenerationService.ts`)
5. **Update all callers** to use the consolidated service with backward-compatible aliases during transition
6. **Migrate tests** to cover the consolidated service

## Non-Goals

- Renaming `InvoiceTemplateAst` and related "invoice"-prefixed types to entity-agnostic names (follow-up)
- Adding invoice preview rendering (parity with quotes) — can be done later
- Changing the template evaluation/rendering pipeline itself
- Modifying the designer or workspace AST handling

## Target Users

- Developers maintaining the billing/PDF generation code
- No user-facing changes — this is an internal refactor

## Architecture

### Before (3 services)
```
server/src/services/pdf-generation.service.ts     → invoices + documents (old location)
packages/billing/src/services/pdfGenerationService.ts  → invoices (new, partial)
packages/billing/src/services/quotePdfGenerationService.ts → quotes
```

### After (1 service)
```
packages/billing/src/services/pdfGenerationService.ts → invoices + quotes + documents
```

### Consolidated `PDFGenerationService` API

```typescript
class PDFGenerationService {
  constructor(tenant: string)

  // Generate PDF buffer without storing
  generatePDF(options: { invoiceId?: string; quoteId?: string; documentId?: string; userId: string; templateAst?: InvoiceTemplateAst }): Promise<Buffer>

  // Generate and persist to storage + publish workflow event
  generateAndStore(options: PDFGenerationOptions): Promise<FileStore>

  // Quote-specific: render HTML+CSS for live preview panel
  renderQuotePreview(options: QuotePDFOptions): Promise<{ html: string; css: string; templateAst: InvoiceTemplateAst | null }>
}
```

### Internal dispatch
- `getInvoiceHtml(invoiceId)` — template resolution, DB fetch, adapter, evaluate, render
- `getQuoteHtml(options)` — template resolution (standard/custom/tenant-default), DB fetch, adapter, evaluate, render
- `getDocumentHtml(documentId)` — block content or markdown/text, wrap in minimal HTML
- `generatePDFBuffer(html, templateAst?)` — Puppeteer browser pool, page.pdf()

### Backward Compatibility
- `createQuotePDFGenerationService` — deprecated alias for `createPDFGenerationService`
- `QuotePDFGenerationService` type — deprecated alias for `PDFGenerationService`

## Caller Migration

| Caller | Change |
|--------|--------|
| `server/src/lib/api/services/InvoiceService.ts` | Already imports from `@alga-psa/billing/services` — no change needed |
| `server/src/lib/jobs/handlers/invoiceEmailHandler.ts` | Already imports from `@alga-psa/billing/services` — no change needed |
| `server/src/lib/jobs/handlers/invoiceZipHandler.ts` | Already imports from `@alga-psa/billing/services` — no change needed |
| `packages/billing/src/actions/quoteActions.ts` | Already imports `createPDFGenerationService` — no change needed |
| `packages/billing/src/actions/invoiceJobActions.ts` | Already imports from local service — no change needed |
| `packages/client-portal/src/actions/client-billing.ts` | Verify import path |
| `server/src/app/api/documents/download/[fileId]/route.ts` | Verify import path |

## Test Migration

| Test File | Status |
|-----------|--------|
| `packages/billing/src/actions/invoicePdfGenerationAstWiring.test.ts` | Update: reads source file — assertions still valid |
| `server/src/services/pdf-generation.service.printSettings.test.ts` | Update: re-point mocks to `@alga-psa/billing` paths |
| `packages/billing/tests/quote/quotePdfGenerationService.test.ts` | Update: import from consolidated service |

## Risks

- **Import path breakage**: The old `server/src/services/pdf-generation.service.ts` may have undiscovered importers. Mitigated by grep/build verification.
- **Workflow event behavior change**: Quotes now publish `DOCUMENT_GENERATED` events (previously they didn't). This is intentional but should be verified with downstream workflow handlers.

## Acceptance Criteria

1. Single `PDFGenerationService` class in `packages/billing/src/services/pdfGenerationService.ts`
2. `server/src/services/pdf-generation.service.ts` deleted
3. `packages/billing/src/services/quotePdfGenerationService.ts` deleted
4. All callers compile and pass tests
5. Invoice PDF generation works end-to-end (template resolution, rendering, storage, workflow events)
6. Quote PDF generation works end-to-end (template resolution, rendering, storage, preview)
7. Document PDF generation works end-to-end (block content, markdown, plain text)
8. Backward-compatible aliases exported from `services/index.ts`
