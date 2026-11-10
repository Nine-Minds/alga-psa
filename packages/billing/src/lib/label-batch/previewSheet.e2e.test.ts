/**
 * The designer preview must show a label exactly as it prints. Lays out, in Chromium, (a) the authoritative
 * preview document (screen media, framed by the preview sheet) and (b) the label batch print document
 * (print media, one 4 x 2 in cell) for every standard label template, then compares the sheet with the
 * cell and every rendered node's box relative to it. Needs a Chromium Puppeteer can launch; fails, not
 * skips, without one.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { LABEL_CLASS_ENTITY_TYPE, recordUrl, type LabelViewModel, type TemplateAst } from '@alga-psa/types';

import { browserPoolService } from '../../services/browserPoolService';
import { evaluateTemplateAst } from '../invoice-template-ast/evaluator';
import { renderTemplateAstHtmlDocument } from '../invoice-template-ast/server-render';
import { resolveTemplatePreviewSheetFromAst } from '../invoice-template-ast/printSettings';
import { PREVIEW_SHEET_CLASS, PREVIEW_SHEET_GUIDE_CLASS } from '../invoice-template-ast/previewSheet';
import { getDocumentTypeRegistryEntry } from '../document-templates/registry';
import { buildSampleLabelViewModel } from '../label-template-ast/sampleData';
import {
  LABEL_CLASS_BY_STANDARD_CODE,
  STANDARD_LABEL_TEMPLATE_ASTS,
  getStandardLabelTemplateAstByCode,
} from '../label-template-ast/standardTemplates';
import { renderLabelBatchHtml } from './renderLabelBatchHtml';

const BASE = 'https://psa.example.com';
const ENTITY_BY_CLASS = LABEL_CLASS_ENTITY_TYPE;
// Record types addressed through their project need one in their URL.
const SAMPLE_PROJECT_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Layout {
  frame: Box & { overflow: string };
  guide: Box | null;
  nodes: Record<string, Box>;
}

/**
 * `contentWidthPx` lays the document out in a page's content box: a flow worksheet has no frame of its
 * own (its `@page` size and margin are the frame), so the print measurement must use the width Chrome
 * gives it when it paginates, not the screen viewport.
 */
async function measure(
  html: string,
  media: 'screen' | 'print',
  frameSelector: string,
  contentWidthPx?: number
): Promise<Layout> {
  const browser = await browserPoolService.getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.emulateMediaType(media);
    await page.setContent(html, { waitUntil: 'load' });
    if (contentWidthPx !== undefined) {
      await page.addStyleTag({ content: `body { margin: 0 !important; width: ${contentWidthPx}px !important; }` });
    }
    return await page.evaluate(
      (selector: string, guideClass: string) => {
        const frame = document.querySelector<HTMLElement>(selector)!;
        const f = frame.getBoundingClientRect();
        const rel = (r: DOMRect) => ({ x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height });
        const nodes: Record<string, { x: number; y: number; w: number; h: number }> = {};
        frame.querySelectorAll<HTMLElement>('[id]').forEach((el) => {
          nodes[el.id] = rel(el.getBoundingClientRect());
        });
        const guideEl = frame.querySelector<HTMLElement>(`.${guideClass}`);
        const guide = guideEl && getComputedStyle(guideEl).display !== 'none' ? rel(guideEl.getBoundingClientRect()) : null;
        return { frame: { x: 0, y: 0, w: f.width, h: f.height, overflow: getComputedStyle(frame).overflow }, guide, nodes };
      },
      frameSelector,
      PREVIEW_SHEET_GUIDE_CLASS
    );
  } finally {
    await page.close().catch(() => undefined);
    await browserPoolService.releaseBrowser(browser).catch(() => undefined);
  }
}

/**
 * Per-code print page and printable-area guide: thermal tags print on the 4 x 2 in roll with the
 * 3 mm margin (round(3 mm to px) = 11 px); the customer worksheets print on their own paper
 * (Letter or A4) with their 15 mm margin (round(15 mm to px) = 57 px). Page sizes are the exact
 * 96 CSS px/in conversions (A4 in mm is not integral at 96 dpi). A worksheet cell is a flow
 * section, so it is width-bound and lets content spill past the page edge instead of clipping.
 */
const GEOMETRY_BY_CODE: Record<string, {
  width: number;
  height: number;
  unit: 'in' | 'mm';
  frame: number;
  pageH: number;
  marginPx: number;
  cellOverflow: string;
}> = {
  'standard-ticket-customer-worksheet': { width: 8.5, height: 11, unit: 'in', frame: 816, pageH: 1056, marginPx: 57, cellOverflow: 'visible' },
  'standard-ticket-customer-worksheet-a4': { width: 210, height: 297, unit: 'mm', frame: 793.6875, pageH: 1122.5197, marginPx: 57, cellOverflow: 'visible' },
};
const TAG_GEOMETRY = { width: 4, height: 2, unit: 'in' as const, frame: 384, pageH: 192, marginPx: 11, cellOverflow: 'hidden' };
const geometryFor = (code: string) => GEOMETRY_BY_CODE[code] ?? TAG_GEOMETRY;

