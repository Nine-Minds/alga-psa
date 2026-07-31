import { describe, expect, it } from 'vitest';
import { normalizeGtin } from '../index';

describe('normalizeGtin', () => {
  it('normalizes UPC-A and its zero-prefixed EAN-13 form identically', () => {
    expect(normalizeGtin('036000291452')).toBe('0036000291452');
    expect(normalizeGtin('036000291452')).toBe(normalizeGtin('0036000291452'));
  });

  it('keeps a 13-digit GTIN unchanged', () => {
    expect(normalizeGtin('0036000291452')).toBe('0036000291452');
  });

  it('keeps non-GTIN barcode formats unchanged', () => {
    expect(normalizeGtin('SN-ABC123')).toBe('SN-ABC123');
  });

  it('trims surrounding whitespace before normalization', () => {
    expect(normalizeGtin('  036000291452  ')).toBe('0036000291452');
    expect(normalizeGtin('  SN-ABC123  ')).toBe('SN-ABC123');
  });
});
