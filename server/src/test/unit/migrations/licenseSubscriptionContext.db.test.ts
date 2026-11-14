import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const cases = [
  {
    name: 'subscription context',
    migration: require('../../../../migrations/20261107120000_license_state_subscription_context.cjs'),
    values: {
      subscription_state: 'cancel_scheduled',
      subscription_cancels_at: new Date('2026-12-01T00:00:00Z'),
      subscription_resubscribe_url: 'https://license.example/resubscribe',
      subscription_context_updated_at: new Date('2026-11-07T00:00:00Z'),
    },
  },
  {
    name: 'payment failure context',
    migration: require('../../../../migrations/20261107120100_license_state_payment_failure.cjs'),
    values: {
      subscription_next_retry_at: new Date('2026-12-01T00:00:00Z'),
      subscription_update_payment_url: 'https://license.example/payment',
      subscription_end_reason: 'payment_failed',
    },
  },
];
const schema = `license_subscription_${randomUUID().replaceAll('-', '')}`;
let db: Knex;

beforeAll(async () => {
  if (!process.env.DB_USER_ADMIN || !process.env.DB_PASSWORD_ADMIN) {
    throw new Error('License migration tests require isolated workspace DB credentials');
  }
  db = knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER_ADMIN,
      password: process.env.DB_PASSWORD_ADMIN,
      database: process.env.TEST_DB_NAME || 'test_database',
    },
    searchPath: [schema], pool: { min: 0, max: 1 },
  });
  await db.raw('CREATE SCHEMA ??', [schema]);
});

afterAll(async () => {
  if (db) {
    try { await db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema]); }
    finally { await db.destroy(); }
  }
});

describe.each(cases)('$name migration', ({ migration, values }) => {
  it('preserves the license and saved context on retries, and supports repeated rollback and reapplication', async () => {
    await db.schema.createTable('license_state', table => {
      table.integer('id').primary();
      table.text('license_token');
      table.text('unrelated_context');
    });
    const original = { id: 1, license_token: 'held-token', unrelated_context: 'keep' };
    try {
      await db('license_state').insert(original);
      await migration.up(db);
      const empty = Object.fromEntries(Object.keys(values).map(column => [column, null]));
      expect(await db('license_state').first()).toEqual({ ...original, ...empty });
      await db('license_state').update(values);
      await migration.up(db);
      expect(await db('license_state').first()).toEqual({ ...original, ...values });
      await migration.down(db);
      await migration.down(db);
      expect(await db('license_state').first()).toEqual(original);
      await migration.up(db);
      expect(await db('license_state').first()).toEqual({ ...original, ...empty });
    } finally {
      await db.schema.dropTable('license_state');
    }
  });

  it('completes a partially applied schema without overwriting existing context', async () => {
    const [column, value] = Object.entries(values)[0];
    await db.schema.createTable('license_state', table => {
      table.integer('id').primary();
      if (value instanceof Date) table.timestamp(column, { useTz: true });
      else table.text(column);
    });
    try {
      await db('license_state').insert({ id: 1, [column]: value });
      await migration.up(db);
      const expected = Object.fromEntries(Object.keys(values).map(name => [name, name === column ? value : null]));
      expect(await db('license_state').first()).toEqual({ id: 1, ...expected });
    } finally {
      await db.schema.dropTable('license_state');
    }
  });
});
