import { describe, expect, it } from 'vitest';
import { formatMinorUnits, minorUnitsToInputValue, parseMoneyToMinorUnits } from './money';

// T015: purchase cost round-trips between the typed decimal and stored cents.
describe('parseMoneyToMinorUnits', () => {
  it('converts a grouped decimal amount to minor units', () => {
    expect(parseMoneyToMinorUnits('1,234.56')).toBe(123456);
  });

  it('converts a bare integer amount', () => {
    expect(parseMoneyToMinorUnits('1200')).toBe(120000);
  });

  it('rounds to the nearest minor unit', () => {
    expect(parseMoneyToMinorUnits('10.005')).toBe(1001);
  });

  it('treats blank and unparseable input as cleared', () => {
    expect(parseMoneyToMinorUnits('')).toBeNull();
    expect(parseMoneyToMinorUnits('   ')).toBeNull();
    expect(parseMoneyToMinorUnits('abc')).toBeNull();
    expect(parseMoneyToMinorUnits(null)).toBeNull();
    expect(parseMoneyToMinorUnits(undefined)).toBeNull();
  });

  it('strips a currency symbol a technician pasted in', () => {
    expect(parseMoneyToMinorUnits('$1,234.56')).toBe(123456);
  });

  it('reads a European decimal comma', () => {
    // Stripping commas turned this into 1.23 — a four-figure laptop saved as
    // one twenty-three.
    expect(parseMoneyToMinorUnits('1.234,56')).toBe(123456);
    expect(parseMoneyToMinorUnits('1 234,56')).toBe(123456);
    expect(parseMoneyToMinorUnits('€1.234,56')).toBe(123456);
    expect(parseMoneyToMinorUnits('12,50')).toBe(1250);
  });

  it('keeps reading a lone dot as the decimal point and a lone comma group as thousands', () => {
    expect(parseMoneyToMinorUnits('1.234')).toBe(123);
    expect(parseMoneyToMinorUnits('1,234')).toBe(123400);
    expect(parseMoneyToMinorUnits('1.234.567')).toBe(123456700);
  });

  it('clamps a negative amount to zero', () => {
    expect(parseMoneyToMinorUnits('-400')).toBe(0);
    expect(parseMoneyToMinorUnits('-1,234.56')).toBe(0);
  });
});

describe('minorUnitsToInputValue', () => {
  it('renders stored minor units as an editable decimal', () => {
    expect(minorUnitsToInputValue(123456)).toBe('1234.56');
    expect(minorUnitsToInputValue(0)).toBe('0.00');
  });

  it('renders a cleared cost as an empty input', () => {
    expect(minorUnitsToInputValue(null)).toBe('');
    expect(minorUnitsToInputValue(undefined)).toBe('');
  });

  it('round-trips through the parser', () => {
    expect(parseMoneyToMinorUnits(minorUnitsToInputValue(123456))).toBe(123456);
  });
});

// T017: read-only surfaces format with the asset's own currency.
describe('formatMinorUnits', () => {
  it('formats with the stored currency', () => {
    expect(formatMinorUnits(123456, 'USD', 'en-US')).toBe('$1,234.56');
  });

  it('defaults to USD when the asset has no currency', () => {
    expect(formatMinorUnits(100, null, 'en-US')).toBe('$1.00');
  });

  it('falls back to amount plus code for an unknown currency', () => {
    expect(formatMinorUnits(123456, 'XYZZY', 'en-US')).toBe('1234.56 XYZZY');
  });

  it('returns null when there is no cost', () => {
    expect(formatMinorUnits(null, 'USD')).toBeNull();
  });
});
