import { describe, expect, it } from 'vitest';
import {
  formatCallNumber,
  normalizeToE164,
  phoneMatchCandidates,
  stripExtension,
  toDigits,
} from './phoneNumbers';

describe('normalizeToE164', () => {
  it('T016: normalizes formatted, spaced and parenthesized numbers', () => {
    expect(normalizeToE164('+1 (555) 123-4567')).toBe('+15551234567');
    expect(normalizeToE164('555 123 4567')).toBe('+15551234567');
    expect(normalizeToE164('(555)123.4567')).toBe('+15551234567');
    expect(normalizeToE164('15551234567')).toBe('+15551234567');
  });

  it('T016: treats a leading 00 as the international access prefix', () => {
    expect(normalizeToE164('004930123456')).toBe('+4930123456');
  });

  it('T016: strips extensions before parsing', () => {
    expect(normalizeToE164('555-123-4567 x220')).toBe('+15551234567');
    expect(normalizeToE164('555-123-4567 ext. 220')).toBe('+15551234567');
    expect(stripExtension('555-123-4567,,9')).toBe('555-123-4567');
  });

  it('T016: unwraps tel:/sip: URIs the Teams CDR hands us', () => {
    expect(normalizeToE164('tel:+15551234567')).toBe('+15551234567');
    expect(normalizeToE164('sip:+15551234567@contoso.com')).toBe('+15551234567');
  });

  it('T016: returns null for garbage, empties and impossible lengths', () => {
    expect(normalizeToE164('not a phone')).toBeNull();
    expect(normalizeToE164('')).toBeNull();
    expect(normalizeToE164(null)).toBeNull();
    expect(normalizeToE164('911')).toBeNull();
    expect(normalizeToE164('+1234567890123456789')).toBeNull();
    expect(normalizeToE164('+0123456789')).toBeNull();
  });

  it('honors a non-NANP default calling code for national-format input', () => {
    expect(normalizeToE164('020 7946 0958', { defaultCallingCode: '44' })).toBe('+442079460958');
  });
});

describe('phoneMatchCandidates', () => {
  it('offers the full digits and the national digits, since stored numbers drop the country code', () => {
    expect(phoneMatchCandidates('+15551234567')).toEqual(['15551234567', '5551234567']);
  });

  it('is empty for a missing number', () => {
    expect(phoneMatchCandidates(null)).toEqual([]);
  });
});

describe('formatting helpers', () => {
  it('renders NANP numbers readably and falls back to the raw value', () => {
    expect(formatCallNumber('+15551234567')).toBe('+1 (555) 123-4567');
    expect(formatCallNumber('+442079460958')).toBe('+442079460958');
    expect(formatCallNumber(null, 'anonymous')).toBe('anonymous');
    expect(formatCallNumber(null, null)).toBe('Unknown number');
  });

  it('reduces a number to digits', () => {
    expect(toDigits('+1 (555) 123-4567')).toBe('15551234567');
    expect(toDigits(undefined)).toBe('');
  });
});
