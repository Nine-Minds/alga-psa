import { describe, expect, it } from 'vitest';
import { resolveAutoTranslation } from './translatableText';

describe('resolveAutoTranslation', () => {
  it('links text that is exactly a standard label', () => {
    expect(resolveAutoTranslation('INVOICE', undefined)).toEqual({ i18nKey: 'labels.invoiceTitle', defaultValue: 'INVOICE' });
    expect(resolveAutoTranslation(' Bill To ', undefined)?.i18nKey).toBe('labels.billTo');
  });

  it.each([
    ['{{cadence}} Total', 'labels.cadenceTotal'],
    ['Optional (included)', 'labels.optionalIncluded'],
    ['Optional (if selected)', 'labels.optionalSection'],
    ['Optional Subtotal', 'labels.optionalSubtotal'],
    ['Optional if selected', 'labels.optionalTotal'],
  ])('links the quote heading "%s" unless the author opts out', (text, i18nKey) => {
    expect(resolveAutoTranslation(text, undefined)).toEqual({ i18nKey, defaultValue: text });
    expect(resolveAutoTranslation(text, true)).toBeUndefined();
  });

  it('leaves other text, and anything the author marked as fixed text, alone', () => {
    expect(resolveAutoTranslation('Bill To:', undefined)).toBeUndefined();
    expect(resolveAutoTranslation('INVOICE', true)).toBeUndefined();
  });
});
