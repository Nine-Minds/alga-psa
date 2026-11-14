/**
 * T013: a long invoice with bundle child rows, printed by real headless Chrome
 * (the same engine `pdfGenerationService` drives), keeps the column header on
 * every page and never strands a bundle row at the foot of a page away from
 * its first component row.
 *
 * Requires Puppeteer's Chromium (or `PUPPETEER_EXECUTABLE_PATH`) and
 * `pdftotext` from poppler, as provided by both CI unit lanes.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { browserPoolService } from '../../services/browserPoolService';
import { evaluateTemplateAst } from './evaluator';
import { resolvePdfPrintOptionsFromAst } from './printSettings';
import { renderTemplateAstHtmlDocument } from './server-render';
import { getStandardTemplateAstByCode } from './standardTemplates';

afterAll(() => browserPoolService.cleanup());

const bundle = (n: number) => ({
  id: `bundle-${n}`,
  description: `Managed bundle ${n}`,
  subtitle: `Bundle ${n} subtitle`,
  quantity: 1, unitPrice: 100000, total: 100000, hasComponents: true,
  components: [1, 2, 3, 4].map((c) => ({ name: `B${n} service ${c}`, quantity: 10 * c, quantityChange: c % 2 ? c : -c, pricingBasis: 'unit' })),
});

describe('bundle child rows across PDF page breaks (T013)', () => {
  it('repeats headers and keeps each bundle row with its first component row', async () => {
    const ast = getStandardTemplateAstByCode('standard-bundle-quantities')!;
    const items = Array.from({ length: 24 }, (_, i) => bundle(i + 1));
    const model = {
      invoiceNumber: 'INV-PDF', issueDate: '2026-10-01', dueDate: '2026-10-31',
      customer: { name: 'Acme', address: '1 Main' }, currencyCode: 'USD',
      subtotal: 2400000, tax: 0, total: 2400000, items,
    };
    const html = await renderTemplateAstHtmlDocument(ast, evaluateTemplateAst(ast, model as unknown as Record<string, unknown>), { locale: 'en-US' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-pdf-'));
    const pdfPath = path.join(dir, 'invoice.pdf');
    try {
      const browser = await browserPoolService.getBrowser();
      try {
        const page = await browser.newPage();
        try {
          await page.setContent(html, { waitUntil: 'load' });
          await page.pdf({ ...resolvePdfPrintOptionsFromAst(ast), path: pdfPath });
        } finally {
          await page.close();
        }
      } finally {
        await browserPoolService.releaseBrowser(browser);
      }
      const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
      const pages = text.split('\f').filter((page) => page.trim().length > 0);
      expect(pages.length).toBeGreaterThan(1);
      // A totals-only final page is outside the item table and has no table
      // header. Every page containing bundle rows must repeat the header.
      for (const page of pages.filter((page) => /Managed bundle \d+|B\d+ service \d/.test(page))) {
        expect(page).toMatch(/Description/);
      }
      for (let n = 1; n <= items.length; n++) {
        const parent = new RegExp(`Managed bundle ${n}\\b`);
        const parentPages = pages.filter((page) => parent.test(page));
        expect(parentPages, `bundle ${n} must appear on exactly one page`).toHaveLength(1);
        expect(parentPages[0], `bundle ${n} must share a page with its first component`).toMatch(new RegExp(`B${n} service 1\\b`));
        for (let c = 1; c <= 4; c++) {
          expect(text.match(new RegExp(`B${n} service ${c}\\b`, 'g')), `bundle ${n} component ${c} must print exactly once`).toHaveLength(1);
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
