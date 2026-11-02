/**
 * The dashboard's "Assets by type" bubbles must count the same rows the grid
 * shows. The counts now run through the shared asset-list filter builder
 * (packages/assets/src/lib/assetListFilters.ts); this test drives the real
 * action against a real database to prove that:
 *
 *   1. unfiltered counts match a join-free GROUP BY exactly (the new left joins
 *      cannot inflate them),
 *   2. each filter narrows the counts the way the grid narrows rows,
 *   3. `asset_type` is EXCLUDED (facet semantics), so selecting a bubble never
 *      zeroes out the bubbles beside it,
 *   4. counts never cross the tenant boundary.
 *
 * Every row is seeded once in beforeAll and all expectations are written
 * against that one fixed dataset, so the cases cannot order-depend.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const HOOK_TIMEOUT = 180_000;
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
let getAssetCountsByType: typeof import('@alga-psa/assets/actions/assetStatisticsActions').getAssetCountsByType;
const columns: Record<string, Record<string, unknown>> = {};
const cleanupTenants = new Set<string>();

function hasColumn(name: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns[name] ?? {}, column);
}
function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}
function unscoped(name: string) {
  return tenantDb(db, '__asset_type_counts_fixture__').unscoped(name, 'asset type counts integration fixture');
}

async function cleanupTenant(tenant: string): Promise<void> {
  const del = async (name: string) => table(tenant, name).del().catch(() => undefined);
  for (const name of ['asset_group_members', 'asset_groups', 'assets', 'clients', 'vendors', 'users']) {
    await del(name);
  }
  await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
}

type TenantFixture = {
  tenantId: string;
  userId: string;
  clientA: string;
  clientB: string;
  vendor: string;
};

async function seedTenant(companyName: string): Promise<TenantFixture> {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  await unscoped('tenants').insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: companyName } : { client_name: companyName }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const userId = randomUUID();
  await table(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `atc-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    first_name: 'Count',
    last_name: 'Tester',
    ...(hasColumn('users', 'email') ? { email: `atc-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
    ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const mkClient = async (clientName: string) => {
    const client_id = randomUUID();
    await table(tenantId, 'clients').insert({
      tenant: tenantId,
      client_id,
      client_name: clientName,
      ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
    return client_id;
  };
  const clientA = await mkClient('Acme Widgets');
  const clientB = await mkClient('Globex Corp');

  const vendor = randomUUID();
  await table(tenantId, 'vendors').insert({
    tenant: tenantId,
    vendor_id: vendor,
    vendor_name: 'Contoso Supply',
    ...(hasColumn('vendors', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('vendors', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return { tenantId, userId, clientA, clientB, vendor };
}

type AssetSeed = {
  name: string;
  asset_type: string;
  client_id: string;
  status?: string;
  vendor_id?: string;
  rmm_provider?: string;
  rmm_device_id?: string;
};

async function seedAsset(tenantId: string, seed: AssetSeed): Promise<string> {
  const asset_id = randomUUID();
  await table(tenantId, 'assets').insert({
    tenant: tenantId,
    asset_id,
    asset_tag: `TAG-${asset_id.slice(0, 8)}`,
    serial_number: `SN-${asset_id.slice(0, 8)}`,
    name: seed.name,
    status: seed.status ?? 'active',
    asset_type: seed.asset_type,
    client_id: seed.client_id,
    ...(seed.vendor_id ? { vendor_id: seed.vendor_id } : {}),
    ...(hasColumn('assets', 'rmm_provider') ? { rmm_provider: seed.rmm_provider ?? null } : {}),
    ...(hasColumn('assets', 'rmm_device_id') ? { rmm_device_id: seed.rmm_device_id ?? null } : {}),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return asset_id;
}

describe('getAssetCountsByType filtered counts', () => {
  // Main tenant: 8 assets → workstation 4, server 2, network_device 2.
  //   clientA (Acme Widgets): Zeta Laptop(ws, rmm), Zeta Server(srv),
  //                           Retired Box(ws, retired), Switch-01(nd), Spare Switch(nd)
  //   clientB (Globex Corp):  Grouped WS(ws), Loose WS(ws), Vendor Server(srv, vendor)
  // Second tenant: 2 workstations, must never appear in the first tenant's counts.
  let fixture: TenantFixture;
  let other: TenantFixture;
  let groupId: string;

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    for (const t of ['tenants', 'clients', 'vendors', 'assets', 'users', 'asset_groups']) {
      columns[t] = await db(t).columnInfo();
    }

    fixture = await seedTenant('Counts PSA');
    other = await seedTenant('Initech');
    actionAuth.tenant = fixture.tenantId;
    actionAuth.userId = fixture.userId;

    const groupedAssetId = await seedAsset(fixture.tenantId, { name: 'Grouped WS', asset_type: 'workstation', client_id: fixture.clientB });
    await seedAsset(fixture.tenantId, { name: 'Loose WS', asset_type: 'workstation', client_id: fixture.clientB });
    await seedAsset(fixture.tenantId, { name: 'Vendor Server', asset_type: 'server', client_id: fixture.clientB, vendor_id: fixture.vendor });
    await seedAsset(fixture.tenantId, { name: 'Zeta Laptop', asset_type: 'workstation', client_id: fixture.clientA, rmm_provider: 'NinjaOne', rmm_device_id: 'rmm-1' });
    await seedAsset(fixture.tenantId, { name: 'Zeta Server', asset_type: 'server', client_id: fixture.clientA });
    await seedAsset(fixture.tenantId, { name: 'Retired Box', asset_type: 'workstation', client_id: fixture.clientA, status: 'retired' });
    await seedAsset(fixture.tenantId, { name: 'Switch-01', asset_type: 'network_device', client_id: fixture.clientA });
    await seedAsset(fixture.tenantId, { name: 'Spare Switch', asset_type: 'network_device', client_id: fixture.clientA });

    groupId = randomUUID();
    await table(fixture.tenantId, 'asset_groups').insert({
      tenant: fixture.tenantId,
      group_id: groupId,
      client_id: fixture.clientB,
      name: `Group ${groupId.slice(0, 8)}`,
      ...(hasColumn('asset_groups', 'kind') ? { kind: 'bundle' } : {}),
    });
    await table(fixture.tenantId, 'asset_group_members').insert({
      tenant: fixture.tenantId,
      group_id: groupId,
      asset_id: groupedAssetId,
    });

    await seedAsset(other.tenantId, { name: 'Initech WS 1', asset_type: 'workstation', client_id: other.clientA });
    await seedAsset(other.tenantId, { name: 'Initech WS 2', asset_type: 'workstation', client_id: other.clientA });

    getAssetCountsByType = (await import('@alga-psa/assets/actions/assetStatisticsActions')).getAssetCountsByType;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) {
      await cleanupTenant(tenant).catch(() => undefined);
    }
    await db?.destroy?.();
  }, HOOK_TIMEOUT);

  it('matches a join-free GROUP BY exactly', async () => {
    const counts = await getAssetCountsByType({});
    expect(counts).toEqual({ workstation: 4, server: 2, network_device: 2 });

    // Ground truth without any join. clients/contacts/vendors are joined on
    // primary keys (1:1), so this equality is what proves the joins — added for
    // the search predicate — do not fan rows out.
    const raw = await table(fixture.tenantId, 'assets')
      .select('asset_type')
      .count('asset_id as count')
      .groupBy('asset_type');
    const rawMap: Record<string, number> = {};
    for (const row of raw) rawMap[String(row.asset_type)] = Number(row.count);
    expect(counts).toEqual(rawMap);
  });

  it('narrows counts by client', async () => {
    expect(await getAssetCountsByType({ client_id: fixture.clientB })).toEqual({
      workstation: 2,
      server: 1,
    });
  });

  it('narrows counts by status', async () => {
    expect(await getAssetCountsByType({ status: 'retired' })).toEqual({ workstation: 1 });
    expect(await getAssetCountsByType({ status: 'active' })).toEqual({
      workstation: 3,
      server: 2,
      network_device: 2,
    });
  });

  it('searches asset columns and the joined client name', async () => {
    // Matches asset names only.
    expect(await getAssetCountsByType({ search: 'Zeta' })).toEqual({ workstation: 1, server: 1 });
    // Reaches the count only through clients.client_name — the join is required.
    expect(await getAssetCountsByType({ search: 'Globex' })).toEqual({ workstation: 2, server: 1 });
  });

  it('combines filters', async () => {
    expect(await getAssetCountsByType({ client_id: fixture.clientA, search: 'Switch' })).toEqual({
      network_device: 2,
    });
  });

  it('ignores asset_type so a selected bubble keeps the other bubbles alive', async () => {
    // The dashboard omits asset_type (facet semantics); passing one must not
    // zero the remaining types, which is what the user needs to switch to.
    const counts = await getAssetCountsByType({
      client_id: fixture.clientA,
      asset_type: 'workstation',
    } as never);

    expect(counts).toEqual({ workstation: 2, server: 1, network_device: 2 });
  });

  it('splits by rmm_managed', async () => {
    expect(await getAssetCountsByType({ rmm_managed: true })).toEqual({ workstation: 1 });
    expect(await getAssetCountsByType({ rmm_managed: false })).toEqual({
      workstation: 3,
      server: 2,
      network_device: 2,
    });
  });

  it('narrows by vendor', async () => {
    expect(await getAssetCountsByType({ vendor_id: fixture.vendor })).toEqual({ server: 1 });
  });

  it('applies group membership and the ungrouped filter', async () => {
    expect(await getAssetCountsByType({ group_id: groupId })).toEqual({ workstation: 1 });
    expect(await getAssetCountsByType({ ungrouped_only: true })).toEqual({
      workstation: 3,
      server: 2,
      network_device: 2,
    });
  });

  it('never counts another tenant assets', async () => {
    expect(await getAssetCountsByType({})).toEqual({ workstation: 4, server: 2, network_device: 2 });

    actionAuth.tenant = other.tenantId;
    try {
      expect(await getAssetCountsByType({})).toEqual({ workstation: 2 });
      // 'Globex' is the first tenant's client name; it must not match here.
      expect(await getAssetCountsByType({ search: 'Globex' })).toEqual({});
    } finally {
      actionAuth.tenant = fixture.tenantId;
    }
  });

  it('rejects invalid filter values instead of silently ignoring them', async () => {
    await expect(getAssetCountsByType({ client_id: 'not-a-uuid' } as never)).rejects.toThrow();
    await expect(getAssetCountsByType({ rmm_managed: 'yes' } as never)).rejects.toThrow();
  });
});
