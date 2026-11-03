import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20261031090000_create_stripe_customer_bindings.cjs');
const forwardMigration = require('../../../migrations/20261103130000_enforce_stripe_customer_binding_ownership.cjs');
const connectionString = process.env.STRIPE_BINDING_TEST_DATABASE_URL;
const isCitus = process.env.STRIPE_BINDING_TEST_CITUS === '1';
const schema = `stripe_binding_migration_${process.pid}_${randomUUID().replaceAll('-', '')}`;

const suite = describe.skipIf(!connectionString);
let admin: Knex;
let db: Knex;
const tenantA = '00000000-0000-4000-8000-000000000001';
const tenantB = '00000000-0000-4000-8000-000000000002';

async function createFixture(options: { nullableExternalId?: boolean } = {}) {
  await db.raw('DROP TABLE IF EXISTS stripe_customers CASCADE');
  await db.raw('DROP TABLE IF EXISTS stripe_customer_bindings CASCADE');
  await db.raw(`
    CREATE TABLE stripe_customers (
      tenant uuid NOT NULL,
      stripe_customer_id uuid NOT NULL DEFAULT gen_random_uuid(),
      stripe_customer_external_id text ${options.nullableExternalId ? '' : 'NOT NULL'},
      PRIMARY KEY (tenant, stripe_customer_id),
      UNIQUE (tenant, stripe_customer_external_id)
    )`);
  if (isCitus) {
    await db.raw("SELECT create_distributed_table('stripe_customers', 'tenant')");
  }
}

