import { describe, expect, it } from 'vitest';
import { resolveAutoTranslation } from './translatableText';

describe('resolveAutoTranslation', () => {
  it('links text that is exactly a standard label', () => {
    expect(resolveAutoTranslation('INVOICE', undefined)).toEqual({ i18nKey: 'labels.invoiceTitle', defaultValue: 'INVOICE' });
    expect(resolveAutoTranslation(' Bill To ', undefined)?.i18nKey).toBe('labels.billTo');
  });

  it('leaves other text, and anything the author marked as fixed text, alone', () => {
    expect(resolveAutoTranslation('Bill To:', undefined)).toBeUndefined();
    expect(resolveAutoTranslation('INVOICE', true)).toBeUndefined();
  });
});
