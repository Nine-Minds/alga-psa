import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20260714200000_enforce_client_type_enum.cjs') as {
  up: (knex: Knex | Knex.Transaction) => Promise<void>;
  down: (knex: Knex | Knex.Transaction) => Promise<void>;
};

describe('client type enum migration (integration)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = await createTestDbConnection({ runSeeds: true });
  });

  afterAll(async () => {
    await knex?.destroy();
  });

  it('normalizes legacy rows and enforces the default, NOT NULL, and enum constraint idempotently', async () => {
    const trx = await knex.transaction();
    let testError: unknown;

    try {
      await migration.down(trx);

      const tenantRow = await trx('tenants').select('tenant').first();
      if (!tenantRow?.tenant) {
        throw new Error('Expected the integration database to contain a seeded tenant');
      }

      const fixtureRows = [
        { client_type: 'Company', expected: 'company' },
        { client_type: null, expected: 'company' },
        { client_type: 'individual', expected: 'individual' },
        { client_type: 'Vendor', expected: 'company' },
      ];
      const fixtureIds = fixtureRows.map(() => uuidv4());

      await trx('clients').insert(fixtureRows.map((fixture, index) => ({
        tenant: tenantRow.tenant,
        client_id: fixtureIds[index],
        client_name: `Client type migration fixture ${fixtureIds[index]}`,
        client_type: fixture.client_type,
      })));

      await migration.up(trx);
      await migration.up(trx);

      const normalizedRows = await trx('clients')
        .where({ tenant: tenantRow.tenant })
        .whereIn('client_id', fixtureIds)
        .select('client_id', 'client_type');
      const typeById = new Map(normalizedRows.map((row) => [row.client_id, row.client_type]));

      fixtureRows.forEach((fixture, index) => {
        expect(typeById.get(fixtureIds[index])).toBe(fixture.expected);
      });

      const column = await trx('information_schema.columns')
        .where({
          table_schema: 'public',
          table_name: 'clients',
          column_name: 'client_type',
        })
        .select('is_nullable', 'column_default')
        .first();
      expect(column?.is_nullable).toBe('NO');
      expect(column?.column_default).toContain('company');

      const defaultedClientId = uuidv4();
      const [defaultedClient] = await trx('clients')
        .insert({
          tenant: tenantRow.tenant,
          client_id: defaultedClientId,
          client_name: `Defaulted client type fixture ${defaultedClientId}`,
        })
        .returning(['client_type']);
      expect(defaultedClient.client_type).toBe('company');

      let invalidInsertError: unknown;
      try {
        await trx.transaction(async (savepoint) => {
          const invalidClientId = uuidv4();
          await savepoint('clients').insert({
            tenant: tenantRow.tenant,
            client_id: invalidClientId,
            client_name: `Invalid client type fixture ${invalidClientId}`,
            client_type: 'Bogus',
          });
        });
      } catch (error) {
        invalidInsertError = error;
      }
      expect(invalidInsertError).toMatchObject({ code: '23514' });
    } catch (error) {
      testError = error;
    } finally {
      await trx.rollback();
    }

    if (testError) {
      throw testError;
    }
  });
});
