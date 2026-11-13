import { afterEach, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import { queryCatalogPickerItems } from '@alga-psa/inventory/lib/materials';

afterEach(() => vi.restoreAllMocks());

describe('ticket catalog category queries', () => {
  it('applies category, tenant, kind and billing filters to both count and paged results', async () => {
    const knex = knexFactory({ client: 'pg' });
    const queries: Array<{ sql: string; bindings: unknown[] }> = [];
    vi.spyOn(knex.client, 'acquireConnection').mockResolvedValue({});
    vi.spyOn(knex.client, 'releaseConnection').mockResolvedValue(undefined);
    vi.spyOn(knex.client, '_query').mockImplementation(async (_connection, query) => {
      queries.push({ sql: query.sql, bindings: query.bindings });
      query.response = { command: 'SELECT', rows: query.sql.includes('count(') ? [{ count: '0' }] : [] };
      return query;
    });
    try {
      await queryCatalogPickerItems(knex as Knex.Transaction, 'tenant-a', {
        category_id: 'category-a', item_kinds: ['service'], billing_methods: ['fixed'],
        is_active: true, search: 'license', page: 2, limit: 10,
      });
      expect(queries).toHaveLength(2);
      for (const query of queries) {
        expect(query.sql).toMatch(/"sc"\."tenant" = \$\d+/);
        expect(query.sql).toMatch(/"sc"\."category_id" = \$\d+/);
        expect(query.sql).toMatch(/"sc"\."item_kind" in \(\$\d+\)/);
        expect(query.sql).toMatch(/"sc"\."billing_method" in \(\$\d+\)/);
        expect(query.bindings).toEqual(expect.arrayContaining(['tenant-a', 'category-a', 'service', 'fixed', '%license%']));
      }
      expect(queries[1].sql).toMatch(/limit \$\d+ offset \$\d+/);
      expect(queries[1].bindings.slice(-2)).toEqual([10, 10]);
    } finally {
      await knex.destroy();
    }
  });
});
