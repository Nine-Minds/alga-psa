/**
 * The paginated preview must not lie: the sheets an author sees on screen are compared, page for page
 * and word for word, against the pages real headless Chrome prints from the same template and data.
 *
 * This is the lock on the feature. The preview exists so an author can see where their page breaks
 * land; a preview that paginates differently from the PDF would be worse than the single endless roll
 * it replaces, because it would be confidently wrong. If paged.js ever diverges here, this suite fails
 * and the chunker gets replaced — it does not get relaxed.
 *
 * Forced breaks — the breaks an author draws, and the whole point of the feature — are held to exact
 * per-page equality. The one documented difference is on a table that splits by natural overflow:
 * Chromium repeats the column header on the continuation page and paged.js does not, and that header
 * costs one row. That is asserted as a bounded drift of a single row per boundary, never more.
 *
 * Requires Puppeteer's Chromium (or `PUPPETEER_EXECUTABLE_PATH`) and `pdftotext` from poppler, as
 * provided by both CI unit lanes.
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
import { PREVIEW_SHEET_GUTTER_PX } from '../../components/invoice-designer/preview/previewSheetScale';
import type { DesignerWorkspaceSnapshot } from '../../components/invoice-designer/state/designerStore';
import { browserPoolService } from '../../services/browserPoolService';
import { evaluateTemplateAst } from './evaluator';
import { paginateDocumentPreviewHtml } from './previewPagination.server';
import { resolvePdfPrintOptionsFromAst } from './printSettings';
import { renderTemplateAstHtmlDocument } from './server-render';
import { getStandardTemplateAstByCode } from './standardTemplates';
import { getStandardQuoteTemplateAstByCode } from '../quote-template-ast/standardTemplates';

afterAll(() => browserPoolService.cleanup());

type WorkspaceNode = DesignerWorkspaceSnapshot['nodesById'][string];

const findPageNode = (workspace: DesignerWorkspaceSnapshot): WorkspaceNode => {
  const root = workspace.nodesById[workspace.rootId];
  const page = root.children
    .map((childId) => workspace.nodesById[childId])
    .find((child) => child?.type === 'page');
  return page ?? root;
};

/** What the palette's "Page Break" block adds, and where. */
const addPageBreak = (workspace: DesignerWorkspaceSnapshot, id: string, index: number) => {
  const parent = findPageNode(workspace);
  workspace.nodesById[id] = {
    id,
    type: 'page-break',
    props: { name: 'Page Break', style: { breakAfter: 'page' }, metadata: {} },
    children: [],
  } as WorkspaceNode;
  parent.children.splice(index, 0, id);
};

/** What the inspector's "Start on a new page" toggle writes. */
const startOnNewPage = (workspace: DesignerWorkspaceSnapshot, nodeId: string) => {
  const props = workspace.nodesById[nodeId].props as Record<string, unknown>;
  props.style = { ...((props.style as Record<string, unknown>) ?? {}), breakBefore: 'page' };
};

/**
 * Collapse to comparable words: the two engines agree on content, not on whitespace — pdftotext and
 * innerText disagree about non-breaking spaces, soft hyphens and line wrapping.
 */
const words = (text: string): string[] =>
  text
    .normalize('NFKC')
    .replace(/[\p{Cf}­]/gu, '')
    .split(/\s+/u)
    .filter(Boolean);

const renderHtml = (ast: TemplateAst, model: Record<string, unknown>) =>
  renderTemplateAstHtmlDocument(ast, evaluateTemplateAst(ast, model), { locale: 'en-US' });

