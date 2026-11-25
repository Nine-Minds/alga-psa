/**
 * alga-2026-0003114 - REST API for project materials (T001-T004).
 *
 * Real DB, real RBAC, real record-level project authorization, real ApiProjectController and ProjectService
 * calling the real inventory cores. Only the event bus is stubbed. Fixtures are seeded here.
 *
 * Run against a private database so the shared `test_database` is not recreated:
 *   TEST_DB_NAME=test_project_materials_api npx vitest run src/test/integration/projectMaterialsApi.integration.test.ts
 */
import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
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
let db: Knex;
let ApiProjectController: typeof import('../../lib/api/controllers/ApiProjectController').ApiProjectController;
const columns: Record<string, Record<string, unknown>> = {};
const cleanupTenants = new Set<string>();

const has = (table: string, column: string) => Object.prototype.hasOwnProperty.call(columns[table] ?? {}, column);
const table = (tenant: string, name: string) => tenantDb(db, tenant).table(name);
const tenantRows = () => tenantDb(db, '__project_materials_api_fixture__')
  .unscoped('tenants', 'project materials API integration fixture creates and removes tenants');

type Fixture = {
  tenant: string;
  apiKey: string;
  readOnlyApiKey: string;
  clientId: string;
  projectId: string;
  otherProjectId: string;
  stockedId: string;
  serializedId: string;
  untrackedId: string;
  warehouseId: string;
  unitId: string;
};

