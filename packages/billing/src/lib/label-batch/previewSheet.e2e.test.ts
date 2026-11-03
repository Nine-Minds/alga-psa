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

async function measure(html: string, media: 'screen' | 'print', frameSelector: string): Promise<Layout> {
  const browser = await browserPoolService.getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.emulateMediaType(media);
    await page.setContent(html, { waitUntil: 'load' });
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
    it(`${code}: same 4 x 2 in sheet, same clipping, every node in the same place`, async () => {
      const ast = getStandardLabelTemplateAstByCode(code) as TemplateAst;
      const viewModel = viewModelFor(code);

      const evaluation = evaluateTemplateAst(ast, viewModel as unknown as Record<string, unknown>);
      const previewHtml = await renderTemplateAstHtmlDocument(ast, evaluation, {
        title: 'Preview',
        previewSheet: resolveTemplatePreviewSheetFromAst(ast, getDocumentTypeRegistryEntry('work-tag').printGeometry)!,
      });
      const printed = await renderLabelBatchHtml([{ templateCode: code, viewModel }], {
        kind: 'one-per-page',
        pageSize: { width: 4, height: 2, unit: 'in' },
      });

      const preview = await measure(previewHtml, 'screen', `.${PREVIEW_SHEET_CLASS}`);
      const paper = await measure(printed.html, 'print', '.label-cell');

      // The sheet IS the label: 4 x 2 in at 96 CSS px/in, clipped like the cell.
      expect(preview.frame.w).toBeCloseTo(384, 1);
      expect(preview.frame.h).toBeCloseTo(192, 1);
      expect(paper.frame.w).toBeCloseTo(384, 1);
      expect(paper.frame.h).toBeCloseTo(192, 1);
      expect(preview.frame.overflow).toBe('hidden');
      expect(paper.frame.overflow).toBe('hidden');

      // The printable-area guide sits exactly on the template margin (the root's padding).
      const root = paper.nodes.root;
      expect(root).toBeDefined();
      expect(preview.guide).not.toBeNull();
      expect(preview.guide!.x).toBeCloseTo(11, 0);
      expect(preview.guide!.y).toBeCloseTo(11, 0);
      expect(preview.guide!.w).toBeCloseTo(384 - 22, 0);
      expect(preview.guide!.h).toBeCloseTo(192 - 22, 0);

      // Every node the template renders is in the same place, at the same size, in both.
      const ids = Object.keys(paper.nodes);
      expect(ids.length).toBeGreaterThan(4);
      expect(Object.keys(preview.nodes).sort()).toEqual(ids.sort());
      for (const id of ids) {
        const a = preview.nodes[id];
        const b = paper.nodes[id];
        for (const key of ['x', 'y', 'w', 'h'] as const) {
          expect(Math.abs(a[key] - b[key]), `${code} #${id}.${key}: preview ${a[key]} vs print ${b[key]}`).toBeLessThan(0.5);
        }
      }
    }, 60_000);
  }
});
