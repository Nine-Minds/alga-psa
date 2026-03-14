import { describe, expect, it } from 'vitest';
import {
  getInvoicePaperPresetById,
  listInvoicePaperPresets,
  millimetersToPixels,
  pixelsToMillimeters,
} from '@alga-psa/types';

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
});
