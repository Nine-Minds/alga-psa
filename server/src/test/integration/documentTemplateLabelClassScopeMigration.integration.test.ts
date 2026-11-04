/**
 * alga-2026-0002683 C2 - T-migration: document_template_assignments gains the `label_class` scope.
 * Real DB; run inside a rolled-back transaction. Also the closest available check of the Citus
 * constraints we can run locally (unique index leads with `tenant`); a real Citus cluster (R2) is separate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20261023100000_document_template_assignments_label_class_scope.cjs') as {
  up: (knex: Knex | Knex.Transaction) => Promise<void>;
  down: (knex: Knex | Knex.Transaction) => Promise<void>;
};

const T = 'document_template_assignments';

describe('document_template_assignments label_class scope migration (integration)', () => {
  let knex: Knex;
  beforeAll(async () => {
    knex = await createTestDbConnection({ runSeeds: true });
  }, 180_000);
  afterAll(async () => {
    await knex?.destroy();
  });

  it('adds the scope, keeps one default per class, leaves other assignments untouched, and reverses', async () => {
    const trx = await knex.transaction();
    try {
      const tenant = (await trx('tenants').select('tenant').first())?.tenant as string;
      if (!tenant) throw new Error('Expected a seeded tenant');

      await migration.down(trx);
      await migration.up(trx); // idempotent from a clean state

      const base = { tenant, document_type: 'work-tag', template_source: 'standard' };
      await trx(T).insert({ ...base, scope_type: 'tenant', scope_id: null, standard_template_code: 'standard-ticket-work-tag' });
      const salesBefore = await trx(T).where({ tenant, document_type: 'sales-order' }).count<{ count: string }[]>('* as count').first();

      // label_class needs scope_key and no scope_id
      await expect(trx.raw('SAVEPOINT s1').then(() =>
        trx(T).insert({ ...base, scope_type: 'label_class', scope_id: null, scope_key: null, standard_template_code: 'standard-asset-label' })
      )).rejects.toThrow();
      await trx.raw('ROLLBACK TO SAVEPOINT s1');

      await trx(T).insert({ ...base, scope_type: 'label_class', scope_id: null, scope_key: 'asset-identity', standard_template_code: 'standard-asset-label' });
      await trx(T).insert({ ...base, scope_type: 'label_class', scope_id: null, scope_key: 'ticket-work-tag', standard_template_code: 'standard-ticket-work-tag' });

      // one default per class
      await trx.raw('SAVEPOINT s2');
      await expect(
        trx(T).insert({ ...base, scope_type: 'label_class', scope_id: null, scope_key: 'asset-identity', standard_template_code: 'standard-asset-label-code128' })
      ).rejects.toThrow();
      await trx.raw('ROLLBACK TO SAVEPOINT s2');

      const salesAfter = await trx(T).where({ tenant, document_type: 'sales-order' }).count<{ count: string }[]>('* as count').first();
      expect(salesAfter).toEqual(salesBefore);

      // down removes only label_class rows; the tenant row survives; the column is gone
      await migration.down(trx);
      expect(await trx.schema.hasColumn(T, 'scope_key')).toBe(false);
      const left = await trx(T).where({ tenant, document_type: 'work-tag' }).select('scope_type');
      expect(left.map((r) => r.scope_type)).toEqual(['tenant']);
      await migration.up(trx);
      expect(await trx.schema.hasColumn(T, 'scope_key')).toBe(true);
    } finally {
      await trx.rollback();
    }
  }, 180_000);
});
