/**
 * REST extension_data writes against the real extension-table schema.
 *
 * The mocked unit cover (assetService.extensionData.test.ts) accepted any
 * column name, so upsertExtensionData's `created_at`/`updated_at` — columns
 * that have never existed on workstation_assets / network_device_assets /
 * server_assets / mobile_device_assets / printer_assets — turned every real
 * payload into a 42703 500, and a bare JS array into a 22P02 one. These cases
 * run the service against a migrated Postgres so that drift fails here.
 *
 * Also covers atomicity: the extension write shares the asset write's
 * transaction, so a Postgres failure on the extension row leaves no orphan
 * asset and no partially applied PUT.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const HOOK_TIMEOUT = 180_000;
const columns: Record<string, Record<string, unknown>> = {};

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: db, tenant: fixtureTenant }),
    withTransaction: async (knex: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) => knex.transaction(callback),
  };
});

let db: Knex;
let fixtureTenant = '';
let AssetService: typeof import('../../lib/api/services/AssetService').AssetService;
const cleanupTenants = new Set<string>();

function hasColumn(name: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns[name] ?? {}, column);
}
function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}
function unscoped(name: string) {
  return tenantDb(db, '__asset_extension_fixture__').unscoped(name, 'asset extension integration fixture');
}

type Fixture = { tenantId: string; userId: string; clientId: string; ctx: any };

async function seedFixture(): Promise<Fixture> {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  fixtureTenant = tenantId;
  await unscoped('tenants').insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: 'Asset Extension PSA' } : { client_name: 'Asset Extension PSA' }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const userId = randomUUID();
  await table(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `asset-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    first_name: 'Asset',
    last_name: 'Tester',
    ...(hasColumn('users', 'email') ? { email: `asset-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
    ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const clientId = randomUUID();
  await table(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Emerald City',
    ...(hasColumn('clients', 'billing_email') ? { billing_email: 'ops@emerald.example' } : {}),
    ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  // A tenant made straight in SQL misses the status registry real tenants get
  // from the migration, and asset writes validate against it.
  await table(tenantId, 'asset_statuses').insert([
    { tenant: tenantId, slug: 'active', label: 'Active', kind: 'deployable', is_builtin: true, is_active: true, display_order: 0 },
  ]);

  return { tenantId, userId, clientId, ctx: { tenant: tenantId, userId, db } };
}

async function cleanupTenant(tenant: string): Promise<void> {
  const del = async (name: string) => table(tenant, name).del().catch(() => undefined);
  for (const name of [
    'asset_history',
    'workstation_assets',
    'network_device_assets',
    'assets',
    'asset_statuses',
    'clients',
    'users',
  ]) {
    await del(name);
  }
  await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
}

const basePayload = (clientId: string, assetType: string, tag: string) => ({
  asset_type: assetType,
  client_id: clientId,
  asset_tag: tag,
  name: `Fixture ${assetType}`,
  status: 'active',
});

// Passes the Zod schema (z.number().min(0)) and overflows the column's int4.
const OVERFLOWING_PORT_COUNT = 2 ** 40;

describe('AssetService extension_data against the real extension tables (integration)', () => {
  beforeAll(async () => {
    // Use the worktree's isolated test Postgres (and its secret-backed
    // credentials) rather than whatever local server .env happened to load.
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'clients']) {
      columns[name] = await tenantDb(db, '__asset_extension_schema__').unscoped(name, 'schema introspection').columnInfo();
    }
    ({ AssetService } = await import('../../lib/api/services/AssetService'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('writes the extension row on create for scalar and jsonb-array payloads', async () => {
    const fx = await seedFixture();
    const service = new AssetService();

    const device = await service.create({
      ...basePayload(fx.clientId, 'network_device', `EXT-FW-${randomUUID().slice(0, 8)}`),
      extension_data: { device_type: 'firewall', management_ip: '192.168.10.4', port_count: 24, supports_poe: true },
    } as any, fx.ctx);

    const deviceRow = await table(fx.tenantId, 'network_device_assets').where({ asset_id: device.asset_id }).first();
    expect(deviceRow).toMatchObject({
      asset_id: device.asset_id,
      tenant: fx.tenantId,
      device_type: 'firewall',
      management_ip: '192.168.10.4',
      port_count: 24,
      supports_poe: true,
    });
    // getWithDetails hydrates the same row back onto the REST response.
    expect(device.extension_data).toMatchObject({ management_ip: '192.168.10.4' });

    // A bare JS array on a jsonb column used to fail with 22P02.
    const workstation = await service.create({
      ...basePayload(fx.clientId, 'workstation', `EXT-WS-${randomUUID().slice(0, 8)}`),
      extension_data: { os_type: 'windows', os_version: '11', installed_software: ['Chrome', 'Slack'] },
    } as any, fx.ctx);

    const workstationRow = await table(fx.tenantId, 'workstation_assets').where({ asset_id: workstation.asset_id }).first();
    expect(workstationRow).toMatchObject({ os_type: 'windows', os_version: '11' });
    expect(workstationRow.installed_software).toEqual(['Chrome', 'Slack']);
  }, HOOK_TIMEOUT);

  it('updates the extension row and the base columns in one PUT', async () => {
    const fx = await seedFixture();
    const service = new AssetService();

    const created = await service.create({
      ...basePayload(fx.clientId, 'network_device', `EXT-SW-${randomUUID().slice(0, 8)}`),
      extension_data: { device_type: 'switch', management_ip: '10.0.0.5', port_count: 8 },
    } as any, fx.ctx);

    // The UPDATE SET path: it must not touch tenant/asset_id (Citus partition
    // key + PK) nor any timestamp column these tables do not have.
    const updated = await service.update(created.asset_id, {
      name: 'Closet switch',
      extension_data: { management_ip: '10.0.0.9', firmware_version: '4.1.13' },
    } as any, fx.ctx);
    expect(updated.name).toBe('Closet switch');

    const row = await table(fx.tenantId, 'network_device_assets').where({ asset_id: created.asset_id }).first();
    expect(row).toMatchObject({
      device_type: 'switch',
      management_ip: '10.0.0.9',
      firmware_version: '4.1.13',
      port_count: 8,
    });
    const assetRow = await table(fx.tenantId, 'assets').where({ asset_id: created.asset_id }).first();
    expect(assetRow.name).toBe('Closet switch');
  }, HOOK_TIMEOUT);

  it('rolls the asset insert back when the extension write fails on create', async () => {
    const fx = await seedFixture();
    const service = new AssetService();
    const tag = `EXT-ROLLBACK-${randomUUID().slice(0, 8)}`;

    await expect(service.create({
      ...basePayload(fx.clientId, 'network_device', tag),
      extension_data: { device_type: 'router', management_ip: '10.0.1.1', port_count: OVERFLOWING_PORT_COUNT },
    } as any, fx.ctx)).rejects.toThrow();

    // No orphan asset: the tag is free, so the caller's retry is not blocked by
    // a duplicate asset_tag on a row it never got to see.
    expect(await table(fx.tenantId, 'assets').where({ asset_tag: tag })).toHaveLength(0);

    const retried = await service.create({
      ...basePayload(fx.clientId, 'network_device', tag),
      extension_data: { device_type: 'router', management_ip: '10.0.1.1', port_count: 48 },
    } as any, fx.ctx);
    expect(await table(fx.tenantId, 'network_device_assets').where({ asset_id: retried.asset_id })).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('rolls the base column changes back when the extension write fails on update', async () => {
    const fx = await seedFixture();
    const service = new AssetService();

    const created = await service.create({
      ...basePayload(fx.clientId, 'network_device', `EXT-PUT-${randomUUID().slice(0, 8)}`),
      extension_data: { device_type: 'switch', management_ip: '10.0.0.5', port_count: 8 },
    } as any, fx.ctx);

    await expect(service.update(created.asset_id, {
      name: 'Renamed by a failing PUT',
      extension_data: { port_count: OVERFLOWING_PORT_COUNT },
    } as any, fx.ctx)).rejects.toThrow();

    const assetRow = await table(fx.tenantId, 'assets').where({ asset_id: created.asset_id }).first();
    expect(assetRow.name).toBe('Fixture network_device');
    const row = await table(fx.tenantId, 'network_device_assets').where({ asset_id: created.asset_id }).first();
    expect(row).toMatchObject({ management_ip: '10.0.0.5', port_count: 8 });
  }, HOOK_TIMEOUT);
});