async function waitForMigrationLock(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await admin.raw(`
      SELECT 1
      FROM pg_stat_activity a
      JOIN pg_locks l ON l.pid = a.pid AND NOT l.granted
      WHERE a.application_name = 'stripe-binding-migration-regression'
        AND a.query ILIKE 'LOCK TABLE stripe_customers%'
      LIMIT 1`);
    if (rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Migration did not wait on the legacy writer lock in time');
}

async function waitForBindingMigrationLock(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await admin.raw(`
      SELECT 1
      FROM pg_stat_activity a
      JOIN pg_locks l ON l.pid = a.pid AND NOT l.granted
      WHERE a.application_name = 'stripe-binding-migration-regression'
        AND a.query ILIKE 'LOCK TABLE stripe_customer_bindings%'
      LIMIT 1`);
    if (rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Migration did not wait on the binding writer lock in time');
}

suite('Stripe customer binding migration ownership enforcement', () => {
  beforeAll(async () => {
    admin = knexFactory({ client: 'pg', connection: connectionString, pool: { min: 1, max: 4 } });
    await admin.raw(`CREATE SCHEMA "${schema}"`);
    db = knexFactory({
      client: 'pg',
      connection: {
        connectionString,
        options: `-c search_path=${schema},public`,
        application_name: 'stripe-binding-migration-regression',
      },
      pool: { min: 1, max: 6 },
    });
    if (isCitus) await db.raw('CREATE EXTENSION IF NOT EXISTS citus');
    await db.raw('SELECT 1');
  });

  afterAll(async () => {
    await db?.destroy();
    if (admin) {
      await admin.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  beforeEach(async () => createFixture());

  it('backfills valid mappings and enforces matching bindings for later writes', async () => {
    await db('stripe_customers').insert([
      { tenant: tenantA, stripe_customer_external_id: 'cus_valid_a' },
      { tenant: tenantB, stripe_customer_external_id: 'cus_valid_b' },
    ]);

    await migration.up(db);

    expect(await db('stripe_customer_bindings').select('stripe_customer_external_id', 'tenant').orderBy('stripe_customer_external_id'))
      .toEqual([
        { stripe_customer_external_id: 'cus_valid_a', tenant: tenantA },
        { stripe_customer_external_id: 'cus_valid_b', tenant: tenantB },
      ]);

    const rejectedCrossTenantWrite = db('stripe_customers')
      .insert({ tenant: tenantB, stripe_customer_external_id: 'cus_valid_a' })
      .then(() => null, (error: Error) => error);
    expect(await rejectedCrossTenantWrite).toBeInstanceOf(Error);

    const rejectedConflictingUpdate = db('stripe_customers')
      .where({ tenant: tenantA, stripe_customer_external_id: 'cus_valid_a' })
      .update({ stripe_customer_external_id: 'cus_valid_b' })
      .then(() => null, (error: Error) => error);
    expect(await rejectedConflictingUpdate).toBeInstanceOf(Error);

    await db.transaction(async (trx) => {
      await trx('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_new', tenant: tenantA });
      await trx('stripe_customers').insert({ tenant: tenantA, stripe_customer_external_id: 'cus_new' });
    });
    expect(await db('stripe_customers').where({ stripe_customer_external_id: 'cus_new' })).toHaveLength(1);
  });

  it('rejects duplicate tenant ownership and rolls back enforcement state', async () => {
    await db('stripe_customers').insert([
      { tenant: tenantA, stripe_customer_external_id: 'cus_duplicate' },
      { tenant: tenantB, stripe_customer_external_id: 'cus_duplicate' },
    ]);

    await expect(migration.up(db)).rejects.toThrow(/conflicting tenants/);
    expect(Number((await db('stripe_customer_bindings').count('* as count').first())?.count)).toBe(0);
    const constraint = await db.raw(`
      SELECT 1 FROM pg_constraint
      WHERE conname = 'stripe_customers_binding_owner_fk'
        AND conrelid = 'stripe_customers'::regclass`);
    expect(constraint.rows).toHaveLength(0);
  });

  it('rejects stale conflicting bindings without leaving an FK or accepting an owner', async () => {
    await db('stripe_customers').insert({ tenant: tenantA, stripe_customer_external_id: 'cus_stale' });
    await db.schema.createTable('stripe_customer_bindings', (table) => {
      table.text('stripe_customer_external_id').notNullable().primary();
      table.uuid('tenant').notNullable();
      table.timestamp('bound_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    });
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_stale', tenant: tenantB });

    await expect(migration.up(db)).rejects.toThrow(/existing bindings conflict/);
    expect(await db('stripe_customer_bindings').where({ stripe_customer_external_id: 'cus_stale' }).first('tenant'))
      .toEqual({ tenant: tenantB });
    const constraint = await db.raw(`
      SELECT 1 FROM pg_constraint
      WHERE conname = 'stripe_customers_binding_owner_fk'
        AND conrelid = 'stripe_customers'::regclass`);
    expect(constraint.rows).toHaveLength(0);
  });

  it('upgrades an installation where the original binding migration is already recorded', async () => {
    await db('stripe_customers').insert({ tenant: tenantA, stripe_customer_external_id: 'cus_forward' });
    await db.schema.createTable('stripe_customer_bindings', (table) => {
      table.text('stripe_customer_external_id').notNullable().primary();
      table.uuid('tenant').notNullable();
      table.timestamp('bound_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    });

    await forwardMigration.up(db);

    expect(await db('stripe_customer_bindings').where({ stripe_customer_external_id: 'cus_forward' }).first('tenant'))
      .toEqual({ tenant: tenantA });
    const constraint = await db.raw(`
      SELECT convalidated FROM pg_constraint
      WHERE conname = 'stripe_customers_binding_owner_fk'
        AND conrelid = 'stripe_customers'::regclass`);
    expect(constraint.rows).toEqual([{ convalidated: true }]);
  });

  it('does not omit nullable mapping rows from preflight or enforcement scope', async () => {
    await createFixture({ nullableExternalId: true });
    await db.raw('INSERT INTO stripe_customers (tenant, stripe_customer_external_id) VALUES (?, NULL)', [tenantA]);

    await expect(migration.up(db)).rejects.toThrow(/null key/);
    const constraint = await db.raw(`
      SELECT 1 FROM pg_constraint
      WHERE conname = 'stripe_customers_binding_owner_fk'
        AND conrelid = 'stripe_customers'::regclass`);
    expect(constraint.rows).toHaveLength(0);
    expect(Number((await db('stripe_customer_bindings').count('* as count').first())?.count)).toBe(0);
  });

  it('waits for independent legacy insert and update statements, then backfills their committed rows', async () => {
    await db('stripe_customers').insert({ tenant: tenantA, stripe_customer_external_id: 'cus_update_before' });

    const writer = await db.transaction();
    await writer('stripe_customers').insert({ tenant: tenantB, stripe_customer_external_id: 'cus_insert_race' });
    const migrationResult = migration.up(db).then(
      () => ({ error: null }),
      (error: Error) => ({ error })
    );
    await waitForMigrationLock();
    await writer('stripe_customers')
      .where({ tenant: tenantA, stripe_customer_external_id: 'cus_update_before' })
      .update({ stripe_customer_external_id: 'cus_update_race' });
    await writer.commit();
    expect((await migrationResult).error).toBeNull();

    expect(await db('stripe_customer_bindings').whereIn('stripe_customer_external_id', ['cus_insert_race', 'cus_update_race']).count('* as count'))
      .toEqual([{ count: '2' }]);
  });

  it('fences binding-first application writers in the same lock order they use', async () => {
    await db.schema.createTable('stripe_customer_bindings', (table) => {
      table.text('stripe_customer_external_id').notNullable().primary();
      table.uuid('tenant').notNullable();
      table.timestamp('bound_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
      table.unique(['stripe_customer_external_id', 'tenant'], 'stripe_customer_bindings_owner_key');
    });
    if (isCitus) await db.raw("SELECT create_reference_table('stripe_customer_bindings')");

    const writer = await db.transaction();
    await writer('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_binding_race', tenant: tenantA });
    const migrationResult = migration.up(db).then(
      () => ({ error: null }),
      (error: Error) => ({ error })
    );
    await waitForBindingMigrationLock();
    await writer('stripe_customers').insert({ tenant: tenantA, stripe_customer_external_id: 'cus_binding_race' });
    await writer.commit();
    expect((await migrationResult).error).toBeNull();
    expect(await db('stripe_customer_bindings').where({ stripe_customer_external_id: 'cus_binding_race' }).first('tenant'))
      .toEqual({ tenant: tenantA });
  });
});
