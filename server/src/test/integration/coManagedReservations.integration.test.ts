import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { getSecret } from '../../lib/utils/getSecret';
import { reserveCoManagedWorkspace } from '../../../../packages/licensing/src/lib/co-managed-reservation';
import { getCoManagedEntitlementState, reconcileHostedCoManagedEntitlement, reconcileSelfHostCoManagedEntitlement, recordSelfHostCoManagedRevocation } from '../../../../packages/licensing/src/lib/co-managed-entitlements';
import { upsertLicenseState } from '../../../../packages/licensing/src/lib/license-state';
import { runCoManagedPurchase } from '../../../../packages/licensing/src/lib/co-managed-purchases';
import { prepareCoManagedProvisioning, runCoManagedProvisioningStep, recordCoManagedProvisioningFailure,
  requestCoManagedProvisioningCleanup, completeCoManagedProvisioningCleanup } from '../../../../packages/co-managed/src/provisioning';
import { tenantDb } from '@alga-psa/db';

const fixtureKeys = vi.hoisted(() => ({ fixture: '' }));
vi.mock('../../../../packages/licensing/src/lib/license-keys', () => ({ LICENSE_PUBLIC_KEYS: fixtureKeys }));
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
fixtureKeys.fixture = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20260906010000_create_co_management_foundation.cjs');
const previousProductMigration = require('../../../migrations/20260505140000_add_tenant_product_code.cjs');
const sourceVersionMigration = require('../../../migrations/20260906020000_add_co_managed_entitlement_source_version.cjs');
const purchaseMigration = require('../../../migrations/20260906030000_create_co_managed_purchase_operations.cjs');
const provisioningMigration = require('../../../migrations/20260906040000_create_co_managed_provisioning.cjs');

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
  await db.schema.createTable('users', table => {
    table.uuid('tenant').notNullable();
    table.uuid('user_id').notNullable();
    table.text('user_type').notNullable();
    table.boolean('is_inactive').notNullable().defaultTo(false);
    table.primary(['tenant', 'user_id']);
  });
  await db.schema.createTable('boards', table => {
    table.uuid('tenant').notNullable();
    table.uuid('board_id').notNullable();
    table.boolean('is_inactive').notNullable().defaultTo(false);
    table.primary(['tenant', 'board_id']);
  });
  await db.schema.createTable('roles', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('role_id').notNullable().defaultTo(db.raw('gen_random_uuid()'));
    table.text('role_name').notNullable();
    table.text('description');
    table.boolean('msp').notNullable();
    table.boolean('client').notNullable();
    table.primary(['tenant', 'role_id']);
  });
  await db.schema.createTable('permissions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('permission_id').notNullable().defaultTo(db.raw('gen_random_uuid()'));
    table.text('resource').notNullable();
    table.text('action').notNullable();
    table.text('description');
    table.boolean('msp').notNullable();
    table.boolean('client').notNullable();
    table.primary(['tenant', 'permission_id']);
    table.unique(['tenant', 'resource', 'action', 'msp', 'client']);
  });
  await db.schema.createTable('role_permissions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('role_id').notNullable();
    table.uuid('permission_id').notNullable();
    table.primary(['tenant', 'role_id', 'permission_id']);
  });
  await db.schema.createTable('document_default_folders', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('default_folder_id').notNullable();
    table.text('entity_type');
    table.text('folder_path');
    table.text('folder_name');
    table.integer('sort_order');
    table.boolean('is_client_visible');
    table.timestamp('created_at');
    table.timestamp('updated_at');
    table.uuid('created_by');
    table.uuid('updated_by');
    table.primary(['tenant', 'default_folder_id']);
  });
  await db.schema.createTable('license_state', (table) => {
    table.increments('id').primary();
    table.text('license_token');
    table.timestamp('updated_at', { useTz: true });
  });
  if (process.env.CO_MANAGED_TEST_CITUS === '1') {
    await db.raw("SELECT create_distributed_table('tenants', 'tenant')");
    await db.raw("SELECT create_distributed_table('clients', 'tenant', colocate_with => 'tenants')");
    for (const table of ['users', 'boards', 'roles', 'permissions', 'role_permissions', 'document_default_folders']) {
      await db.raw("SELECT create_distributed_table(?::regclass, 'tenant', colocate_with => 'tenants')", [table]);
    }
  }
  await previousProductMigration.up(db);
  await migration.up(db);
  // Recovering/replaying a nontransactional Citus migration must be safe.
  await migration.up(db);
  await migration.down(db);
  await migration.up(db);
  await sourceVersionMigration.up(db);
  await purchaseMigration.up(db);
  await purchaseMigration.up(db);
  await provisioningMigration.up(db);
  await provisioningMigration.up(db);
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

