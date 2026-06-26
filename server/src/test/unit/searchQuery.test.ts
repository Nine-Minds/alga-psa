import knexFactory, { type Knex } from 'knex';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decodeSearchCursor,
  encodeSearchCursor,
  parseQuery,
  runSearchQuery,
  sanitizeHeadline,
  SearchQueryError,
} from '@alga-psa/search/query';

type SearchTestKnex = Knex & { raw: ReturnType<typeof vi.fn> };

const createdKnex: Knex[] = [];

function createSearchKnex(
  rawImplementation: (...args: any[]) => any = async () => ({ rows: [] }),
): SearchTestKnex {
  const knex = knexFactory({ client: 'pg' }) as SearchTestKnex;
  Object.defineProperty(knex, 'raw', {
    value: vi.fn(rawImplementation),
    configurable: true,
  });
  createdKnex.push(knex);
  return knex;
}

afterEach(async () => {
  await Promise.all(createdKnex.splice(0).map((knex) => knex.destroy()));
});

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
      prefixTsquery: 'acme:* & corp:*',
    });

    expect(parseQuery('  TIC-1023  ')).toEqual({
      raw: 'TIC-1023',
      normalized: 'tic-1023',
      isIdentifierLike: true,
      identifier: 'tic-1023',
      prefixTsquery: 'tic:* & 1023:*',
    });
  });

  it('T091 builds the FTS branch with websearch_to_tsquery and search_vector match', async () => {
    const knex = createSearchKnex();

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
    const knex = createSearchKnex();

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

  it('T138 orders recent results by source_updated_at only, ignoring relevance score ordering', async () => {
    const knex = createSearchKnex();

    await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'acme',
      allowedTypes: ['client'],
      sort: 'recent',
    });

    const sql = knex.raw.mock.calls[0]?.[0] as string;
    const orderByClause = sql.slice(sql.indexOf('ORDER BY'), sql.indexOf('LIMIT ?'));
    expect(orderByClause).toContain('ORDER BY source_updated_at DESC, object_id ASC');
    expect(orderByClause).not.toContain('score DESC');
  });

  it('T093 returns rows from the pg_trgm fallback branch', async () => {
    const knex = createSearchKnex(async (sql: string) => {
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
      });

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

  it('T169 ranks Exchange as the top result for the misspelled query exhcange', async () => {
    const knex = createSearchKnex(async (sql: string) => {
        expect(sql).toContain('s.title % q.raw');
        return {
          rows: [
            {
              object_type: 'client',
              object_id: 'client-exchange',
              parent_type: null,
              parent_id: null,
              title: 'Exchange',
              subtitle: null,
              url: '/msp/clients/client-exchange',
              score: 0.44,
              source_updated_at: '2026-05-13T12:00:00.000Z',
              metadata: {},
              snippet: null,
            },
            {
              object_type: 'client',
              object_id: 'client-other',
              parent_type: null,
              parent_id: null,
              title: 'Exhaust Support',
              subtitle: null,
              url: '/msp/clients/client-other',
              score: 0.08,
              source_updated_at: '2026-05-13T11:00:00.000Z',
              metadata: {},
              snippet: null,
            },
          ],
        };
      });

    const results = await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'exhcange',
      allowedTypes: ['client'],
    });

    expect(results[0]).toMatchObject({
      type: 'client',
      id: 'client-exchange',
      title: 'Exchange',
    });
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('T094 includes pg_trgm similarity in the composite score', async () => {
    const knex = createSearchKnex();

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

  it('T095 pins an exact ticket identifier match at the top', async () => {
    const knex = createSearchKnex(async () => ({
        rows: [{
          object_type: 'ticket',
          object_id: 'ticket-1023',
          parent_type: null,
          parent_id: null,
          title: 'Cannot access VPN',
          subtitle: 'ACME Corp | TIC-1023',
          url: '/msp/tickets/ticket-1023',
          score: 1000,
          source_updated_at: '2026-05-13T12:00:00.000Z',
          metadata: { identifier: 'TIC-1023' },
          snippet: null,
        }],
      }));

    const results = await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'TIC-1023',
      allowedTypes: ['ticket'],
    });

    const [sql, bindings] = knex.raw.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("lower(coalesce(s.metadata->>'identifier', '')) = q.identifier");
    expect(sql).toContain('THEN 1000');
    expect(bindings[4]).toBe('tic-1023');
    expect(results[0]).toMatchObject({
      type: 'ticket',
      id: 'ticket-1023',
      score: 1000,
    });
  });

  it('T096 pins an exact asset-tag style identifier match', async () => {
    const knex = createSearchKnex(async () => ({
        rows: [{
          object_type: 'asset',
          object_id: 'asset-42',
          parent_type: null,
          parent_id: null,
          title: 'Lenovo Laptop',
          subtitle: 'LAP-0042',
          url: '/msp/assets/asset-42',
          score: 1000,
          source_updated_at: '2026-05-13T12:00:00.000Z',
          metadata: { identifier: 'LAP-0042' },
          snippet: null,
        }],
      }));

    const results = await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'LAP-0042',
      allowedTypes: ['asset'],
    });

    const [sql, bindings] = knex.raw.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("lower(coalesce(s.metadata->>'identifier', '')) = q.identifier");
    expect(bindings[4]).toBe('lap-0042');
    expect(results[0]).toMatchObject({
      type: 'asset',
      id: 'asset-42',
      title: 'Lenovo Laptop',
      score: 1000,
    });
  });

  it('T186 ranks an exact identifier row first when the query also has free text', async () => {
    const knex = createSearchKnex(async () => ({
        rows: [
          {
            object_type: 'ticket',
            object_id: 'ticket-1023',
            parent_type: null,
            parent_id: null,
            title: 'VPN access issue',
            subtitle: 'ACME Corp | TIC-1023',
            url: '/msp/tickets/ticket-1023',
            score: 1000,
            source_updated_at: '2026-05-13T12:00:00.000Z',
            metadata: { identifier: 'TIC-1023' },
            snippet: null,
          },
          {
            object_type: 'ticket',
            object_id: 'ticket-free-text',
            parent_type: null,
            parent_id: null,
            title: 'VPN troubleshooting',
            subtitle: null,
            url: '/msp/tickets/ticket-free-text',
            score: 0.5,
            source_updated_at: '2026-05-13T12:00:00.000Z',
            metadata: {},
            snippet: null,
          },
        ],
      }));

    const results = await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'TIC-1023 vpn',
      allowedTypes: ['ticket'],
    });

    const [sql, bindings] = knex.raw.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("lower(coalesce(s.metadata->>'identifier', '')) = q.identifier");
    expect(bindings[4]).toBe('tic-1023');
    expect(results[0]).toMatchObject({
      type: 'ticket',
      id: 'ticket-1023',
      score: 1000,
    });
    expect(results[1]).toMatchObject({ id: 'ticket-free-text' });
  });

  it('T163 matches both full and shortened ticket identifiers through metadata identifier branches', async () => {
    const knex = createSearchKnex(async () => ({
        rows: [{
          object_type: 'ticket',
          object_id: 'ticket-1023',
          parent_type: null,
          parent_id: null,
          title: 'Cannot access VPN',
          subtitle: 'ACME Corp | TIC-1023',
          url: '/msp/tickets/ticket-1023',
          score: 900,
          source_updated_at: '2026-05-13T12:00:00.000Z',
          metadata: { identifier: 'TIC-1023' },
          snippet: null,
        }],
      }));

    const results = await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'tic-10',
      allowedTypes: ['ticket'],
    });

    const [sql, bindings] = knex.raw.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("lower(coalesce(s.metadata->>'identifier', '')) = q.identifier");
    expect(sql).toContain("lower(coalesce(s.metadata->>'identifier', '')) LIKE q.identifier || '%'");
    expect(sql).toContain('THEN 1000');
    expect(sql).toContain('THEN 900');
    expect(bindings[4]).toBe('tic-10');
    expect(results[0]).toMatchObject({
      type: 'ticket',
      id: 'ticket-1023',
      score: 900,
    });
  });

  it('T097 applies time decay so newer equivalent rows rank higher', async () => {
    const knex = createSearchKnex();

    await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'acme',
      allowedTypes: ['client'],
    });

    const sql = knex.raw.mock.calls[0]?.[0] as string;
    expect(sql).toContain('exp(-EXTRACT(epoch FROM (now() - s.source_updated_at)) / (90 * 86400))');
    expect(sql).toContain('ORDER BY score DESC, source_updated_at DESC, object_id ASC');
  });

  it('T098 floors the time decay multiplier at 0.05', async () => {
    const knex = createSearchKnex();

    await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'acme',
      allowedTypes: ['client'],
    });

    const sql = knex.raw.mock.calls[0]?.[0] as string;
    expect(sql).toContain('GREATEST(');
    expect(sql).toContain('0.05');
  });

  it('T099 cursor encoding round-trips score, updatedAt, and object id', () => {
    const updatedAt = new Date('2026-05-13T12:34:56.789Z');
    const cursor = encodeSearchCursor({
      score: 12.5,
      updatedAt,
      id: 'client-1',
    });

    expect(decodeSearchCursor(cursor)).toEqual({
      score: 12.5,
      updatedAt: updatedAt.toISOString(),
      objectId: 'client-1',
    });
  });

  it('T100 uses strict cursor predicates so page two does not repeat page one rows', async () => {
    const knex = createSearchKnex();
    const updatedAt = new Date('2026-05-13T12:34:56.789Z');
    const cursor = encodeSearchCursor({
      score: 3.14,
      updatedAt,
      id: 'client-1',
    });

    await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'acme',
      allowedTypes: ['client'],
      cursor,
      offset: 100,
    });

    const [sql, bindings] = knex.raw.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('score < ?::double precision');
    expect(sql).toContain('source_updated_at < ?::timestamptz');
    expect(sql).toContain('object_id > ?');
    expect(bindings.slice(7, 14)).toEqual([
      3.14,
      3.14,
      3.14,
      updatedAt.toISOString(),
      3.14,
      updatedAt.toISOString(),
      'client-1',
    ]);
    expect(bindings.at(-1)).toBe(0);
  });

  it('T101 configures ts_headline with controlled sentinel tokens', async () => {
    const knex = createSearchKnex();

    await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'acme',
      allowedTypes: ['client'],
      includeSnippets: true,
    });

    const sql = knex.raw.mock.calls[0]?.[0] as string;
    expect(sql).toContain('ts_headline(');
    expect(sql).toContain('StartSel=__SEARCH_MARK_START__');
    expect(sql).toContain('StopSel=__SEARCH_MARK_STOP__');
  });

  it('T104 omits ts_headline from typeahead SQL when snippets are disabled', async () => {
    const knex = createSearchKnex();

    await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-0000-0000-000000000001',
      query: 'acme',
      allowedTypes: ['client'],
      includeSnippets: false,
    });

    const sql = knex.raw.mock.calls[0]?.[0] as string;
    expect(sql).toContain('NULL AS snippet');
    expect(sql).not.toContain('ts_headline');
  });

  it('T102 rebuilds snippets with only mark tags and escapes source HTML', () => {
    const sanitized = sanitizeHeadline(
      '<script>alert(1)</script> __SEARCH_MARK_START__ACME__SEARCH_MARK_STOP__ <b>bold</b>',
    );

    expect(sanitized).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt; <mark>ACME</mark> &lt;b&gt;bold&lt;/b&gt;',
    );
    expect(sanitized).not.toContain('<script>');
    expect(sanitized).not.toContain('<b>');
  });

  it('T103 escapes the whole snippet when sentinels are malformed', () => {
    expect(sanitizeHeadline('__SEARCH_MARK_START__<script>alert(1)</script>')).toBe(
      '__SEARCH_MARK_START__&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(sanitizeHeadline('__SEARCH_MARK_STOP__<em>bad</em>')).toBe(
      '__SEARCH_MARK_STOP__&lt;em&gt;bad&lt;/em&gt;',
    );
  });

  it('T174 keeps generated multi-tenant query load tenant-scoped with zero leaks', async () => {
    const tenants = Array.from({ length: 50 }, (_, index) => (
      `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
    ));
    const leakedRows: string[] = [];
    const knex = createSearchKnex(async (sql: string, bindings: unknown[]) => {
        expect(sql).toContain('from "app_search_index" where "app_search_index"."tenant" = ?');
        expect(sql).not.toContain('WHERE s.tenant = ?::uuid');
        const tenant = bindings[5] as string;
        if (!tenants.includes(tenant)) {
          leakedRows.push(`unknown:${tenant}`);
        }
        return {
          rows: [{
            object_type: 'client',
            object_id: `${tenant}:client`,
            parent_type: null,
            parent_id: null,
            title: `Client ${tenant}`,
            subtitle: null,
            url: `/msp/clients/${tenant}:client`,
            score: 1,
            source_updated_at: '2026-05-13T12:00:00.000Z',
            metadata: { tenant },
            snippet: null,
          }],
        };
      });

    for (let index = 0; index < 500; index += 1) {
      const tenant = tenants[index % tenants.length]!;
      const [result] = await runSearchQuery({
        knex: knex as never,
        tenant,
        query: `acme ${index}`,
        allowedTypes: ['client'],
        limit: 1,
      });

      if (!result?.id.startsWith(`${tenant}:`)) {
        leakedRows.push(`${tenant}->${result?.id ?? 'missing'}`);
      }
    }

    expect(knex.raw).toHaveBeenCalledTimes(500);
    expect(leakedRows).toEqual([]);
  });

  it('T180 always emits a tenant predicate and tenant binding in search SQL', async () => {
    const knex = createSearchKnex();

    await runSearchQuery({
      knex: knex as never,
      tenant: '00000000-0000-4000-8000-000000000123',
      query: 'acme',
      allowedTypes: ['client', 'ticket'],
      limit: 25,
    });

    const [sql, bindings] = knex.raw.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('from "app_search_index" where "app_search_index"."tenant" = ?');
    expect(sql).not.toContain('WHERE s.tenant = ?::uuid');
    expect(bindings[5]).toBe('00000000-0000-4000-8000-000000000123');
  });
});
