/**
 * alga0002283 — "Failed to update asset" when saving an asset form.
 *
 * Real-DB regression: Quick-Add style create -> getAsset -> the edit form's
 * load/submit mapping -> a warranty-only updateAsset. Before the fix pg
 * returned `power_draw_watts` (decimal(8,2)) as the string "0.00", the update
 * schema's z.number() rejected it, and the form only showed a generic toast.
 *
 * Covers a network device (numeric string column) and a workstation, each with
 * the legacy zero-filled Quick Add payload and the new null payload.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

const published = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn(async (event: unknown) => { published.calls.push(event); }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const HOOK_TIMEOUT = 180_000;
const columns: Record<string, Record<string, unknown>> = {};
const actionAuth = vi.hoisted(() => ({ tenant: '', userId: '' }));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    hasPermission: vi.fn().mockResolvedValue(true),
    withAuth: (action: any) => async (...args: unknown[]) => action(
      { user_id: actionAuth.userId },
      { tenant: actionAuth.tenant },
      ...args,
    ),
  };
});
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: db, tenant: actionAuth.tenant }),
    withTransaction: async (knex: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) => knex.transaction(callback),
  };
});

let db: Knex;
let createAsset: typeof import('@alga-psa/assets/actions/assetActions').createAsset;
let getAsset: typeof import('@alga-psa/assets/actions/assetActions').getAsset;
let updateAsset: typeof import('@alga-psa/assets/actions/assetActions').updateAsset;
let isAssetValidationError: typeof import('@alga-psa/assets/actions/assetActionErrors').isAssetValidationError;
const cleanupTenants = new Set<string>();

function hasColumn(name: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns[name] ?? {}, column);
}
function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}
function unscoped(name: string) {
  return tenantDb(db, '__asset_save_fixture__').unscoped(name, 'asset save integration fixture');
}

async function seedTenant(): Promise<{ tenantId: string; userId: string; clientId: string }> {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  await unscoped('tenants').insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: 'Asset Save PSA' } : { client_name: 'Asset Save PSA' }),
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
    client_name: 'EQUIT Fixture Client',
    ...(hasColumn('clients', 'billing_email') ? { billing_email: 'ops@equit.example' } : {}),
    ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  actionAuth.tenant = tenantId;
  actionAuth.userId = userId;
  return { tenantId, userId, clientId };
}

async function cleanupTenant(tenant: string): Promise<void> {
  const del = async (name: string) => table(tenant, name).del().catch(() => undefined);
  for (const name of [
    'asset_history',
    'workstation_assets',
    'network_device_assets',
    'assets',
    'clients',
    'users',
  ]) {
    await del(name);
  }
  await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
}

/**
 * Mirrors AssetForm: the load mapping (`?? null` for numerics) followed by the
 * unchanged submit mapping, with only the warranty date edited. The component
 * itself is covered by AssetForm.customTypes.test.tsx; here the point is the
 * real getAsset output feeding a real updateAsset.
 */
function formPayloadFromLoadedAsset(asset: any, warrantyEnd: string) {
  const payload: Record<string, unknown> = {
    asset_type: asset.asset_type,
    client_id: asset.client_id,
    name: asset.name,
    asset_tag: asset.asset_tag,
    serial_number: asset.serial_number?.trim() || undefined,
    status: asset.status,
    location_id: asset.location_id ?? null,
    location: asset.location?.trim() || undefined,
    purchase_date: typeof asset.purchase_date === 'string'
      ? new Date(asset.purchase_date.split('T')[0] + 'T00:00:00Z').toISOString()
      : undefined,
    warranty_end_date: new Date(warrantyEnd + 'T00:00:00Z').toISOString(),
  };
  if (asset.workstation) {
    const w = asset.workstation;
    payload.workstation = {
      os_type: w.os_type || '',
      os_version: w.os_version || '',
      cpu_model: w.cpu_model || '',
      cpu_cores: w.cpu_cores ?? null,
      ram_gb: w.ram_gb ?? null,
      storage_type: w.storage_type || '',
      storage_capacity_gb: w.storage_capacity_gb ?? null,
      gpu_model: w.gpu_model?.trim() || undefined,
      installed_software: Array.isArray(w.installed_software) ? w.installed_software : [],
    };
  }
  if (asset.network_device) {
    const n = asset.network_device;
    payload.network_device = {
      device_type: n.device_type || 'switch',
      management_ip: n.management_ip || '',
      port_count: n.port_count ?? null,
      firmware_version: n.firmware_version || '',
      supports_poe: n.supports_poe || false,
      power_draw_watts: n.power_draw_watts ?? null,
      vlan_config: n.vlan_config || {},
      port_config: n.port_config || {},
    };
  }
  return payload;
}

type Case = {
  label: string;
  assetType: 'network_device' | 'workstation';
  createPayload: (clientId: string) => Record<string, unknown>;
  stored: (row: any) => Record<string, number | null>;
  expected: Record<string, number | null>;
};

const base = (clientId: string, assetType: string) => ({
  asset_type: assetType,
  client_id: clientId,
  asset_tag: `TAG-${randomUUID().slice(0, 8)}`,
  name: `Fixture ${assetType}`,
  status: 'active',
  location_id: null,
});

