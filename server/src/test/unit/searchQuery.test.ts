import { describe, expect, it, vi } from 'vitest';

import { parseQuery, runSearchQuery, SearchQueryError } from '../../lib/search/query';

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

  it('T091 builds the FTS branch with websearch_to_tsquery and search_vector match', async () => {
    const knex = {
      raw: vi.fn(async () => ({ rows: [] })),
    };

    await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'acme',
      allowedTypes: ['client'],
    });

    const sql = knex.raw.mock.calls[0]?.[0] as string;
    expect(sql).toContain("websearch_to_tsquery('english', ?)");
    expect(sql).toContain('s.search_vector @@ q.tsq');
  });

  it('T092 orders relevance results by the score containing ts_rank_cd descending', async () => {
    const knex = {
      raw: vi.fn(async () => ({ rows: [] })),
    };

    await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'acme',
      allowedTypes: ['client'],
      sort: 'relevance',
    });

    const sql = knex.raw.mock.calls[0]?.[0] as string;
    expect(sql).toContain('ts_rank_cd(s.search_vector, q.tsq)');
    expect(sql).toContain('ORDER BY score DESC, source_updated_at DESC, object_id ASC');
  });
});