const printedPages = async (ast: TemplateAst, html: string): Promise<string[]> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-parity-pdf-'));
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
    const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
    // Keep blank pages: a stray empty final page is exactly what we are hunting.
    return text.split('\f').slice(0, -1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** The text each drawn sheet shows, read back out of the paginated preview document. */
const previewPages = async (paginatedHtml: string): Promise<string[]> => {
  const browser = await browserPoolService.getBrowser();
  try {
    const page = await browser.newPage();
    try {
      await page.setContent(paginatedHtml, { waitUntil: 'load' });
      return await page.evaluate(() =>
        Array.from(document.querySelectorAll('.pagedjs_page_content')).map(
          (element) => (element as HTMLElement).innerText || element.textContent || '',
        ),
      );
    } finally {
      await page.close();
    }
  } finally {
    await browserPoolService.releaseBrowser(browser);
  }
};

/** Preview sheets and printed pages, for the same AST and data. */
const paginateBothWays = async (ast: TemplateAst, model: Record<string, unknown>) => {
  const html = await renderHtml(ast, model);
  const [preview, printed] = await Promise.all([
    paginateDocumentPreviewHtml(html, ast, { locale: 'en' }),
    printedPages(ast, html),
  ]);
  return { preview, printed, sheets: await previewPages(preview.html) };
};

/**
 * Same content on the same page. Compared as a multiset, not a sequence: pdftotext reads a two-column
 * header band in visual order and `innerText` reads it in DOM order, which is a disagreement between
 * two text extractors, not between two paginations.
 */
const expectParity = (sheets: string[], printed: string[]) => {
  expect(sheets).toHaveLength(printed.length);
  sheets.forEach((sheet, index) => {
    expect(words(sheet).sort()).toEqual(words(printed[index]).sort());
  });
};

/** Which page (1-based) each needle lands on, or 0 when it is nowhere. */
const pageOf = (pages: string[], needles: string[]): number[] =>
  needles.map((needle) => pages.findIndex((page) => page.includes(needle)) + 1);

const quoteModel = {
  quoteNumber: 'Q-PREVIEW',
  quote_number: 'Q-PREVIEW',
  title: 'Mighty Blue proposal',
  currencyCode: 'USD',
  currency_code: 'USD',
  subtotal: 500000,
  tax: 0,
  total: 500000,
  total_amount: 500000,
  items: [{ description: 'Managed endpoints', quantity: 10, unit_price: 50000, unitPrice: 50000, total_price: 500000, total: 500000 }],
  line_items: [{ description: 'Managed endpoints', quantity: 10, unit_price: 50000, unitPrice: 50000, total_price: 500000, total: 500000 }],
};

const invoiceModel = (itemCount: number) => ({
  invoiceNumber: 'INV-PREVIEW',
  issueDate: '2026-11-01',
  dueDate: '2026-11-30',
  customer: { name: 'Mighty Blue Group', address: '1 Main' },
  currencyCode: 'USD',
  subtotal: 50000 * itemCount,
  tax: 0,
  total: 50000 * itemCount,
  items: Array.from({ length: itemCount }, (_, index) => ({
    description: `Managed endpoints batch ${index + 1}`,
    quantity: 10,
    unitPrice: 50000,
    total: 500000,
  })),
});

describe('the paginated preview matches the printed pages', () => {
  it('draws a quote cover / body / signature break as the three pages it prints', async () => {
    const source = getStandardQuoteTemplateAstByCode('standard-quote-default')!;
    const workspace = importTemplateAstToWorkspace(JSON.parse(JSON.stringify(source)) as TemplateAst);
    const page = findPageNode(workspace);

    addPageBreak(workspace, 'cover-break', 1);
    const signatureId = page.children.find((childId) => childId.includes('signature'));
    expect(signatureId, 'the standard quote carries a signature block to isolate').toBeTruthy();
    startOnNewPage(workspace, signatureId!);

    const { preview, printed, sheets } = await paginateBothWays(exportWorkspaceToTemplateAst(workspace), quoteModel);
    expect(printed).toHaveLength(3);
    expect(preview.pageCount).toBe(3);
    expectParity(sheets, printed);
  }, 180_000);

  it('draws an invoice forced onto a second page as two sheets', async () => {
    const source = getStandardTemplateAstByCode('standard-default')!;
    const workspace = importTemplateAstToWorkspace(JSON.parse(JSON.stringify(source)) as TemplateAst);
    const lineItemsId = findPageNode(workspace).children.find(
      (childId) => workspace.nodesById[childId]?.type === 'dynamic-table',
    );
    expect(lineItemsId, 'the standard invoice carries a line-items table').toBeTruthy();
    startOnNewPage(workspace, lineItemsId!);

    const { preview, printed, sheets } = await paginateBothWays(exportWorkspaceToTemplateAst(workspace), invoiceModel(1));
    expect(printed).toHaveLength(2);
    expect(preview.pageCount).toBe(2);
    expectParity(sheets, printed);
  }, 180_000);

  it('breaks before a block that states no display of its own', async () => {
    // The reported regression, from the author's own quote: a Page Break dropped between the
    // timeline and the pricing left the pricing rows on the timeline's sheet and moved only the
    // totals overleaf — one block late — while the PDF broke in the right place. Every style this
    // renderer writes is an inline style, and paged.js treats an element whose inline style omits
    // `display` as not displayed, then looks past it for the element the break sits against. So the
    // break has to be asserted against a neighbour that states no display: the line-items table.
    const source = getStandardQuoteTemplateAstByCode('standard-quote-default')!;
    const workspace = importTemplateAstToWorkspace(JSON.parse(JSON.stringify(source)) as TemplateAst);
    const page = findPageNode(workspace);

    const tableIndex = page.children.findIndex(
      (childId) => workspace.nodesById[childId]?.type === 'dynamic-table',
    );
    expect(tableIndex, 'the standard quote carries a line-items table').toBeGreaterThan(0);
    addPageBreak(workspace, 'pricing-break', tableIndex);

    const { preview, printed, sheets } = await paginateBothWays(exportWorkspaceToTemplateAst(workspace), quoteModel);
    expect(printed).toHaveLength(2);
    expect(preview.pageCount).toBe(2);
    expectParity(sheets, printed);
    // Named explicitly, because parity alone would also be satisfied by both engines breaking in
    // the same wrong place: the rows start the second sheet, they do not trail the first.
    expect(pageOf(sheets, ['Managed endpoints'])).toEqual([2]);
  }, 180_000);

  it('opens a sheet on natural overflow, not only on a forced break', async () => {
    const itemCount = 60;
    const ast = getStandardTemplateAstByCode('standard-default')!;
    const { preview, printed, sheets } = await paginateBothWays(ast, invoiceModel(itemCount));
    expect(printed.length).toBeGreaterThan(1);
    expect(preview.pageCount).toBe(printed.length);

    // Every line lands on the page it prints on. The chunker does not repeat a split table's column
    // header the way Chromium's own page fragmentation does, and that header costs exactly one row at
    // each boundary it is missing from — so one line per boundary may sit a page early, and no line
    // may be further out than that, missing, or on two sheets at once.
    const rows = Array.from({ length: itemCount }, (_, index) => `Managed endpoints batch ${index + 1}`);
    const previewPageOfRow = pageOf(sheets, rows);
    const printedPageOfRow = pageOf(printed, rows);
    expect(previewPageOfRow.filter((page) => page === 0)).toEqual([]);
    const drift = previewPageOfRow.map((page, index) => page - printedPageOfRow[index]);
    expect(Math.max(...drift.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(drift.filter((delta) => delta !== 0).length).toBeLessThanOrEqual(printed.length - 1);
    expect(previewPageOfRow).toEqual([...previewPageOfRow].sort((a, b) => a - b));
  }, 180_000);

  it('adds no empty sheet for a page break on the last block', async () => {
    const source = getStandardQuoteTemplateAstByCode('standard-quote-default')!;
    const workspace = importTemplateAstToWorkspace(JSON.parse(JSON.stringify(source)) as TemplateAst);
    const page = findPageNode(workspace);
    addPageBreak(workspace, 'trailing-break', page.children.length);

    const { preview, printed, sheets } = await paginateBothWays(exportWorkspaceToTemplateAst(workspace), quoteModel);
    expect(printed).toHaveLength(1);
    expect(preview.pageCount).toBe(1);
    expectParity(sheets, printed);
  }, 180_000);
});

/**
 * How the drawn sheets sit in a pane narrower than the paper. Measured in real Chromium because the
 * thing under test is a cascade fight: paged.js states the page box's size with a two-class selector,
 * so the screen-only framing has to outweigh it or the box keeps the paper's unzoomed size.
 */
const measureFrameLayout = async (paginatedHtml: string, paneWidthPx: number) => {
  const browser = await browserPoolService.getBrowser();
  try {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: paneWidthPx, height: 800 });
      await page.setContent(paginatedHtml, { waitUntil: 'load' });
      return await page.evaluate(
        (input) => {
          const sheets = Array.from(document.querySelectorAll<HTMLElement>('.alga-preview-sheet'));
          const sheetWidthPx = Number(sheets[0]?.getAttribute('data-sheet-width-px'));
          // The frame's own arithmetic: fit the paper into the pane minus its gutter, never past 1.
          const scale = Math.max(0.1, Math.floor(Math.min((input.paneWidthPx - input.gutterPx * 2) / sheetWidthPx, 1) * 100) / 100);
          const read = () => {
            const box = document.querySelector<HTMLElement>('.alga-preview-page')!.getBoundingClientRect();
            const sheet = sheets[0].getBoundingClientRect();
            return {
              overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              documentHeightPx: Math.ceil(document.body.getBoundingClientRect().height),
              backdropWidthPx: box.width,
              backdropHeightPx: box.height,
              sheetWidthPx: sheet.width,
              sheetHeightPx: sheet.height,
              sheetLeftPx: sheet.left,
            };
          };
          const actual = read();
          sheets.forEach((sheet) => sheet.style.setProperty('zoom', String(scale)));
          return { scale, paperWidthPx: sheetWidthPx, fit: read(), actual };
        },
        { paneWidthPx, gutterPx: PREVIEW_SHEET_GUTTER_PX },
      );
    } finally {
      await page.close();
    }
  } finally {
    await browserPoolService.releaseBrowser(browser);
  }
};

