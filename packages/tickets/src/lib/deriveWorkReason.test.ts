import { describe, expect, it } from 'vitest';
import { deriveWorkReason } from './deriveWorkReason';

describe('deriveWorkReason (design §9: subcategory, then category, else null; no board fallback)', () => {
  it('prefers the subcategory', () => expect(deriveWorkReason('Printer', 'Hardware')).toBe('Printer'));
  it('falls back to the category', () => expect(deriveWorkReason(null, 'Hardware')).toBe('Hardware'));
  it('ignores blanks and returns null when neither is set', () => {
    expect(deriveWorkReason('  ', ' Hardware ')).toBe('Hardware');
    expect(deriveWorkReason(null, null)).toBeNull();
    expect(deriveWorkReason('', '')).toBeNull();
  });
});
