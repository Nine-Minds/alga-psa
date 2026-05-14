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

  it('T093 returns rows from the pg_trgm fallback branch', async () => {
    const knex = {
      raw: vi.fn(async (sql: string) => {
        expect(sql).toContain('s.title % q.raw');
        expect(sql).toContain("coalesce(s.subtitle, '') % q.raw");
        return {
          rows: [{
            object_type: 'client',
            object_id: 'client-exchange',
            parent_type: null,
            parent_id: null,
            title: 'Exchange Systems',
            subtitle: null,
            url: '/msp/clients/client-exchange',
            score: 0.42,
            source_updated_at: '2026-05-13T12:00:00.000Z',
            metadata: {},
            snippet: null,
          }],
        };
      }),
    };

    const results = await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'exhcange',
      allowedTypes: ['client'],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'client',
      id: 'client-exchange',
      title: 'Exchange Systems',
      score: 0.42,
    });
  });

  it('T094 includes pg_trgm similarity in the composite score', async () => {
    const knex = {
      raw: vi.fn(async () => ({ rows: [] })),
    };

    await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'exhcange',
      allowedTypes: ['client'],
    });

    const sql = knex.raw.mock.calls[0]?.[0] as string;
    expect(sql).toContain('similarity(s.title, q.raw)');
    expect(sql).toContain("similarity(coalesce(s.subtitle, ''), q.raw)");
    expect(sql).toContain('* 0.4');
  });
});
