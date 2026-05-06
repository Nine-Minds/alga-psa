import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);

describe('tenant product_code migration (integration)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = await createTestDbConnection();
  });

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  it('T001: product_code defaults to psa, allows algadesk, and rejects invalid values', async () => {
    const migration = require('../../../../migrations/20260505140000_add_tenant_product_code.cjs');

    const trx = await knex.transaction();
    let failure: unknown = null;

    try {
      await migration.down(trx);
      await migration.up(trx);

      await expect(trx.schema.hasColumn('tenants', 'product_code')).resolves.toBe(true);

      const column = await trx('information_schema.columns')
        .where({
          table_schema: 'public',
          table_name: 'tenants',
          column_name: 'product_code',
        })
        .select<{ is_nullable: string; column_default: string | null; data_type: string }[]>(
          'is_nullable',
          'column_default',
          'data_type',
        )
        .first();

      expect(column?.is_nullable).toBe('NO');
      expect(column?.data_type).toBe('text');
      expect(column?.column_default).toContain("'psa'");

      const anyTenant = await trx('tenants').select('tenant').first();
      expect(anyTenant?.tenant).toBeTruthy();

      await trx('tenants')
        .where({ tenant: anyTenant.tenant })
        .update({ product_code: 'algadesk' });

      const updated = await trx('tenants')
        .where({ tenant: anyTenant.tenant })
        .select('product_code')
        .first();
      expect(updated?.product_code).toBe('algadesk');

      await expect(
        trx('tenants')
          .where({ tenant: anyTenant.tenant })
          .update({ product_code: 'invalid_product' }),
      ).rejects.toThrow();
    } catch (error) {
      failure = error;
    } finally {
      await trx.rollback();
    }

    if (failure) {
      throw failure;
    }
  });
});
