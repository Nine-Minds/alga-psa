import { describe, expect, it } from 'vitest';
import { parseNumberInput } from './numberInput';

describe('parseNumberInput (alga0002283)', () => {
  it('treats empty / whitespace / garbage as null, never NaN', () => {
    expect(parseNumberInput('', { integer: true })).toBeNull();
    expect(parseNumberInput('   ', { integer: false })).toBeNull();
    expect(parseNumberInput('abc', { integer: false })).toBeNull();
    expect(parseNumberInput('Infinity', { integer: false })).toBeNull();
  });

  it('keeps 0 as a real value', () => {
    expect(parseNumberInput('0', { integer: true })).toBe(0);
    expect(parseNumberInput('0.00', { integer: false })).toBe(0);
  });

  it('truncates for integer columns and keeps the fraction for decimal columns', () => {
    expect(parseNumberInput('12.5', { integer: true })).toBe(12);
    expect(parseNumberInput('12.5', { integer: false })).toBe(12.5);
    expect(parseNumberInput('-3', { integer: true })).toBe(-3);
  });
});