describe('the drawn sheets in a pane narrower than the paper', () => {
  it('shrinks the backdrop with the paper, leaving nothing to scroll sideways', async () => {
    const source = getStandardQuoteTemplateAstByCode('standard-quote-default')!;
    const workspace = importTemplateAstToWorkspace(JSON.parse(JSON.stringify(source)) as TemplateAst);
    addPageBreak(workspace, 'cover-break', 1);
    const ast = exportWorkspaceToTemplateAst(workspace);
    const { pageCount, html } = await paginateDocumentPreviewHtml(await renderHtml(ast, quoteModel), ast, {
      locale: 'en',
    });
    expect(pageCount).toBe(2);

    const paneWidthPx = 560;
    const layout = await measureFrameLayout(html, paneWidthPx);
    expect(layout.scale).toBeLessThan(1);

    // Fitted: the page box is the zoomed sheet, so the sheet is centred on the backdrop and the whole
    // of it is on screen. Before the specificity fix the box stayed 8.5 x 11in and the fitted sheet
    // sat in the middle of a backdrop that scrolled 280px sideways.
    expect(layout.fit.overflowPx).toBe(0);
    expect(layout.fit.sheetWidthPx).toBeCloseTo(layout.paperWidthPx * layout.scale, 0);
    expect(layout.fit.backdropWidthPx).toBeCloseTo(layout.fit.sheetWidthPx, 0);
    expect(layout.fit.backdropHeightPx - layout.fit.sheetHeightPx).toBeLessThan(40); // the caption
    expect(layout.fit.documentHeightPx).toBeLessThan(layout.actual.documentHeightPx);

    // At 100% the paper is wider than the pane on purpose — but it starts at the gutter, so the part
    // that is off-screen is off to the right, where a scroll (or a drag) can still reach it.
    expect(layout.actual.sheetWidthPx).toBeCloseTo(layout.paperWidthPx, 0);
    expect(layout.actual.sheetLeftPx).toBe(PREVIEW_SHEET_GUTTER_PX);
    expect(layout.actual.overflowPx).toBeCloseTo(layout.paperWidthPx + PREVIEW_SHEET_GUTTER_PX - paneWidthPx, 0);
  }, 180_000);
});
