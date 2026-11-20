import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { knex, type Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const migration = createRequire(import.meta.url)(
  '../../../ee/server/migrations/20261120120000_add_stripe_catalog_account_settings.cjs'
) as { up: (db: Knex) => Promise<void> };

const database = `stripe_account_test_${randomUUID().replaceAll('-', '')}`;
const operations = 'co_managed_purchase_operations';
let admin: Knex;
let db: Knex;

beforeAll(async () => {
  wireLocalTestDbEnv();
  const connection = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: process.env.DB_PASSWORD_ADMIN || 'postpass123',
  };
  admin = knex({ client: 'pg', connection: { ...connection, database: 'postgres' } });
  await admin.raw('CREATE DATABASE ??', [database]);
  db = knex({ client: 'pg', connection: { ...connection, database } });

  await db.raw(`
    CREATE TABLE co_managed_purchase_operations (
      tenant uuid NOT NULL, operation_id uuid NOT NULL, offer_version_id uuid, price_id text,
      stripe_account text, livemode boolean, PRIMARY KEY (tenant, operation_id)
    );
    CREATE TABLE stripe_offer_versions (
      version_id uuid PRIMARY KEY, price_id text NOT NULL, stripe_account text NOT NULL,
      livemode boolean NOT NULL, offer_key text NOT NULL, billing_interval text NOT NULL,
      UNIQUE (stripe_account, livemode, price_id)
    );
  `);
  if (process.env.TEST_DB_BACKEND === 'citus') {
    await db.raw('CREATE EXTENSION IF NOT EXISTS citus');
    await db.raw("SELECT create_distributed_table('co_managed_purchase_operations', 'tenant')");
    await db.raw("SELECT create_reference_table('stripe_offer_versions')");
  }
});

afterAll(async () => {
  await db?.destroy();
  try {
    await admin?.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [database]);
  } finally {
    await admin?.destroy();
  }
});

it('backfills in bounded batches, preferring the offer version and leaving unresolved or pinned operations alone', async () => {
  const tenant = randomUUID();
  const otherTenant = randomUUID();
  const sharedId = randomUUID();
  const exactVersion = randomUUID();
  const catalogEntry = { offer_key: 'co_managed_technician_seat', billing_interval: 'month' };
  await db('stripe_offer_versions').insert([
    { ...catalogEntry, version_id: exactVersion, price_id: 'price_original', stripe_account: 'acct_original', livemode: false },
    { ...catalogEntry, version_id: randomUUID(), price_id: 'price_unique', stripe_account: 'acct_unique', livemode: true },
    { ...catalogEntry, version_id: randomUUID(), price_id: 'price_ambiguous', stripe_account: 'acct_a', livemode: true },
    { ...catalogEntry, version_id: randomUUID(), price_id: 'price_ambiguous', stripe_account: 'acct_a', livemode: false },
    { ...catalogEntry, version_id: randomUUID(), price_id: 'price_annual', stripe_account: 'acct_a', livemode: true, billing_interval: 'year' },
  ]);

  const missingVersion = randomUUID();
  const fallbackRows = Array.from({ length: 1_001 }, (_, i) => ({
    tenant, operation_id: randomUUID(), offer_version_id: i === 0 ? missingVersion : null, price_id: 'price_unique',
  }));
  const pinnedId = randomUUID();
  const partialId = randomUUID();
  const ambiguousId = randomUUID();
  const annualId = randomUUID();
  await db.batchInsert(operations, [
    ...fallbackRows,
    { tenant, operation_id: sharedId, offer_version_id: exactVersion, price_id: 'price_unique' },
    { tenant: otherTenant, operation_id: sharedId, price_id: 'price_unknown' },
    { tenant, operation_id: ambiguousId, price_id: 'price_ambiguous' },
    { tenant, operation_id: annualId, price_id: 'price_annual' },
    { tenant, operation_id: pinnedId, offer_version_id: exactVersion, stripe_account: 'acct_pinned', livemode: true },
    { tenant, operation_id: partialId, price_id: 'price_unique', stripe_account: 'acct_partial' },
  ], 250);

  const updates: number[] = [];
  const recordUpdate = (result: { command?: string; rowCount?: number }) => {
    if (result.command === 'UPDATE' && result.rowCount) updates.push(result.rowCount);
  };
  db.on('query-response', recordUpdate);
  try {
    await migration.up(db);
    expect(Math.max(...updates)).toBeLessThanOrEqual(1_000);
    expect(updates.reduce((sum, count) => sum + count, 0)).toBe(fallbackRows.length + 1);
    updates.length = 0;
    await migration.up(db);
    expect(updates).toEqual([]);
  } finally {
    db.off('query-response', recordUpdate);
  }

  const pin = (tenant: string, operation_id: string) => db(operations).where({ tenant, operation_id })
    .first('stripe_account', 'livemode');
  expect(await pin(tenant, sharedId)).toEqual({ stripe_account: 'acct_original', livemode: false });
  const unpinned = { stripe_account: null, livemode: null };
  expect(await pin(otherTenant, sharedId)).toEqual(unpinned);
  expect(await pin(tenant, ambiguousId)).toEqual(unpinned);
  expect(await pin(tenant, annualId)).toEqual(unpinned);
  expect(await pin(tenant, pinnedId)).toEqual({ stripe_account: 'acct_pinned', livemode: true });
  expect(await pin(tenant, partialId)).toEqual({ stripe_account: 'acct_partial', livemode: null });
  expect(await db(operations).where({ tenant, stripe_account: 'acct_unique', livemode: true }).count('* as count').first())
    .toEqual({ count: String(fallbackRows.length) });
});
