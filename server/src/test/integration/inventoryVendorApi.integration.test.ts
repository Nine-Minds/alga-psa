import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

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

type Keys = { full: string; readOnly: string; createOnly: string; none: string };
type Fixture = { tenantId: string; keys: Keys; serviceId: string; secondServiceId: string; userId: string };

let db: Knex;
let ApiInventoryController: typeof import('../../lib/api/controllers/ApiInventoryController').ApiInventoryController;
const cleanupTenants = new Set<string>();

const hasColumn = (table: string, column: string) => Object.prototype.hasOwnProperty.call(columns[table] ?? {}, column);
const table = (tenant: string, name: string) => tenantDb(db, tenant).table(name);
const tenantRows = () => tenantDb(db, '__inventory_vendor_api_fixture__')
  .unscoped('tenants', 'inventory vendor API integration fixture creates and removes tenants');
const schemaTable = (name: string) => tenantDb(db, '__inventory_vendor_api_schema__')
  .unscoped(name, 'inventory vendor API integration reads schema metadata');

async function seedUser(tenant: string, permissions: Array<[string, string]>): Promise<{ userId: string; apiKey: string }> {
  const userId = randomUUID();
  const username = `vendor-api-${userId.slice(0, 8)}`;
  await table(tenant, 'users').insert({
    tenant,
    user_id: userId,
    username,
    hashed_password: 'not-used',
    first_name: 'Vendor',
    last_name: 'Tester',
    ...(hasColumn('users', 'email') ? { email: `${username}@example.com` } : {}),
    ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
  });
  if (permissions.length) {
    const roleId = randomUUID();
    await table(tenant, 'roles').insert({
      tenant,
      role_id: roleId,
      role_name: `Vendor API ${roleId.slice(0, 8)}`,
      description: 'Vendor API integration role',
      ...(hasColumn('roles', 'msp') ? { msp: true } : {}),
      ...(hasColumn('roles', 'client') ? { client: false } : {}),
    });
    await table(tenant, 'user_roles').insert({ tenant, user_id: userId, role_id: roleId });
    const rows = permissions.map(([resource, action]) => ({
      tenant,
      permission_id: randomUUID(),
      resource,
      action,
      ...(hasColumn('permissions', 'msp') ? { msp: true } : {}),
      ...(hasColumn('permissions', 'client') ? { client: false } : {}),
    }));
    await table(tenant, 'permissions').insert(rows);
    await table(tenant, 'role_permissions').insert(rows.map((row) => ({ tenant, role_id: roleId, permission_id: row.permission_id })));
  }
  const apiKey = `vendor-api-${randomUUID()}`;
  await table(tenant, 'api_keys').insert({
    tenant,
    api_key_id: randomUUID(),
    user_id: userId,
    api_key: createHash('sha256').update(apiKey).digest('hex'),
    description: 'Vendor API integration key',
    active: true,
    ...(hasColumn('api_keys', 'usage_count') ? { usage_count: 0 } : {}),
    ...(hasColumn('api_keys', 'purpose') ? { purpose: 'integration_test' } : {}),
  });
  return { userId, apiKey };
}

async function seedFixture(): Promise<Fixture> {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  await tenantRows().insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: 'Vendor API' } : { client_name: 'Vendor API' }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'product_code') ? { product_code: 'psa' } : {}),
  });

  const full = await seedUser(tenantId, [['vendor', 'read'], ['vendor', 'create'], ['vendor', 'update']]);
  const readOnly = await seedUser(tenantId, [['vendor', 'read']]);
  const createOnly = await seedUser(tenantId, [['vendor', 'create']]);
  const none = await seedUser(tenantId, [['inventory', 'read']]);

  const serviceTypeId = randomUUID();
  await table(tenantId, 'service_types').insert({ tenant: tenantId, id: serviceTypeId, name: `Vendor API ${serviceTypeId.slice(0, 8)}`, order_number: 1 });
  const [serviceId, secondServiceId] = [randomUUID(), randomUUID()];
  await table(tenantId, 'service_catalog').insert([serviceId, secondServiceId].map((id, index) => ({
    tenant: tenantId,
    service_id: id,
    service_name: `Vendor API Product ${index + 1}`,
    custom_service_type_id: serviceTypeId,
    billing_method: 'usage',
    default_rate: 500,
    unit_of_measure: 'each',
    item_kind: 'product',
    is_active: true,
    sku: `VAP-${id.slice(0, 8)}`,
    cost: 200,
    cost_currency: 'USD',
  })));

  return {
    tenantId,
    userId: full.userId,
    serviceId,
    secondServiceId,
    keys: { full: full.apiKey, readOnly: readOnly.apiKey, createOnly: createOnly.apiKey, none: none.apiKey },
  };
}

