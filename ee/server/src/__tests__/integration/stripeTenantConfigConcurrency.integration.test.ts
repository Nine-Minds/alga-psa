import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { mergeStripeConfiguration } from '../../lib/payments/stripeTenantConfig';

const schema = `stripe_config_race_${process.pid}`;
const tenant = randomUUID();
const configId = randomUUID();
let db: Knex;

describe('tenant Stripe configuration concurrency against PostgreSQL', () => {
  beforeAll(async () => {
    const connection = {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME_SERVER || process.env.DB_NAME || 'server',
      user: process.env.DB_USER_SERVER || 'postgres',
      password: String(process.env.DB_PASSWORD_SERVER || ''),
    };
    const admin = knexFactory({ client: 'pg', connection, pool: { min: 1, max: 1 } });
    await admin.raw(`CREATE SCHEMA ${schema}`);
    await admin.destroy();
    db = knexFactory({
      client: 'pg',
      connection: { ...connection, options: `-c search_path=${schema},public` },
      pool: { min: 3, max: 3 },
    });
    await db.schema.createTable('payment_provider_configs', (table) => {
      table.uuid('config_id').primary();
      table.uuid('tenant').notNullable();
      table.string('provider_type').notNullable();
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.jsonb('configuration').notNullable().defaultTo('{}');
      table.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
  });

  afterAll(async () => {
    if (db) {
      await db.raw(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
      await db.destroy();
    }
  });

  it('preserves first-use binding and rotation fields when webhook reconciliation writes after a locked update', async () => {
    await db('payment_provider_configs').insert({
      config_id: configId,
      tenant,
      provider_type: 'stripe',
      configuration: { publishable_key: 'pk_test_race', webhook_endpoint_id: 'we_before' },
    });

    let releaseLock!: () => void;
    let signalLocked!: () => void;
    const lockAcquired = new Promise<void>((resolve) => { signalLocked = resolve; });
    const holdLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    const bindingTransaction = db.transaction(async (trx) => {
      const row = await trx('payment_provider_configs').where({ tenant, config_id: configId }).forUpdate().first();
      expect(row).toBeDefined();
      signalLocked();
      await holdLock;
      await trx('payment_provider_configs').where({ tenant, config_id: configId }).update({
        configuration: {
          ...row.configuration,
          stripe_account_id: 'acct_verified',
          stripe_secret_key_name: 'stripe_payment_secret_key_rotation_b',
          stripe_credential_fingerprint: 'fingerprint_b',
        },
      });
    });
    await lockAcquired;

    const webhookWrite = mergeStripeConfiguration(db, tenant, configId, {
      webhook_events: ['checkout.session.completed'],
      webhook_endpoint_id: 'we_after',
    });
    const lockWaitDeadline = Date.now() + 5_000;
    let waitingUpdates = 0;
    while (Date.now() < lockWaitDeadline) {
      const result = await db.raw(
        `SELECT count(*)::int AS count
           FROM pg_locks
          WHERE relation = 'payment_provider_configs'::regclass
            AND NOT granted`,
      );
      waitingUpdates = result.rows[0].count;
      if (waitingUpdates > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(waitingUpdates).toBeGreaterThan(0);
    releaseLock();
    await Promise.all([bindingTransaction, webhookWrite]);

    const row = await db('payment_provider_configs').where({ tenant, config_id: configId }).first();
    expect(row.configuration).toMatchObject({
      stripe_account_id: 'acct_verified',
      stripe_secret_key_name: 'stripe_payment_secret_key_rotation_b',
      stripe_credential_fingerprint: 'fingerprint_b',
      webhook_events: ['checkout.session.completed'],
      webhook_endpoint_id: 'we_after',
    });
  });
});
