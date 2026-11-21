import { describe, expect, it } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';

import { resolveDocumentPrintGeometryFromAst, resolveTemplatePreviewSheetFromAst } from './printSettings';
import { getDocumentTypeRegistryEntry } from '../document-templates/registry';
import { buildPreviewSheetCss, previewSheetSizePx, PREVIEW_SHEET_CLASS, wrapInPreviewSheet } from './previewSheet';
import { renderTemplateAstHtmlDocument } from './server-render';
import { evaluateTemplateAst } from './evaluator';
import { getStandardLabelTemplateAstByCode, STANDARD_LABEL_ASSET_CODE128_CODE } from '../label-template-ast/standardTemplates';
import { buildSampleLabelViewModel } from '../label-template-ast/sampleData';
import { getStandardSalesOrderTemplateAstByCode, STANDARD_SALES_ORDER_CONFIRMATION_CODE } from '../sales-order-template-ast/standardTemplates';

const astWith = (printSettings: Record<string, unknown> | undefined): TemplateAst =>
  ({
    kind: 'invoice-template-ast',
    version: 1,
    metadata: printSettings ? { printSettings } : undefined,
    layout: { id: 'root', type: 'document', children: [{ id: 't', type: 'text', content: { type: 'literal', value: 'x' } }] },
  }) as unknown as TemplateAst;

describe('resolveTemplatePreviewSheetFromAst', () => {
  it('frames a 4 x 2 in label as the printed cell, with the template margin as the guide', () => {
    const ast = getStandardLabelTemplateAstByCode(STANDARD_LABEL_ASSET_CODE128_CODE);
    const sheet = resolveTemplatePreviewSheetFromAst(ast, 'label-cell')!;
    expect(sheet.widthMm).toBeCloseTo(101.6, 3);
    expect(sheet.heightMm).toBeCloseTo(50.8, 3);
    // The guide sits where the renderer pads the root: 3 mm rounded to whole CSS px (11 px).
    expect(sheet.guideMarginMm).toBeCloseTo((11 * 25.4) / 96, 6);
    expect(previewSheetSizePx(sheet)).toEqual({ widthPx: 384, heightPx: 192 });
  });

  it('frames a millimetre label at its own size', () => {
    const ast = astWith({ paperPreset: 'Letter', marginMm: 2, customPageSize: { width: 62, height: 29, unit: 'mm' } });
    expect(resolveTemplatePreviewSheetFromAst(ast, 'label-cell')).toMatchObject({ widthMm: 62, heightMm: 29 });
  });

  it('frames a page document on the page box it prints onto, with the printed margin as the guide', () => {
    // One resolver owns the numbers: the sheet an author reads and the PDF a client reads agree by
    // construction, because both come out of resolveDocumentPrintGeometryFromAst.
    const ast = astWith({ paperPreset: 'A4', marginMm: 12 });
    const geometry = resolveDocumentPrintGeometryFromAst(ast);
    expect(resolveTemplatePreviewSheetFromAst(ast, 'document')).toEqual({
      widthMm: geometry.pageWidthMm,
      heightMm: geometry.pageHeightMm,
      guideMarginMm: geometry.marginMm,
    });
    expect(resolveTemplatePreviewSheetFromAst(ast, 'document')).toMatchObject({ widthMm: 210, heightMm: 297, guideMarginMm: 12 });
  });

  it('frames every registered page kind, and keeps the label on its cell', () => {
    for (const type of ['sales-order', 'packing-slip', 'pick-list', 'staging-manifest', 'rma-return-slip'] as const) {
      const entry = getDocumentTypeRegistryEntry(type);
      if (entry.printGeometry !== 'document') continue;
      const sheet = resolveTemplatePreviewSheetFromAst(astWith({ paperPreset: 'Letter', marginMm: 16 }), entry.printGeometry);
      expect(sheet, `${type} is a page document and must be drawn on a page`).toMatchObject({
        widthMm: 215.9,
        heightMm: 279.4,
        guideMarginMm: 16,
      });
    }
    const salesOrder = getStandardSalesOrderTemplateAstByCode(STANDARD_SALES_ORDER_CONFIRMATION_CODE);
    expect(
      resolveTemplatePreviewSheetFromAst(salesOrder, getDocumentTypeRegistryEntry('sales-order').printGeometry),
    ).toEqual(expect.objectContaining({ widthMm: expect.any(Number), heightMm: expect.any(Number) }));
    expect(getDocumentTypeRegistryEntry('work-tag').printGeometry).toBe('label-cell');
  });
});

describe('preview sheet markup', () => {
  const sheet = { widthMm: 101.6, heightMm: 50.8, guideMarginMm: 3 };

  it('keeps every framing rule screen-only and hides the guide in print', () => {
    const css = buildPreviewSheetCss(sheet);
    const [screenBlock, printBlock] = css.split('@media print');
    expect(screenBlock.startsWith('@media screen {')).toBe(true);
    expect(screenBlock).toContain('height: 50.8mm');
    expect(screenBlock).toContain('width: 101.6mm');
    expect(screenBlock).toContain('overflow: hidden');
    expect(printBlock).toContain('display: none');
    // Outside the two media blocks there are no rules at all.
    expect(css.replace(/@media (screen|print) \{[\s\S]*?\n\}/g, '').trim()).toBe('');
  });

  it('wraps the markup and exposes the sheet size for zoom-to-fit', () => {
    const html = wrapInPreviewSheet('<div id="root"></div>', sheet);
    expect(html).toContain(`class="${PREVIEW_SHEET_CLASS}"`);
    expect(html).toContain('data-sheet-width-px="384"');
    expect(html).toContain('data-sheet-height-px="192"');
    expect(html).toContain('<div id="root"></div>');
  });
});

describe('renderTemplateAstHtmlDocument previewSheet option', () => {
  it('adds the sheet only when asked, and leaves the PDF document untouched otherwise', async () => {
    const ast = getStandardLabelTemplateAstByCode(STANDARD_LABEL_ASSET_CODE128_CODE)!;
    const evaluation = evaluateTemplateAst(ast, buildSampleLabelViewModel() as unknown as Record<string, unknown>);
    const plain = await renderTemplateAstHtmlDocument(ast, evaluation, { title: 'Preview' });
    const framed = await renderTemplateAstHtmlDocument(ast, evaluation, {
      title: 'Preview',
      previewSheet: resolveTemplatePreviewSheetFromAst(ast, 'label-cell')!,
    });
    expect(plain).not.toContain(PREVIEW_SHEET_CLASS);
    expect(plain).not.toContain('@media screen');
    expect(framed).toContain(`class="${PREVIEW_SHEET_CLASS}"`);
    // The page's own @page rule is still emitted, unchanged.
    expect(framed).toContain('@page { size: 4in 2in; margin: 3mm; }');
    expect(plain).toContain('@page { size: 4in 2in; margin: 3mm; }');
  });
});
