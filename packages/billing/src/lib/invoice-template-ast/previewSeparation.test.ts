/**
 * The preview frame may never reach paper.
 *
 * The on-screen preview draws a document on sheets — a white page box, a dashed printable-area guide,
 * a "Page n of N" caption — and all of it is screen-only scaffolding invented by the preview. A PDF is
 * the document itself. The two paths share one renderer, so the separation is a contract, not a habit:
 * no PDF-producing call may ask for a sheet, and no sheet, guide or page-number markup may appear in
 * the HTML a PDF is printed from.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { evaluateTemplateAst } from './evaluator';
import { PREVIEW_SHEET_CLASS, PREVIEW_SHEET_GUIDE_CLASS } from './previewSheet';
import { renderTemplateAstHtmlDocument } from './server-render';
import { getStandardTemplateAstByCode } from './standardTemplates';

const servicesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../services');

const readService = (file: string): string => fs.readFileSync(path.join(servicesDir, file), 'utf8');

describe('preview framing never reaches a PDF', () => {
  it('leaves no sheet, guide or page-number markup in the printed HTML', async () => {
    const ast = getStandardTemplateAstByCode('standard-default')!;
    const model = {
      invoiceNumber: 'INV-1',
      issueDate: '2026-11-01',
      dueDate: '2026-11-30',
      customer: { name: 'Acme', address: '1 Main' },
      currencyCode: 'USD',
      subtotal: 1000,
      tax: 0,
      total: 1000,
      items: [{ description: 'Service', quantity: 1, unitPrice: 1000, total: 1000 }],
    };
    const html = await renderTemplateAstHtmlDocument(ast, evaluateTemplateAst(ast, model), { title: 'Invoice' });
    for (const marker of [
      PREVIEW_SHEET_CLASS,
      PREVIEW_SHEET_GUIDE_CLASS,
      'alga-preview-page',
      'alga-preview-page-caption',
      'data-preview-page',
      'pagedjs',
      '@media screen',
    ]) {
      expect(html, `${marker} is preview framing and must not be printed`).not.toContain(marker);
    }
  });

  it('never asks the renderer for a sheet from a PDF path', () => {
    for (const file of ['pdfGenerationService.ts', 'registeredDocumentPdfService.ts']) {
      const source = readService(file);
      expect(source, `${file} must not frame a document it is about to print`).not.toMatch(/previewSheet/);
      expect(source, `${file} must not paginate for the screen`).not.toMatch(/previewPagination|paginate\w*Preview/);
    }
  });
});
