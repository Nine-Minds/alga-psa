import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const migration = require(
  path.join(
    repoRoot,
    'server/migrations/20260803044749_allow_microsoft_tenant_email_provider.cjs'
  )
) as {
  up: (knex: Knex | Knex.Transaction) => Promise<void>;
  down: (knex: Knex | Knex.Transaction) => Promise<void>;
};

describe('Microsoft outbound email provider migration', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({
      databaseName: 'microsoft_outbound_email_migration_test',
      runSeeds: true,
    });
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('widens the original provider constraint and persists Microsoft settings', async () => {
    const trx = await db.transaction();
    try {
      const seededTenant = await trx('tenants').first('tenant');
      expect(seededTenant).toBeDefined();
      if (!seededTenant) {
        throw new Error('Expected a seeded tenant');
      }

      const [settings] = await trx('tenant_email_settings')
        .insert({
          tenant: seededTenant.tenant,
          email_provider: 'smtp',
        })
        .returning(['id', 'tenant', 'email_provider']);

      await migration.down(trx);

      await expect(
        trx.transaction(async (savepoint) => {
          await savepoint('tenant_email_settings')
            .where({ id: settings.id, tenant: settings.tenant })
            .update({ email_provider: 'microsoft' });
        })
      ).rejects.toMatchObject({ code: '23514' });

      await migration.up(trx);

      const updated = await trx('tenant_email_settings')
        .where({ id: settings.id, tenant: settings.tenant })
        .update({ email_provider: 'microsoft' });
      expect(updated).toBe(1);

      const persisted = await trx('tenant_email_settings')
        .where({ id: settings.id, tenant: settings.tenant })
        .first('email_provider');
      expect(persisted?.email_provider).toBe('microsoft');
    } finally {
      await trx.rollback();
    }
  });
});
