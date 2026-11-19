/**
 * Forced page breaks authored in the designer, printed by real headless Chrome
 * (the same engine `pdfGenerationService` drives).
 *
 * The whole feature is a promise about pagination, and pagination only exists
 * in a paginating engine: jsdom has no pages, so nothing below this line can be
 * proven by a DOM assertion. Chromium fragments a column flex or grid container
 * (which is what the designer's page wrapper is) but ignores a forced break
 * between the items of a *row*, where there is no page boundary to take — so
 * this suite drives the designer's own export, not a hand-built AST, and
 * asserts page counts and per-page content.
 *
 * Requires Puppeteer's Chromium (or `PUPPETEER_EXECUTABLE_PATH`) and
 * `pdftotext` from poppler, as provided by both CI unit lanes.
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
import type { DesignerWorkspaceSnapshot } from '../../components/invoice-designer/state/designerStore';
import { browserPoolService } from '../../services/browserPoolService';
import { evaluateTemplateAst } from './evaluator';
import { resolvePdfPrintOptionsFromAst } from './printSettings';
import { renderTemplateAstHtmlDocument } from './server-render';
import { getStandardTemplateAstByCode } from './standardTemplates';
import { getStandardQuoteTemplateAstByCode } from '../quote-template-ast/standardTemplates';

afterAll(() => browserPoolService.cleanup());

type WorkspaceNode = DesignerWorkspaceSnapshot['nodesById'][string];

/** The designer page (or the document) that top-level blocks sit on. */
const findPageNode = (workspace: DesignerWorkspaceSnapshot): WorkspaceNode => {
  const root = workspace.nodesById[workspace.rootId];
  const page = root.children
    .map((childId) => workspace.nodesById[childId])
    .find((child) => child?.type === 'page');
  return page ?? root;
};

/** What the palette's "Page Break" block adds, and where. */
const addPageBreak = (workspace: DesignerWorkspaceSnapshot, id: string, index: number) => {
  const page = findPageNode(workspace);
  workspace.nodesById[id] = {
    id,
    type: 'page-break',
    props: { name: 'Page Break', style: { breakAfter: 'page' }, metadata: {} },
    children: [],
  };
  page.children.splice(index, 0, id);
};

/** What the inspector's "Start on a new page" toggle writes. */
const startOnNewPage = (workspace: DesignerWorkspaceSnapshot, nodeId: string) => {
  const node = workspace.nodesById[nodeId];
  const props = node.props as Record<string, unknown>;
  props.style = { ...((props.style as Record<string, unknown>) ?? {}), breakBefore: 'page' };
};

const renderPdfPages = async (ast: TemplateAst, model: Record<string, unknown>): Promise<string[]> => {
  const html = await renderTemplateAstHtmlDocument(ast, evaluateTemplateAst(ast, model), { locale: 'en-US' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-break-pdf-'));
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

const quoteModel = {
  quoteNumber: 'Q-PAGEBREAK',
  quote_number: 'Q-PAGEBREAK',
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

const invoiceModel = {
  invoiceNumber: 'INV-PAGEBREAK',
  issueDate: '2026-11-01',
  dueDate: '2026-11-30',
  customer: { name: 'Mighty Blue Group', address: '1 Main' },
  currencyCode: 'USD',
  subtotal: 500000,
  tax: 0,
  total: 500000,
  items: [{ description: 'Managed endpoints', quantity: 10, unitPrice: 50000, total: 500000 }],
};

describe('forced page breaks in the printed document', () => {
  it('splits a quote into cover / body / signature pages on designer-authored breaks', async () => {
    const source = getStandardQuoteTemplateAstByCode('standard-quote-default')!;
    const workspace = importTemplateAstToWorkspace(JSON.parse(JSON.stringify(source)) as TemplateAst);

    const page = findPageNode(workspace);
    const baselineChildCount = page.children.length;
    expect(baselineChildCount).toBeGreaterThan(2);

    const withoutBreaks = await renderPdfPages(exportWorkspaceToTemplateAst(workspace), quoteModel);
    expect(withoutBreaks).toHaveLength(1);

    // One break near the top (cover page) and the signature block onto its own page.
    addPageBreak(workspace, 'cover-break', 1);
    const signatureId = page.children.find((childId) => childId.includes('signature'));
    expect(signatureId, 'the standard quote carries a signature block to isolate').toBeTruthy();
    startOnNewPage(workspace, signatureId!);

    const pages = await renderPdfPages(exportWorkspaceToTemplateAst(workspace), quoteModel);
    expect(pages).toHaveLength(3);
    // The break and the break-before each opened a page, in authored order.
    expect(pages[0]).toMatch(/Q-PAGEBREAK/);
    expect(pages[1]).toMatch(/Managed endpoints/);
    expect(pages[2]).toMatch(/Signature|Accepted|Date/i);
  }, 120_000);

  it('starts the line-items table on its own page when the table itself is told to', async () => {
    // The author's actual move (reported from the designer): select the line
    // items and tick "Start on a new page", with no wrapper and no inserted
    // block. The table is a flex item of the page stack, which Chromium does
    // fragment — only a *row* flex parent swallows a forced break.
    const source = getStandardTemplateAstByCode('standard-default')!;
    const workspace = importTemplateAstToWorkspace(JSON.parse(JSON.stringify(source)) as TemplateAst);
    const page = findPageNode(workspace);

    const lineItemsId = page.children.find(
      (childId) => workspace.nodesById[childId]?.type === 'dynamic-table'
    );
    expect(lineItemsId, 'the standard invoice carries a line-items table').toBeTruthy();
    startOnNewPage(workspace, lineItemsId!);

    const pages = await renderPdfPages(exportWorkspaceToTemplateAst(workspace), invoiceModel);
    expect(pages).toHaveLength(2);
    expect(pages[1]).toMatch(/Managed endpoints/);
  }, 120_000);

  it('paginates an invoice on a forced break and adds no page for a trailing one', async () => {
    const source = getStandardTemplateAstByCode('standard-default')!;
    const workspace = importTemplateAstToWorkspace(JSON.parse(JSON.stringify(source)) as TemplateAst);
    const page = findPageNode(workspace);

    addPageBreak(workspace, 'mid-break', 1);
    const withMidBreak = await renderPdfPages(exportWorkspaceToTemplateAst(workspace), invoiceModel);
    expect(withMidBreak).toHaveLength(2);

    // A page break with nothing after it must not open an empty final page. The
    // renderer neutralizes the trailing break rather than relying on the engine:
    // today's Chromium happens to drop it too, so this is an end-to-end guard on
    // the outcome, while react-renderer.print.test.tsx pins the emitted style.
    addPageBreak(workspace, 'trailing-break', page.children.length);
    const withTrailingBreak = await renderPdfPages(exportWorkspaceToTemplateAst(workspace), invoiceModel);
    expect(withTrailingBreak).toHaveLength(2);
    expect(withTrailingBreak[1].trim().length).toBeGreaterThan(0);
  }, 120_000);
});
