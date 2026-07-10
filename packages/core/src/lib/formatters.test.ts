import { describe, expect, it } from 'vitest';
import {
  currencyFractionDigits,
  formatCurrencyFromMinorUnits,
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
});
