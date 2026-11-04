import { describe, expect, it } from 'vitest';
import {
  currencyFractionDigits,
  displayCurrencySymbol,
  formatCurrency,
  formatCurrencyFromMinorUnits,
  formatCurrencyWithSymbol,
  fromMinorUnits,
  minorUnitsToPlainDecimalText,
  toMinorUnits,
} from './formatters';

// Intl separates symbol from digits with NBSP/NNBSP depending on locale.
const stripSpaces = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ');

describe('currency minor-unit formatters', () => {
  it('round-trips currencies with different minor-unit exponents', () => {
    expect(currencyFractionDigits('USD', 'en-US')).toBe(2);
    expect(toMinorUnits(12.34, 'en-US', 'USD')).toBe(1234);
    expect(formatCurrencyFromMinorUnits(1234, 'en-US', 'USD')).toBe('$12.34');

    expect(currencyFractionDigits('JPY', 'en-US')).toBe(0);
    expect(toMinorUnits(1234, 'en-US', 'JPY')).toBe(1234);
    expect(formatCurrencyFromMinorUnits(1234, 'en-US', 'JPY')).toBe('¥1,234');

    expect(currencyFractionDigits('BHD', 'en-US')).toBe(3);
    expect(toMinorUnits(12.345, 'en-US', 'BHD')).toBe(12345);
    expect(formatCurrencyFromMinorUnits(12345, 'en-US', 'BHD').replace(/\u00a0/g, ' ')).toBe('BHD 12.345');
  });

  it('shows the product symbol, not the ISO code, for picker currencies', () => {
    // The picker offers "ZAR (R)", so an amount must read R, not "ZAR 12.34".
    expect(stripSpaces(formatCurrencyFromMinorUnits(1234, 'en', 'ZAR'))).toBe('R 12.34');
    expect(stripSpaces(formatCurrency(12.34, 'en', 'ZAR'))).toBe('R 12.34');
    expect(stripSpaces(formatCurrencyFromMinorUnits(1234, 'en', 'SEK'))).toBe('kr 12.34');
    expect(stripSpaces(formatCurrencyFromMinorUnits(1234, 'en', 'CHF'))).toBe('Fr. 12.34');
    // Multi-currency dollars keep their disambiguating prefix from the table.
    expect(stripSpaces(formatCurrencyFromMinorUnits(1234, 'en', 'CAD'))).toBe('C$12.34');
  });

  it('keeps the locale symbol position and separators', () => {
    expect(stripSpaces(formatCurrencyFromMinorUnits(123450, 'de', 'ZAR'))).toBe('1.234,50 R');
    expect(stripSpaces(formatCurrencyFromMinorUnits(123450, 'fr', 'ZAR'))).toBe('1 234,50 R');
    expect(stripSpaces(formatCurrencyFromMinorUnits(123450, 'en', 'ZAR'))).toBe('R 1,234.50');
  });

  it('formatCurrencyWithSymbol is the seam other formatters share', () => {
    // The shared seam every money-display surface routes through.
    expect(stripSpaces(formatCurrencyWithSymbol(12.34, 'en', 'ZAR'))).toBe('R 12.34');
    expect(formatCurrencyWithSymbol(1234.5, 'en', 'USD')).toBe('$1,234.50');
    // An omitted locale follows the runtime's own, as a bare Intl call would.
    expect(formatCurrencyWithSymbol(0, undefined, 'ZAR')).toContain('R');
    expect(formatCurrencyWithSymbol(0, undefined, 'ZAR')).not.toContain('ZAR');
    // Pass-through options still apply (whole-unit amounts, fraction digits).
    expect(stripSpaces(formatCurrencyWithSymbol(1234, 'en', 'ZAR', { maximumFractionDigits: 0 })))
      .toBe('R 1,234');
    // Callers that explicitly ask for the ISO wording keep it.
    expect(stripSpaces(formatCurrencyWithSymbol(12.34, 'en', 'ZAR', { currencyDisplay: 'code' })))
      .toBe('ZAR 12.34');
    expect(formatCurrencyWithSymbol(12.34, 'en', 'ZAR', { currencyDisplay: 'name' }))
      .toContain('South African rand');
  });

  it('displayCurrencySymbol falls back to Intl outside the product table', () => {
    expect(displayCurrencySymbol('ZAR', 'en')).toBe('R');
    expect(displayCurrencySymbol('USD', 'en')).toBe('$');
    expect(displayCurrencySymbol('BHD', 'en')).toBe('BHD');
    expect(displayCurrencySymbol('not-a-code', 'en')).toBe('not-a-code');
  });

  it('fromMinorUnits uses the currency exponent and inverts toMinorUnits', () => {
    expect(fromMinorUnits(1050, 'en-US', 'USD')).toBe(10.5);
    expect(fromMinorUnits(10000, 'en-US', 'JPY')).toBe(10000);
    expect(fromMinorUnits(12345, 'en-US', 'BHD')).toBe(12.345);

    for (const [value, currency] of [[12.34, 'USD'], [10000, 'JPY'], [12.345, 'BHD'], [0, 'USD']] as const) {
      expect(fromMinorUnits(toMinorUnits(value, 'en-US', currency), 'en-US', currency)).toBe(value);
    }
  });

  it('minorUnitsToPlainDecimalText matches toFixed(2) for USD and emits whole units for JPY', () => {
    expect(minorUnitsToPlainDecimalText(1050, 'en-US', 'USD')).toBe('10.50');
    expect(minorUnitsToPlainDecimalText(5, 'en-US', 'USD')).toBe('0.05');
    expect(minorUnitsToPlainDecimalText(0, 'en-US', 'USD')).toBe('0.00');
    expect(minorUnitsToPlainDecimalText(-500, 'en-US', 'USD')).toBe('-5.00');
    expect(minorUnitsToPlainDecimalText(1049.6, 'en-US', 'USD')).toBe('10.50');
    expect(minorUnitsToPlainDecimalText(10000, 'en-US', 'JPY')).toBe('10000');
    expect(minorUnitsToPlainDecimalText(12345, 'en-US', 'BHD')).toBe('12.345');
  });
});
