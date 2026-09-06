import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { getSecret } from '../../lib/utils/getSecret';
import { reserveCoManagedWorkspace } from '../../../../packages/licensing/src/lib/co-managed-reservation';
import { tenantDb } from '@alga-psa/db';

const fixtureKeys = vi.hoisted(() => ({ fixture: '' }));
vi.mock('../../../../packages/licensing/src/lib/license-keys', () => ({ LICENSE_PUBLIC_KEYS: fixtureKeys }));
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
fixtureKeys.fixture = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20260906010000_create_co_management_foundation.cjs');
const previousProductMigration = require('../../../migrations/20260505140000_add_tenant_product_code.cjs');

// Never bootstrap the running app or another suite's database. The fixture uses
// the existing tenant/client key shapes; full-install migration coverage is separate.
const databaseName = `co_managed_test_${randomUUID().replaceAll('-', '')}`;
let admin: Knex;
let db: Knex;
let created = false;

beforeAll(async () => {
  const connection = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN'),
  };
  admin = knex({ client: 'pg', connection: { ...connection, database: 'postgres' } });
  await admin.raw('CREATE DATABASE ??', [databaseName]);
  created = true;
  db = knex({ client: 'pg', connection: { ...connection, database: databaseName }, pool: { min: 0, max: 6 } });
  if (process.env.CO_MANAGED_TEST_CITUS === '1') await db.raw('CREATE EXTENSION citus');
  await db.schema.createTable('tenants', (table) => {
    table.uuid('tenant').primary();
    table.text('plan').notNullable().defaultTo('pro');
  });
  await db.schema.createTable('clients', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('client_id').notNullable();
    table.primary(['tenant', 'client_id']);
  });
  if (process.env.CO_MANAGED_TEST_CITUS === '1') {
    await db.raw("SELECT create_distributed_table('tenants', 'tenant')");
    await db.raw("SELECT create_distributed_table('clients', 'tenant', colocate_with => 'tenants')");
  }
  await previousProductMigration.up(db);
  await migration.up(db);
  // Recovering/replaying a nontransactional Citus migration must be safe.
  await migration.up(db);
  await migration.down(db);
  await migration.up(db);
}, 60_000);

afterAll(async () => {
  await db?.destroy();
  if (created) await admin.raw('DROP DATABASE ??', [databaseName]);
  await admin?.destroy();
});

async function sponsorFixture(capacity = 4, productCode = 'psa', plan = 'pro') {
  const sponsorTenant = randomUUID();
  const clientId = randomUUID();
  const sponsor = tenantDb(db, sponsorTenant);
  await sponsor.table('tenants').insert({ tenant: sponsorTenant, product_code: productCode, plan });
  await sponsor.table('clients').insert({ tenant: sponsorTenant, client_id: clientId });
  await sponsor.table('co_managed_entitlements').insert({
    tenant: sponsorTenant, source: 'hosted', source_reference: `subscription-${sponsorTenant}`,
    capacity, verified_at: new Date(Date.now() - 1000), valid_until: new Date(Date.now() + 3_600_000),
  });
  return { sponsorTenant, clientId, operationId: randomUUID(), seats: 2, visibilityMode: 'board_scope' as const };
}

