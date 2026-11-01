import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { withMigratedSchemaContract } from '../utils/schemaContract';

describe('REST query contracts against the migrated schema', () => {
  let db: Knex;
  let tenant: string;

  beforeAll(async () => {
    db = await createTestDbConnection({ recreate: false });
    const row = await db('tenants').first<{ tenant: string }>('tenant');
    if (!row) throw new Error('The integration database has no tenant fixture');
    tenant = row.tenant;
  }, 300_000);

  afterAll(async () => { await db?.destroy(); });

  it('executes the board update and both category tree scopes inside rollback transactions', async () => {
    await withMigratedSchemaContract(db, 'board update', async (trx) => {
      await trx('boards').where({ tenant }).update({
        board_name: trx.ref('board_name'),
        default_assigned_team_id: null,
      });
      await trx('boards').where({ tenant }).select('*').limit(1);
    });

    await withMigratedSchemaContract(db, 'unscoped category tree', async (trx) => {
      await trx('categories').where({ tenant }).whereNull('board_id').select('*').orderBy('category_name');
    });

    await withMigratedSchemaContract(db, 'board category tree', async (trx) => {
      await trx('categories').where({ tenant, board_id: randomUUID() }).select('*').orderBy('category_name');
    });
  });

  it('reports the missing relation column from an actual PostgreSQL 42703', async () => {
    await expect(withMigratedSchemaContract(db, 'deliberate mismatch', async (trx) => {
      await trx('boards').select('schema_contract_missing_column').where({ tenant }).limit(1);
    })).rejects.toThrow(/deliberate mismatch.*schema_contract_missing_column/);
  });
});
