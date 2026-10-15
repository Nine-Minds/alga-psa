import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';

const migration: { up(db: Knex.Transaction): Promise<void>; down(db: Knex.Transaction): Promise<void> } = createRequire(import.meta.url)(
  fileURLToPath(new URL('../../../../migrations/20260906123000_add_usage_comments.cjs', import.meta.url)),
);
const schema = `usage_comments_${randomUUID().replaceAll('-', '')}`;
let db: Knex;

beforeAll(async () => {
  if (!process.env.DB_USER_ADMIN || !process.env.DB_PASSWORD_ADMIN) {
    throw new Error('Usage comments migration test requires the isolated workspace DB credentials');
  }
  db = knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN,
      database: process.env.TEST_DB_NAME || 'test_database',
    },
    searchPath: [schema, 'public'], pool: { min: 0, max: 1 },
  });
  await db.raw('CREATE SCHEMA ??', [schema]);
});

afterAll(async () => {
  if (db) {
    try { await db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema]); }
    finally { await db.destroy(); }
  }
});

it('preserves legacy usage rows through the comments upgrade, rollback and reapplication', async () => {
  // A minimal pre-upgrade table makes preservation independent of current seeds.
  // The identical migration also runs against tenant shards when Citus is installed.
  await db.schema.createTable('usage_tracking', table => {
    table.uuid('tenant').notNullable(); table.uuid('usage_id').notNullable();
    table.decimal('quantity').notNullable(); table.primary(['tenant', 'usage_id']);
  });
  const legacy = { tenant: randomUUID(), usage_id: randomUUID(), quantity: '4.00' };
  await db('usage_tracking').insert(legacy);
  const { rows } = await db.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='citus') AS installed");
  if (rows[0].installed) await db.raw("SELECT create_distributed_table(?, 'tenant')", [`${schema}.usage_tracking`]);
  await db.transaction(trx => migration.up(trx));
  expect(await db('usage_tracking').first()).toEqual({ ...legacy, comments: null });
  await db('usage_tracking').where({ tenant: legacy.tenant, usage_id: legacy.usage_id }).update({ comments: 'Client approved these endpoints' });
  expect((await db('usage_tracking').first()).comments).toBe('Client approved these endpoints');
  await db.transaction(trx => migration.down(trx));
  expect(await db('usage_tracking').first()).toEqual(legacy);
  await db.transaction(trx => migration.up(trx));
  expect(await db('usage_tracking').first()).toEqual({ ...legacy, comments: null });
});
