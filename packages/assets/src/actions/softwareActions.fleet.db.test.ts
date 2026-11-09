import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createWorkspaceTestDbConnection } from '../../../db/test-utils/workspaceConnection';

const holder: {
  knex: Knex;
  tenant: string;
  userId: string;
  readableClientIds: Set<string>;
} = {
  knex: undefined as never,
  tenant: '',
  userId: '',
  readableClientIds: new Set(),
};

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => unknown) => (...args: unknown[]) =>
    fn({ user_id: holder.userId, tenant: holder.tenant, user_type: 'internal' }, { tenant: holder.tenant }, ...args),
  hasPermission: async () => true,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: holder.knex, tenant: holder.tenant }),
  };
});

// Keep the shared readable-asset query and the production fleet action real;
// provide a deterministic selected-client policy decision for these fixtures.
vi.mock('../lib/assetReadAuthorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/assetReadAuthorization')>();
  return {
    ...actual,
    createAssetReadContext: async () => ({
      subject: {},
      authorizationKernel: {
        authorizeResource: async ({ record }: { record?: { clientId?: string | null } }) => ({
          allowed: Boolean(record?.clientId && holder.readableClientIds.has(record.clientId)),
        }),
      },
      requestCache: {},
    }),
  };
});

import { searchSoftwareFleetWide } from './softwareActions';

let db: Knex;
let trx: Knex.Transaction;
let tenant: string;
let clientA: string;
let clientB: string;

beforeAll(async () => {
  db = createWorkspaceTestDbConnection();
});

beforeEach(async () => {
  trx = await db.transaction();
  holder.knex = trx;
  tenant = randomUUID();
  clientA = randomUUID();
  clientB = randomUUID();
  holder.tenant = tenant;
  holder.userId = randomUUID();
  holder.readableClientIds = new Set([clientA]);

  await trx('tenants').insert({
    tenant,
    client_name: `Software fleet ${tenant}`,
    email: `software-fleet-${tenant}@example.invalid`,
    product_code: 'psa',
  });
  await trx('clients').insert([
    { tenant, client_id: clientA, client_name: 'Readable client', billing_cycle: 'monthly', billing_email: `a-${tenant}@example.invalid` },
    { tenant, client_id: clientB, client_name: 'Excluded client', billing_cycle: 'monthly', billing_email: `b-${tenant}@example.invalid` },
  ]);
});

afterEach(async () => {
  await trx?.rollback().catch(() => undefined);
});

afterAll(async () => {
  await db?.destroy();
});

async function addAsset(clientId: string, name: string): Promise<string> {
  const assetId = randomUUID();
  await trx('assets').insert({
    tenant,
    asset_id: assetId,
    asset_type: 'workstation',
    client_id: clientId,
    asset_tag: `SW-${assetId.slice(0, 8)}`,
    name,
    serial_number: `SER-${assetId.slice(0, 8)}`,
    status: 'active',
    location: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return assetId;
}

async function addSoftware(name: string, category: string): Promise<string> {
  const softwareId = randomUUID();
  await trx('software_catalog').insert({
    tenant,
    software_id: softwareId,
    name,
    normalized_name: name.toLowerCase(),
    publisher: 'Test Publisher',
    category,
    software_type: 'application',
    is_managed: false,
    is_security_relevant: false,
  });
  return softwareId;
}

async function install(assetId: string, softwareId: string): Promise<void> {
  await trx('asset_software').insert({
    tenant,
    asset_id: assetId,
    software_id: softwareId,
    version: '1.0',
    is_current: true,
  });
}

describe('searchSoftwareFleetWide database authorization', () => {
  it('limits counts, previews, filters, and pagination to readable-client installs', async () => {
    const readableAsset1 = await addAsset(clientA, 'Readable workstation 1');
    const readableAsset2 = await addAsset(clientA, 'Readable workstation 2');
    const excludedAsset = await addAsset(clientB, 'Excluded workstation');
    const sharedSoftware = await addSoftware('Shared App', 'Browser');
    const readableOnlySoftware = await addSoftware('Readable Only App', 'Productivity');
    const excludedOnlySoftware = await addSoftware('Excluded Secret App', 'Security');

    await install(readableAsset1, sharedSoftware);
    await install(readableAsset2, sharedSoftware);
    await install(excludedAsset, sharedSoftware);
    await install(readableAsset2, readableOnlySoftware);
    await install(excludedAsset, excludedOnlySoftware);

    const firstPage = await searchSoftwareFleetWide({ page: 1, limit: 1 });
    expect(firstPage).toMatchObject({ total: 2, page: 1, limit: 1 });
    expect(firstPage.results).toHaveLength(1);
    expect(firstPage.results[0]).toMatchObject({
      software_id: sharedSoftware,
      name: 'Shared App',
      install_count: 2,
    });
    expect(firstPage.results[0].assets.map((asset) => asset.asset_id).sort()).toEqual([readableAsset1, readableAsset2].sort());
    expect(firstPage.results[0].assets.every((asset) => asset.client_id === clientA)).toBe(true);

    const secondPage = await searchSoftwareFleetWide({ page: 2, limit: 1 });
    expect(secondPage).toMatchObject({ total: 2, page: 2, limit: 1 });
    expect(secondPage.results.map((row) => row.software_id)).toEqual([readableOnlySoftware]);
    expect(secondPage.results[0].install_count).toBe(1);
    expect(secondPage.results[0].assets.map((asset) => asset.asset_id)).toEqual([readableAsset2]);

    const outOfRangePage = await searchSoftwareFleetWide({ page: 3, limit: 1 });
    expect(outOfRangePage).toMatchObject({ total: 2, page: 3, limit: 1, results: [] });

    const excludedOnlyCategory = await searchSoftwareFleetWide({ category: 'Security' });
    expect(excludedOnlyCategory).toMatchObject({ total: 0, results: [] });
    const excludedOnlySearch = await searchSoftwareFleetWide({ search: 'Excluded Secret App' });
    expect(excludedOnlySearch).toMatchObject({ total: 0, results: [] });
    const excludedClientFilter = await searchSoftwareFleetWide({ client_id: clientB });
    expect(excludedClientFilter).toMatchObject({ total: 0, results: [] });
  });

  it('returns no catalog results or totals when the caller has no readable assets', async () => {
    const assetId = await addAsset(clientA, 'Readable before policy change');
    const softwareId = await addSoftware('Any App', 'Productivity');
    await install(assetId, softwareId);
    holder.readableClientIds = new Set();

    await expect(searchSoftwareFleetWide({})).resolves.toMatchObject({
      total: 0,
      results: [],
    });
  });
});