const CASES: Case[] = [
  {
    label: 'network device, legacy Quick Add payload (zeros)',
    assetType: 'network_device',
    createPayload: (clientId) => ({
      ...base(clientId, 'network_device'),
      network_device: {
        device_type: 'switch', management_ip: '10.0.0.2', port_count: 0, firmware_version: '',
        supports_poe: false, power_draw_watts: 0, vlan_config: {}, port_config: {},
      },
    }),
    stored: (row) => ({ port_count: row.port_count, power_draw_watts: row.power_draw_watts === null ? null : Number(row.power_draw_watts) }),
    expected: { port_count: 0, power_draw_watts: 0 },
  },
  {
    label: 'network device, Quick Add payload (nulls)',
    assetType: 'network_device',
    createPayload: (clientId) => ({
      ...base(clientId, 'network_device'),
      network_device: {
        device_type: 'router', management_ip: '10.0.0.3', port_count: null, firmware_version: '',
        supports_poe: false, power_draw_watts: null, vlan_config: {}, port_config: {},
      },
    }),
    stored: (row) => ({ port_count: row.port_count, power_draw_watts: row.power_draw_watts === null ? null : Number(row.power_draw_watts) }),
    expected: { port_count: null, power_draw_watts: null },
  },
  {
    label: 'workstation, legacy Quick Add payload (zeros)',
    assetType: 'workstation',
    createPayload: (clientId) => ({
      ...base(clientId, 'workstation'),
      workstation: {
        os_type: 'windows', os_version: '11', cpu_model: '', cpu_cores: 0, ram_gb: 0,
        storage_type: '', storage_capacity_gb: 0, installed_software: [],
      },
    }),
    stored: (row) => ({ cpu_cores: row.cpu_cores, ram_gb: row.ram_gb, storage_capacity_gb: row.storage_capacity_gb }),
    expected: { cpu_cores: 0, ram_gb: 0, storage_capacity_gb: 0 },
  },
  {
    label: 'workstation, Quick Add payload (nulls)',
    assetType: 'workstation',
    createPayload: (clientId) => ({
      ...base(clientId, 'workstation'),
      workstation: {
        os_type: 'macos', os_version: '15', cpu_model: '', cpu_cores: null, ram_gb: null,
        storage_type: '', storage_capacity_gb: null, installed_software: [],
      },
    }),
    stored: (row) => ({ cpu_cores: row.cpu_cores, ram_gb: row.ram_gb, storage_capacity_gb: row.storage_capacity_gb }),
    expected: { cpu_cores: null, ram_gb: null, storage_capacity_gb: null },
  },
];

describe('asset save: Quick Add create -> load -> warranty-only update (alga0002283)', () => {
  beforeAll(async () => {
    // Isolated per-worktree Postgres (set TEST_DB_NAME) with secret-backed credentials.
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'clients']) {
      columns[name] = await tenantDb(db, '__asset_save_schema__').unscoped(name, 'schema introspection').columnInfo();
    }
    ({ createAsset, getAsset, updateAsset } = await import('@alga-psa/assets/actions/assetActions'));
    ({ isAssetValidationError } = await import('@alga-psa/assets/actions/assetActionErrors'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it.each(CASES)('$label saves a warranty-only edit', async (testCase) => {
    const { tenantId, clientId } = await seedTenant();
    published.calls.length = 0;

    const created: any = await createAsset(testCase.createPayload(clientId) as any);
    expect(isAssetValidationError(created)).toBe(false);
    expect(created.asset_id).toBeTruthy();

    // getAsset hands the form a normalised Asset: numbers are numbers (pg returns
    // decimal(8,2) as a string) and timestamps are strings, never Date objects.
    const loaded: any = await getAsset(created.asset_id);
    expect(loaded.asset_id).toBe(created.asset_id);
    expect(typeof loaded.created_at).toBe('string');
    const extension = loaded[testCase.assetType];
    for (const [key, expected] of Object.entries(testCase.expected)) {
      expect(extension[key]).toBe(expected);
    }

    const payload = formPayloadFromLoadedAsset(loaded, '2026-12-31');
    const result: any = await updateAsset(created.asset_id, payload as any);

    // The failing behaviour: a returned/thrown validation error on a warranty-only edit.
    expect(isAssetValidationError(result), JSON.stringify(result)).toBe(false);
    expect(result.asset_id).toBe(created.asset_id);
    expect(String(result.warranty_end_date)).toContain('2026-12-31');

    const assetRow = await table(tenantId, 'assets').where({ asset_id: created.asset_id }).first();
    expect(new Date(assetRow.warranty_end_date).toISOString()).toBe('2026-12-31T00:00:00.000Z');

    // The extension numerics survive the round trip unchanged (0 stays 0, null stays null).
    const extTable = testCase.assetType === 'network_device' ? 'network_device_assets' : 'workstation_assets';
    const extRow = await table(tenantId, extTable).where({ asset_id: created.asset_id }).first();
    expect(testCase.stored(extRow)).toEqual(testCase.expected);

    // Workflow events were published best-effort post-commit.
    expect(published.calls.length).toBeGreaterThan(0);
  });

  it('returns validationIssues (does not throw) when the update payload is invalid', async () => {
    const { clientId } = await seedTenant();
    const created: any = await createAsset(CASES[0].createPayload(clientId) as any);

    const result: any = await updateAsset(created.asset_id, {
      network_device: { power_draw_watts: 'not-a-number' },
    } as any);

    expect(isAssetValidationError(result)).toBe(true);
    expect(result.validationIssues.some((i: any) => i.path.join('.') === 'network_device.power_draw_watts')).toBe(true);
  });
});
