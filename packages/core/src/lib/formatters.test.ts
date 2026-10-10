import { describe, expect, it } from 'vitest';
import {
  currencyFractionDigits,
  formatCurrencyFromMinorUnits,
  fromMinorUnits,
  toMinorUnits,
} from './formatters';

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

  it('fromMinorUnits uses the currency exponent and inverts toMinorUnits', () => {
    expect(fromMinorUnits(1050, 'en-US', 'USD')).toBe(10.5);
    expect(fromMinorUnits(10000, 'en-US', 'JPY')).toBe(10000);
    expect(fromMinorUnits(12345, 'en-US', 'BHD')).toBe(12.345);

    for (const [value, currency] of [[12.34, 'USD'], [10000, 'JPY'], [12.345, 'BHD'], [0, 'USD']] as const) {
      expect(fromMinorUnits(toMinorUnits(value, 'en-US', currency), 'en-US', currency)).toBe(value);
    }
  });
});