function license(aud: string, seats: number, issuedAt?: number) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'fixture' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'nineminds-license', sub: 'license', cust: 'customer', tier: 'pro', aud,
    iat: issuedAt ?? now - 10, exp: now + 3600, co_managed_seats: seats })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign('sha256', Buffer.from(signingInput), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

describe('co-managed onboarding seeds', () => {
  const seedRoot = '../../../../ee/server/seeds/onboarding/co_managed/';
  const rolesSeed = require(seedRoot + '01_roles.cjs');
  const permissionsSeed = require(seedRoot + '02_permissions.cjs');
  const grantsSeed = require(seedRoot + '03_role_permissions.cjs');
  const foldersSeed = require(seedRoot + '08_document_folder_templates.cjs');

  it('creates operational roles and permissions without granting commercial capabilities', async () => {
    const customer = await sponsorFixture(0, 'co_managed');
    const scoped = tenantDb(db, customer.sponsorTenant);
    await rolesSeed.seed(db, customer.sponsorTenant);
    await permissionsSeed.seed(db, customer.sponsorTenant);
    await grantsSeed.seed(db, customer.sponsorTenant);
    const roles = await scoped.table('roles');
    expect(roles.map(role => role.role_name)).not.toContain('Finance');
    expect(roles).toHaveLength(6);
    const admin = roles.find(role => role.role_name === 'Admin' && role.msp);
    const grants = await scoped.table('role_permissions').where('role_id', admin.role_id);
    const permissions = await scoped.table('permissions').whereIn('permission_id', grants.map(grant => grant.permission_id));
    const resources = new Set(permissions.map(permission => permission.resource));
    for (const resource of ['ticket', 'project', 'project_task', 'time_entry', 'time_sheet', 'user_schedule', 'asset', 'sla_policy', 'workflow', 'credential', 'document']) {
      expect(resources.has(resource), resource).toBe(true);
    }
    for (const resource of ['billing', 'invoice', 'financial', 'accounting_integrations', 'opportunities', 'quotes', 'rmm', 'extension', 'tax', 'account_management']) {
      expect(resources.has(resource), resource).toBe(false);
    }
  });

  it('replays defaults without replacing custom roles, grants, or folder settings', async () => {
    const customer = await sponsorFixture(0, 'co_managed');
    const scoped = tenantDb(db, customer.sponsorTenant);
    for (const seed of [rolesSeed, permissionsSeed, grantsSeed, foldersSeed]) await seed.seed(db, customer.sponsorTenant);
    const role = (await scoped.table('roles').insert({ tenant: customer.sponsorTenant, role_name: 'Local support', msp: true, client: false }).returning('*'))[0];
    const permission = await scoped.table('permissions').where({ resource: 'ticket', action: 'read', msp: true }).first();
    await scoped.table('role_permissions').insert({ tenant: customer.sponsorTenant, role_id: role.role_id, permission_id: permission.permission_id });
    await scoped.table('document_default_folders').where('folder_path', '/Tickets').update({ folder_name: 'Our ticket files' });
    const before = await scoped.table('role_permissions').count('* as total').first();
    for (const seed of [rolesSeed, permissionsSeed, grantsSeed, foldersSeed]) await seed.seed(db, customer.sponsorTenant);
    expect(await scoped.table('role_permissions').count('* as total').first()).toEqual(before);
    expect(await scoped.table('roles').where('role_id', role.role_id).first()).toMatchObject({ role_name: 'Local support' });
    expect(await scoped.table('document_default_folders').where('folder_path', '/Tickets').first()).toMatchObject({ folder_name: 'Our ticket files' });
    const folders = await scoped.table('document_default_folders');
    expect(folders.some(folder => folder.entity_type === 'contract' || /Invoices|Sales Orders|Contracts/.test(folder.folder_path))).toBe(false);
  });

  it('does not apply co-managed defaults to a PSA or sibling workspace', async () => {
    const msp = await sponsorFixture();
    const customer = await sponsorFixture(0, 'co_managed');
    await expect(rolesSeed.seed(db, msp.sponsorTenant)).rejects.toThrow('co-managed customer workspace');
    await foldersSeed.seed(db);
    expect(await tenantDb(db, msp.sponsorTenant).table('document_default_folders')).toHaveLength(0);
    expect((await tenantDb(db, customer.sponsorTenant).table('document_default_folders')).length).toBeGreaterThan(0);
    expect(await tenantDb(db, msp.sponsorTenant).table('roles')).toHaveLength(0);
  });
});

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

describe('co-managed entitlement reconciliation', () => {
  const future = () => new Date(Date.now() + 3_600_000);

  it('persists expiry-based read-only deadlines even when no webhook or worker ran', async () => {
    const input = await sponsorFixture();
    await reserveCoManagedWorkspace(db, input);
    const expired = new Date(Date.now() - 40 * 86_400_000);
    await tenantDb(db, input.sponsorTenant).table('co_managed_entitlements').update({ valid_until: expired });
    const state = await getCoManagedEntitlementState(db, input.sponsorTenant);
    expect(state).toMatchObject({ capacity: 0, allocated: 2, canGrow: false, isReadOnly: true,
      graceEndsAt: new Date(expired.getTime() + 30 * 86_400_000).toISOString() });
    expect(await getCoManagedEntitlementState(db, input.sponsorTenant)).toEqual(state);
    const row = await tenantDb(db, input.sponsorTenant).table('co_managed_entitlements').first();
    expect(new Date(row.lapse_started_at)).toEqual(expired);
  });

  it('starts one grace period for a capacity deficit and never evicts allocated users', async () => {
    const input = await sponsorFixture();
    await reserveCoManagedWorkspace(db, input);
    const sync = () => reconcileHostedCoManagedEntitlement(db, input.sponsorTenant, `subscription-${input.sponsorTenant}`,
      async () => ({ capacity: 1, active: true, validUntil: future() }));
    const state = await sync();
    expect(state).toMatchObject({ capacity: 1, allocated: 2, available: 0, canGrow: false, isReadOnly: false });
    expect(state.graceEndsAt).not.toBeNull();
    expect((await sync()).graceEndsAt).toBe(state.graceEndsAt);
    expect(await tenantDb(db, input.sponsorTenant).table('co_managed_allocations').first()).toMatchObject({ seats: 2, state: 'reserved' });
  });

  it('clears the old deadline after valid capacity recovers', async () => {
    const input = await sponsorFixture();
    await reserveCoManagedWorkspace(db, input);
    const source = `subscription-${input.sponsorTenant}`;
    await reconcileHostedCoManagedEntitlement(db, input.sponsorTenant, source,
      async () => ({ capacity: 0, active: false, validUntil: future() }));
    expect(await reconcileHostedCoManagedEntitlement(db, input.sponsorTenant, source,
      async () => ({ capacity: 3, active: true, validUntil: future() })))
      .toMatchObject({ canGrow: true, isReadOnly: false, graceEndsAt: null, available: 1 });
    expect(await tenantDb(db, input.sponsorTenant).table('co_managed_entitlements').first())
      .toMatchObject({ lapse_started_at: null, read_only_after: null });
  });

  it('does not restart an unobserved old lapse when a delinquency event finally arrives', async () => {
    const input = await sponsorFixture();
    const expired = new Date(Date.now() - 40 * 86_400_000);
    await tenantDb(db, input.sponsorTenant).table('co_managed_entitlements').update({ valid_until: expired });
    const state = await reconcileHostedCoManagedEntitlement(db, input.sponsorTenant, `subscription-${input.sponsorTenant}`,
      async () => ({ capacity: 0, active: false, validUntil: future() }));
    expect(state).toMatchObject({ isReadOnly: true, graceEndsAt: new Date(expired.getTime() + 30 * 86_400_000).toISOString() });
  });

  it('rolls back an initial entitlement if provider validation fails', async () => {
    const sponsor = randomUUID();
    await expect(reconcileHostedCoManagedEntitlement(db, sponsor, 'sub-invalid', async () => {
      throw new Error('Customer or price mismatch');
    })).rejects.toThrow('Customer or price mismatch');
    expect(await tenantDb(db, sponsor).table('co_managed_entitlements').first()).toBeUndefined();
    expect((await getCoManagedEntitlementState(db, sponsor)).isReadOnly).toBe(true);
  });

  it('rejects an event for a different subscription without changing purchased capacity', async () => {
    const input = await sponsorFixture();
    const loader = vi.fn(async () => ({ capacity: 100, active: true, validUntil: future() }));
    await expect(reconcileHostedCoManagedEntitlement(db, input.sponsorTenant, 'another-subscription', loader))
      .rejects.toThrow('different subscription');
    expect(loader).not.toHaveBeenCalled();
    expect((await getCoManagedEntitlementState(db, input.sponsorTenant)).capacity).toBe(4);
  });

  it('serializes observations while provider state is fetched', async () => {
    const input = await sponsorFixture();
    const source = `subscription-${input.sponsorTenant}`;
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const calls: string[] = [];
    const first = reconcileHostedCoManagedEntitlement(db, input.sponsorTenant, source, async () => {
      calls.push('first-start'); entered(); await blocked; calls.push('first-end');
      return { capacity: 3, active: true, validUntil: future() };
    });
    await started;
    const second = reconcileHostedCoManagedEntitlement(db, input.sponsorTenant, source, async () => {
      calls.push('second'); return { capacity: 2, active: true, validUntil: future() };
    });
    release();
    await Promise.all([first, second]);
    expect(calls).toEqual(['first-start', 'first-end', 'second']);
    expect((await getCoManagedEntitlementState(db, input.sponsorTenant)).capacity).toBe(2);
  });

  it('ignores delayed older signed licenses after a newer signed reduction', async () => {
    const sponsor = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await reconcileSelfHostCoManagedEntitlement(db, sponsor, license(sponsor, 2, now - 5));
    expect(await reconcileSelfHostCoManagedEntitlement(db, sponsor, license(sponsor, 10, now - 10)))
      .toMatchObject({ capacity: 2 });
    expect(await reconcileSelfHostCoManagedEntitlement(db, sponsor, license(sponsor, 3, now - 1)))
      .toMatchObject({ capacity: 3 });
  });

  it('never overwrites hosted capacity with an offline license', async () => {
    const input = await sponsorFixture();
    await expect(reconcileSelfHostCoManagedEntitlement(db, input.sponsorTenant, license(input.sponsorTenant, 100)))
      .rejects.toThrow('Cannot replace hosted');
    expect((await getCoManagedEntitlementState(db, input.sponsorTenant)).capacity).toBe(4);
  });

  it('applies a signed license and its capacity atomically through the shared appliance writer', async () => {
    const sponsor = randomUUID();
    const token = license(sponsor, 5);
    await upsertLicenseState({ license_token: token }, db);
    expect((await getCoManagedEntitlementState(db, sponsor)).capacity).toBe(5);
    expect(await db('license_state').first()).toMatchObject({ license_token: token });
    const hosted = await sponsorFixture();
    await expect(upsertLicenseState({ license_token: license(hosted.sponsorTenant, 50) }, db)).rejects.toThrow('Cannot replace hosted');
    expect(await db('license_state').first()).toMatchObject({ license_token: token });
  });

  it('starts grace on online revocation and ignores a delayed revocation of an older license', async () => {
    const sponsor = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const token = license(sponsor, 5, now - 10);
    await reconcileSelfHostCoManagedEntitlement(db, sponsor, token);
    await recordSelfHostCoManagedRevocation(db, token);
    const revoked = await getCoManagedEntitlementState(db, sponsor);
    expect(revoked).toMatchObject({ canGrow: false, isReadOnly: false, capacity: 0 });
    expect(revoked.graceEndsAt).not.toBeNull();
    await recordSelfHostCoManagedRevocation(db, token);
    expect(await reconcileSelfHostCoManagedEntitlement(db, sponsor, token)).toEqual(revoked);
    await reconcileSelfHostCoManagedEntitlement(db, sponsor, license(sponsor, 6, now - 1));
    await recordSelfHostCoManagedRevocation(db, token);
    expect(await getCoManagedEntitlementState(db, sponsor)).toMatchObject({ capacity: 6, canGrow: true, graceEndsAt: null });
  });
});

describe('co-managed purchase persistence', () => {
  it('deduplicates concurrent purchase submissions', async () => {
    const sponsor = await sponsorFixture();
    const input = { sponsorTenant: sponsor.sponsorTenant, quantity: 6, operationId: randomUUID() };
    const provider = vi.fn(async () => ({ kind: 'updated' as const, subscriptionId: `subscription-${sponsor.sponsorTenant}` }));
    const results = await Promise.all([runCoManagedPurchase(db, input, provider), runCoManagedPurchase(db, input, provider)]);
    expect(results[0]).toEqual(results[1]);
    expect(provider).toHaveBeenCalledTimes(1);
    // The provider's mutation response does not itself grant unverified growth.
    expect((await getCoManagedEntitlementState(db, sponsor.sponsorTenant)).capacity).toBe(4);
  });

  it('preserves intent after a lost provider response and blocks allocation growth until recovery', async () => {
    const sponsor = await sponsorFixture();
    const input = { sponsorTenant: sponsor.sponsorTenant, quantity: 2, operationId: randomUUID() };
    await expect(runCoManagedPurchase(db, input, async () => { throw new Error('Response lost'); })).rejects.toThrow('Response lost');
    await expect(reserveCoManagedWorkspace(db, sponsor)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    const recovered = await runCoManagedPurchase(db, input, async (op) => {
      expect(op).toMatchObject({ operation_id: input.operationId, quantity: 2, state: 'preparing' });
      return { kind: 'updated', subscriptionId: `subscription-${sponsor.sponsorTenant}` };
    });
    expect(recovered.kind).toBe('updated');
    expect((await getCoManagedEntitlementState(db, sponsor.sponsorTenant)).capacity).toBe(2);
    await expect(reserveCoManagedWorkspace(db, sponsor)).resolves.toMatchObject({ seats: 2 });
  });

  it('refuses a reduction below allocated seats without leaving a stuck operation', async () => {
    const sponsor = await sponsorFixture();
    await reserveCoManagedWorkspace(db, sponsor);
    const input = { sponsorTenant: sponsor.sponsorTenant, quantity: 1, operationId: randomUUID() };
    const provider = vi.fn();
    await expect(runCoManagedPurchase(db, input, provider)).rejects.toMatchObject({ code: 'ALLOCATED_CAPACITY_REQUIRED' });
    expect(provider).not.toHaveBeenCalled();
    expect(await tenantDb(db, sponsor.sponsorTenant).table('co_managed_purchase_operations')).toHaveLength(0);
  });

  it('allows one pending checkout and preserves the original quantity on retries', async () => {
    const sponsor = await sponsorFixture();
    const input = { sponsorTenant: sponsor.sponsorTenant, quantity: 5, operationId: randomUUID() };
    await runCoManagedPurchase(db, input, async () => ({ kind: 'checkout', sessionId: 'session', clientSecret: 'ephemeral' }));
    await expect(runCoManagedPurchase(db, { ...input, quantity: 6 }, vi.fn())).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    await expect(runCoManagedPurchase(db, { ...input, operationId: randomUUID() }, vi.fn())).rejects.toMatchObject({ code: 'PURCHASE_IN_PROGRESS' });
    const rows = await tenantDb(db, sponsor.sponsorTenant).table('co_managed_purchase_operations');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('ephemeral');
    await runCoManagedPurchase(db, input, async () => ({ kind: 'expired' }));
    await expect(runCoManagedPurchase(db, { ...input, operationId: randomUUID() }, async () => ({ kind: 'updated', subscriptionId: null })))
      .resolves.toMatchObject({ kind: 'updated' });
  });

  it('isolates identical operation IDs between sponsors and excludes customer products', async () => {
    const one = await sponsorFixture();
    const two = await sponsorFixture();
    const customer = await sponsorFixture(2, 'co_managed');
    const operationId = randomUUID();
    const provider = vi.fn(async () => ({ kind: 'updated' as const, subscriptionId: null }));
    await runCoManagedPurchase(db, { sponsorTenant: one.sponsorTenant, quantity: 2, operationId }, provider);
    await runCoManagedPurchase(db, { sponsorTenant: two.sponsorTenant, quantity: 2, operationId }, provider);
    await expect(runCoManagedPurchase(db, { sponsorTenant: customer.sponsorTenant, quantity: 2, operationId }, provider))
      .rejects.toMatchObject({ code: 'SPONSOR_NOT_ELIGIBLE' });
    expect(provider).toHaveBeenCalledTimes(2);
  });
});

describe('co-managed provisioning request and worker lifecycle', () => {
  async function requestFixture() {
    const reservation = await sponsorFixture(2);
    const requestedBy = randomUUID(), escalationBoardId = randomUUID();
    const sponsor = tenantDb(db, reservation.sponsorTenant);
    await sponsor.table('users').insert({ tenant: reservation.sponsorTenant, user_id: requestedBy, user_type: 'internal' });
    await sponsor.table('boards').insert({ tenant: reservation.sponsorTenant, board_id: escalationBoardId });
    return { ...reservation, requestedBy, escalationBoardId, workspaceName: 'Customer IT',
      administrator: { firstName: 'Customer', lastName: 'Admin', email: 'customer@example.test' } };
  }

  it('reserves the full immutable request and identities before any worker or login exists', async () => {
    const input = await requestFixture();
    const [one, two] = await Promise.all([prepareCoManagedProvisioning(db, input), prepareCoManagedProvisioning(db, input)]);
    expect(one).toEqual(two);
    expect(one).toMatchObject({ state: 'queued', requested_by: input.requestedBy, escalation_board_id: input.escalationBoardId });
    expect(one.customer_board_id).not.toBe(input.escalationBoardId);
    expect(await tenantDb(db, one.customer_tenant).table('users')).toHaveLength(0);
    expect(await tenantDb(db, one.customer_tenant).table('tenants').first()).toBeUndefined();
    expect(await tenantDb(db, input.sponsorTenant).table('co_managed_allocations')).toHaveLength(1);
  });

  it('rejects changes to administrator, name, or destination while retaining the original reservation', async () => {
    const input = await requestFixture();
    await prepareCoManagedProvisioning(db, input);
    for (const changes of [{ workspaceName: 'Different' }, { escalationBoardId: randomUUID() },
      { administrator: { ...input.administrator, email: 'another@example.test' } }]) {
      await expect(prepareCoManagedProvisioning(db, { ...input, ...changes })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    }
    expect(await tenantDb(db, input.sponsorTenant).table('co_managed_allocations')).toHaveLength(1);
  });

  it('normalizes harmless whitespace and email case on retries', async () => {
    const input = await requestFixture();
    const original = await prepareCoManagedProvisioning(db, input);
    expect(await prepareCoManagedProvisioning(db, { ...input, workspaceName: ' Customer IT ',
      administrator: { ...input.administrator, email: ' Customer@Example.test ' } })).toEqual(original);
  });

  it('rolls back reservation and relationship when an actor or destination is foreign', async () => {
    const input = await requestFixture(), other = await requestFixture();
    await expect(prepareCoManagedProvisioning(db, { ...input, requestedBy: other.requestedBy })).rejects.toMatchObject({ code: 'ACTOR_NOT_FOUND' });
    await expect(prepareCoManagedProvisioning(db, { ...input, escalationBoardId: other.escalationBoardId })).rejects.toMatchObject({ code: 'DESTINATION_NOT_FOUND' });
    expect(await tenantDb(db, input.sponsorTenant).table('co_managed_allocations')).toHaveLength(0);
    expect(await db('co_management_relationships').where('sponsor_tenant', input.sponsorTenant)).toHaveLength(0);
  });

  it('rolls back a failed database step and preserves capacity for recovery', async () => {
    const input = await requestFixture(), operation = await prepareCoManagedProvisioning(db, input);
    await expect(runCoManagedProvisioningStep(db, input.sponsorTenant, input.operationId, 'tenant', async trx => {
      await tenantDb(trx, operation.customer_tenant).table('tenants').insert({ tenant: operation.customer_tenant, product_code: 'co_managed' });
      throw new Error('simulated worker crash');
    })).rejects.toThrow('simulated worker crash');
    expect(await tenantDb(db, operation.customer_tenant).table('tenants').first()).toBeUndefined();
    await recordCoManagedProvisioningFailure(db, input.sponsorTenant, input.operationId);
    expect(await tenantDb(db, input.sponsorTenant).table('co_managed_allocations').first()).toMatchObject({ state: 'reserved' });
    await runCoManagedProvisioningStep(db, input.sponsorTenant, input.operationId, 'tenant', async trx => {
      await tenantDb(trx, operation.customer_tenant).table('tenants').insert({ tenant: operation.customer_tenant, product_code: 'co_managed' });
    });
    expect(await tenantDb(db, input.sponsorTenant).table('co_managed_provisioning_operations').first()).toMatchObject({ state: 'provisioning', step: 'tenant', error_code: null });
  });

  it('does not provision a queued reservation after license lapse', async () => {
    const input = await requestFixture(); await prepareCoManagedProvisioning(db, input);
    await tenantDb(db, input.sponsorTenant).table('co_managed_entitlements').update({ valid_until: new Date(0) });
    const work = vi.fn();
    await expect(runCoManagedProvisioningStep(db, input.sponsorTenant, input.operationId, 'tenant', work)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    expect(work).not.toHaveBeenCalled();
    expect(await tenantDb(db, input.sponsorTenant).table('co_managed_allocations').first()).toMatchObject({ state: 'reserved' });
  });

  it('serializes duplicate worker deliveries and never replays a committed database step', async () => {
    const input = await requestFixture(), operation = await prepareCoManagedProvisioning(db, input);
    const work = vi.fn(async (trx: Knex.Transaction) => {
      await tenantDb(trx, operation.customer_tenant).table('tenants').insert({ tenant: operation.customer_tenant, product_code: 'co_managed' });
    });
    const results = await Promise.all([
      runCoManagedProvisioningStep(db, input.sponsorTenant, input.operationId, 'tenant', work),
      runCoManagedProvisioningStep(db, input.sponsorTenant, input.operationId, 'tenant', work),
    ]);
    expect(results.filter(result => result.skipped)).toHaveLength(1);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('requires predecessor steps before creating the administrator invitation', async () => {
    const input = await requestFixture(); await prepareCoManagedProvisioning(db, input);
    const work = vi.fn();
    await expect(runCoManagedProvisioningStep(db, input.sponsorTenant, input.operationId, 'administrator_invitation', work))
      .rejects.toMatchObject({ code: 'OPERATION_CLOSED' });
    expect(work).not.toHaveBeenCalled();
  });

  it('serializes cancellation with an in-flight worker step', async () => {
    const input = await requestFixture(), operation = await prepareCoManagedProvisioning(db, input);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const running = runCoManagedProvisioningStep(db, input.sponsorTenant, input.operationId, 'tenant', async trx => {
      entered(); await gate;
      await tenantDb(trx, operation.customer_tenant).table('tenants').insert({ tenant: operation.customer_tenant, product_code: 'co_managed' });
    });
    await started;
    const cancellation = requestCoManagedProvisioningCleanup(db, input.sponsorTenant, input.operationId);
    release();
    await Promise.all([running, cancellation]);
    expect(await tenantDb(db, input.sponsorTenant).table('co_managed_provisioning_operations').first()).toMatchObject({ state: 'cleanup_requested' });
    await expect(completeCoManagedProvisioningCleanup(db, input.sponsorTenant, input.operationId)).rejects.toMatchObject({ code: 'CLEANUP_INCOMPLETE' });
  });

  it('blocks later steps on cancellation and releases capacity only after complete database cleanup', async () => {
    const input = await requestFixture(), operation = await prepareCoManagedProvisioning(db, input);
    const customer = tenantDb(db, operation.customer_tenant);
    await customer.table('tenants').insert({ tenant: operation.customer_tenant, product_code: 'co_managed' });
    await customer.table('users').insert({ tenant: operation.customer_tenant, user_id: randomUUID(), user_type: 'internal' });
    await requestCoManagedProvisioningCleanup(db, input.sponsorTenant, input.operationId);
    await expect(runCoManagedProvisioningStep(db, input.sponsorTenant, input.operationId, 'seeds', vi.fn())).rejects.toMatchObject({ code: 'OPERATION_CLOSED' });
    await expect(completeCoManagedProvisioningCleanup(db, input.sponsorTenant, input.operationId)).rejects.toMatchObject({ code: 'CLEANUP_INCOMPLETE' });
    await customer.table('tenants').del();
    await expect(completeCoManagedProvisioningCleanup(db, input.sponsorTenant, input.operationId)).rejects.toMatchObject({ code: 'CLEANUP_INCOMPLETE' });
    await customer.table('users').del();
    await completeCoManagedProvisioningCleanup(db, input.sponsorTenant, input.operationId);
    await completeCoManagedProvisioningCleanup(db, input.sponsorTenant, input.operationId);
    expect(await tenantDb(db, input.sponsorTenant).table('co_managed_allocations').first()).toMatchObject({ state: 'released' });
    expect(await customer.table('co_management_relationships').first()).toMatchObject({ state: 'terminated' });
    expect((await getCoManagedEntitlementState(db, input.sponsorTenant)).available).toBe(2);
  });

  it('does not cancel or modify an accepted customer through the provisioning cleanup path', async () => {
    const input = await requestFixture(), operation = await prepareCoManagedProvisioning(db, input);
    await tenantDb(db, operation.customer_tenant).table('co_management_relationships').update({ state: 'active', accepted_at: new Date(), accepted_by: randomUUID() });
    await expect(requestCoManagedProvisioningCleanup(db, input.sponsorTenant, input.operationId)).rejects.toMatchObject({ code: 'RELATIONSHIP_ACTIVE' });
    await expect(runCoManagedProvisioningStep(db, input.sponsorTenant, input.operationId, 'tenant', vi.fn())).rejects.toMatchObject({ code: 'RELATIONSHIP_ACTIVE' });
  });

  it('does not expose or operate on another sponsor’s operation', async () => {
    const input = await requestFixture(), other = await requestFixture();
    await prepareCoManagedProvisioning(db, input);
    await expect(requestCoManagedProvisioningCleanup(db, other.sponsorTenant, input.operationId)).rejects.toMatchObject({ code: 'OPERATION_NOT_FOUND' });
  });
});
