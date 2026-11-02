import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';

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

type Fixture = {
  tenantId: string;
  algadeskTenantId: string;
  apiKey: string;
  deniedApiKey: string;
  algadeskApiKey: string;
  serializedServiceId: string;
  stockedServiceId: string;
  warehouseId: string;
  scopedVanId: string;
  transferDestinationId: string;
  poId: string;
  poLineId: string;
  transferId: string;
};

let db: Knex;
let ApiInventoryController: typeof import('../../lib/api/controllers/ApiInventoryController').ApiInventoryController;
const cleanupTenants = new Set<string>();

function hasColumn(table: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns[table] ?? {}, column);
}

function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}

function tenantRows() {
  return tenantDb(db, '__inventory_api_test_fixture__')
    .unscoped('tenants', 'inventory API integration fixture creates and removes tenants');
}

function schemaTable(name: string) {
  return tenantDb(db, '__inventory_api_test_schema__')
    .unscoped(name, 'inventory API integration reads schema metadata');
}

function tenantInsert(tenant: string, name: string, productCode: 'psa' | 'algadesk') {
  return {
    tenant,
    ...(hasColumn('tenants', 'company_name') ? { company_name: name } : { client_name: name }),
    email: `${tenant}@example.com`,
    ...(hasColumn('tenants', 'product_code') ? { product_code: productCode } : {}),
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  };
}

function userInsert(tenant: string, userId: string, username: string) {
  return {
    tenant,
    user_id: userId,
    username,
    hashed_password: 'not-used',
    first_name: 'Inventory',
    last_name: 'Tester',
    ...(hasColumn('users', 'role') ? { role: 'admin' } : {}),
    ...(hasColumn('users', 'email') ? { email: `${username}@example.com` } : {}),
    ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
    ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  };
}

