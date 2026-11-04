import { randomBytes } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDbConnection, dropCalendarDeliveryTestDatabase } from '../../../test-utils/dbConfig';

/**
 * Calendar suites connect with `recreate: false` to reuse the database an
 * earlier file bootstrapped. Sharding can make such a file the first one to run
 * on a fresh Postgres, where nothing has created the database or the app role:
 * the reuse path then failed every test with `password authentication failed
 * for user "app_user"`. Reuse must bootstrap what is absent and keep what is
 * present.
 */
describe('createTestDbConnection({ recreate: false })', () => {
  // The calendar scratch boundary is what dropCalendarDeliveryTestDatabase may drop.
  const databaseName = `calendar_delivery_test_${randomBytes(6).toString('hex')}`;
  let db: Knex | undefined;

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
    await dropCalendarDeliveryTestDatabase(databaseName);
  });

  it('bootstraps a database nothing has created yet, then reuses it without wiping it', async () => {
    db = await createTestDbConnection({ databaseName, recreate: false });
    const { rows } = await db.raw('SELECT current_user AS role');
    expect(rows[0].role).toBe(process.env.DB_USER_SERVER || 'app_user');
    expect(await db.schema.hasTable('tenants')).toBe(true);

    await db.schema.createTable('reuse_marker', (table) => table.integer('id'));
    await db('reuse_marker').insert({ id: 1 });
    await db.destroy();

    db = await createTestDbConnection({ databaseName, recreate: false });
    expect(await db('reuse_marker').select('id')).toEqual([{ id: 1 }]);
  }, 600_000);
});
