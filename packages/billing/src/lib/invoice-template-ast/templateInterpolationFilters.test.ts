import { describe, expect, it } from 'vitest';
import {
  decodeTemplatePathExpression,
  encodeTemplatePathExpression,
  parseTemplateToken,
} from './templateInterpolationFilters';

describe('templateInterpolationFilters', () => {
  it('parses plain path tokens', () => {
    expect(parseTemplateToken('invoice.total')).toEqual({ path: 'invoice.total' });
  });

  it('parses currency filter tokens with whitespace tolerance', () => {
    expect(parseTemplateToken('invoice.total | currency')).toEqual({
      path: 'invoice.total',
      filter: 'currency',
    });
  });

  it('rejects unsupported filters', () => {
    expect(parseTemplateToken('invoice.total | percent')).toBeNull();
  });

  it('encodes and decodes filtered path expressions', () => {
    const encoded = encodeTemplatePathExpression('total', 'currency');
    expect(encoded).toBe('total|currency');
    expect(decodeTemplatePathExpression(encoded)).toEqual({
      path: 'total',
      filter: 'currency',
    });
  });
});
