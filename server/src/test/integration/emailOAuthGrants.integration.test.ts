import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createTenant } from '../../../test-utils/testDataFactory';
import { getSecret } from '../../lib/utils/getSecret';

wireLocalTestDbEnv();
const describeDb = await describeWithDb();
const databaseName = `email_oauth_grants_test_${randomUUID().replaceAll('-', '')}`;
let db: Knex;

describeDb('email OAuth grant persistence (database)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName, runSeeds: false });
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
    const admin = knex({ client: 'pg', connection: {
      host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123'), database: 'postgres',
    }, pool: { min: 0, max: 1 } });
    try { await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]); }
    finally { await admin.destroy(); }
  });

  it('runs the migration retry-safely and lets the application role consume a grant only once', async () => {
    // createTestDbConnection bootstraps the isolated database with all migrations
    // and returns a connection authenticated as DB_USER_SERVER. Re-running this
    // migration verifies the retry path, including ensureTenantDistribution.
    const migration = await import('../../../migrations/20261101090000_create_email_oauth_grants.cjs');
    await migration.up(db);

    const tenant = await createTenant(db, 'OAuth grant persistence fixture');
    const id = randomUUID();
    const providerId = randomUUID();
    const userId = randomUUID();
    await db('email_oauth_grants').insert({
      tenant, id, provider_id: providerId, initiated_by_user_id: userId,
      purpose: 'reconnect', redirect_uri: 'https://psa.example.test/callback',
      created_at: db.fn.now(), expires_at: new Date(Date.now() + 60_000), consumed_at: null,
    });

    const consume = () => db('email_oauth_grants')
      .where({ tenant, id })
      .whereNull('consumed_at')
      .where('expires_at', '>', db.fn.now())
      .update({ consumed_at: db.fn.now() })
      .returning('id');
    const outcomes = await Promise.all([consume(), consume()]);
    expect(outcomes.reduce((count, rows) => count + rows.length, 0)).toBe(1);
    expect(await db('email_oauth_grants').where({ tenant, id }).first('consumed_at'))
      .toMatchObject({ consumed_at: expect.any(Date) });
  }, 30_000);
});
