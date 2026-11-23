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

  describe("a document's stack of pages", () => {
    // Letter at 96 dpi.
    const page = { widthPx: 816, heightPx: 1056 };

    it('fits the width and lets the pages run past the pane, because they are scrolled through', () => {
      // A height-bounded fit would shrink an 1056 px page into a 592 px pane and make it unreadable.
      expect(computePreviewSheetScale(page, { widthPx: 612, heightPx: 592 }, 'fit', 'width')).toBe(0.75);
    });

    it('never blows a page up past its printed size', () => {
      expect(computePreviewSheetScale(page, { widthPx: 2400, heightPx: 4000 }, 'fit', 'width')).toBe(1);
    });

    it('still shows a page at actual size on 100%', () => {
      expect(computePreviewSheetScale(page, { widthPx: 400, heightPx: 400 }, 'actual', 'width')).toBe(1);
    });

    it('leaves the single label sheet on the height-bounded fit it had', () => {
      expect(computePreviewSheetScale(label, { widthPx: 1600, heightPx: 592 }, 'fit', 'box')).toBe(3.08);
      expect(computePreviewSheetScale(label, { widthPx: 1600, heightPx: 592 }, 'fit')).toBe(3.08);
    });
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