async function seed(): Promise<Fixture> {
  const tenant = randomUUID();
  cleanupTenants.add(tenant);
  await tenantRows().insert({
    tenant,
    ...(has('tenants', 'company_name') ? { company_name: 'Project Materials API' } : { client_name: 'Project Materials API' }),
    email: `${tenant}@example.com`,
    ...(has('tenants', 'product_code') ? { product_code: 'psa' } : {}),
    ...(has('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(has('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const makeUser = async (label: string, perms: Array<[string, string]>) => {
    const userId = randomUUID();
    const username = `pm-${label}-${tenant.slice(0, 8)}`;
    await table(tenant, 'users').insert({
      tenant, user_id: userId, username, hashed_password: 'not-used', first_name: 'PM', last_name: label,
      ...(has('users', 'role') ? { role: 'admin' } : {}),
      ...(has('users', 'email') ? { email: `${username}@example.com` } : {}),
      ...(has('users', 'user_type') ? { user_type: 'internal' } : {}),
      ...(has('users', 'is_inactive') ? { is_inactive: false } : {}),
      ...(has('users', 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(has('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
    const roleId = randomUUID();
    await table(tenant, 'roles').insert({
      tenant, role_id: roleId, role_name: `PM ${label} ${roleId.slice(0, 6)}`, description: 'project materials',
      ...(has('roles', 'msp') ? { msp: true } : {}),
      ...(has('roles', 'client') ? { client: false } : {}),
      ...(has('roles', 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(has('roles', 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
    await table(tenant, 'user_roles').insert({
      tenant, user_id: userId, role_id: roleId, ...(has('user_roles', 'created_at') ? { created_at: db.fn.now() } : {}),
    });
    const rows = perms.map(([resource, action]) => ({
      tenant, permission_id: randomUUID(), resource, action,
      ...(has('permissions', 'msp') ? { msp: true } : {}),
      ...(has('permissions', 'client') ? { client: false } : {}),
      ...(has('permissions', 'description') ? { description: `${action} ${resource}` } : {}),
      ...(has('permissions', 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(has('permissions', 'updated_at') ? { updated_at: db.fn.now() } : {}),
    }));
    await table(tenant, 'permissions').insert(rows);
    await table(tenant, 'role_permissions').insert(rows.map((p) => ({
      tenant, role_id: roleId, permission_id: p.permission_id,
      ...(has('role_permissions', 'created_at') ? { created_at: db.fn.now() } : {}),
    })));
    const plain = `pm-${label}-${randomUUID()}`;
    await table(tenant, 'api_keys').insert({
      tenant, api_key_id: randomUUID(), user_id: userId, api_key: createHash('sha256').update(plain).digest('hex'),
      description: 'project materials', active: true,
      ...(has('api_keys', 'usage_count') ? { usage_count: 0 } : {}),
      ...(has('api_keys', 'purpose') ? { purpose: 'integration_test' } : {}),
      ...(has('api_keys', 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(has('api_keys', 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
    return plain;
  };
  const apiKey = await makeUser('full', [['project', 'read'], ['project', 'update']]);
  const readOnlyApiKey = await makeUser('read', [['project', 'read']]);

  const clientId = randomUUID();
  await table(tenant, 'clients').insert({ tenant, client_id: clientId, client_name: 'Material Client' });
  const statusId = randomUUID();
  await table(tenant, 'statuses').insert({
    tenant, status_id: statusId, name: 'Active', status_type: 'project', order_number: 1,
    ...(has('statuses', 'is_closed') ? { is_closed: false } : {}),
  });
  const mkProject = async (name: string) => {
    const projectId = randomUUID();
    await table(tenant, 'projects').insert({
      tenant, project_id: projectId, project_name: name, client_id: clientId, status: statusId,
      wbs_code: projectId.slice(0, 8), project_number: `P-${projectId.slice(0, 8)}`,
    });
    return projectId;
  };
  const projectId = await mkProject('Rollout');
  const otherProjectId = await mkProject('Other rollout');

  const serviceTypeId = randomUUID();
  await table(tenant, 'service_types').insert({
    tenant, id: serviceTypeId, name: `PM ${serviceTypeId.slice(0, 8)}`, order_number: 1,
    created_at: db.fn.now(), updated_at: db.fn.now(),
  });
  const product = (service_id: string, name: string) => ({
    tenant, service_id, service_name: name, description: name, custom_service_type_id: serviceTypeId,
    billing_method: 'usage', default_rate: 500, unit_of_measure: 'each', category_id: null, tax_rate_id: null,
    item_kind: 'product', is_active: true, sku: `SKU-${service_id.slice(0, 8)}`, cost: 200, cost_currency: 'USD',
  });
  const stockedId = randomUUID();
  const serializedId = randomUUID();
  const untrackedId = randomUUID();
  await table(tenant, 'service_catalog').insert([
    product(stockedId, 'Patch Cable'), product(serializedId, 'Serialized Router'), product(untrackedId, 'Consumable'),
  ]);
  const warehouseId = randomUUID();
  await table(tenant, 'stock_locations').insert({
    tenant, location_id: warehouseId, name: 'Main Warehouse', location_type: 'warehouse', is_default: true, is_active: true,
  });
  const settings = (service_id: string, is_serialized: boolean) => ({
    tenant, service_id, track_stock: true, is_serialized, is_kit: false, creates_asset_on_delivery: false,
    average_cost: 200, cost_currency: 'USD', default_location_id: warehouseId,
  });
  await table(tenant, 'product_inventory_settings').insert([settings(stockedId, false), settings(serializedId, true)]);
  await table(tenant, 'stock_levels').insert([
    { tenant, service_id: stockedId, location_id: warehouseId, quantity_on_hand: 5, reserved_quantity: 0, held_quantity: 0 },
    { tenant, service_id: serializedId, location_id: warehouseId, quantity_on_hand: 1, reserved_quantity: 0, held_quantity: 0 },
  ]);
  const unitId = randomUUID();
  await table(tenant, 'stock_units').insert({
    tenant, unit_id: unitId, service_id: serializedId, serial_number: `SN-${unitId.slice(0, 8)}`, status: 'in_stock',
    location_id: warehouseId, received_at: db.fn.now(),
  });

  return { tenant, apiKey, readOnlyApiKey, clientId, projectId, otherProjectId, stockedId, serializedId, untrackedId, warehouseId, unitId };
}

const call = (f: Fixture, key: string, method: string, path: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method,
  headers: { 'x-api-key': key, 'x-tenant-id': f.tenant, ...(body ? { 'content-type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const collection = (f: Fixture, projectId = f.projectId) => `/api/v1/projects/${projectId}/materials`;
const list = async (f: Fixture, projectId = f.projectId) => {
  const res = await new ApiProjectController().getMaterials()(call(f, f.apiKey, 'GET', collection(f, projectId)));
  expect(res.status).toBe(200);
  return (await res.json()).data as any[];
};
const add = (f: Fixture, body: Record<string, unknown>, projectId = f.projectId, key = f.apiKey) =>
  new ApiProjectController().addMaterial()(call(f, key, 'POST', collection(f, projectId), body));
const del = (f: Fixture, materialId: string, projectId = f.projectId, key = f.apiKey) =>
  new ApiProjectController().deleteMaterial()(call(f, key, 'DELETE', `${collection(f, projectId)}/${materialId}`));
const level = async (f: Fixture, serviceId: string) =>
  table(f.tenant, 'stock_levels').where({ service_id: serviceId, location_id: f.warehouseId }).first();
const movements = (f: Fixture, serviceId: string) => table(f.tenant, 'stock_movements').where({ service_id: serviceId });
const materialRows = (f: Fixture) => table(f.tenant, 'project_materials');
const body = (serviceId: string, extra: Record<string, unknown> = {}) =>
  ({ service_id: serviceId, quantity: 2, rate: 750, currency_code: 'USD', ...extra });

// stock_movements is an append-only ledger app_user cannot delete; best-effort cleanup, residue is inert.
async function cleanup(tenant: string) {
  for (const name of ['project_materials', 'projects', 'statuses', 'clients', 'stock_movements', 'stock_units', 'stock_levels',
    'product_inventory_settings', 'stock_locations', 'service_catalog', 'service_types', 'api_keys', 'role_permissions',
    'user_roles', 'permissions', 'roles', 'users']) {
    await table(tenant, name).del().catch(() => undefined);
  }
  await tenantRows().where({ tenant }).del().catch(() => undefined);
}

describe('project materials REST API (integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    wireLocalTestDbEnv();
    process.env.DB_NAME_SERVER = process.env.TEST_DB_NAME || 'test_database';
    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'roles', 'user_roles', 'permissions', 'role_permissions', 'api_keys', 'statuses']) {
      columns[name] = await tenantDb(db, '__project_materials_api_schema__')
        .unscoped(name, 'project materials API integration reads schema metadata').columnInfo();
    }
    ({ ApiProjectController } = await import('../../lib/api/controllers/ApiProjectController'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanup(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('T001: adds a stock-tracked material; on-hand drops, it is listed, a movement is recorded against the project; client_id comes from the project', async () => {
    const f = await seed();
    const res = await add(f, body(f.stockedId, { description: 'Cabling' }));
    expect(res.status).toBe(201);
    const created = (await res.json()).data;
    expect(created).toMatchObject({
      project_id: f.projectId, client_id: f.clientId, service_id: f.stockedId, quantity: 2, rate: 750,
      currency_code: 'USD', service_name: 'Patch Cable', is_billed: false,
    });
    expect(created.sku).toBe(`SKU-${f.stockedId.slice(0, 8)}`);

    expect(Number((await level(f, f.stockedId)).quantity_on_hand)).toBe(3);
    const listed = await list(f);
    expect(listed.map((m) => m.project_material_id)).toEqual([created.project_material_id]);
    expect(listed[0]).not.toHaveProperty('catalog_unit_cost');
    expect(await list(f, f.otherProjectId)).toEqual([]);
    const moves = await movements(f, f.stockedId);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ source_doc_type: 'project_material', source_doc_id: created.project_material_id });
    expect(Number(moves[0].quantity)).toBe(2);
  }, HOOK_TIMEOUT);

  it('T001: client_id in the body is rejected (400) and nothing is written', async () => {
    const f = await seed();
    const otherClient = randomUUID();
    await table(f.tenant, 'clients').insert({ tenant: f.tenant, client_id: otherClient, client_name: 'Someone else' });
    const res = await add(f, body(f.stockedId, { client_id: otherClient }));
    expect(res.status).toBe(400);
    expect(JSON.stringify((await res.json()).error.details)).toContain('client_id');
    expect(await materialRows(f)).toHaveLength(0);
    expect(Number((await level(f, f.stockedId)).quantity_on_hand)).toBe(5);
  }, HOOK_TIMEOUT);

  it('T002: adds a serialized material with unit_id and delivers the unit; omitting unit_id is a 400 on unit_id', async () => {
    const f = await seed();
    const missing = await add(f, body(f.serializedId, { quantity: 1 }));
    expect(missing.status).toBe(400);
    expect(JSON.stringify((await missing.json()).error.details)).toContain('unit_id');
    expect(await materialRows(f)).toHaveLength(0);

    const res = await add(f, body(f.serializedId, { quantity: 1, unit_id: f.unitId }));
    expect(res.status).toBe(201);
    const unit = await table(f.tenant, 'stock_units').where({ unit_id: f.unitId }).first();
    expect(unit.status).not.toBe('in_stock');
    expect(Number((await level(f, f.serializedId)).quantity_on_hand)).toBe(0);
  }, HOOK_TIMEOUT);

  it('T003: deleting the material returns on-hand and empties the list; a material of another project is a 404 and survives', async () => {
    const f = await seed();
    const created = (await (await add(f, body(f.stockedId))).json()).data;
    expect(Number((await level(f, f.stockedId)).quantity_on_hand)).toBe(3);

    // Ownership: addressed through a different (existing) project it must not be touched.
    const wrongProject = await del(f, created.project_material_id, f.otherProjectId);
    expect(wrongProject.status).toBe(404);
    expect(await materialRows(f)).toHaveLength(1);
    expect(Number((await level(f, f.stockedId)).quantity_on_hand)).toBe(3);

    const res = await del(f, created.project_material_id);
    expect(res.status).toBe(204);
    expect(Number((await level(f, f.stockedId)).quantity_on_hand)).toBe(5);
    expect(await list(f)).toEqual([]);
    expect(await materialRows(f)).toHaveLength(0);
    expect((await del(f, created.project_material_id)).status).toBe(404);
  }, HOOK_TIMEOUT);

  it('T003: a billed material cannot be deleted (409) and keeps its stock consumption', async () => {
    const f = await seed();
    const created = (await (await add(f, body(f.stockedId))).json()).data;
    await materialRows(f).where({ project_material_id: created.project_material_id }).update({ is_billed: true });
    expect((await del(f, created.project_material_id)).status).toBe(409);
    expect(await materialRows(f)).toHaveLength(1);
    expect(Number((await level(f, f.stockedId)).quantity_on_hand)).toBe(3);
  }, HOOK_TIMEOUT);

  it('T004: quantity above free stock is a 400 on quantity and nothing is written', async () => {
    const f = await seed();
    const res = await add(f, body(f.stockedId, { quantity: 6 }));
    expect(res.status).toBe(400);
    expect(JSON.stringify((await res.json()).error.details)).toContain('quantity');
    expect(await materialRows(f)).toHaveLength(0);
    expect(await movements(f, f.stockedId)).toHaveLength(0);
    expect(Number((await level(f, f.stockedId)).quantity_on_hand)).toBe(5);
  }, HOOK_TIMEOUT);

  it.each([['held_quantity'], ['reserved_quantity']])('T004: stock %s for a sales order is a 400 on quantity, never overridden', async (counter) => {
    const f = await seed();
    await table(f.tenant, 'stock_levels')
      .where({ service_id: f.stockedId, location_id: f.warehouseId })
      .update({ [counter]: 4 });
    const res = await add(f, body(f.stockedId, { quantity: 2 }));
    expect(res.status).toBe(400);
    expect(JSON.stringify((await res.json()).error.details)).toContain('quantity');
    expect(await materialRows(f)).toHaveLength(0);
    expect(await movements(f, f.stockedId)).toHaveLength(0);
    const after = await level(f, f.stockedId);
    expect(Number(after.quantity_on_hand)).toBe(5);
    expect(Number(after[counter])).toBe(4);
  }, HOOK_TIMEOUT);

  it('adds an untracked product without touching stock, and an unknown project is 404 with nothing written', async () => {
    const f = await seed();
    expect((await add(f, body(f.untrackedId))).status).toBe(201);
    expect(await movements(f, f.untrackedId)).toHaveLength(0);
    const unknown = await add(f, body(f.untrackedId), randomUUID());
    expect(unknown.status).toBe(404);
    expect(await materialRows(f)).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('T006: a read-only key lists but cannot add or delete (403); stock is untouched', async () => {
    const f = await seed();
    const created = (await (await add(f, body(f.stockedId))).json()).data;
    const read = await new ApiProjectController().getMaterials()(call(f, f.readOnlyApiKey, 'GET', collection(f)));
    expect(read.status).toBe(200);
    expect((await add(f, body(f.stockedId), f.projectId, f.readOnlyApiKey)).status).toBe(403);
    expect((await del(f, created.project_material_id, f.projectId, f.readOnlyApiKey)).status).toBe(403);
    expect(await materialRows(f)).toHaveLength(1);
    expect(Number((await level(f, f.stockedId)).quantity_on_hand)).toBe(3);
  }, HOOK_TIMEOUT);
});
