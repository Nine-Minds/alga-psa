import { describe, expect, it } from 'vitest';
import { DEFAULT_QUOTE_VALIDITY_DAYS, getQuoteValidityDays, isValidQuoteValidityDays } from './billing';

describe('quote validity defaults', () => {
  it('uses configured days and falls back for missing or invalid settings', () => {
    expect(getQuoteValidityDays(15)).toBe(15);
    expect(getQuoteValidityDays(undefined)).toBe(DEFAULT_QUOTE_VALIDITY_DAYS);
    expect(getQuoteValidityDays(0)).toBe(DEFAULT_QUOTE_VALIDITY_DAYS);
    expect(getQuoteValidityDays(366)).toBe(DEFAULT_QUOTE_VALIDITY_DAYS);
    expect(getQuoteValidityDays(1.5)).toBe(DEFAULT_QUOTE_VALIDITY_DAYS);
  });

  it('rejects out-of-range and non-integer saves', () => {
    expect(isValidQuoteValidityDays(1)).toBe(true);
    expect(isValidQuoteValidityDays(365)).toBe(true);
    expect(isValidQuoteValidityDays(0)).toBe(false);
    expect(isValidQuoteValidityDays(366)).toBe(false);
    expect(isValidQuoteValidityDays(1.5)).toBe(false);
  });
});
