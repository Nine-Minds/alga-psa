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

const dbHolder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db/db', () => ({ getConnection: async () => dbHolder.db }));

import { StripeService } from '../../lib/stripe/StripeService';
import { StripeOwnershipError } from '../../lib/stripe/stripeCustomerOwnership';

const require_ = createRequire(import.meta.url);
const migration = require_('../../../migrations/20261031090000_create_stripe_customer_bindings.cjs');

const SCHEMA = `t0002926_${process.pid}`;
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const MASTER = randomUUID();
const SHARED_EMAIL = 'billing@shared.example';

let db: Knex;

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
    },
    pool: { min: 1, max: 1 },
  });
  dbHolder.db = db;
  await db.raw(`CREATE SCHEMA ${SCHEMA}`);
  await db.raw(`SET search_path TO ${SCHEMA}, public`);
  await db.raw(`CREATE TABLE tenants (tenant uuid PRIMARY KEY, email text)`);
  await db.raw(`
    CREATE TABLE stripe_customers (
      tenant uuid NOT NULL, stripe_customer_id uuid NOT NULL DEFAULT gen_random_uuid(),
      stripe_customer_external_id text NOT NULL, billing_tenant uuid, email text NOT NULL, name text,
      metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
      PRIMARY KEY (tenant, stripe_customer_id), UNIQUE (tenant, stripe_customer_external_id))`);
  await db.raw(`CREATE TABLE stripe_subscriptions (tenant uuid NOT NULL, stripe_subscription_external_id text)`);
  await db.raw(`
    CREATE TABLE audit_logs (
      audit_id uuid PRIMARY KEY, tenant uuid DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
      user_id uuid, operation text, table_name text, record_id text, changed_data jsonb, details jsonb, "timestamp" timestamptz)`);
});

afterAll(async () => {
  await db.raw(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await db.destroy();
});

beforeEach(async () => {
  await db.raw('TRUNCATE tenants, stripe_customers, stripe_subscriptions, audit_logs');
  await db.raw('DROP TABLE IF EXISTS stripe_customer_bindings');
  await db('tenants').insert([
    { tenant: TENANT_A, email: SHARED_EMAIL },
    { tenant: TENANT_B, email: SHARED_EMAIL },
  ]);
  await migration.up(db);
});

describe('migration: global uniqueness of stripe_customer_external_id', () => {
  it('pre-flight fails listing cross-tenant duplicates, changes nothing, and does not auto-resolve', async () => {
    await db.raw('DROP TABLE stripe_customer_bindings');
    await db('stripe_customers').insert([
      { tenant: TENANT_A, stripe_customer_external_id: 'cus_dup', email: 'x' },
      { tenant: TENANT_B, stripe_customer_external_id: 'cus_dup', email: 'x' },
    ]);
    await expect(migration.up(db)).rejects.toThrow(/cus_dup.*\[.*\]/s);
    expect((await db.schema.hasTable('stripe_customer_bindings'))).toBe(false);
    expect(await count('stripe_customers')).toBe(2);
  });

  it('backfills bindings from existing rows when there are no duplicates', async () => {
    await db.raw('DROP TABLE stripe_customer_bindings');
    await db('stripe_customers').insert({ tenant: TENANT_A, stripe_customer_external_id: 'cus_old', email: 'x' });
    await migration.up(db);
    expect(await db('stripe_customer_bindings').select('*')).toMatchObject([{ stripe_customer_external_id: 'cus_old', tenant: TENANT_A }]);
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

  it('raw inserts of the same id for a second tenant violate the primary key', async () => {
    await db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_raw', tenant: TENANT_A });
    await expect(
      db('stripe_customer_bindings').insert({ stripe_customer_external_id: 'cus_raw', tenant: TENANT_B }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('getOrImportCustomer ownership proof', () => {
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