const viewModelFor = (code: string): LabelViewModel => {
  const labelClass = LABEL_CLASS_BY_STANDARD_CODE[code];
  const entityType = ENTITY_BY_CLASS[labelClass];
  const sample = buildSampleLabelViewModel();
  const options = entityType === 'staging_container' ? { projectId: SAMPLE_PROJECT_ID } : {};
  const sequence = labelClass === 'staging-container' ? { n: 3, total: 5 } : null;
  return { ...sample, labelClass, entityType, sequence, url: recordUrl(entityType, sample.recordId, BASE, options) } as LabelViewModel;
};

afterAll(async () => {
  await browserPoolService.cleanup();
});

describe('designer preview sheet matches the printed label cell', () => {
  it('work-tag documents preview through the label-cell geometry', () => {
    expect(getDocumentTypeRegistryEntry('work-tag').printGeometry).toBe('label-cell');
    expect(getDocumentTypeRegistryEntry('sales-order').printGeometry).toBe('document');
  });

  for (const code of Object.keys(STANDARD_LABEL_TEMPLATE_ASTS)) {
    it(`${code}: same sheet, same clipping, every node in the same place`, async () => {
      const geometry = geometryFor(code);
      const { frame: framePx, pageH: pagePx, marginPx, cellOverflow } = geometry;
      const ast = getStandardLabelTemplateAstByCode(code) as TemplateAst;
      const viewModel = viewModelFor(code);

      const evaluation = evaluateTemplateAst(ast, viewModel as unknown as Record<string, unknown>);
      const previewHtml = await renderTemplateAstHtmlDocument(ast, evaluation, {
        title: 'Preview',
        previewSheet: resolveTemplatePreviewSheetFromAst(ast, getDocumentTypeRegistryEntry('work-tag').printGeometry)!,
      });
      const printed = await renderLabelBatchHtml([{ templateCode: code, viewModel }], {
        kind: 'one-per-page',
        pageSize: { width: geometry.width, height: geometry.height, unit: geometry.unit },
      });

      const isFlow = cellOverflow === 'visible';
      // A worksheet prints on a named page whose margin is the template margin, so its cell starts at
      // the margin and is as wide as the page's content box; a tag cell is the whole label.
      const inset = isFlow ? marginPx : 0;
      const preview = await measure(previewHtml, 'screen', `.${PREVIEW_SHEET_CLASS}`);
      const paper = await measure(printed.html, 'print', '.label-cell', isFlow ? framePx - marginPx * 2 : undefined);

      // The sheet IS the label (or the worksheet page) at 96 CSS px/in, clipped like the cell.
      expect(preview.frame.w).toBeCloseTo(framePx, 1);
      expect(preview.frame.h).toBeCloseTo(pagePx, 1);
      expect(paper.frame.w).toBeCloseTo(framePx - inset * 2, 1);
      if (isFlow) {
        const pageRule = /@page (label-flow-\d+) \{ size: ([\d.]+)mm ([\d.]+)mm; margin: ([\d.]+)mm; \}/.exec(printed.html);
        expect(pageRule).not.toBeNull();
        const toPx = (mm: string) => (Number(mm) * 96) / 25.4;
        expect(toPx(pageRule![2])).toBeCloseTo(framePx, 1);
        expect(toPx(pageRule![3])).toBeCloseTo(pagePx, 1);
        expect(toPx(pageRule![4])).toBeCloseTo(marginPx, 1);
      } else {
        expect(paper.frame.h).toBeCloseTo(pagePx, 1);
      }
      expect(preview.frame.overflow).toBe('hidden');
      expect(paper.frame.overflow).toBe(cellOverflow);

      // The printable-area guide sits exactly on the template margin (the root's padding).
      const root = paper.nodes.root;
      expect(root).toBeDefined();
      expect(preview.guide).not.toBeNull();
      expect(preview.guide!.x).toBeCloseTo(marginPx, 0);
      expect(preview.guide!.y).toBeCloseTo(marginPx, 0);
      expect(preview.guide!.w).toBeCloseTo(framePx - marginPx * 2, 0);
      expect(preview.guide!.h).toBeCloseTo(pagePx - marginPx * 2, 0);

      // Every node the template renders is in the same place, at the same size, in both. On a worksheet
      // the page-sized root is the page itself (its padding moved to the @page margin), so it is the
      // one node that is compared through the guide above instead.
      const ids = Object.keys(paper.nodes);
      expect(ids.length).toBeGreaterThan(4);
      expect(Object.keys(preview.nodes).sort()).toEqual(ids.sort());
      for (const id of ids) {
        if (isFlow && id === 'root') continue;
        const a = preview.nodes[id];
        const b = paper.nodes[id];
        const placed = { x: b.x + inset, y: b.y + inset, w: b.w, h: b.h };
        for (const key of ['x', 'y', 'w', 'h'] as const) {
          expect(Math.abs(a[key] - placed[key]), `${code} #${id}.${key}: preview ${a[key]} vs print ${placed[key]}`).toBeLessThan(0.5);
        }
      }
    }, 60_000);
  }
});
