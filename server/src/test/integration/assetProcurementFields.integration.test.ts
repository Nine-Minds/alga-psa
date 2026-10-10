/**
 * alga-2026-0002672 — asset record fields (FR-A1 / FR-A4).
 *
 * Real-DB coverage for the new first-class columns: the schema shape and the
 * composite vendor FK (T001), create/update persistence with the tenant
 * currency default (T004/T006), vendor validation (T005) and the vendor_name
 * join on read (T007).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
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
let listAssets: typeof import('@alga-psa/assets/actions/assetActions').listAssets;
let assetActionErrorFrom: typeof import('@alga-psa/assets/actions/assetActionErrors').assetActionErrorFrom;

const cleanupTenants = new Set<string>();

function hasColumn(name: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns[name] ?? {}, column);
}
function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}
function unscoped(name: string) {
  return tenantDb(db, '__asset_fields_fixture__').unscoped(name, 'asset fields integration fixture');
}

async function seedTenant(currency?: string): Promise<{ tenantId: string; userId: string; clientId: string; vendorId: string }> {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  await unscoped('tenants').insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: 'Asset Fields PSA' } : { client_name: 'Asset Fields PSA' }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const userId = randomUUID();
  await table(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `fields-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    first_name: 'Asset',
    last_name: 'Fields',
    ...(hasColumn('users', 'email') ? { email: `fields-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
    ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const clientId = randomUUID();
  await table(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Asset Fields Client',
    ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const vendorId = randomUUID();
  await table(tenantId, 'vendors').insert({
    tenant: tenantId,
    vendor_id: vendorId,
    vendor_name: 'Acme Supplies',
    is_active: true,
  });

  if (currency) {
    await table(tenantId, 'default_billing_settings').insert({
      tenant: tenantId,
      default_currency_code: currency,
    }).onConflict(['tenant']).merge({ default_currency_code: currency });
  }

  // A tenant made straight in SQL misses the onboarding seed that gives real
  // tenants their builtin statuses, and every asset write validates its slug.
  await table(tenantId, 'asset_statuses')
    .insert(BUILTIN_STATUSES.map((status) => ({ tenant: tenantId, ...status, is_builtin: true, is_active: true })));

  actionAuth.tenant = tenantId;
  actionAuth.userId = userId;
  return { tenantId, userId, clientId, vendorId };
}

async function cleanupTenant(tenant: string): Promise<void> {
  const del = async (name: string) => table(tenant, name).del().catch(() => undefined);
  for (const name of ['asset_history', 'assets', 'asset_statuses', 'vendors', 'default_billing_settings', 'clients', 'users']) {
    await del(name);
  }
  await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
}

const BUILTIN_STATUSES = [
  { slug: 'active', label: 'Active', kind: 'deployable', display_order: 0 },
  { slug: 'retired', label: 'Retired', kind: 'archived', display_order: 4 },
];

const baseAsset = (clientId: string) => ({
  asset_type: 'unknown',
  client_id: clientId,
  asset_tag: `TAG-${randomUUID().slice(0, 8)}`,
  name: 'Fixture laptop',
  status: 'active',
  location_id: null,
});

describe('asset procurement fields', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'clients', 'assets']) {
      columns[name] = await tenantDb(db, '__asset_fields_schema__').unscoped(name, 'schema introspection').columnInfo();
    }
    ({ createAsset, getAsset, updateAsset, listAssets } = await import('@alga-psa/assets/actions/assetActions'));
    ({ assetActionErrorFrom } = await import('@alga-psa/assets/actions/assetActionErrors'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  // T001
  it('adds the columns with the expected types and a composite vendor FK', async () => {
    const info = columns.assets as Record<string, { type?: string; nullable?: boolean }>;
    expect(info.manufacturer?.type).toBe('text');
    expect(info.model?.type).toBe('text');
    expect(info.vendor_id?.type).toBe('uuid');
    expect(info.purchase_cost?.type).toBe('bigint');
    expect(info.purchase_cost_currency?.type).toBe('text');
    expect(info.order_number?.type).toBe('text');
    for (const column of ['manufacturer', 'model', 'vendor_id', 'purchase_cost', 'purchase_cost_currency', 'order_number']) {
      expect(info[column]?.nullable, `${column} must be nullable`).toBe(true);
    }

    const fk = await db.raw(
      `SELECT array_agg(att.attname::text ORDER BY att.attname) AS cols
         FROM pg_constraint con
         JOIN pg_attribute att
           ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
        WHERE con.conrelid = 'assets'::regclass
          AND con.contype = 'f'
          AND con.confrelid = 'vendors'::regclass
        GROUP BY con.oid`
    );
    expect(fk.rows.length).toBeGreaterThan(0);
    expect(fk.rows[0].cols.sort()).toEqual(['tenant', 'vendor_id']);
  });

  // T004
  it('createAsset persists the new fields and defaults the currency to the tenant currency', async () => {
    const { tenantId, clientId, vendorId } = await seedTenant('EUR');
    const created: any = await createAsset({
      ...baseAsset(clientId),
      manufacturer: 'Lenovo',
      model: 'ThinkPad T14',
      vendor_id: vendorId,
      purchase_cost: 123456,
      order_number: 'PO-4471',
    } as any);

    expect(assetActionErrorFrom(created)).toBeNull();
    const row = await table(tenantId, 'assets').where({ asset_id: created.asset_id }).first();
    expect(row.manufacturer).toBe('Lenovo');
    expect(row.model).toBe('ThinkPad T14');
    expect(row.vendor_id).toBe(vendorId);
    expect(Number(row.purchase_cost)).toBe(123456);
    expect(row.purchase_cost_currency).toBe('EUR');
    expect(row.order_number).toBe('PO-4471');
    // The importer no longer stuffs these into attributes.
    expect(row.attributes?.manufacturer).toBeUndefined();
  });

  // T005
  it('createAsset rejects a vendor from another tenant or one that does not exist', async () => {
    const own = await seedTenant();
    const other = await seedTenant();
    // seedTenant leaves the session on the tenant it just made; go back.
    actionAuth.tenant = own.tenantId;
    actionAuth.userId = own.userId;

    // Validation failures throw, as every other unavailable-selection check in
    // createAsset does; the UI maps the throw through assetActionErrorFrom.
    const crossTenant = await createAsset({
      ...baseAsset(own.clientId),
      vendor_id: other.vendorId,
    } as any).catch((error: unknown) => error);
    expect(crossTenant).toBeInstanceOf(Error);
    expect(assetActionErrorFrom(crossTenant)).not.toBeNull();

    const missing = await createAsset({
      ...baseAsset(own.clientId),
      vendor_id: randomUUID(),
    } as any).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(Error);
    expect(assetActionErrorFrom(missing)).not.toBeNull();
  });

  // T006
  it('updateAsset clears vendor_id and purchase_cost with an explicit null', async () => {
    const { tenantId, clientId, vendorId } = await seedTenant('USD');
    const created: any = await createAsset({
      ...baseAsset(clientId),
      vendor_id: vendorId,
      purchase_cost: 50000,
      manufacturer: 'Dell',
    } as any);

    const updated: any = await updateAsset(created.asset_id, {
      vendor_id: null,
      purchase_cost: null,
      manufacturer: null,
    } as any);
    expect(assetActionErrorFrom(updated)).toBeNull();

    const row = await table(tenantId, 'assets').where({ asset_id: created.asset_id }).first();
    expect(row.vendor_id).toBeNull();
    expect(row.purchase_cost).toBeNull();
    expect(row.purchase_cost_currency).toBeNull();
    expect(row.manufacturer).toBeNull();
  });

  // T007
  it('getAsset and listAssets return vendor_name from the joined vendor', async () => {
    const { clientId, vendorId } = await seedTenant();
    const created: any = await createAsset({
      ...baseAsset(clientId),
      vendor_id: vendorId,
      manufacturer: 'Lenovo',
    } as any);

    const fetched: any = await getAsset(created.asset_id);
    expect(fetched.vendor_name).toBe('Acme Supplies');
    expect(fetched.vendor_id).toBe(vendorId);

    const listed: any = await listAssets({ client_id: clientId, limit: 10 } as any);
    const match = listed.assets.find((asset: any) => asset.asset_id === created.asset_id);
    expect(match?.vendor_name).toBe('Acme Supplies');
  });

  // FR-A6 / T019
  it('list search matches manufacturer and model', async () => {
    const { clientId } = await seedTenant();
    const created: any = await createAsset({
      ...baseAsset(clientId),
      name: 'Reception PC',
      manufacturer: 'Lenovo',
      model: 'ThinkCentre M70q',
    } as any);
    await createAsset({ ...baseAsset(clientId), name: 'Other PC', manufacturer: 'HP' } as any);

    const byMake: any = await listAssets({ client_id: clientId, search: 'lenovo', limit: 10 } as any);
    expect(byMake.assets.map((asset: any) => asset.asset_id)).toEqual([created.asset_id]);

    const byModel: any = await listAssets({ client_id: clientId, search: 'M70q', limit: 10 } as any);
    expect(byModel.assets.map((asset: any) => asset.asset_id)).toEqual([created.asset_id]);
  });
});
