/**
 * alga-2026-0002926: getOrImportCustomer must never bind a tenant to a Stripe customer
 * (or subscriptions) it cannot prove belong to that tenant. Runs against a real Postgres
 * schema (the DB constraint is the point); Stripe is faked.
 *
 * Needs a reachable Postgres: DB_HOST/DB_PORT/DB_USER_SERVER/DB_PASSWORD_SERVER/DB_NAME_SERVER.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';

const dbHolder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db/db', () => ({ getConnection: async () => dbHolder.db }));

import { StripeService } from '../../lib/stripe/StripeService';
import { StripeOwnershipError } from '../../lib/stripe/stripeCustomerOwnership';
import { stripeApiOverride } from '../../lib/stripe/stripeApiOverride';
import { tenantDeletionOrder } from '../../../../../packages/db/src/lib/tenantTableManifest';

const require_ = createRequire(import.meta.url);
const migration = require_('../../../migrations/20261031090000_create_stripe_customer_bindings.cjs');
const ownerIndexMigration = require_('../../../migrations/20261102080000_add_stripe_customer_binding_owner_index.cjs');
const upgradeMigration = require_('../../../migrations/20261102090000_enforce_stripe_customer_binding_writes.cjs');
const validationMigration = require_('../../../migrations/20261103090000_validate_stripe_customer_binding_owner_fk.cjs');

const SCHEMA = `t0002926_${process.pid}`;
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const MASTER = randomUUID();
const SHARED_EMAIL = 'billing@shared.example';

let db: Knex;

async function removeBindingEnforcement({ dropBindings = true } = {}) {
  await db.raw(`ALTER TABLE ${SCHEMA}.stripe_customers DROP CONSTRAINT IF EXISTS stripe_customers_binding_owner_fk`);
  if (dropBindings) await db.raw(`DROP TABLE IF EXISTS ${SCHEMA}.stripe_customer_bindings`);
}

async function restoreOwnerConstraint() {
  await db.raw(`ALTER TABLE ${SCHEMA}.stripe_customers ADD CONSTRAINT stripe_customers_binding_owner_fk
    FOREIGN KEY (tenant, stripe_customer_external_id)
    REFERENCES ${SCHEMA}.stripe_customer_bindings (tenant, stripe_customer_external_id) NOT VALID`);
}

function makeTestConnection(applicationName = 'stripe_binding_test') {
  return knexFactory({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME_SERVER || process.env.DB_NAME || 'server',
      user: process.env.DB_USER_SERVER || 'postgres', password: String(process.env.DB_PASSWORD_SERVER || ''),
      options: `-c search_path=${SCHEMA},public -c application_name=${applicationName}`,
    },
    pool: { min: 1, max: 1 },
  });
}

type FakeCustomer = { id: string; email: string; deleted?: boolean; metadata: Record<string, string> };

function makeService(customers: FakeCustomer[], subscriptions: Record<string, any[]> = {}) {
  const service = new StripeService() as any;
  service.config = { masterTenantId: MASTER };
  service.ensureInitialized = async () => undefined;
  service.importSubscription = vi.fn(async () => undefined);
  service.stripe = {
    customers: {
      list: vi.fn(async ({ email }: { email: string }) => ({
        data: customers.filter((c) => c.email === email && !c.deleted),
        has_more: false,
      })),
      retrieve: vi.fn(async (id: string) => customers.find((c) => c.id === id) ?? { id, deleted: true }),
      update: vi.fn(async (id: string, params: { metadata: Record<string, string> }) => {
        const c = customers.find((x) => x.id === id)!;
        c.metadata = { ...c.metadata, ...params.metadata };
        return c;
      }),
    },
    subscriptions: { list: vi.fn(async ({ customer }: { customer: string }) => ({ data: subscriptions[customer] ?? [] })) },
  };
  return service;
}

const count = async (table: string, where: Record<string, unknown> = {}) =>
  Number((await db(table).where(where).count('* as n').first())!.n);

beforeAll(async () => {
  db = knexFactory({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME_SERVER || process.env.DB_NAME || 'server',
      user: process.env.DB_USER_SERVER || 'postgres',
      password: String(process.env.DB_PASSWORD_SERVER || ''),
      options: `-c search_path=${SCHEMA},public -c application_name=stripe_binding_test_main`,
    },
    pool: { min: 1, max: 1 },
  });
  dbHolder.db = db;
  await db.raw(`CREATE SCHEMA ${SCHEMA}`);
  await db.raw(`SET search_path TO ${SCHEMA}, public`);
  const publicCollision = await db.raw(`SELECT to_regclass('public.stripe_customers') IS NOT NULL OR to_regclass('public.stripe_customer_bindings') IS NOT NULL AS present`);
  if (publicCollision.rows[0].present) {
    throw new Error('Stripe ownership integration test requires a dedicated database with no public Stripe tables; refusing search_path fallback.');
  }
  await db.raw(`CREATE TABLE tenants (tenant uuid PRIMARY KEY, email text, plan text, product_code text)`);
  await db.raw(`
    CREATE TABLE stripe_customers (
      tenant uuid NOT NULL, stripe_customer_id uuid NOT NULL DEFAULT gen_random_uuid(),
      stripe_customer_external_id text NOT NULL, billing_tenant uuid, email text NOT NULL, name text,
      metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
      PRIMARY KEY (tenant, stripe_customer_id), UNIQUE (tenant, stripe_customer_external_id))`);
  if (process.env.STRIPE_BINDING_CITUS_TEST === '1') {
    await db.raw(`SELECT create_distributed_table(?::regclass, 'tenant')`, [`${SCHEMA}.stripe_customers`]);
  }
  await db.raw(`CREATE TABLE stripe_subscriptions (tenant uuid NOT NULL, stripe_subscription_external_id text)`);
  await db.raw(`
    CREATE TABLE audit_logs (
      audit_id uuid PRIMARY KEY, tenant uuid DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
      user_id uuid, operation text, table_name text, record_id text, changed_data jsonb, details jsonb, "timestamp" timestamptz)`);
});

afterAll(async () => {
  await db.raw(`DROP TABLE IF EXISTS ${SCHEMA}.stripe_customers`);
  await db.raw(`DROP TABLE IF EXISTS ${SCHEMA}.stripe_customer_bindings`);
  await db.raw(`DROP TABLE IF EXISTS ${SCHEMA}.stripe_subscriptions`);
  await db.raw(`DROP TABLE IF EXISTS ${SCHEMA}.audit_logs`);
  await db.raw(`DROP TABLE IF EXISTS ${SCHEMA}.tenants`);
  await db.raw(`DROP SCHEMA ${SCHEMA}`);
  await db.destroy();
});

beforeEach(async () => {
  await removeBindingEnforcement();
  await db.raw('TRUNCATE tenants, stripe_customers, stripe_subscriptions, audit_logs');
  await db('tenants').insert([
    { tenant: TENANT_A, email: SHARED_EMAIL },
    { tenant: TENANT_B, email: SHARED_EMAIL },
  ]);
  await migration.up(db);
});

describe('migration: global uniqueness of stripe_customer_external_id', () => {
  it('deletes customer mappings before bindings in manifest order and preserves other tenants', async () => {
    await db('stripe_customer_bindings').insert([
      { tenant: TENANT_A, stripe_customer_external_id: 'cus_delete_a' },
      { tenant: TENANT_B, stripe_customer_external_id: 'cus_delete_b' },
    ]);
    await db('stripe_customers').insert([
      { tenant: TENANT_A, stripe_customer_external_id: 'cus_delete_a', email: 'a' },
      { tenant: TENANT_B, stripe_customer_external_id: 'cus_delete_b', email: 'b' },
    ]);

    const relevantTables = tenantDeletionOrder().filter((table) =>
      table === 'stripe_customers' || table === 'stripe_customer_bindings');
    expect(relevantTables).toEqual(['stripe_customers', 'stripe_customer_bindings']);
    for (const table of relevantTables) await db(table).where({ tenant: TENANT_A }).del();

    expect(await db('stripe_customers').where({ tenant: TENANT_A })).toHaveLength(0);
    expect(await db('stripe_customer_bindings').where({ tenant: TENANT_A })).toHaveLength(0);
    expect(await db('stripe_customers').where({ tenant: TENANT_B }).select('stripe_customer_external_id'))
      .toEqual([{ stripe_customer_external_id: 'cus_delete_b' }]);
    expect(await db('stripe_customer_bindings').where({ tenant: TENANT_B }).select('stripe_customer_external_id'))
      .toEqual([{ stripe_customer_external_id: 'cus_delete_b' }]);
  });

  it('pre-flight fails listing cross-tenant duplicates, changes nothing, and does not auto-resolve', async () => {
    await removeBindingEnforcement();
    await db('stripe_customers').insert([
      { tenant: TENANT_A, stripe_customer_external_id: 'cus_dup', email: 'x' },
      { tenant: TENANT_B, stripe_customer_external_id: 'cus_dup', email: 'x' },
    ]);
    await expect(migration.up(db)).rejects.toThrow(/cus_dup.*\[.*\]/s);
    expect((await db.schema.hasTable('stripe_customer_bindings'))).toBe(false);
    expect(await count('stripe_customers')).toBe(2);
    const constraints = await db.raw(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='stripe_customers'::regclass AND conname='stripe_customers_binding_owner_fk'`);
    expect(constraints.rows[0].n).toBe(0);
  });

  it('backfills bindings from existing rows when there are no duplicates', async () => {
    await removeBindingEnforcement();
    await db('stripe_customers').insert({ tenant: TENANT_A, stripe_customer_external_id: 'cus_old', email: 'x' });
    await migration.up(db);
    expect(await db('stripe_customer_bindings').select('*')).toMatchObject([{ stripe_customer_external_id: 'cus_old', tenant: TENANT_A }]);
    await expect(db('stripe_customers').insert({ tenant: TENANT_B, stripe_customer_external_id: 'cus_old', email: 'x' }))
      .rejects.toThrow(/foreign key|violates foreign key/i);
  });

  it('the binding blocks one external id being bound to a second tenant, and writes nothing for it', async () => {
    const customers: FakeCustomer[] = [{ id: 'cus_shared', email: SHARED_EMAIL, metadata: { tenant_id: TENANT_A } }];
    await makeService(customers).getOrImportCustomer(TENANT_A);

    // Tenant B's customer metadata (wrongly) also names B: the DB must still refuse the second binding.
    customers[0].metadata = { tenant_id: TENANT_B };
    await expect(makeService(customers).getOrImportCustomer(TENANT_B)).rejects.toMatchObject({ code: 'already_bound' });
    expect(await count('stripe_customers', { tenant: TENANT_B })).toBe(0);
    expect(await db('stripe_customer_bindings').select('tenant')).toEqual([{ tenant: TENANT_A }]);
  });

  it('ownership constraint rejects conflicting legacy inserts and updates', async () => {
    await expect(db('stripe_customer_bindings').insert({ stripe_customer_external_id: '  ', tenant: TENANT_A }))
      .rejects.toThrow(/check constraint|violates check/i);
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_legacy', tenant: TENANT_A });
    await expect(db('stripe_customers').insert({ tenant: TENANT_B, stripe_customer_external_id: 'cus_legacy', email: 'x' }))
      .rejects.toThrow(/foreign key|violates foreign key/i);
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_update', tenant: TENANT_A });
    await db('stripe_customers').insert({ tenant: TENANT_A, stripe_customer_external_id: 'cus_update', email: 'x' });
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_update_2', tenant: TENANT_A });
    await db('stripe_customers').where({ tenant: TENANT_A }).update({ stripe_customer_external_id: 'cus_update_2' });
    expect(await db('stripe_customer_bindings').where({ stripe_customer_external_id: 'cus_update_2' }).first())
      .toMatchObject({ tenant: TENANT_A });
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_b_update', tenant: TENANT_B });
    await db('stripe_customers').insert({ tenant: TENANT_B, stripe_customer_external_id: 'cus_b_update', email: 'x' });
    await expect(db('stripe_customers').where({ tenant: TENANT_B }).update({ stripe_customer_external_id: 'cus_legacy' }))
      .rejects.toThrow(/foreign key|violates foreign key/i);
    expect(await db('stripe_customers').select('tenant', 'stripe_customer_external_id'))
      .toEqual(expect.arrayContaining([
        { tenant: TENANT_A, stripe_customer_external_id: 'cus_update_2' },
        { tenant: TENANT_B, stripe_customer_external_id: 'cus_b_update' },
      ]));
  });

  it('concurrent legacy claims cannot assign the same Stripe id to different tenants', async () => {
    const second = makeTestConnection();
    try {
      const claimAndInsert = (connection: Knex, tenant: string) => connection.transaction(async (trx) => {
        const [claim] = await trx('stripe_customer_bindings')
          .insert({ stripe_customer_external_id: 'cus_race', tenant })
          .onConflict('stripe_customer_external_id').ignore().returning('tenant');
        if (!claim) {
          const current = await trx('stripe_customer_bindings').where({ stripe_customer_external_id: 'cus_race' }).first();
          if (current?.tenant !== tenant) throw new Error('Stripe customer already claimed by another tenant');
        }
        await trx('stripe_customers').insert({ tenant, stripe_customer_external_id: 'cus_race', email: 'x' });
      });
      const results = await Promise.allSettled([claimAndInsert(db, TENANT_A), claimAndInsert(second, TENANT_B)]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(await db('stripe_customer_bindings').where({ stripe_customer_external_id: 'cus_race' })).toHaveLength(1);
      expect(await db('stripe_customers').where({ stripe_customer_external_id: 'cus_race' })).toHaveLength(1);
    } finally {
      await second.destroy();
    }
  });

  it('backfill refuses a pre-existing binding that disagrees with the mapping', async () => {
    await removeBindingEnforcement();
    await db('stripe_customers').insert({ tenant: TENANT_A, stripe_customer_external_id: 'cus_backfill', email: 'x' });
    await db.schema.createTable('stripe_customer_bindings', (table) => {
      table.text('stripe_customer_external_id').primary(); table.uuid('tenant').notNullable();
    });
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_backfill', tenant: TENANT_B });
    if (process.env.STRIPE_BINDING_CITUS_TEST === '1') {
      await db.raw(`SELECT create_reference_table(?::regclass)`, [`${SCHEMA}.stripe_customer_bindings`]);
    }
    await ownerIndexMigration.up(db);
    const ownerIndex = await db.raw(`SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname='stripe_customer_bindings_owner_key'`);
    expect(ownerIndex.rows[0]?.indexdef).toMatch(/UNIQUE INDEX .*\(tenant, stripe_customer_external_id\)/i);
    await expect(migration.up(db)).rejects.toThrow(/backfill mismatch/i);
    expect(await db('stripe_customer_bindings').where({ stripe_customer_external_id: 'cus_backfill' }).first())
      .toMatchObject({ tenant: TENANT_B });
  });

  it('migration fails actionably on a historical empty binding, even without a mapping row', async () => {
    await removeBindingEnforcement();
    await db.schema.createTable('stripe_customer_bindings', (table) => {
      table.text('stripe_customer_external_id').notNullable().primary();
      table.uuid('tenant').notNullable();
    });
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: '', tenant: TENANT_A });
    if (process.env.STRIPE_BINDING_CITUS_TEST === '1') {
      await db.raw(`SELECT create_reference_table(?::regclass)`, [`${SCHEMA}.stripe_customer_bindings`]);
    }
    await ownerIndexMigration.up(db);
    await expect(migration.up(db)).rejects.toThrow(/binding rows contain null or empty customer ids/i);
    expect(await db('stripe_customer_bindings').where({ stripe_customer_external_id: '' })).toHaveLength(1);
    const fk = await db.raw(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='stripe_customers'::regclass AND conname='stripe_customers_binding_owner_fk'`);
    expect(fk.rows[0].n).toBe(0);
  });

  it('migration rollback removes the ownership constraint and binding table', async () => {
    await validationMigration.down(db);
    await upgradeMigration.down(db);
    await ownerIndexMigration.down(db);
    expect(await db.schema.hasTable('stripe_customer_bindings')).toBe(true);
    await migration.down(db);
    expect(await db.schema.hasTable('stripe_customer_bindings')).toBe(false);
    const constraints = await db.raw(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='stripe_customers'::regclass AND conname='stripe_customers_binding_owner_fk'`);
    expect(constraints.rows[0].n).toBe(0);
    await db('stripe_customers').insert([
      { tenant: TENANT_A, stripe_customer_external_id: 'cus_rollback', email: 'x' },
      { tenant: TENANT_B, stripe_customer_external_id: 'cus_rollback', email: 'x' },
    ]);
    expect(await db('stripe_customers').where({ stripe_customer_external_id: 'cus_rollback' })).toHaveLength(2);
  });

  it('follow-up migration installs enforcement when the original migration was already applied', async () => {
    // Model the historical migration's exact table shape: a primary key on external id,
    // tenant index, and existing backfill, but no tenant-composite key or FK.
    await removeBindingEnforcement();
    await db.schema.createTable('stripe_customer_bindings', (table) => {
      table.text('stripe_customer_external_id').notNullable().primary();
      table.uuid('tenant').notNullable();
      table.timestamp('bound_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
      table.index(['tenant'], 'stripe_customer_bindings_tenant_idx');
    });
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_pre_upgrade', tenant: TENANT_A });
    await db('stripe_customers').insert({ tenant: TENANT_A, stripe_customer_external_id: 'cus_pre_upgrade', email: 'x' });
    await db('stripe_customers').insert({ tenant: TENANT_A, stripe_customer_external_id: 'cus_added_by_old_writer', email: 'x' });
    if (process.env.STRIPE_BINDING_CITUS_TEST === '1') {
      await db.raw(`SELECT create_reference_table(?::regclass)`, [`${SCHEMA}.stripe_customer_bindings`]);
    }
    await ownerIndexMigration.up(db);
    await upgradeMigration.up(db);
    expect(await db('stripe_customer_bindings').where({ stripe_customer_external_id: 'cus_added_by_old_writer' }).first())
      .toMatchObject({ tenant: TENANT_A });
    await validationMigration.up(db);
    const constraint = await db.raw(`SELECT convalidated FROM pg_constraint WHERE conrelid='stripe_customers'::regclass AND conname='stripe_customers_binding_owner_fk'`);
    expect(constraint.rows[0].convalidated).toBe(true);
    await expect(db('stripe_customers').insert({ tenant: TENANT_B, stripe_customer_external_id: 'cus_added_by_old_writer', email: 'x' }))
      .rejects.toThrow(/foreign key|violates foreign key/i);
  });

  it('migration queues ahead of legacy writers and installs enforcement before releasing them', async () => {
    await removeBindingEnforcement();
    const blocker = makeTestConnection();
    const migrator = makeTestConnection();
    const writer = makeTestConnection('stripe_binding_writer');
    let writerTrx: Knex.Transaction | undefined;
    try {
      await db('stripe_customers').insert({ tenant: TENANT_A, stripe_customer_external_id: 'cus_rollout', email: 'x' });
      await blocker.raw('BEGIN');
      await blocker.raw('LOCK TABLE stripe_customers IN ACCESS EXCLUSIVE MODE');

      let migrationFinished = false;
      const migrationRun = migration.up(migrator).finally(() => { migrationFinished = true; });
      const deadline = Date.now() + 5000;
      let queued = false;
      while (Date.now() < deadline) {
        const locks = await db.raw(`SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation WHERE c.relname='stripe_customers' AND NOT l.granted) AS waiting`);
        if (locks.rows[0].waiting) { queued = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(queued).toBe(true);
      writerTrx = await writer.transaction();
      let writerSettled = false;
      const writerRun = writerTrx('stripe_customers').insert({ tenant: TENANT_B, stripe_customer_external_id: 'cus_rollout', email: 'x' })
        .then(() => { writerSettled = true; }, (error) => { writerSettled = true; throw error; });
      const writerDeadline = Date.now() + 5000;
      let writerActive = false;
      while (Date.now() < writerDeadline) {
        const activity = await db.raw(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='stripe_binding_writer' AND state='active') AS active`);
        if (activity.rows[0].active) { writerActive = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(writerActive).toBe(true);
      expect(writerSettled).toBe(false);
      expect(migrationFinished).toBe(false);
      await blocker.raw('COMMIT');
      await migrationRun;
      await expect(writerRun).rejects.toThrow(/foreign key|violates foreign key/i);
      await writerTrx.rollback().catch(() => undefined);
      expect(await db('stripe_customers').where({ stripe_customer_external_id: 'cus_rollout' })).toHaveLength(1);
      expect(await db('stripe_customer_bindings').where({ stripe_customer_external_id: 'cus_rollout' }).first())
        .toMatchObject({ tenant: TENANT_A });

      // Matching ownership is accepted, while a later legacy update cannot
      // move that mapping onto a customer owned by the other tenant.
      await writer('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_matching', tenant: TENANT_A });
      await writer('stripe_customers').insert({ tenant: TENANT_A, stripe_customer_external_id: 'cus_matching', email: 'matching' });
      await writer('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_tenant_b_original', tenant: TENANT_B });
      await writer('stripe_customers').insert({ tenant: TENANT_B, stripe_customer_external_id: 'cus_tenant_b_original', email: 'tenant-b' });
      await expect(writer('stripe_customers').where({ tenant: TENANT_B, stripe_customer_external_id: 'cus_tenant_b_original' }).update({ stripe_customer_external_id: 'cus_rollout' }))
        .rejects.toThrow(/foreign key|violates foreign key/i);
      expect(await db('stripe_customers').where({ tenant: TENANT_B }).select('stripe_customer_external_id'))
        .toEqual([{ stripe_customer_external_id: 'cus_tenant_b_original' }]);
    } finally {
      if (writerTrx && !writerTrx.isCompleted()) await writerTrx.rollback().catch(() => undefined);
      await blocker.destroy(); await migrator.destroy(); await writer.destroy();
    }
  });

  it('raw inserts of the same id for a second tenant violate the primary key', async () => {
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_raw', tenant: TENANT_A });
    await expect(
      db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_raw', tenant: TENANT_B }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('getOrImportCustomer ownership proof', () => {
  it('existing mapping requires matching binding and remote ownership metadata', async () => {
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_existing', tenant: TENANT_A });
    await db('stripe_customers').insert({ tenant: TENANT_A, stripe_customer_external_id: 'cus_existing', email: 'x' });
    const service = makeService([{ id: 'cus_existing', email: 'x', metadata: { tenant_id: TENANT_A } }]);
    await expect(service.getOrImportCustomer(TENANT_A)).resolves.toMatchObject({ stripe_customer_external_id: 'cus_existing' });

    await removeBindingEnforcement({ dropBindings: false });
    await db('stripe_customer_bindings').where({ stripe_customer_external_id: 'cus_existing' }).update({ tenant: TENANT_B });
    await expect(service.getOrImportCustomer(TENANT_A)).rejects.toMatchObject({ code: 'already_bound' });
    await db('stripe_customer_bindings').where({ stripe_customer_external_id: 'cus_existing' }).update({ tenant: TENANT_A });
    service.stripe.customers.retrieve.mockResolvedValue({ id: 'cus_existing', metadata: { tenant_id: TENANT_B } });
    await expect(service.getOrImportCustomer(TENANT_A)).rejects.toMatchObject({ code: 'not_owned' });
  });

  it('refuses existing mappings with missing bindings or missing remote ownership metadata', async () => {
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_existing', tenant: TENANT_A });
    await db('stripe_customers').insert({ tenant: TENANT_A, stripe_customer_external_id: 'cus_existing', email: 'x' });
    await removeBindingEnforcement({ dropBindings: false });
    await db('stripe_customer_bindings').where({ stripe_customer_external_id: 'cus_existing' }).del();
    await expect(makeService([{ id: 'cus_existing', email: 'x', metadata: { tenant_id: TENANT_A } }]).getOrImportCustomer(TENANT_A))
      .rejects.toMatchObject({ code: 'already_bound' });
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_existing', tenant: TENANT_A });
    await restoreOwnerConstraint();
    await expect(makeService([{ id: 'cus_existing', email: 'x', metadata: {} }]).getOrImportCustomer(TENANT_A))
      .rejects.toMatchObject({ code: 'not_owned' });
  });

  it('rejects a deleted remote customer on the existing-mapping fast path before subscription work', async () => {
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_deleted_existing', tenant: TENANT_A });
    await db('stripe_customers').insert({ tenant: TENANT_A, stripe_customer_external_id: 'cus_deleted_existing', email: 'x' });
    const service = makeService([{ id: 'cus_deleted_existing', email: 'x', metadata: { tenant_id: TENANT_A }, deleted: true }]);

    await expect(service.getOrImportCustomer(TENANT_A)).rejects.toMatchObject({ code: 'not_owned' });
    expect(service.stripe.subscriptions.list).not.toHaveBeenCalled();
    expect(service.importSubscription).not.toHaveBeenCalled();
  });

  it.skipIf(!process.env.STRIPE_API_BASE_URL)('validates the existing-customer fast path against the Stripe simulator', async () => {
    const secretKey = process.env.STRIPE_SECRET_KEY || 'sk_test_algasim';
    const endpoint = process.env.STRIPE_API_BASE_URL!;
    const stripe = new Stripe(secretKey, {
      apiVersion: '2024-12-18.acacia' as any,
      ...stripeApiOverride(secretKey, { ...process.env, STRIPE_API_BASE_URL: endpoint }),
    });
    const service = new StripeService() as any;
    service.config = { masterTenantId: MASTER };
    service.ensureInitialized = async () => undefined;
    service.stripe = stripe;
    service.importSubscription = vi.fn(async () => undefined);
    const mismatchTenant = randomUUID();
    const deletedTenant = randomUUID();
    const incompatibleTenant = randomUUID();

    const matching = await stripe.customers.create({ email: 'match@simulator.test', metadata: { tenant_id: TENANT_A } });
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: matching.id, tenant: TENANT_A });
    await db('stripe_customers').insert({ tenant: TENANT_A, stripe_customer_external_id: matching.id, email: 'match@simulator.test' });
    await expect(service.getOrImportCustomer(TENANT_A)).resolves.toMatchObject({ stripe_customer_external_id: matching.id });

    const mismatched = await stripe.customers.create({ email: 'mismatch@simulator.test', metadata: { tenant_id: TENANT_B } });
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: mismatched.id, tenant: mismatchTenant });
    await db('stripe_customers').insert({ tenant: mismatchTenant, stripe_customer_external_id: mismatched.id, email: 'mismatch@simulator.test' });
    await expect(service.getOrImportCustomer(mismatchTenant)).rejects.toMatchObject({ code: 'not_owned' });
    expect(service.importSubscription).not.toHaveBeenCalled();

    const deleted = await stripe.customers.create({ email: 'deleted@simulator.test', metadata: { tenant_id: deletedTenant } });
    await db('tenants').insert({ tenant: deletedTenant, email: 'deleted@simulator.test', plan: 'pro', product_code: 'psa' });
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: deleted.id, tenant: deletedTenant });
    await db('stripe_customers').insert({ tenant: deletedTenant, stripe_customer_external_id: deleted.id, email: 'deleted@simulator.test' });
    await expect(service.getOrImportCustomer(deletedTenant)).resolves.toMatchObject({ stripe_customer_external_id: deleted.id });
    service.buildSubscriptionLineItemsForTier = vi.fn(() => [{ price: 'price_simulator', quantity: 1 }]);
    const createCheckoutSession = vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({
      id: 'cs_deleted_customer_fast_path', client_secret: 'secret_simulator',
    } as any);
    await expect((service as any).createLicenseCheckoutSession(deletedTenant, 1)).resolves.toMatchObject({
      sessionId: 'cs_deleted_customer_fast_path',
    });
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    await stripe.customers.del(deleted.id);
    await expect((service as any).createLicenseCheckoutSession(deletedTenant, 1)).rejects.toMatchObject({ code: 'not_owned' });
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(service.importSubscription).not.toHaveBeenCalled();

    const incompatible = await stripe.customers.create({ email: 'binding@simulator.test', metadata: { tenant_id: TENANT_A } });
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: incompatible.id, tenant: incompatibleTenant });
    await db('stripe_customers').insert({ tenant: incompatibleTenant, stripe_customer_external_id: incompatible.id, email: 'binding@simulator.test' });
    await removeBindingEnforcement({ dropBindings: false });
    await db('stripe_customer_bindings').where({ stripe_customer_external_id: incompatible.id }).update({ tenant: TENANT_B });
    await expect(service.getOrImportCustomer(incompatibleTenant)).rejects.toMatchObject({ code: 'already_bound' });
    await db('stripe_customer_bindings').where({ stripe_customer_external_id: incompatible.id }).update({ tenant: incompatibleTenant });
    await restoreOwnerConstraint();
  });

  it('two tenants share an email: tenant A imports only the customer whose metadata names A', async () => {
    const customers: FakeCustomer[] = [
      { id: 'cus_other', email: SHARED_EMAIL, metadata: { tenant_id: TENANT_B } },
      { id: 'cus_mine', email: SHARED_EMAIL, metadata: { alga_tenant_id: TENANT_A } },
    ];
    const row = await makeService(customers).getOrImportCustomer(TENANT_A);
    expect(row.stripe_customer_external_id).toBe('cus_mine');
    expect(await db('stripe_customers').select('tenant', 'stripe_customer_external_id')).toEqual([
      { tenant: TENANT_A, stripe_customer_external_id: 'cus_mine' },
    ]);
  });

  it('refuses when the only candidate carries foreign metadata, writing zero rows', async () => {
    const service = makeService([{ id: 'cus_foreign', email: SHARED_EMAIL, metadata: { tenant_id: TENANT_B } }]);
    const err = await service.getOrImportCustomer(TENANT_A).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StripeOwnershipError);
    expect(err.message).not.toContain('cus_foreign');
    expect(err.message).not.toContain(TENANT_B);
    expect(err.detail).toContain('cus_foreign');
    expect(await count('stripe_customers')).toBe(0);
    expect(await count('stripe_subscriptions')).toBe(0);
    expect(await count('stripe_customer_bindings')).toBe(0);
    expect(service.stripe.subscriptions.list).not.toHaveBeenCalled();
  });

  it('refuses ambiguous owned candidates and lists the ids for the operator', async () => {
    const service = makeService([
      { id: 'cus_one', email: SHARED_EMAIL, metadata: { tenant_id: TENANT_A } },
      { id: 'cus_two', email: SHARED_EMAIL, metadata: { alga_tenant_id: TENANT_A } },
    ]);
    const err = await service.getOrImportCustomer(TENANT_A).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'ambiguous_owned_candidates', candidateIds: ['cus_one', 'cus_two'] });
    expect(err.detail).toMatch(/cus_one.*cus_two/);
    expect(await count('stripe_customers')).toBe(0);
  });

  it.each([
    ['no candidates', [] as FakeCustomer[], 'no_candidates'],
    ['candidates with no metadata', [{ id: 'cus_bare', email: SHARED_EMAIL, metadata: {} }], 'no_owned_candidate'],
    ['candidate with conflicting keys', [{ id: 'cus_conf', email: SHARED_EMAIL, metadata: { tenant_id: TENANT_A, alga_tenant_id: TENANT_B } }], 'no_owned_candidate'],
  ])('fails closed: %s', async (_name, customers, code) => {
    await expect(makeService(customers).getOrImportCustomer(TENANT_A)).rejects.toMatchObject({ code });
    expect(await count('stripe_customers')).toBe(0);
    expect(await count('stripe_customer_bindings')).toBe(0);
  });

  it('refuses to search Stripe at all when the tenant has no email', async () => {
    await db('tenants').where({ tenant: TENANT_A }).update({ email: null });
    const service = makeService([{ id: 'cus_any', email: SHARED_EMAIL, metadata: { tenant_id: TENANT_A } }]);
    await expect(service.getOrImportCustomer(TENANT_A)).rejects.toMatchObject({ code: 'no_candidates' });
    expect(service.stripe.customers.list).not.toHaveBeenCalled();
  });

  it('importer re-verifies ownership on the retrieved customer (every import path is gated)', async () => {
    const service = makeService([{ id: 'cus_f', email: SHARED_EMAIL, metadata: { tenant_id: TENANT_B } }]);
    await expect(service.importStripeCustomer(TENANT_A, 'cus_f', db)).rejects.toMatchObject({ code: 'not_owned' });
    expect(await count('stripe_customers')).toBe(0);
  });

  it('skips a subscription stamped with another tenant while its siblings import; unstamped ones import', async () => {
    const service = makeService(
      [{ id: 'cus_mine', email: SHARED_EMAIL, metadata: { tenant_id: TENANT_A } }],
      {
        cus_mine: [
          { id: 'sub_ok', metadata: { tenant_id: TENANT_A } },
          { id: 'sub_foreign', metadata: { tenant_id: TENANT_B } },
          { id: 'sub_conflict', metadata: { tenant_id: TENANT_A, alga_tenant_id: TENANT_B } },
          { id: 'sub_unstamped', metadata: {} },
        ],
      },
    );
    await service.getOrImportCustomer(TENANT_A);
    const imported = service.importSubscription.mock.calls.map((c: any[]) => c[2].id);
    expect(imported).toEqual(['sub_ok', 'sub_unstamped']);
  });
});

describe('linkStripeCustomerToTenant (operator recovery)', () => {
  it('stamps an unstamped customer, writes the mapping, binding and an audit record', async () => {
    const customers: FakeCustomer[] = [{ id: 'cus_nm', email: 'nm@store.example', metadata: {} }];
    const service = makeService(customers, { cus_nm: [{ id: 'sub_foreign', metadata: { tenant_id: TENANT_B } }, { id: 'sub_x', metadata: {} }] });
    const row = await service.linkStripeCustomerToTenant(TENANT_A, 'cus_nm', { actor: 'op@nineminds.com', reason: 'ticket alga-2026-0002926' });

    expect(row.stripe_customer_external_id).toBe('cus_nm');
    expect(customers[0].metadata.tenant_id).toBe(TENANT_A);
    expect(await db('stripe_customer_bindings').select('tenant')).toEqual([{ tenant: TENANT_A }]);
    expect(service.importSubscription.mock.calls.map((c: any[]) => c[2].id)).toEqual(['sub_x']);
    const audit = await db('audit_logs').select('*');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ operation: 'stripe_customer_link', table_name: 'stripe_customers', tenant: TENANT_A });
    expect(audit[0].details).toMatchObject({ actor: 'op@nineminds.com', reason: 'ticket alga-2026-0002926', stripe_customer_external_id: 'cus_nm' });
  });

  it('refuses an already-bound customer, a foreign-stamped customer, a deleted customer, and a missing actor/reason', async () => {
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_taken', tenant: TENANT_B });
    const customers: FakeCustomer[] = [
      { id: 'cus_taken', email: 'x', metadata: {} },
      { id: 'cus_foreign', email: 'x', metadata: { tenant_id: TENANT_B } },
      { id: 'cus_gone', email: 'x', metadata: {}, deleted: true },
    ];
    const service = makeService(customers);
    const link = (id: string, o = { actor: 'op', reason: 'r' }) => service.linkStripeCustomerToTenant(TENANT_A, id, o);
    await expect(link('cus_taken')).rejects.toMatchObject({ code: 'already_bound' });
    await expect(link('cus_foreign')).rejects.toMatchObject({ code: 'not_owned' });
    await expect(link('cus_gone')).rejects.toMatchObject({ code: 'customer_deleted' });
    await expect(link('cus_taken', { actor: '', reason: 'r' })).rejects.toThrow(/actor and reason/);
    expect(customers[0].metadata).toEqual({}); // refused before stamping
    expect(await count('stripe_customers')).toBe(0);
    expect(await count('audit_logs')).toBe(0);
  });
});
