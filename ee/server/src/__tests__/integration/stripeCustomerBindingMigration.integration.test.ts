import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20261031090000_create_stripe_customer_bindings.cjs');
const forwardMigration = require('../../../migrations/20261122120000_enforce_stripe_customer_binding_ownership.cjs');
const connectionString = process.env.STRIPE_BINDING_TEST_DATABASE_URL;
const isCitus = process.env.STRIPE_BINDING_TEST_CITUS === '1';
const schema = `stripe_binding_migration_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const sentinelSchema = `stripe_binding_sentinel_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const preexistingSchema = `stripe_binding_preexisting_${process.pid}_${randomUUID().replaceAll('-', '')}`;

const suite = describe.skipIf(!connectionString);
let admin: Knex;
let db: Knex;
let ownedSchemas: Set<string>;
const tenantA = '00000000-0000-4000-8000-000000000001';
const tenantB = '00000000-0000-4000-8000-000000000002';
const sentinelTenant = '00000000-0000-4000-8000-000000000099';

const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const fixtureTable = (name: string) => `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
const sentinelTable = (name: string, ownerSchema = sentinelSchema) => `${quoteIdentifier(ownerSchema)}.${quoteIdentifier(name)}`;

async function createOwnedSchema(connection: Knex, name: string, ownership: Set<string>) {
  await connection.raw(`CREATE SCHEMA ${quoteIdentifier(name)}`);
  ownership.add(name);
}

async function dropOwnedSchema(connection: Knex, name: string, ownership: Set<string>) {
  if (!ownership.has(name)) return;
  await connection.raw(`DROP SCHEMA IF EXISTS ${quoteIdentifier(name)} CASCADE`);
  ownership.delete(name);
}

async function cleanupOwnedSchemas(connection: Knex, ownership: Set<string>) {
  for (const name of [...ownership]) await dropOwnedSchema(connection, name, ownership);
}

async function expectSentinelsIntact(ownerSchema = sentinelSchema) {
  const bindings = await admin.raw(`
    SELECT stripe_customer_external_id, tenant
    FROM ${sentinelTable('stripe_customer_bindings', ownerSchema)}
    WHERE stripe_customer_external_id = 'cus_schema_sentinel'`);
  const customers = await admin.raw(`
    SELECT stripe_customer_external_id, tenant
    FROM ${sentinelTable('stripe_customers', ownerSchema)}
    WHERE stripe_customer_external_id = 'cus_schema_sentinel'`);
  const constraint = await admin.raw(`
    SELECT convalidated
    FROM pg_constraint
    WHERE conname = 'stripe_customer_sentinel_fk'
      AND conrelid = '${sentinelTable('stripe_customers', ownerSchema)}'::regclass
      AND contype = 'f'`);

  expect(bindings.rows).toEqual([{ stripe_customer_external_id: 'cus_schema_sentinel', tenant: sentinelTenant }]);
  expect(customers.rows).toEqual([{ stripe_customer_external_id: 'cus_schema_sentinel', tenant: sentinelTenant }]);
  expect(constraint.rows).toEqual([{ convalidated: true }]);
}

async function createFixture(options: { nullableExternalId?: boolean; distributeCustomers?: boolean } = {}) {
  await db.raw(`DROP TABLE IF EXISTS ${fixtureTable('stripe_customers')} CASCADE`);
  await db.raw(`DROP TABLE IF EXISTS ${fixtureTable('stripe_customer_bindings')} CASCADE`);
  await db.raw(`
    CREATE TABLE ${fixtureTable('stripe_customers')} (
      tenant uuid NOT NULL,
      stripe_customer_id uuid NOT NULL DEFAULT gen_random_uuid(),
      stripe_customer_external_id text ${options.nullableExternalId ? '' : 'NOT NULL'},
      PRIMARY KEY (tenant, stripe_customer_id),
      UNIQUE (tenant, stripe_customer_external_id)
    )`);
  if (isCitus && options.distributeCustomers !== false) {
    await db.raw(`SELECT create_distributed_table('${schema}.stripe_customers', 'tenant')`);
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
    ownedSchemas = new Set();
    await createOwnedSchema(admin, schema, ownedSchemas);
    await createOwnedSchema(admin, sentinelSchema, ownedSchemas);
    if (isCitus) await admin.raw('CREATE EXTENSION IF NOT EXISTS citus');
    await admin.raw(`
      CREATE TABLE ${sentinelTable('stripe_customer_bindings')} (
        stripe_customer_external_id text NOT NULL PRIMARY KEY,
        tenant uuid NOT NULL,
        UNIQUE (stripe_customer_external_id, tenant)
      )`);
    await admin.raw(`
      CREATE TABLE ${sentinelTable('stripe_customers')} (
        tenant uuid NOT NULL,
        stripe_customer_external_id text NOT NULL,
        CONSTRAINT stripe_customer_sentinel_fk
          FOREIGN KEY (stripe_customer_external_id, tenant)
          REFERENCES ${sentinelTable('stripe_customer_bindings')} (stripe_customer_external_id, tenant)
      )`);
    await admin.raw(
      `INSERT INTO ${sentinelTable('stripe_customer_bindings')} (stripe_customer_external_id, tenant) VALUES ('cus_schema_sentinel', ?);`,
      [sentinelTenant]
    );
    await admin.raw(
      `INSERT INTO ${sentinelTable('stripe_customers')} (stripe_customer_external_id, tenant) VALUES ('cus_schema_sentinel', ?);`,
      [sentinelTenant]
    );
    await expectSentinelsIntact();

    db = knexFactory({
      client: 'pg',
      connection: {
        connectionString,
        options: `-c search_path=${schema}`,
        application_name: 'stripe-binding-migration-regression',
      },
      pool: { min: 1, max: 6 },
    });
    await db.raw('SELECT 1');
  });

  afterAll(async () => {
    await db?.destroy();
    if (admin) {
      try {
        await dropOwnedSchema(admin, schema, ownedSchemas);
        await expectSentinelsIntact();
      } finally {
        await cleanupOwnedSchemas(admin, ownedSchemas);
        await admin.destroy();
      }
    }
  });

  beforeEach(async () => {
    await createFixture();
    await expectSentinelsIntact();
  });

  afterEach(async () => expectSentinelsIntact());

  it('preserves pre-existing tables and dependent constraints when schema setup fails', async () => {
    await admin.raw(`CREATE SCHEMA ${quoteIdentifier(preexistingSchema)}`);
    try {
      await admin.raw(`CREATE TABLE ${sentinelTable('stripe_customer_bindings', preexistingSchema)} (
        stripe_customer_external_id text NOT NULL PRIMARY KEY,
        tenant uuid NOT NULL,
        UNIQUE (stripe_customer_external_id, tenant)
      )`);
      await admin.raw(`CREATE TABLE ${sentinelTable('stripe_customers', preexistingSchema)} (
        tenant uuid NOT NULL,
        stripe_customer_external_id text NOT NULL,
        CONSTRAINT stripe_customer_sentinel_fk
          FOREIGN KEY (stripe_customer_external_id, tenant)
          REFERENCES ${sentinelTable('stripe_customer_bindings', preexistingSchema)} (stripe_customer_external_id, tenant)
      )`);
      await admin.raw(
        `INSERT INTO ${sentinelTable('stripe_customer_bindings', preexistingSchema)} VALUES ('cus_schema_sentinel', ?)`,
        [sentinelTenant]
      );
      await admin.raw(
        `INSERT INTO ${sentinelTable('stripe_customers', preexistingSchema)} VALUES (?, 'cus_schema_sentinel')`,
        [sentinelTenant]
      );

      const failedSetupOwnership = new Set<string>();
      await expect(createOwnedSchema(admin, preexistingSchema, failedSetupOwnership)).rejects.toThrow();
      await cleanupOwnedSchemas(admin, failedSetupOwnership);
      await expectSentinelsIntact(preexistingSchema);
    } finally {
      await admin.raw(`DROP SCHEMA ${quoteIdentifier(preexistingSchema)} CASCADE`);
    }
  });

  it('backfills valid mappings and enforces matching bindings for later writes', async () => {
    await db('stripe_customers').insert([
      { tenant: tenantA, stripe_customer_external_id: 'cus_valid_a' },
      { tenant: tenantB, stripe_customer_external_id: 'cus_valid_b' },
    ]);

    await migration.up(db);
    const notYetValidated = await db.raw(`
      SELECT convalidated FROM pg_constraint
      WHERE conname = 'stripe_customers_binding_owner_fk'
        AND conrelid = 'stripe_customers'::regclass`);
    expect(notYetValidated.rows).toEqual([{ convalidated: false }]);
    await forwardMigration.up(db);

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

  it.skipIf(!isCitus)('enforces global ownership for Citus local mappings when the FK graph includes distributed tables', async () => {
    await createFixture({ distributeCustomers: false });
    await db('stripe_customers').insert({ tenant: tenantA, stripe_customer_external_id: 'cus_local_owner' });

    await migration.up(db);
    await forwardMigration.up(db);

    const ownershipConstraints = await db.raw(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'stripe_customers'::regclass
        AND conname IN ('stripe_customers_binding_owner_fk', 'stripe_customers_global_owner_key')`);
    expect(ownershipConstraints.rows).toEqual([{ conname: 'stripe_customers_global_owner_key' }]);

    const rejectedCrossTenantWrite = db('stripe_customers')
      .insert({ tenant: tenantB, stripe_customer_external_id: 'cus_local_owner' })
      .then(() => null, (error: Error) => error);
    expect(await rejectedCrossTenantWrite).toBeInstanceOf(Error);
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
    await db.schema.withSchema(schema).createTable('stripe_customer_bindings', (table) => {
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
    await db.schema.withSchema(schema).createTable('stripe_customer_bindings', (table) => {
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
    await db.schema.withSchema(schema).createTable('stripe_customer_bindings', (table) => {
      table.text('stripe_customer_external_id').notNullable().primary();
      table.uuid('tenant').notNullable();
      table.timestamp('bound_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
      table.unique(['stripe_customer_external_id', 'tenant'], 'stripe_customer_bindings_owner_key');
    });
    if (isCitus) await db.raw(`SELECT create_reference_table('${schema}.stripe_customer_bindings')`);

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
