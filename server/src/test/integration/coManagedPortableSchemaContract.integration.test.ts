import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { catalogColumnsToCheck } from '../helpers/coManagedPortableCatalogColumns';

/**
 * Exact counterpart of the migration-text check in unit/product/coManagedPortableSchemaContract.test.ts: every column
 * a portable catalog projects must exist in the migrated database, or the export fails at runtime with Postgres 42703.
 */
describe('portable catalogs against a migrated database (information_schema)', () => {
  let knex: Knex;

  // A cold createTestDbConnection runs every migration before resolving.
  beforeAll(async () => { knex = await createTestDbConnection(); }, 900_000);
  afterAll(async () => { await knex?.destroy(); });

  it('every catalog column exists', async () => {
    const rows = await knex('information_schema.columns').where({ table_schema: 'public' })
      .select<{ table_name: string; column_name: string }[]>('table_name', 'column_name');
    const have = new Set(rows.map(r => `${r.table_name}.${r.column_name}`));
    expect(have.size).toBeGreaterThan(1000);
    const missing = catalogColumnsToCheck().filter(c => !have.has(`${c.physical}.${c.column}`)).map(c => `${c.catalog}.${c.table}.${c.column}`);
    expect(missing).toEqual([]);
  });
});
