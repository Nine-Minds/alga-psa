import { describe, expect, it } from 'vitest';
import {
  getInvoicePaperPresetById,
  listInvoicePaperPresets,
  millimetersToPixels,
  pixelsToMillimeters,
  type TemplateAst,
} from '@alga-psa/types';
import {
  DOCUMENT_PRINT_GEOMETRY_CSS,
  resolveCustomPageCssFromAst,
  resolveDocumentPrintGeometryFromAst,
  resolvePdfPrintOptionsFromAst,
} from './printSettings';

const buildTemplateAst = ({
  paperPreset,
  marginMm,
  widthPx,
  heightPx,
  paddingPx,
}: {
  paperPreset?: 'Letter' | 'A4' | 'Legal';
  marginMm?: number;
  widthPx: number;
  heightPx: number;
  paddingPx: number;
}): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: 1,
  metadata: paperPreset && typeof marginMm === 'number' ? { printSettings: { paperPreset, marginMm } } : undefined,
  layout: {
    id: 'document-root',
    type: 'document',
    style: {
      inline: {
        width: `${widthPx}px`,
        height: `${heightPx}px`,
      },
    },
    children: [
      {
        id: 'page-root',
        type: 'section',
        style: {
          inline: {
            width: `${widthPx}px`,
            height: `${heightPx}px`,
            padding: `${paddingPx}px`,
          },
        },
        children: [],
      },
    ],
  },
});

describe('invoice print preset registry', () => {
  it('returns correct physical dimensions for Letter, A4, and Legal', () => {
    expect(getInvoicePaperPresetById('Letter')).toMatchObject({
      widthMm: 215.9,
      heightMm: 279.4,
    });
    expect(getInvoicePaperPresetById('A4')).toMatchObject({
      widthMm: 210,
      heightMm: 297,
    });
    expect(getInvoicePaperPresetById('Legal')).toMatchObject({
      widthMm: 215.9,
      heightMm: 355.6,
    });
  });

  it('maps preset dimensions to deterministic editor pixel sizes', () => {
    expect(
      listInvoicePaperPresets().map((preset) => ({
        id: preset.id,
        widthPx: preset.widthPx,
        heightPx: preset.heightPx,
      }))
    ).toEqual([
      { id: 'Letter', widthPx: 816, heightPx: 1056 },
      { id: 'A4', widthPx: 794, heightPx: 1123 },
      { id: 'Legal', widthPx: 816, heightPx: 1344 },
    ]);

    expect(Math.round(millimetersToPixels(215.9))).toBe(816);
    expect(Math.round(millimetersToPixels(297))).toBe(1123);
    expect(pixelsToMillimeters(816)).toBeCloseTo(215.9, 1);
  });

  it('returns the expected Puppeteer format and uniform margin for explicit print settings', () => {
    const templateAst = buildTemplateAst({
      paperPreset: 'A4',
      marginMm: 12,
      widthPx: 794,
      heightPx: 1123,
      paddingPx: 45,
    });

    // The page box carries the margin on every page. The 45px of padding the markup also
    // carries is stripped for print (DOCUMENT_PRINT_GEOMETRY_CSS), so this is not a second one.
    expect(resolvePdfPrintOptionsFromAst(templateAst)).toEqual({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '12mm',
        right: '12mm',
        bottom: '12mm',
        left: '12mm',
      },
    });
  });

  it('produces consistent fallback PDF options for legacy templates without explicit print metadata', () => {
    const legacyTemplateAst = buildTemplateAst({
      widthPx: 816,
      heightPx: 1056,
      paddingPx: 40,
    });

    // A legacy template states its margin as the page section's padding; it becomes the page
    // box's margin, which is the only margin that repeats on the second page and the third.
    expect(resolvePdfPrintOptionsFromAst(legacyTemplateAst)).toEqual({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '10.58mm',
        right: '10.58mm',
        bottom: '10.58mm',
        left: '10.58mm',
      },
    });
  });
});