function call(
  fixture: Fixture,
  apiKey: string,
  path: string,
  init: { method?: string; body?: Record<string, unknown>; params?: Record<string, string> } = {},
): NextRequest {
  const req = new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'x-api-key': apiKey,
      'x-tenant-id': fixture.tenantId,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  (req as any).params = Promise.resolve(init.params ?? {});
  return req;
}

async function cleanupTenant(tenant: string): Promise<void> {
  for (const name of [
    'vendor_products', 'purchase_orders', 'vendors', 'service_catalog', 'service_types', 'api_keys',
    'role_permissions', 'user_roles', 'permissions', 'roles', 'users',
  ]) {
    await table(tenant, name).del().catch(() => undefined);
  }
  await tenantRows().where({ tenant }).del().catch(() => undefined);
}

describe('vendor REST API (alga-2026-0003114)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';
    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'roles', 'permissions', 'api_keys']) {
      columns[name] = await schemaTable(name).columnInfo();
    }
    ({ ApiInventoryController } = await import('../../lib/api/controllers/ApiInventoryController'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('T002: a rename onto another vendor\'s normalized name is a 409 naming that vendor, and the renamed vendor is unchanged', async () => {
    const fx = await seedFixture();
    const vendor = new ApiInventoryController('vendor');
    const path = '/api/v1/inventory/vendors';

    const first = await vendor.createVendor()(call(fx, fx.keys.full, path, { method: 'POST', body: { vendor_name: 'Ingram Micro' } }));
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.vendor_id as string;
    const second = await vendor.createVendor()(call(fx, fx.keys.full, path, { method: 'POST', body: { vendor_name: 'TD Synnex' } }));
    expect(second.status).toBe(201);
    const secondId = (await second.json()).data.vendor_id as string;
    const before = await table(fx.tenantId, 'vendors').where({ vendor_id: secondId }).first();

    const clash = await vendor.updateVendor()(
      call(fx, fx.keys.full, `${path}/${secondId}`, { method: 'PUT', body: { vendor_name: ' ingram MICRO ' }, params: { vendorId: secondId } }),
    );
    expect(clash.status).toBe(409);
    const body = await clash.json();
    expect(body.error.message).toContain('Ingram Micro');
    expect(body.error.message).toContain(firstId);
    expect(body.error.details).toMatchObject({ existing_vendor_id: firstId, existing_vendor_name: 'Ingram Micro' });

    const after = await table(fx.tenantId, 'vendors').where({ vendor_id: secondId }).first();
    expect(after.vendor_name).toBe(before.vendor_name);
    expect(new Date(after.updated_at).getTime()).toBe(new Date(before.updated_at).getTime());
  });

  it('T001/T002/T003/T004: creates, updates, deactivates, 409s on a duplicate name, manages the price list and deletes entries over HTTP', async () => {
    const fx = await seedFixture();
    const vendor = new ApiInventoryController('vendor');
    const path = '/api/v1/inventory/vendors';

    const created = await vendor.createVendor()(call(fx, fx.keys.full, path, { method: 'POST', body: { vendor_name: '  Ingram Micro ', email: 'sales@ingram.example' } }));
    expect(created.status).toBe(201);
    const vendorId = (await created.json()).data.vendor_id as string;
    const byId = { vendorId };

    // T002: normalized duplicate -> 409 naming the existing vendor, and no row is written.
    const duplicate = await vendor.createVendor()(call(fx, fx.keys.full, path, { method: 'POST', body: { vendor_name: 'ingram MICRO' } }));
    expect(duplicate.status).toBe(409);
    const conflict = await duplicate.json();
    expect(conflict.error.message).toContain('Ingram Micro');
    expect(conflict.error.message).toContain(vendorId);
    expect(await table(fx.tenantId, 'vendors').count({ count: '*' }).first()).toMatchObject({ count: '1' });

    // Invalid body -> 400 with the field path.
    const invalid = await vendor.createVendor()(call(fx, fx.keys.full, path, { method: 'POST', body: { email: 'x@example.com' } }));
    expect(invalid.status).toBe(400);
    expect(JSON.stringify((await invalid.json()).error.details)).toContain('vendor_name');

    // T001: update, list, deactivate (idempotent), include_inactive, reactivate via PUT.
    const updated = await vendor.updateVendor()(call(fx, fx.keys.full, `${path}/${vendorId}`, { method: 'PUT', body: { payment_terms: 'Net 30' }, params: byId }));
    expect(updated.status).toBe(200);
    expect((await updated.json()).data.payment_terms).toBe('Net 30');

    const listed = await vendor.listVendors()(call(fx, fx.keys.full, `${path}?search=ingram&limit=10`));
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.data.map((v: any) => v.vendor_id)).toEqual([vendorId]);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const deactivated = await vendor.deactivateVendor()(call(fx, fx.keys.full, `${path}/${vendorId}/deactivate`, { method: 'POST', params: byId }));
      expect(deactivated.status).toBe(200);
      expect((await deactivated.json()).data.is_active).toBe(false);
    }
    const hidden = await (await vendor.listVendors()(call(fx, fx.keys.full, `${path}?search=ingram`))).json();
    expect(hidden.data).toHaveLength(0);
    const shown = await (await vendor.listVendors()(call(fx, fx.keys.full, `${path}?search=ingram&include_inactive=true`))).json();
    expect(shown.data.map((v: any) => v.vendor_id)).toEqual([vendorId]);
    const reactivated = await vendor.updateVendor()(call(fx, fx.keys.full, `${path}/${vendorId}`, { method: 'PUT', body: { is_active: true }, params: byId }));
    expect((await reactivated.json()).data.is_active).toBe(true);

    // T003: price list upsert, list, preferred moves to the second vendor.
    const second = await (await vendor.createVendor()(call(fx, fx.keys.full, path, { method: 'POST', body: { vendor_name: 'Synnex' } }))).json();
    const secondId = second.data.vendor_id as string;
    const entryPath = (id: string) => `${path}/${id}/products/${fx.serviceId}`;
    const put = (id: string, body: Record<string, unknown>) => vendor.upsertVendorProduct()(
      call(fx, fx.keys.full, entryPath(id), { method: 'PUT', body, params: { vendorId: id, serviceId: fx.serviceId } }),
    );
    const first = await put(vendorId, { vendor_sku: 'IM-1', unit_cost: 12345, cost_currency: 'usd', lead_time_days: 3, is_preferred: true });
    expect(first.status).toBe(200);
    expect((await first.json()).data).toMatchObject({ vendor_sku: 'IM-1', unit_cost: 12345, cost_currency: 'USD', is_preferred: true });

    const products = await vendor.listVendorProducts()(call(fx, fx.keys.full, `${path}/${vendorId}/products`, { params: byId }));
    expect(products.status).toBe(200);
    expect((await products.json()).data).toEqual([
      expect.objectContaining({ service_id: fx.serviceId, service_name: 'Vendor API Product 1', sku: expect.stringMatching(/^VAP-/), unit_cost: 12345 }),
    ]);

    expect((await put(secondId, { unit_cost: 9000, is_preferred: true })).status).toBe(200);
    const preferred = await table(fx.tenantId, 'vendor_products').where({ service_id: fx.serviceId, is_preferred: true }).select('vendor_id');
    expect(preferred.map((row: any) => row.vendor_id)).toEqual([secondId]);

    // Bad cost -> 400, unknown vendor/product -> 404.
    expect((await put(vendorId, { unit_cost: -5 })).status).toBe(400);
    expect((await put(randomUUID(), { unit_cost: 1 })).status).toBe(404);
    const unknownProduct = await vendor.upsertVendorProduct()(call(fx, fx.keys.full, entryPath(vendorId), { method: 'PUT', body: { unit_cost: 1 }, params: { vendorId, serviceId: randomUUID() } }));
    expect(unknownProduct.status).toBe(404);

    // T004: delete the entry; a second delete is a 404 and the row is gone.
    const del = () => vendor.deleteVendorProduct()(call(fx, fx.keys.full, entryPath(vendorId), { method: 'DELETE', params: { vendorId, serviceId: fx.serviceId } }));
    expect((await del()).status).toBe(200);
    expect((await del()).status).toBe(404);
    expect(await table(fx.tenantId, 'vendor_products').where({ vendor_id: vendorId, service_id: fx.serviceId }).first()).toBeUndefined();
  }, HOOK_TIMEOUT);

  it('T005: 403 without the matching vendor permission, 404 for an unknown vendorId', async () => {
    const fx = await seedFixture();
    const vendor = new ApiInventoryController('vendor');
    const path = '/api/v1/inventory/vendors';
    const someId = randomUUID();
    const params = { vendorId: someId, serviceId: fx.serviceId };

    // No vendor permission at all: every route is refused.
    expect((await vendor.listVendors()(call(fx, fx.keys.none, path))).status).toBe(403);
    expect((await vendor.getVendor()(call(fx, fx.keys.none, `${path}/${someId}`, { params }))).status).toBe(403);
    expect((await vendor.listVendorProducts()(call(fx, fx.keys.none, `${path}/${someId}/products`, { params }))).status).toBe(403);

    // Read-only key may not create or update.
    expect((await vendor.createVendor()(call(fx, fx.keys.readOnly, path, { method: 'POST', body: { vendor_name: 'Nope' } }))).status).toBe(403);
    expect((await vendor.updateVendor()(call(fx, fx.keys.readOnly, `${path}/${someId}`, { method: 'PUT', body: { notes: 'x' }, params }))).status).toBe(403);
    expect((await vendor.deactivateVendor()(call(fx, fx.keys.readOnly, `${path}/${someId}/deactivate`, { method: 'POST', params }))).status).toBe(403);
    expect((await vendor.upsertVendorProduct()(call(fx, fx.keys.readOnly, `${path}/${someId}/products/${fx.serviceId}`, { method: 'PUT', body: { unit_cost: 1 }, params }))).status).toBe(403);
    expect((await vendor.deleteVendorProduct()(call(fx, fx.keys.readOnly, `${path}/${someId}/products/${fx.serviceId}`, { method: 'DELETE', params }))).status).toBe(403);

    // Create-only key may create but not read or update.
    expect((await vendor.listVendors()(call(fx, fx.keys.createOnly, path))).status).toBe(403);
    expect((await vendor.updateVendor()(call(fx, fx.keys.createOnly, `${path}/${someId}`, { method: 'PUT', body: { notes: 'x' }, params }))).status).toBe(403);
    const createdByCreateOnly = await vendor.createVendor()(call(fx, fx.keys.createOnly, path, { method: 'POST', body: { vendor_name: 'Create Only Co' } }));
    expect(createdByCreateOnly.status).toBe(201);

    // Full access: unknown vendor -> 404 on every route that takes one.
    expect((await vendor.getVendor()(call(fx, fx.keys.full, `${path}/${someId}`, { params }))).status).toBe(404);
    expect((await vendor.updateVendor()(call(fx, fx.keys.full, `${path}/${someId}`, { method: 'PUT', body: { notes: 'x' }, params }))).status).toBe(404);
    expect((await vendor.deactivateVendor()(call(fx, fx.keys.full, `${path}/${someId}/deactivate`, { method: 'POST', params }))).status).toBe(404);
    expect((await vendor.listVendorProducts()(call(fx, fx.keys.full, `${path}/${someId}/products`, { params }))).status).toBe(404);
    expect((await vendor.deleteVendorProduct()(call(fx, fx.keys.full, `${path}/${someId}/products/${fx.serviceId}`, { method: 'DELETE', params }))).status).toBe(404);
  }, HOOK_TIMEOUT);
});
