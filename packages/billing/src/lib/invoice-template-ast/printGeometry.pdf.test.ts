/**
 * What a document actually measures when real headless Chrome prints it (the same engine
 * `pdfGenerationService` drives).
 *
 * The geometry is a promise about paper — margins that repeat on every page, text at the size it
 * was authored — and neither can be proven by a DOM assertion: jsdom has no pages and no print
 * scaling. So this suite prints the shipped standard templates AND the same templates after a
 * designer round-trip, and measures the ink on each page with `pdftotext -bbox`.
 *
 * Before the page box owned the margin, these numbers were wrong three ways: the first page was
 * indented ~23 mm where the template said 10.58 mm (Puppeteer's margin + the renderer's root
 * padding + the browser's body margin), later pages only ~12 mm (padding cannot repeat per page),
 * and a designer-saved template printed at ~90 % scale because its page-wide root overflowed the
 * printable area and Chromium shrank every page to fit.
 *
 * Requires Puppeteer's Chromium (or `PUPPETEER_EXECUTABLE_PATH`) and `pdftotext` from poppler,
 * as provided by both CI unit lanes.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import {
  exportWorkspaceToTemplateAst,
  importTemplateAstToWorkspace,
} from '../../components/invoice-designer/ast/workspaceAst';
import { browserPoolService } from '../../services/browserPoolService';
import { evaluateTemplateAst } from './evaluator';
import { resolveDocumentPrintGeometryFromAst, resolvePdfPrintOptionsFromAst } from './printSettings';
import { renderTemplateAstHtmlDocument } from './server-render';
import { getStandardTemplateAstByCode } from './standardTemplates';
import { getStandardQuoteTemplateAstByCode } from '../quote-template-ast/standardTemplates';

afterAll(() => browserPoolService.cleanup());

const PT_PER_MM = 72 / 25.4;
const toMm = (pt: number): number => Math.round((pt / PT_PER_MM) * 100) / 100;

interface PageInk {
  /** Distance from each paper edge to the nearest ink, in millimetres. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Height of the first word's box — the scale Chromium printed at. */
  firstWordHeightPt: number;
}

/** Print `ast` and measure where the text landed on every page. */
const printAndMeasure = async (ast: TemplateAst, model: Record<string, unknown>): Promise<PageInk[]> => {
  const html = await renderTemplateAstHtmlDocument(ast, evaluateTemplateAst(ast, model), { locale: 'en-US' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'print-geometry-'));
  const pdfPath = path.join(dir, 'document.pdf');
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

    const xml = execFileSync('pdftotext', ['-bbox', pdfPath, '-'], { encoding: 'utf8' });
    return [...xml.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)].map((page) => {
      const words = [...page[3].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g)].map(
        (word) => ({ x0: +word[1], y0: +word[2], x1: +word[3], y1: +word[4] })
      );
      expect(words.length, 'every page of these documents carries text').toBeGreaterThan(0);
      return {
        left: toMm(Math.min(...words.map((w) => w.x0))),
        right: toMm(+page[1] - Math.max(...words.map((w) => w.x1))),
        top: toMm(Math.min(...words.map((w) => w.y0))),
        bottom: toMm(+page[2] - Math.max(...words.map((w) => w.y1))),
        firstWordHeightPt: Math.round((words[0].y1 - words[0].y0) * 100) / 100,
      };
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** The template as a tenant's own save of it leaves the designer. */
const asDesignerSaved = (ast: TemplateAst): TemplateAst =>
  exportWorkspaceToTemplateAst(importTemplateAstToWorkspace(JSON.parse(JSON.stringify(ast)) as TemplateAst));

/** Enough line items to run every layout past its first page. */
const lineItems = Array.from({ length: 40 }, (_, index) => ({
  description: `Managed endpoints line ${index + 1}, described at a length that reaches across the page`,
  quantity: 10,
  unitPrice: 50000,
  unit_price: 50000,
  total: 500000,
  total_price: 500000,
}));

const invoiceModel = {
  invoiceNumber: 'INV-GEOMETRY',
  issueDate: '2026-11-01',
  dueDate: '2026-11-30',
  customer: { name: 'Mighty Blue Group', address: '1 Main Street' },
  currencyCode: 'USD',
  subtotal: 500000,
  tax: 0,
  total: 500000,
  items: lineItems,
};

const quoteModel = {
  ...invoiceModel,
  quoteNumber: 'Q-GEOMETRY',
  quote_number: 'Q-GEOMETRY',
  title: 'Mighty Blue proposal',
  currency_code: 'USD',
  total_amount: 500000,
  line_items: lineItems,
};

/**
 * How far past the margin the measured ink may sit. Text does not start at its box's edge (a
 * glyph's side bearing) and the first cell of a table is padded by 8px, so ink is expected a
 * little INSIDE the margin — never outside it.
 */
const INK_INSET_TOLERANCE_MM = 3;
/** Rounding slack for ink sitting exactly on the margin. */
const MARGIN_TOLERANCE_MM = 0.6;

describe('printed document geometry', () => {
  it.each([
    ['invoice', () => getStandardTemplateAstByCode('standard-default')!, invoiceModel],
    ['quote', () => getStandardQuoteTemplateAstByCode('standard-quote-default')!, quoteModel],
  ])('keeps %s content inside the same margin on every page, shipped or designer-saved', async (
    _kind,
    getAst,
    model
  ) => {
    const shipped = getAst();
    const geometry = resolveDocumentPrintGeometryFromAst(shipped);
    expect(geometry.marginMm).toBeGreaterThan(0);

    const pages = await printAndMeasure(shipped, model);
    expect(pages.length, 'this model is long enough to need a second page').toBeGreaterThan(1);

    for (const page of pages) {
      for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
        // Inside the margin, never past it — on the first page and on the last.
        expect(page[edge], `${edge} margin`).toBeGreaterThanOrEqual(geometry.marginMm - MARGIN_TOLERANCE_MM);
      }
      expect(page.left, 'left margin').toBeLessThanOrEqual(geometry.marginMm + INK_INSET_TOLERANCE_MM);
      expect(page.top, 'top margin').toBeLessThanOrEqual(geometry.marginMm + INK_INSET_TOLERANCE_MM);
    }

    // A tenant's save of the same template prints identically: no page is shrunk to fit, so the
    // round trip through the designer changes neither the margins nor the size of the type.
    const saved = await printAndMeasure(asDesignerSaved(shipped), model);
    expect(saved).toEqual(pages);
  }, 180_000);

  it('prints a designer-saved template at the size it was authored', async () => {
    // The page-sized root a save writes used to overflow the printable area, and Chromium
    // rescued it by shrinking the whole document — type included — to about 90%.
    const shipped = getStandardTemplateAstByCode('standard-default')!;
    const [shippedFirstPage] = await printAndMeasure(shipped, invoiceModel);
    const [savedFirstPage] = await printAndMeasure(asDesignerSaved(shipped), invoiceModel);

    expect(savedFirstPage.firstWordHeightPt).toBe(shippedFirstPage.firstWordHeightPt);
  }, 180_000);
});