describe('document print geometry', () => {
  const marginOf = (ast: TemplateAst): string => resolvePdfPrintOptionsFromAst(ast).margin.top;

  it('resolves one page box, one margin and the content box it leaves', () => {
    const geometry = resolveDocumentPrintGeometryFromAst(
      buildTemplateAst({ paperPreset: 'A4', marginMm: 12, widthPx: 794, heightPx: 1123, paddingPx: 45 })
    );

    expect(geometry).toEqual({
      pageWidthMm: 210,
      pageHeightMm: 297,
      marginMm: 12,
      contentWidthMm: 186,
      contentHeightMm: 273,
    });
  });

  it('gives the printed page exactly the margin it resolves, on every paper', () => {
    for (const [paperPreset, widthMm, heightMm] of [
      ['Letter', 215.9, 279.4],
      ['A4', 210, 297],
      ['Legal', 215.9, 355.6],
    ] as const) {
      const ast = buildTemplateAst({ paperPreset, marginMm: 15, widthPx: 816, heightPx: 1056, paddingPx: 0 });
      const geometry = resolveDocumentPrintGeometryFromAst(ast);
      expect(geometry.pageWidthMm).toBe(widthMm);
      expect(geometry.pageHeightMm).toBe(heightMm);
      expect(geometry.contentWidthMm).toBeCloseTo(widthMm - 30, 2);
      expect(geometry.contentHeightMm).toBeCloseTo(heightMm - 30, 2);
      // The number the page box is actually told to use is the number resolved here.
      expect(marginOf(ast)).toBe(`${geometry.marginMm}mm`);
    }
  });

  it('reads a designer-saved page-sized root as the sheet, not as a content width', () => {
    // What exportWorkspaceToTemplateAst writes: the root pinned to the full page. That is the
    // paper, so the content box is still the page less its margins.
    const ast = buildTemplateAst({
      paperPreset: 'Letter',
      marginMm: 10.58,
      widthPx: 816,
      heightPx: 1056,
      paddingPx: 0,
    });

    expect(resolveDocumentPrintGeometryFromAst(ast)).toEqual({
      pageWidthMm: 215.9,
      pageHeightMm: 279.4,
      marginMm: 10.58,
      contentWidthMm: 194.74,
      contentHeightMm: 258.24,
    });
  });

  it('agrees with the @page rule a custom page size emits', () => {
    const ast = {
      kind: 'invoice-template-ast',
      version: 1,
      metadata: { printSettings: { paperPreset: 'Letter', marginMm: 5, customPageSize: { width: 4, height: 2, unit: 'in' } } },
      layout: { id: 'document-root', type: 'document', children: [] },
    } as unknown as TemplateAst;

    const geometry = resolveDocumentPrintGeometryFromAst(ast);
    expect(geometry.pageWidthMm).toBe(101.6);
    expect(geometry.pageHeightMm).toBe(50.8);
    expect(geometry.marginMm).toBe(5);
    expect(geometry.contentWidthMm).toBe(91.6);
    // All three places the margin is stated say the same number: the @page rule (which wins
    // under preferCSSPageSize), the Puppeteer options, and the geometry.
    expect(resolveCustomPageCssFromAst(ast)).toBe('@page { size: 4in 2in; margin: 5mm; }');
    expect(marginOf(ast)).toBe('5mm');
  });

  it('strips the markup of the margin and the page width, for print only', () => {
    // Three things in the markup would otherwise fight the page box: the browser's body margin,
    // the renderer's root padding (which only indents the first page), and the page-sized root
    // (which overflows the printable area and made Chromium shrink every page to fit).
    expect(DOCUMENT_PRINT_GEOMETRY_CSS.startsWith('@media print {')).toBe(true);
    expect(DOCUMENT_PRINT_GEOMETRY_CSS).toMatch(/html, body \{ margin: 0; padding: 0; \}/);

    const rootRule = DOCUMENT_PRINT_GEOMETRY_CSS.match(
      /\.invoice-template-root > \.ast-node-type-document \{([^}]*)\}/
    )?.[1];
    expect(rootRule).toBeTruthy();
    expect(rootRule).toMatch(/padding: 0 !important;/);
    expect(rootRule).toMatch(/width: auto !important;/);
    expect(rootRule).toMatch(/height: auto !important;/);

    // A legacy template states the margin as the padding of the one section wrapping its page.
    const pageSectionRule = DOCUMENT_PRINT_GEOMETRY_CSS.match(
      /section\.ast-node-type-section:only-child \{([^}]*)\}/
    )?.[1];
    expect(pageSectionRule).toMatch(/padding: 0 !important;/);
    expect(pageSectionRule).toMatch(/width: auto !important;/);
  });
});

describe('custom page size', () => {
  const customAst = (customPageSize: unknown, marginMm = 2): TemplateAst =>
    ({
      kind: 'invoice-template-ast',
      version: 1,
      metadata: { printSettings: { paperPreset: 'Letter', marginMm, customPageSize } },
      layout: { id: 'document-root', type: 'document', children: [] },
    }) as unknown as TemplateAst;

  it('emits width, height and preferCSSPageSize for a custom size', () => {
    const options = resolvePdfPrintOptionsFromAst(customAst({ width: 4, height: 2, unit: 'in' }));
    expect(options.width).toBe('4in');
    expect(options.height).toBe('2in');
    expect(options.preferCSSPageSize).toBe(true);
    expect(options.format).toBeUndefined();
  });

  it('supports millimetres', () => {
    const options = resolvePdfPrintOptionsFromAst(customAst({ width: 102, height: 51, unit: 'mm' }));
    expect(options.width).toBe('102mm');
    expect(options.height).toBe('51mm');
  });

  it('emits a matching @page rule only for custom sizes', () => {
    expect(resolveCustomPageCssFromAst(customAst({ width: 4, height: 2, unit: 'in' }, 2))).toBe(
      '@page { size: 4in 2in; margin: 2mm; }'
    );
    expect(resolveCustomPageCssFromAst(customAst(undefined))).toBeNull();
  });

  it.each(['Letter', 'A4', 'Legal'] as const)('leaves %s output unchanged', (paperPreset) => {
    const ast = buildTemplateAst({ paperPreset, marginMm: 10, widthPx: 800, heightPx: 1000, paddingPx: 0 });
    const options = resolvePdfPrintOptionsFromAst(ast);
    expect(options.format).toBe(paperPreset);
    expect(options.width).toBeUndefined();
    expect(options.preferCSSPageSize).toBeUndefined();
    expect(resolveCustomPageCssFromAst(ast)).toBeNull();
  });
});
