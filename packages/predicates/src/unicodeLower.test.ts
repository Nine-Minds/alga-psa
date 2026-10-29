import { describe, expect, it } from 'vitest';
import { unicodeLowerV1 } from './unicodeLower';
import unicode from './unicodeLower.v1.json';

describe('frozen Unicode v1 lowercase', () => {
  it.each([
    ['', ''], ['İ', 'i\u0307'], ['ΟΣ', 'ος'], ['ΟΣΑ', 'οσα'],
    ['Ο\u0301Σ', 'ο\u0301ς'], ['Σ', 'σ'], ['AΣ\u0301B', 'aσ\u0301b'],
    ['ÉCOLE 𐐀', 'école 𐐨'],
    // Unicode 17 added casing for these. v1 must stay on Unicode 16 even on newer Node.
    ['\ua7ce', '\ua7ce'], ['A\ua7ceΣ', 'a\ua7ceσ'], ['ΑΣ\ua7ce', 'ας\ua7ce'],
  ])('folds %j to %j independent of host Unicode data', (input, expected) => {
    expect(unicodeLowerV1(input)).toBe(expected);
  });

  it('applies every frozen single-codepoint mapping', () => {
    const upper = Array.from(unicode.upper);
    const lower = Array.from(unicode.lower);
    expect(upper.length).toBe(lower.length);
    for (let index = 0; index < upper.length; index++) {
      expect(unicodeLowerV1(upper[index]), upper[index]).toBe(lower[index]);
    }
  });
});