function license(aud: string, seats: number) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'fixture' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'nineminds-license', sub: 'license', cust: 'customer', tier: 'pro', aud,
    iat: now - 10, exp: now + 3600, co_managed_seats: seats })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign('sha256', Buffer.from(signingInput), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

describe('co-managed reservation persistence', () => {
  it('atomically reserves a new customer identity without activating trust or creating a login', async () => {
    const input = await sponsorFixture();
    const result = await reserveCoManagedWorkspace(db, input);
    expect(result).toMatchObject({ operation_id: input.operationId, seats: 2, state: 'reserved' });
    expect(result.customer_tenant).not.toBe(input.sponsorTenant);
    const customer = tenantDb(db, result.customer_tenant);
    expect(await customer.table('tenants').first()).toBeUndefined();
    expect(await customer.table('co_management_relationships').first()).toMatchObject({
      sponsor_tenant: input.sponsorTenant, state: 'provisioning', accepted_at: null, revision: 1,
    });
  });

  it('serializes competing reservations so only one can consume the last seats', async () => {
    const input = await sponsorFixture(2);
    const results = await Promise.allSettled([
      reserveCoManagedWorkspace(db, input),
      reserveCoManagedWorkspace(db, { ...input, operationId: randomUUID() }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'CAPACITY_UNAVAILABLE' },
    });
    expect(await tenantDb(db, input.sponsorTenant).table('co_managed_allocations')).toHaveLength(1);
  });

  it('retries the same operation concurrently without duplicating a reservation', async () => {
    const input = await sponsorFixture(2);
    const results = await Promise.all([reserveCoManagedWorkspace(db, input), reserveCoManagedWorkspace(db, input)]);
    expect(results[0]).toEqual(results[1]);
    await expect(reserveCoManagedWorkspace(db, { ...input, seats: 1 })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
  });

  it('keeps capacity and idempotency scoped to each sponsor', async () => {
    const one = await sponsorFixture(2);
    const two = await sponsorFixture(2);
    const first = await reserveCoManagedWorkspace(db, one);
    const second = await reserveCoManagedWorkspace(db, { ...two, operationId: one.operationId });
    expect(first.customer_tenant).not.toBe(second.customer_tenant);
    expect(await tenantDb(db, one.sponsorTenant).table('co_managed_allocations').where('allocation_id', second.allocation_id).first()).toBeUndefined();
  });

  it('recognizes the original operation after later allocation or scope changes', async () => {
    const input = await sponsorFixture();
    const original = await reserveCoManagedWorkspace(db, input);
    await tenantDb(db, input.sponsorTenant).table('co_managed_allocations')
      .where('allocation_id', original.allocation_id).update({ seats: 3 });
    await tenantDb(db, original.customer_tenant).table('co_management_relationships')
      .where('relationship_id', original.relationship_id).update({ visibility_mode: 'escalation_only' });
    await expect(reserveCoManagedWorkspace(db, input)).resolves.toMatchObject({ allocation_id: original.allocation_id, seats: 3 });
    await expect(reserveCoManagedWorkspace(db, { ...input, seats: 3 })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
  });

  it.each([['algadesk', 'pro'], ['co_managed', 'pro'], ['psa', 'essentials'], ['psa', 'invalid']])
  ('denies an ineligible sponsor product=%s plan=%s', async (product, plan) => {
    const input = await sponsorFixture(2, product, plan);
    await expect(reserveCoManagedWorkspace(db, input)).rejects.toMatchObject({ code: 'SPONSOR_NOT_ELIGIBLE' });
    expect(await tenantDb(db, input.sponsorTenant).table('co_managed_allocations')).toHaveLength(0);
  });

  it('does not accept a client from another sponsor', async () => {
    const one = await sponsorFixture();
    const two = await sponsorFixture();
    await expect(reserveCoManagedWorkspace(db, { ...one, clientId: two.clientId })).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
  });

  it('rejects a nested sponsor even if its product was incorrectly changed to PSA', async () => {
    const input = await sponsorFixture();
    await tenantDb(db, input.sponsorTenant).table('co_management_relationships').insert({
      tenant: input.sponsorTenant, relationship_id: randomUUID(),
      sponsor_tenant: randomUUID(), sponsor_client_id: randomUUID(),
    });
    await expect(reserveCoManagedWorkspace(db, input)).rejects.toMatchObject({ code: 'SPONSOR_NOT_ELIGIBLE' });
  });

  it('rejects expired hosted capacity before the lapse worker has updated the row', async () => {
    const input = await sponsorFixture();
    await tenantDb(db, input.sponsorTenant).table('co_managed_entitlements').update({ valid_until: new Date(Date.now() - 1000) });
    await expect(reserveCoManagedWorkspace(db, input)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
  });

  it.each([0, -1, 0.5])('rejects invalid seat allocation %s without reserving an identity', async (seats) => {
    const input = await sponsorFixture();
    await expect(reserveCoManagedWorkspace(db, { ...input, seats })).rejects.toMatchObject({ code: 'INVALID_RESERVATION' });
    expect(await tenantDb(db, input.sponsorTenant).table('co_managed_allocations')).toHaveLength(0);
  });

  it('blocks growth immediately during a lapse while preserving an existing reservation', async () => {
    const input = await sponsorFixture();
    const existing = await reserveCoManagedWorkspace(db, input);
    const lapse = new Date();
    await tenantDb(db, input.sponsorTenant).table('co_managed_entitlements').update({
      lapse_started_at: lapse, read_only_after: new Date(lapse.getTime() + 30 * 86_400_000),
    });
    await expect(reserveCoManagedWorkspace(db, input)).resolves.toEqual(existing);
    await expect(reserveCoManagedWorkspace(db, { ...input, operationId: randomUUID() })).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
  });

  it('does not trust an inflated database counter for self-hosted capacity', async () => {
    const input = await sponsorFixture(100, 'psa', 'essentials');
    const sponsor = tenantDb(db, input.sponsorTenant);
    await sponsor.table('co_managed_entitlements').update({ source: 'self_host', signed_license: license(input.sponsorTenant, 1) });
    await expect(reserveCoManagedWorkspace(db, input)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    await expect(reserveCoManagedWorkspace(db, { ...input, seats: 1 })).resolves.toMatchObject({ seats: 1 });
  });

  it('rejects a valid self-host license belonging to another sponsor', async () => {
    const input = await sponsorFixture();
    await tenantDb(db, input.sponsorTenant).table('co_managed_entitlements').update({ source: 'self_host', signed_license: license(randomUUID(), 100) });
    await expect(reserveCoManagedWorkspace(db, input)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
  });

  it('enforces one live sponsor at the customer key', async () => {
    const input = await sponsorFixture();
    const result = await reserveCoManagedWorkspace(db, input);
    const customer = tenantDb(db, result.customer_tenant);
    await expect(customer.table('co_management_relationships').insert({
      tenant: result.customer_tenant, relationship_id: randomUUID(),
      sponsor_tenant: randomUUID(), sponsor_client_id: randomUUID(),
    })).rejects.toMatchObject({ code: '23505' });
  });

  it('does not permit activation without acceptance or release without a timestamp', async () => {
    const input = await sponsorFixture();
    const result = await reserveCoManagedWorkspace(db, input);
    await expect(tenantDb(db, result.customer_tenant).table('co_management_relationships')
      .where('relationship_id', result.relationship_id).update({ state: 'active' }))
      .rejects.toMatchObject({ code: '23514' });
    await expect(tenantDb(db, input.sponsorTenant).table('co_managed_allocations')
      .where('allocation_id', result.allocation_id).update({ state: 'released' }))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('keeps customer product constraints closed and refuses a destructive rollback', async () => {
    await db('tenants').insert({ tenant: randomUUID(), product_code: 'co_managed' });
    await expect(db('tenants').insert({ tenant: randomUUID(), product_code: 'unknown' })).rejects.toMatchObject({ code: '23514' });
    await expect(migration.down(db)).rejects.toThrow('Cannot roll back co-management');
    expect(await db.schema.hasTable('co_managed_allocations')).toBe(true);
  });
});
