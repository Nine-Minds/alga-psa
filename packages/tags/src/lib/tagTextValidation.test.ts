import { describe, expect, it } from 'vitest';
import { validateTagText } from './tagTextValidation';

describe('validateTagText', () => {
  it.each([
    ['VIP', true, 'VIP'],
    ['  padded  ', true, 'padded'],
    ['a-b_c 1!@#$%^&*()+=[]{};\':",./<>?', true, 'a-b_c 1!@#$%^&*()+=[]{};\':",./<>?'],
    ['x'.repeat(50), true, 'x'.repeat(50)],
  ])('accepts %j', (input, valid, text) => {
    expect(validateTagText(input)).toEqual({ valid, text });
  });

  it.each([
    ['', 'common:errors.tags.textRequired'],
    ['   ', 'common:errors.tags.textRequired'],
    [null, 'common:errors.tags.textRequired'],
    [undefined, 'common:errors.tags.textRequired'],
    ['x'.repeat(51), 'common:errors.tags.textTooLong'],
    ['café', 'common:errors.tags.textInvalidCharacters'],
    ['back\\slash', 'common:errors.tags.textInvalidCharacters'],
    ['pipe|', 'common:errors.tags.textInvalidCharacters'],
  ])('rejects %j', (input, i18nKey) => {
    const result = validateTagText(input as string | null | undefined);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.i18nKey).toBe(i18nKey);
  });
});
