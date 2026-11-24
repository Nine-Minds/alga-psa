import { describe, expect, it } from 'vitest';
import { normalizeTagTexts } from '../applyTagChanges';

describe('normalizeTagTexts', () => {
  it('trims, drops empties, and dedupes case-insensitively keeping first casing', () => {
    expect(normalizeTagTexts([' Urgent ', 'urgent', '', '   ', 'VIP'])).toEqual(['Urgent', 'VIP']);
  });

  it('does not validate by default, so legacy text can be matched for removal', () => {
    expect(normalizeTagTexts(['legacy-é🔥'])).toEqual(['legacy-é🔥']);
  });

  it('validates when asked (creating definitions)', () => {
    expect(() => normalizeTagTexts(['legacy-é🔥'], { validate: true })).toThrow(/Validation failed/);
    expect(() => normalizeTagTexts(['x'.repeat(51)], { validate: true })).toThrow(/too long/);
    expect(normalizeTagTexts(['ok tag'], { validate: true })).toEqual(['ok tag']);
  });
});