function apiKeyInsert(tenant: string, userId: string, plainText: string) {
  return {
    tenant,
    api_key_id: randomUUID(),
    user_id: userId,
    api_key: createHash('sha256').update(plainText).digest('hex'),
    description: 'Inventory API integration key',
    active: true,
    ...(hasColumn('api_keys', 'usage_count') ? { usage_count: 0 } : {}),
    ...(hasColumn('api_keys', 'usage_limit') ? { usage_limit: null } : {}),
    ...(hasColumn('api_keys', 'last_used_at') ? { last_used_at: null } : {}),
    ...(hasColumn('api_keys', 'expires_at') ? { expires_at: null } : {}),
    ...(hasColumn('api_keys', 'purpose') ? { purpose: 'integration_test' } : {}),
    ...(hasColumn('api_keys', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('api_keys', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  };
}

async function grantPermissions(
  tenant: string,
  userId: string,
  definitions: Array<[string, string]>,
): Promise<void> {
  const roleId = randomUUID();
  await table(tenant, 'roles').insert({
    tenant,
    role_id: roleId,
    role_name: `Inventory API ${roleId.slice(0, 8)}`,
    description: 'Inventory API integration role',
    ...(hasColumn('roles', 'msp') ? { msp: true } : {}),
    ...(hasColumn('roles', 'client') ? { client: false } : {}),
    ...(hasColumn('roles', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('roles', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });
  await table(tenant, 'user_roles').insert({
    tenant,
    user_id: userId,
    role_id: roleId,
    ...(hasColumn('user_roles', 'created_at') ? { created_at: db.fn.now() } : {}),
  });
  const permissions = definitions.map(([resource, action]) => ({
    tenant,
    permission_id: randomUUID(),
    resource,
    action,
    ...(hasColumn('permissions', 'msp') ? { msp: true } : {}),
    ...(hasColumn('permissions', 'client') ? { client: false } : {}),
    ...(hasColumn('permissions', 'description') ? { description: `${action} ${resource}` } : {}),
    ...(hasColumn('permissions', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('permissions', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  }));
  await table(tenant, 'permissions').insert(permissions);
  await table(tenant, 'role_permissions').insert(permissions.map((permission) => ({
    tenant,
    role_id: roleId,
    permission_id: permission.permission_id,
    ...(hasColumn('role_permissions', 'created_at') ? { created_at: db.fn.now() } : {}),
  })));
}

async function seedFixture(): Promise<Fixture> {
  const tenantId = randomUUID();
  const algadeskTenantId = randomUUID();
  cleanupTenants.add(tenantId);
  cleanupTenants.add(algadeskTenantId);
  await tenantRows().insert([
    tenantInsert(tenantId, 'Inventory API PSA', 'psa'),
    tenantInsert(algadeskTenantId, 'Inventory API AlgaDesk', 'algadesk'),
  ]);

  const userId = randomUUID();
  const deniedUserId = randomUUID();
  const vanOwnerId = randomUUID();
  const algadeskUserId = randomUUID();
  await table(tenantId, 'users').insert([
    userInsert(tenantId, userId, `inventory-${tenantId.slice(0, 8)}`),
    userInsert(tenantId, deniedUserId, `inventory-denied-${tenantId.slice(0, 8)}`),
    userInsert(tenantId, vanOwnerId, `inventory-van-${tenantId.slice(0, 8)}`),
  ]);
  await table(algadeskTenantId, 'users').insert(
    userInsert(algadeskTenantId, algadeskUserId, `inventory-algadesk-${algadeskTenantId.slice(0, 8)}`),
  );

  await grantPermissions(tenantId, userId, [
    ['inventory', 'read'],
    ['inventory', 'create'],
    ['inventory', 'update'],
    ['cycle_count', 'read'],
    ['cycle_count', 'create'],
    ['cycle_count', 'update'],
    ['purchase_order', 'read'],
    ['purchase_order', 'update'],
    ['stock_transfer', 'read'],
    ['stock_transfer', 'update'],
  ]);
  await grantPermissions(algadeskTenantId, algadeskUserId, [['inventory', 'read']]);

  const apiKey = `inventory-${randomUUID()}`;
  const deniedApiKey = `inventory-denied-${randomUUID()}`;
  const algadeskApiKey = `inventory-algadesk-${randomUUID()}`;
  await table(tenantId, 'api_keys').insert([
    apiKeyInsert(tenantId, userId, apiKey),
    apiKeyInsert(tenantId, deniedUserId, deniedApiKey),
  ]);
  await table(algadeskTenantId, 'api_keys').insert(
    apiKeyInsert(algadeskTenantId, algadeskUserId, algadeskApiKey),
  );

  const serviceTypeId = randomUUID();
  await table(tenantId, 'service_types').insert({
    tenant: tenantId,
    id: serviceTypeId,
    name: `Inventory ${serviceTypeId.slice(0, 8)}`,
    order_number: 1,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const serializedServiceId = randomUUID();
  const stockedServiceId = randomUUID();
  await table(tenantId, 'service_catalog').insert([
    {
      tenant: tenantId,
      service_id: serializedServiceId,
      service_name: 'Serialized Router',
      description: 'Serialized inventory fixture',
      custom_service_type_id: serviceTypeId,
      billing_method: 'usage',
      default_rate: 25000,
      unit_of_measure: 'each',
      category_id: null,
      tax_rate_id: null,
      item_kind: 'product',
      is_active: true,
      sku: `SER-${serializedServiceId.slice(0, 8)}`,
      barcode: '0036000291452',
      cost: 15000,
      cost_currency: 'USD',
    },
    {
      tenant: tenantId,
      service_id: stockedServiceId,
      service_name: 'Patch Cable',
      description: 'Non-serialized inventory fixture',
      custom_service_type_id: serviceTypeId,
      billing_method: 'usage',
      default_rate: 500,
      unit_of_measure: 'each',
      category_id: null,
      tax_rate_id: null,
      item_kind: 'product',
      is_active: true,
      sku: `STK-${stockedServiceId.slice(0, 8)}`,
      barcode: null,
      cost: 200,
      cost_currency: 'USD',
    },
  ]);

  const warehouseId = randomUUID();
  const scopedVanId = randomUUID();
  const transferDestinationId = randomUUID();
  await table(tenantId, 'stock_locations').insert([
    { tenant: tenantId, location_id: warehouseId, name: 'Main Warehouse', location_type: 'warehouse', is_default: true, is_active: true },
    { tenant: tenantId, location_id: scopedVanId, name: 'Scoped Van', location_type: 'van', assigned_user_id: vanOwnerId, is_default: false, is_active: true },
    { tenant: tenantId, location_id: transferDestinationId, name: 'Branch Warehouse', location_type: 'warehouse', is_default: false, is_active: true },
  ]);
  await table(tenantId, 'product_inventory_settings').insert([
    {
      tenant: tenantId,
      service_id: serializedServiceId,
      track_stock: true,
      is_serialized: true,
      is_kit: false,
      creates_asset_on_delivery: false,
      average_cost: 15000,
      cost_currency: 'USD',
      default_location_id: warehouseId,
    },
    {
      tenant: tenantId,
      service_id: stockedServiceId,
      track_stock: true,
      is_serialized: false,
      is_kit: false,
      creates_asset_on_delivery: false,
      average_cost: 200,
      cost_currency: 'USD',
      reorder_point: 2,
      default_location_id: warehouseId,
    },
  ]);
  await table(tenantId, 'stock_levels').insert([
    { tenant: tenantId, service_id: serializedServiceId, location_id: warehouseId, quantity_on_hand: 0, reserved_quantity: 0, held_quantity: 0 },
    { tenant: tenantId, service_id: stockedServiceId, location_id: warehouseId, quantity_on_hand: 5, reserved_quantity: 0, held_quantity: 0 },
    { tenant: tenantId, service_id: stockedServiceId, location_id: scopedVanId, quantity_on_hand: 0, reserved_quantity: 0, held_quantity: 0 },
    { tenant: tenantId, service_id: stockedServiceId, location_id: transferDestinationId, quantity_on_hand: 0, reserved_quantity: 0, held_quantity: 0 },
  ]);

  const vendorId = randomUUID();
  await table(tenantId, 'vendors').insert({
    tenant: tenantId,
    vendor_id: vendorId,
    vendor_name: 'Inventory Test Vendor',
    is_active: true,
  });
  const poId = randomUUID();
  const poLineId = randomUUID();
  await table(tenantId, 'purchase_orders').insert({
    tenant: tenantId,
    po_id: poId,
    po_number: `PO-${poId.slice(0, 8)}`,
    vendor_id: vendorId,
    status: 'open',
    ship_to_location_id: warehouseId,
    currency_code: 'USD',
    is_drop_ship: false,
    created_by: userId,
  });
  await table(tenantId, 'purchase_order_lines').insert({
    tenant: tenantId,
    po_line_id: poLineId,
    po_id: poId,
    service_id: stockedServiceId,
    quantity_ordered: 2,
    quantity_received: 0,
    unit_cost: 180,
    cost_currency: 'USD',
  });

  const transferId = randomUUID();
  await table(tenantId, 'stock_transfers').insert({
    tenant: tenantId,
    transfer_id: transferId,
    from_location_id: warehouseId,
    to_location_id: transferDestinationId,
    status: 'dispatched',
    dispatched_by: userId,
    dispatched_at: db.fn.now(),
  });
  await table(tenantId, 'stock_transfer_lines').insert({
    tenant: tenantId,
    transfer_id: transferId,
    service_id: stockedServiceId,
    quantity: 1,
  });

  return {
    tenantId,
    algadeskTenantId,
    apiKey,
    deniedApiKey,
    algadeskApiKey,
    serializedServiceId,
    stockedServiceId,
    warehouseId,
    scopedVanId,
    transferDestinationId,
    poId,
    poLineId,
    transferId,
  };
}

function request(
  fixture: Pick<Fixture, 'tenantId' | 'apiKey'>,
  path: string,
  init: { method?: string; body?: Record<string, unknown> } = {},
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'x-api-key': fixture.apiKey,
      'x-tenant-id': fixture.tenantId,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
}

function withParams(req: NextRequest, params: Record<string, string>): NextRequest {
  (req as any).params = Promise.resolve(params);
  return req;
}

// Best-effort: stock_movements is an append-only ledger (trg_stock_movements_immutable)
// that app_user can't delete from or disable, and its rows FK-pin tenants/users/
// stock_locations. DB is recreated per run with fresh UUIDs, so the residue is inert.
async function cleanupTenant(tenant: string): Promise<void> {
  const safeDelete = async (name: string) => table(tenant, name).del().catch(() => undefined);
  for (const name of [
    'authorization_bundle_assignments',
    'authorization_bundle_rules',
    'authorization_bundle_revisions',
    'authorization_bundles',
    'asset_associations',
    'assets',
    'clients',
    'stock_movements',
    'stock_units',
    'count_lines',
    'count_sessions',
    'stock_transfer_lines',
    'stock_transfers',
    'purchase_order_lines',
    'purchase_orders',
    'stock_levels',
    'product_inventory_settings',
    'vendors',
    'stock_locations',
    'service_prices',
    'service_catalog',
    'service_types',
    'api_keys',
    'role_permissions',
    'user_roles',
    'permissions',
    'roles',
    'users',
  ]) {
    await safeDelete(name);
  }
  await tenantRows().where({ tenant }).del().catch(() => undefined);
}

type AssetLookupFixture = {
  fixture: Fixture;
  /** Has inventory:read and asset:read, narrowed by a bundle to clientA only. */
  narrowedApiKey: string;
  /** Has inventory:read and asset:read with no narrowing. */
  fullApiKey: string;
  clientAAssetId: string;
  clientBAssetId: string;
  clientASerial: string;
  clientBSerial: string;
  clientBTag: string;
  /** Serial of an asset that also equals a catalog product SKU. */
  productCollisionCode: string;
  productCollisionAssetId: string;
};

async function seedAssetLookupFixture(): Promise<AssetLookupFixture> {
  const fixture = await seedFixture();
  const tenant = fixture.tenantId;
  const suffix = tenant.slice(0, 8);

  const narrowedUserId = randomUUID();
  const fullUserId = randomUUID();
  await table(tenant, 'users').insert([
    userInsert(tenant, narrowedUserId, `inventory-narrowed-${suffix}`),
    userInsert(tenant, fullUserId, `inventory-full-${suffix}`),
  ]);
  for (const userId of [narrowedUserId, fullUserId]) {
    await grantPermissions(tenant, userId, [['inventory', 'read'], ['asset', 'read']]);
  }
  const narrowedApiKey = `inventory-narrowed-${randomUUID()}`;
  const fullApiKey = `inventory-full-${randomUUID()}`;
  await table(tenant, 'api_keys').insert([
    apiKeyInsert(tenant, narrowedUserId, narrowedApiKey),
    apiKeyInsert(tenant, fullUserId, fullApiKey),
  ]);

  const clientAId = randomUUID();
  const clientBId = randomUUID();
  await table(tenant, 'clients').insert([clientAId, clientBId].map((clientId, index) => ({
    tenant,
    client_id: clientId,
    client_name: `Lookup Client ${index === 0 ? 'A' : 'B'}`,
  })));

  const clientAAssetId = randomUUID();
  const clientBAssetId = randomUUID();
  const productCollisionAssetId = randomUUID();
  const clientASerial = `LOOKUP-A-${suffix}`;
  const clientBSerial = `LOOKUP-B-${suffix}`;
  const clientBTag = `TAG-B-${suffix}`;
  const serializedSku = (await table(tenant, 'service_catalog')
    .where({ service_id: fixture.serializedServiceId })
    .first()).sku as string;
  const baseAsset = (assetId: string, clientId: string, name: string, serial: string, tag: string) => ({
    tenant,
    asset_id: assetId,
    asset_tag: tag,
    serial_number: serial,
    name,
    status: 'active',
    asset_type: 'workstation',
    client_id: clientId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await table(tenant, 'assets').insert([
    baseAsset(clientAAssetId, clientAId, 'Client A laptop', clientASerial, `TAG-A-${suffix}`),
    baseAsset(clientBAssetId, clientBId, 'Client B laptop', clientBSerial, clientBTag),
    baseAsset(productCollisionAssetId, clientAId, 'Asset sharing a product SKU', serializedSku, `TAG-C-${suffix}`),
  ]);

  const bundle = await createAuthorizationBundle(db, {
    tenant,
    name: `Lookup narrowing ${suffix}`,
    actorUserId: narrowedUserId,
  });
  await upsertBundleRule(db, {
    tenant,
    bundleId: bundle.bundleId,
    revisionId: bundle.revisionId,
    resourceType: 'asset',
    action: 'read',
    templateKey: 'selected_clients',
    config: { selectedClientIds: [clientAId] },
    actorUserId: narrowedUserId,
  });
  await publishBundleRevision(db as any, {
    tenant,
    bundleId: bundle.bundleId,
    revisionId: bundle.revisionId,
    actorUserId: narrowedUserId,
  });
  await createBundleAssignment(db, {
    tenant,
    bundleId: bundle.bundleId,
    targetType: 'user',
    targetId: narrowedUserId,
    actorUserId: narrowedUserId,
  });

  return {
    fixture,
    narrowedApiKey,
    fullApiKey,
    clientAAssetId,
    clientBAssetId,
    clientASerial,
    clientBSerial,
    clientBTag,
    productCollisionCode: serializedSku,
    productCollisionAssetId,
  };
}

describe('inventory REST API (integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'roles', 'user_roles', 'permissions', 'role_permissions', 'api_keys']) {
      columns[name] = await schemaTable(name).columnInfo();
    }
    ({ ApiInventoryController } = await import('../../lib/api/controllers/ApiInventoryController'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('T025/T026: receives serialized stock, reports duplicate serial, validates adjustment reason, and enforces location scope', async () => {
    const fixture = await seedFixture();
    const controller = new ApiInventoryController('inventory');
    const receipt = await controller.receiveStock()(request(fixture, '/api/v1/inventory/receipts', {
      method: 'POST',
      body: {
        service_id: fixture.serializedServiceId,
        location_id: fixture.warehouseId,
        quantity: 2,
        serials: [{ serial_number: 'SERIAL-1' }, { serial_number: 'SERIAL-2', mac_address: 'AA:BB:CC:DD:EE:FF' }],
      },
    }));
    expect(receipt.status).toBe(201);
    expect(await table(fixture.tenantId, 'stock_units').where({ service_id: fixture.serializedServiceId })).toHaveLength(2);
    expect(await table(fixture.tenantId, 'stock_movements').where({ service_id: fixture.serializedServiceId, movement_type: 'receipt' })).toHaveLength(2);
    expect((await table(fixture.tenantId, 'stock_levels').where({ service_id: fixture.serializedServiceId, location_id: fixture.warehouseId }).first()).quantity_on_hand).toBe(2);

    const duplicate = await controller.receiveStock()(request(fixture, '/api/v1/inventory/receipts', {
      method: 'POST',
      body: {
        service_id: fixture.serializedServiceId,
        location_id: fixture.warehouseId,
        quantity: 1,
        serials: [{ serial_number: 'SERIAL-1' }],
      },
    }));
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe('DUPLICATE_SERIAL');

    const missingReason = await controller.adjustStock()(request(fixture, '/api/v1/inventory/adjustments', {
      method: 'POST',
      body: { service_id: fixture.stockedServiceId, location_id: fixture.warehouseId, quantity_delta: 1 },
    }));
    expect(missingReason.status).toBe(400);

    const scoped = await controller.adjustStock()(request(fixture, '/api/v1/inventory/adjustments', {
      method: 'POST',
      body: { service_id: fixture.stockedServiceId, location_id: fixture.scopedVanId, quantity_delta: 1, reason: 'Found' },
    }));
    expect(scoped.status).toBe(403);
  }, HOOK_TIMEOUT);

  it('T027/T028/T029: completes count, PO receiving, and transfer receiving lifecycles', async () => {
    const fixture = await seedFixture();
    const countController = new ApiInventoryController('cycle_count');
    const started = await countController.startCount()(request(fixture, '/api/v1/inventory/counts', {
      method: 'POST',
      body: { location_id: fixture.warehouseId },
    }));
    expect(started.status).toBe(201);
    const sessionId = (await started.json()).data.session_id;
    const recorded = await countController.recordCount()(withParams(request(fixture, `/api/v1/inventory/counts/${sessionId}/records`, {
      method: 'POST',
      body: { service_id: fixture.stockedServiceId, counted_quantity: 5 },
    }), { sessionId }));
    expect(recorded.status).toBe(200);
    const listed = await countController.listCounts()(request(fixture, '/api/v1/inventory/counts'));
    expect(listed.status).toBe(200);
    const listedSession = (await listed.json()).data.find((row: any) => row.session_id === sessionId);
    expect(listedSession.line_count).toBeGreaterThanOrEqual(1);
    const submitted = await countController.submitCount()(withParams(
      request(fixture, `/api/v1/inventory/counts/${sessionId}/submit`, { method: 'POST' }),
      { sessionId },
    ));
    expect(submitted.status).toBe(200);
    expect((await submitted.json()).data.status).toBe('review');
    const doubleSubmit = await countController.submitCount()(withParams(
      request(fixture, `/api/v1/inventory/counts/${sessionId}/submit`, { method: 'POST' }),
      { sessionId },
    ));
    expect(doubleSubmit.status).toBe(409);

    const poController = new ApiInventoryController('purchase_order');
    const poReceive = await poController.receivePurchaseOrderLine()(withParams(request(
      fixture,
      `/api/v1/inventory/purchase-orders/${fixture.poId}/lines/${fixture.poLineId}/receive`,
      { method: 'POST', body: { quantity: 1 } },
    ), { poId: fixture.poId, lineId: fixture.poLineId }));
    expect(poReceive.status).toBe(200);
    expect((await table(fixture.tenantId, 'purchase_order_lines').where({ po_line_id: fixture.poLineId }).first()).quantity_received).toBe(1);
    expect((await table(fixture.tenantId, 'purchase_orders').where({ po_id: fixture.poId }).first()).status).toBe('partially_received');

    const transferController = new ApiInventoryController('stock_transfer');
    const transferReceive = await transferController.receiveTransfer()(withParams(
      request(fixture, `/api/v1/inventory/transfers/${fixture.transferId}/receive`, { method: 'POST' }),
      { transferId: fixture.transferId },
    ));
    expect(transferReceive.status).toBe(200);
    expect((await table(fixture.tenantId, 'stock_transfers').where({ transfer_id: fixture.transferId }).first()).status).toBe('received');
    expect((await table(fixture.tenantId, 'stock_levels').where({ service_id: fixture.stockedServiceId, location_id: fixture.transferDestinationId }).first()).quantity_on_hand).toBe(1);
  }, HOOK_TIMEOUT);

  it('T030/T031: returns 403 for missing inventory:read and for the AlgaDesk product boundary', async () => {
    const fixture = await seedFixture();
    const controller = new ApiInventoryController('inventory');
    const denied = await controller.listStock()(request({
      tenantId: fixture.tenantId,
      apiKey: fixture.deniedApiKey,
    }, '/api/v1/inventory/stock'));
    expect(denied.status).toBe(403);

    const productDenied = await controller.lookup()(request({
      tenantId: fixture.algadeskTenantId,
      apiKey: fixture.algadeskApiKey,
    }, '/api/v1/inventory/lookup?code=anything'));
    expect(productDenied.status).toBe(403);
    expect((await productDenied.json()).error.code).toBe('PRODUCT_ACCESS_DENIED');
  }, HOOK_TIMEOUT);
  describe('GET /api/v1/inventory/lookup asset authorization (alga-2026-0002683 B2)', () => {
    async function lookup(tenantId: string, apiKey: string, code: string) {
      const controller = new ApiInventoryController('inventory');
      const response = await controller.lookup()(request(
        { tenantId, apiKey },
        `/api/v1/inventory/lookup?code=${encodeURIComponent(code)}`,
      ));
      expect(response.status).toBe(200);
      return (await response.json()).data;
    }

    it('(a) returns none, with no asset in the payload, for a caller without asset:read', async () => {
      const fx = await seedAssetLookupFixture();
      for (const code of [fx.clientASerial, fx.clientBTag]) {
        const result = await lookup(fx.fixture.tenantId, fx.fixture.apiKey, code);
        expect(result.type).toBe('none');
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(fx.clientAAssetId);
        expect(serialized).not.toContain(fx.clientBAssetId);
        expect(serialized).not.toContain('"asset"');
      }
    }, HOOK_TIMEOUT);

    it('(b) returns a plain product result when the code matches a product and an unreadable asset', async () => {
      const fx = await seedAssetLookupFixture();
      const result = await lookup(fx.fixture.tenantId, fx.fixture.apiKey, fx.productCollisionCode);
      expect(result.type).toBe('product');
      expect(JSON.stringify(result)).not.toContain(fx.productCollisionAssetId);
    }, HOOK_TIMEOUT);

    it('(c) drops an asset without record-level access but keeps the ones the caller can read', async () => {
      // Record-level narrowing for assets comes from authorization bundles, which
      // only the enterprise kernel evaluates; the CE kernel is allow-all for
      // internal users. Install the enterprise kernel for this case.
      const { createEnterpriseAuthorizationKernel } = await import('../../../../ee/server/src/lib/authorization/kernel');
      const previousKernel = globalThis.__algaAuthorizationKernelSingleton;
      globalThis.__algaAuthorizationKernelSingleton = await createEnterpriseAuthorizationKernel();
      try {
        await assertNarrowedLookup();
      } finally {
        globalThis.__algaAuthorizationKernelSingleton = previousKernel;
      }
    }, HOOK_TIMEOUT);

    async function assertNarrowedLookup() {
      const fx = await seedAssetLookupFixture();
      const denied = await lookup(fx.fixture.tenantId, fx.narrowedApiKey, fx.clientBSerial);
      expect(denied.type).toBe('none');
      expect(JSON.stringify(denied)).not.toContain(fx.clientBAssetId);

      const allowed = await lookup(fx.fixture.tenantId, fx.narrowedApiKey, fx.clientASerial);
      expect(allowed.type).toBe('asset');
      expect(allowed.asset.asset_id).toBe(fx.clientAAssetId);

      // Product + readable asset stays a multi; the unreadable asset never appears.
      const multi = await lookup(fx.fixture.tenantId, fx.narrowedApiKey, fx.productCollisionCode);
      expect(multi.type).toBe('multi');
      expect(multi.matches.map((match: any) => match.kind)).toEqual(['product', 'asset']);
    }

    it('(d) keeps today\'s asset and multi results for a caller with asset:read and record access', async () => {
      const fx = await seedAssetLookupFixture();
      const asset = await lookup(fx.fixture.tenantId, fx.fullApiKey, fx.clientBSerial);
      expect(asset.type).toBe('asset');
      expect(asset.asset.asset_id).toBe(fx.clientBAssetId);

      const byTag = await lookup(fx.fixture.tenantId, fx.fullApiKey, fx.clientBTag);
      expect(byTag.type).toBe('asset');

      const multi = await lookup(fx.fixture.tenantId, fx.fullApiKey, fx.productCollisionCode);
      expect(multi.type).toBe('multi');
      expect(multi.matches.map((match: any) => match.kind)).toEqual(['product', 'asset']);
      expect(multi.matches[1].asset.asset_id).toBe(fx.productCollisionAssetId);
    }, HOOK_TIMEOUT);
  });
});
