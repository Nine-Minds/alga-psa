import { describe, expect, it } from 'vitest';
import { expandAssetLabelCopies } from './LabelPrintDialog';

describe('physical asset label copies', () => {
  it('keeps copies adjacent and preserves input batch order', () => {
    expect(expandAssetLabelCopies(['A', 'B', 'C'], 2)).toEqual(['A', 'A', 'B', 'B', 'C', 'C']);
  });

  it('supports single labels and clamps invalid copy counts', () => {
    expect(expandAssetLabelCopies(['A', 'B'], 1)).toEqual(['A', 'B']);
    expect(expandAssetLabelCopies(['A'], 0)).toEqual(['A']);
    expect(expandAssetLabelCopies(['A'], 11)).toHaveLength(10);
  });
});
