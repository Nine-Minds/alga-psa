import { describe, expect, it } from 'vitest';
import {
  getInvoicePaperPresetById,
  listInvoicePaperPresets,
  millimetersToPixels,
  pixelsToMillimeters,
  type InvoiceTemplateAst,
} from '@alga-psa/types';
import { resolveInvoicePdfPrintOptionsFromAst } from './printSettings';

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
}): InvoiceTemplateAst => ({
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

    expect(resolveInvoicePdfPrintOptionsFromAst(templateAst)).toEqual({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });
  });

  it('produces consistent fallback PDF options for legacy templates without explicit print metadata', () => {
    const legacyTemplateAst = buildTemplateAst({
      widthPx: 816,
      heightPx: 1056,
      paddingPx: 40,
    });

    expect(resolveInvoicePdfPrintOptionsFromAst(legacyTemplateAst)).toEqual({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });
  });
});
