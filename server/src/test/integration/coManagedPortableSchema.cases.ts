/** CM L7b3 portable catalogs against the migrated database: every projected column exists, so no export fails with 42703. */
import { describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { catalogColumnsToCheck } from '../helpers/coManagedPortableCatalogColumns';

export function defineSchemaCases(get: () => { db: Knex }) {
  describe('portable catalogs against the migrated schema (information_schema)', () => {
    it('every catalog column exists on the table or view the export reads', async () => {
      const { db } = get();
      const rows = await db('information_schema.columns').where({ table_schema: 'public' }).select('table_name', 'column_name') as { table_name: string; column_name: string }[];
      const have = new Set(rows.map(r => `${r.table_name}.${r.column_name}`));
      // Checked against the relation the export selects from (external_files after its rename; the handoffs table for handoff_history).
      const missing = catalogColumnsToCheck().filter(c => !have.has(`${c.queried}.${c.column}`)).map(c => `${c.catalog}.${c.table}.${c.column}`);
      expect(missing).toEqual([]);
    });
  });
}
