import { describe, expect, it } from 'vitest';

import { parseQuery, SearchQueryError } from '../../lib/search/query';

describe('search query parsing', () => {
  it('T089 rejects queries longer than 200 characters with a typed error', () => {
    expect(() => parseQuery('x'.repeat(201))).toThrow(SearchQueryError);

    try {
      parseQuery('x'.repeat(201));
      throw new Error('Expected parseQuery to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SearchQueryError);
      expect((error as SearchQueryError).code).toBe('query_too_long');
    }
  });

  it('T090 accepts normalized whitespace and lowercases identifier-like queries', () => {
    expect(parseQuery('  Acme   Corp  ')).toEqual({
      raw: 'Acme Corp',
      normalized: 'Acme Corp',
      isIdentifierLike: false,
      identifier: undefined,
    });

    expect(parseQuery('  TIC-1023  ')).toEqual({
      raw: 'TIC-1023',
      normalized: 'tic-1023',
      isIdentifierLike: true,
      identifier: 'tic-1023',
    });
  });
});
