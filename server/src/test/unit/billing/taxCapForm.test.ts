import { describe, it, expect, vi } from 'vitest';
import { decimalTextToMinorUnits, minorUnitsToDecimalText, formatExactCurrencyFromMinorUnits } from '../../../../../packages/core/src/lib/formatters';
vi.mock('@alga-psa/core', async () => await import('../../../../../packages/core/src/lib/formatters'));
import { createTaxCapDraft, changeTaxCapCurrency, taxCapPayload } from '@alga-psa/billing/components/billing-dashboard/taxCapForm';

describe('exact tax cap money', () => {
  it.each([['USD', '90071992547409.91'], ['JPY', '9007199254740991'], ['BHD', '9007199254740.991']])('round trips maximum safe %s without floating point loss', (currency, text) => {
    expect(decimalTextToMinorUnits(text, currency)).toBe(Number.MAX_SAFE_INTEGER);
    expect(minorUnitsToDecimalText('9007199254740991', currency)).toBe(text);
    expect(formatExactCurrencyFromMinorUnits('9007199254740991', currency).replace(/[^\d.]/g, '')).toBe(text);
    const localized = text.replace('.', ',');
    expect(decimalTextToMinorUnits(localized, currency, 'de')).toBe(Number.MAX_SAFE_INTEGER);
    expect(minorUnitsToDecimalText(Number.MAX_SAFE_INTEGER, currency, 'de')).toBe(localized);
    expect(formatExactCurrencyFromMinorUnits('9007199254740991', currency, 'de')
      .replace(/[^\d,]/g, '').replace(',', '.')).toBe(text);
  });
  it.each(['-0', '-1', '1.001', '1.000', '1e2', '0x10', '+1', '1,000.00', '1 2', '1junk', 'NaN', 'Infinity', '.1', '1.', '90071992547409.92'])('rejects invalid USD text %s', text => {
    expect(() => decimalTextToMinorUnits(text, 'USD')).toThrow();
  });
  it('respects currency precision and ungrouped localized decimals', () => {
    expect(decimalTextToMinorUnits(' 12,34 ', 'EUR', 'de')).toBe(1234);
    expect(decimalTextToMinorUnits('1.001', 'BHD')).toBe(1001);
    expect(decimalTextToMinorUnits('1', 'JPY')).toBe(1);
    expect(() => decimalTextToMinorUnits('1.0', 'JPY')).toThrow('precision');
    expect(() => decimalTextToMinorUnits('1', 'ZZZ')).toThrow('currency');
    expect(decimalTextToMinorUnits('0', 'USD')).toBe(0);
    expect(decimalTextToMinorUnits(' ', '')).toBeNull();
  });
});

describe('tax cap edit payloads', () => {
  it('creates null and zero distinctly, preserves untouched and formatting-only edits', () => {
    const blank = createTaxCapDraft({}, 'en');
    expect(taxCapPayload(blank, 'en', false)).toEqual({ cap_amount: null, currency_code: null });
    expect(taxCapPayload({ ...blank, currency: 'USD', text: '0' }, 'en', false)).toEqual({ cap_amount: 0, currency_code: 'USD' });
    const saved = createTaxCapDraft({ cap_amount: '500', currency_code: 'USD' }, 'en');
    expect(saved.text).toBe('5.00');
    expect(taxCapPayload(saved, 'en', true)).toEqual({});
    expect(taxCapPayload({ ...saved, text: '05.0', touched: true }, 'en', true)).toEqual({});
    expect(taxCapPayload({ ...saved, text: '', touched: true }, 'en', true)).toEqual({ cap_amount: null });
  });
  it('requires re-entry after currency changes and permits deliberate clear', () => {
    const changed = changeTaxCapCurrency(createTaxCapDraft({ cap_amount: 500, currency_code: 'USD' }, 'en'), 'JPY');
    expect(changed.text).toBe('5.00');
    expect(() => taxCapPayload(changed, 'en', true)).toThrow('reenter');
    expect(taxCapPayload({ ...changed, text: '5', touched: true, needsReentry: false }, 'en', true)).toEqual({ cap_amount: 5, currency_code: 'JPY' });
    expect(taxCapPayload({ ...changed, text: '', touched: true, needsReentry: false }, 'en', true)).toEqual({ cap_amount: null, currency_code: 'JPY' });
  });
  it.each([0, 500])('preserves, resolves and clears legacy cap %s explicitly', cap => {
    const legacy = createTaxCapDraft({ cap_amount: cap, currency_code: null }, 'en');
    expect(taxCapPayload(legacy, 'en', true)).toEqual({});
    expect(() => taxCapPayload({ ...legacy, currency: 'USD' }, 'en', true)).toThrow('currency');
    expect(taxCapPayload({ ...legacy, touched: true }, 'en', true)).toEqual({ cap_amount: null });
    expect(taxCapPayload({ ...legacy, touched: true, currency: 'USD', text: minorUnitsToDecimalText(cap, 'USD') }, 'en', true)).toEqual({ currency_code: 'USD' });
  });
});
