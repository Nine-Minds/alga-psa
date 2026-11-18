import { describe, expect, it } from 'vitest';

import { computePreviewSheetScale, MAX_FIT_SCALE, readPreviewSheetMetrics } from './previewSheetScale';

const label = { widthPx: 384, heightPx: 192 };

describe('computePreviewSheetScale', () => {
  it('enlarges a label to fill the pane, bounded by the pane height', () => {
    expect(computePreviewSheetScale(label, { widthPx: 1600, heightPx: 592 }, 'fit')).toBe(3.08);
  });

  it('never enlarges a label past the maximum', () => {
    expect(computePreviewSheetScale(label, { widthPx: 5000, heightPx: 5000 }, 'fit')).toBe(MAX_FIT_SCALE);
  });

  it('shrinks a label in a pane narrower than the label', () => {
    expect(computePreviewSheetScale(label, { widthPx: 192, heightPx: 592 }, 'fit')).toBe(0.5);
  });

  it('100% is always 1', () => {
    expect(computePreviewSheetScale(label, { widthPx: 1600, heightPx: 592 }, 'actual')).toBe(1);
    expect(computePreviewSheetScale(label, { widthPx: 100, heightPx: 100 }, 'actual')).toBe(1);
  });
});

describe('readPreviewSheetMetrics', () => {
  it('reads the server sheet attributes and rejects markup without them', () => {
    const el = {
      getAttribute: (name: string) =>
        ({ 'data-sheet-width-px': '384', 'data-sheet-height-px': '192' })[name] ?? null,
    } as unknown as Element;
    expect(readPreviewSheetMetrics(el)).toEqual(label);
    expect(readPreviewSheetMetrics({ getAttribute: () => null } as unknown as Element)).toBeNull();
    expect(readPreviewSheetMetrics(null)).toBeNull();
  });
});
