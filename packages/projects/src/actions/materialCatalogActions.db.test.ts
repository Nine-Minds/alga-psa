/**
 * Project material wrappers combine coarse RBAC with the real project-read kernel.
 * Published bundle narrowing is exercised against the migrated inventory DB; every
 * denial cases roll back their fixtures; dedicated hook cases verify real commit/rollback behavior.
 * Run with scripts/run-workspace-db-tests.mjs.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import knexLib, { type Knex } from 'knex';

const testState = vi.hoisted(() => ({
  trx: null as any,
  tenant: '',
  user: { user_id: '', user_type: 'internal', roles: [] as unknown[] } as Record<string, unknown>,
  permissions: new Set<string>(),
  publishedEvents: [] as Array<{ eventType: string; payload: unknown }>,
}));

vi.mock('@alga-psa/db', async () => ({
  ...(await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db')),
  createTenantKnex: vi.fn(async () => ({ knex: testState.trx })),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: unknown[]) => fn(testState.user, { tenant: testState.tenant }, ...args),
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) =>
    testState.permissions.has(`${resource}:${action}`)),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) =>
    testState.permissions.has(`${resource}:${action}`)),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(async () => undefined),
  reviveStoredWorkflowPayload: vi.fn(() => null),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async ({ eventType, payload }: { eventType: string; payload: unknown }) => {
    testState.publishedEvents.push({ eventType, payload });
  }),
}));

import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { withTransaction } from '@alga-psa/db';
import { addMaterial as addInventoryMaterial } from '@alga-psa/inventory/lib';
import {
  addProjectMaterial,
  deleteProjectMaterial,
  getProjectMaterialBillingOptions,
  listProjectMaterials,
  updateProjectMaterial,
} from './materialCatalogActions';
import {
  createInventoryTestTenant,
  getInventoryTestDatabaseConnection,
} from '../../../inventory/src/test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();
if (typeof databaseConnection.password === 'string' && databaseConnection.password.startsWith('/')) {
  // Local wire-in env files point at container-only secret paths. Resolve the
  // matching checkout secret without ever logging its contents.
  databaseConnection.password = readFileSync(path.resolve(process.cwd(), '../secrets', path.basename(databaseConnection.password)), 'utf8').trim();
}
let knex: Knex;
let TENANT: string;
let FOREIGN_TENANT: string;
let LOCATION: string;
let USER: string;
let RESTRICTED: string;
let CLIENT_A: string;
let CLIENT_B: string;
let TYPE_ID: string;
let FOREIGN_MATERIAL_ID: string;
const ALL = ['project:read', 'project:update', 'inventory:read', 'asset:create'];

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: databaseConnection, pool: { min: 1, max: 4 } });
  TENANT = await createInventoryTestTenant(knex);
  testState.tenant = TENANT;
  LOCATION = (await knex('stock_locations').where({ tenant: TENANT, is_default: true }).first()).location_id;
  USER = (await knex('users').where({ tenant: TENANT }).first()).user_id;
  CLIENT_A = (await knex('clients').where({ tenant: TENANT }).first()).client_id;
  TYPE_ID = (await knex('service_types').where({ tenant: TENANT }).first()).id;

  CLIENT_B = randomUUID();
  RESTRICTED = randomUUID();
  await knex.transaction(async (trx) => {
    await trx('clients').insert({ tenant: TENANT, client_id: CLIENT_B, client_name: 'Client B', billing_cycle: 'monthly' });
    await trx('users').insert({ tenant: TENANT, user_id: RESTRICTED, username: `restricted-${RESTRICTED}`, email: `r-${RESTRICTED}@example.invalid`, hashed_password: 'x', user_type: 'internal', first_name: 'R', last_name: 'User' });
    const bundle_id = randomUUID();
    const revision_id = randomUUID();
    await trx('authorization_bundles').insert({ tenant: TENANT, bundle_id, bundle_key: `materials-${bundle_id.slice(0, 8)}`, name: 'Client A projects', is_system: false, status: 'active' });
    await trx('authorization_bundle_revisions').insert({ tenant: TENANT, revision_id, bundle_id, revision_number: 1, lifecycle_state: 'published' });
    await trx('authorization_bundles').where({ tenant: TENANT, bundle_id }).update({ published_revision_id: revision_id });
    await trx('authorization_bundle_rules').insert({
      tenant: TENANT, bundle_id, revision_id, resource_type: 'project', action: 'read', template_key: 'selected_clients',
      effect: 'narrow', config: JSON.stringify({ selectedClientIds: [CLIENT_A] }), position: 0,
    });
    await trx('authorization_bundle_assignments').insert({ tenant: TENANT, bundle_id, target_type: 'user', target_id: RESTRICTED, status: 'active' });
  });

  // A material owned by another tenant proves the resolver does not become an existence oracle.
  FOREIGN_TENANT = await createInventoryTestTenant(knex);
  await knex.transaction(async (trx) => {
    const clientId = (await trx('clients').where({ tenant: FOREIGN_TENANT }).first()).client_id;
    const status = (await trx('statuses').where({ tenant: FOREIGN_TENANT }).first()).status_id;
    const typeId = (await trx('service_types').where({ tenant: FOREIGN_TENANT }).first()).id;
    const [project] = await trx('projects').insert({ tenant: FOREIGN_TENANT, project_name: 'Foreign project', client_id: clientId, status, wbs_code: randomUUID().slice(0, 8), project_number: `F-${randomUUID().slice(0, 8)}` }).returning('project_id');
    const [service] = await trx('service_catalog').insert({ tenant: FOREIGN_TENANT, service_name: 'Foreign product', item_kind: 'product', billing_method: 'per_unit', default_rate: 100, is_active: true, custom_service_type_id: typeId }).returning('service_id');
    const [material] = await trx('project_materials').insert({ tenant: FOREIGN_TENANT, project_id: project.project_id, client_id: clientId, service_id: service.service_id, quantity: 1, rate: 100, currency_code: 'USD' }).returning('project_material_id');
    FOREIGN_MATERIAL_ID = material.project_material_id;
  });
});

beforeEach(async () => {
  testState.trx = await knex.transaction();
  testState.user = { user_id: USER, user_type: 'internal', roles: [] };
  testState.permissions = new Set(ALL);
  testState.publishedEvents = [];
});
afterEach(async () => {
  if (typeof testState.trx?.rollback === 'function') await testState.trx.rollback();
  testState.trx = null;
});
afterAll(async () => { await knex?.destroy(); });

const trx = (): Knex.Transaction => testState.trx;
async function makeProject(clientId: string): Promise<string> {
  const status = (await trx()('statuses').where({ tenant: TENANT }).first()).status_id;
  const suffix = randomUUID().slice(0, 8);
  const [project] = await trx()('projects').insert({ tenant: TENANT, project_name: `Material ${suffix}`, client_id: clientId, status, wbs_code: suffix, project_number: `M-${suffix}` }).returning('project_id');
  const [config] = await trx()('project_billing_configs').insert({ tenant: TENANT, project_id: project.project_id, billing_model: 'time_and_materials', currency: 'USD' }).returning('config_id');
  await trx()('project_billing_schedule_entries').insert({ tenant: TENANT, config_id: config.config_id, entry_type: 'milestone', description: `Milestone ${suffix}`, amount: 10000, trigger_type: 'manual', status: 'pending' });
  return project.project_id;
}
async function makeProduct(options: { stock: number; reorder?: number; serialized?: boolean; createsAsset?: boolean }): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const [service] = await trx()('service_catalog').insert({ tenant: TENANT, service_name: `Material product ${suffix}`, sku: suffix, item_kind: 'product', billing_method: 'per_unit', default_rate: 100, is_active: true, custom_service_type_id: TYPE_ID }).returning('service_id');
  await trx()('product_inventory_settings').insert({ tenant: TENANT, service_id: service.service_id, track_stock: true, is_serialized: options.serialized ?? false, creates_asset_on_delivery: options.createsAsset ?? false, reorder_point: options.reorder ?? null, cost_currency: 'USD', default_location_id: LOCATION });
  if (options.serialized) {
    await trx()('stock_units').insert({ tenant: TENANT, service_id: service.service_id, serial_number: `SER-${suffix}`, status: 'in_stock', location_id: LOCATION, unit_cost: 25, cost_currency: 'USD' });
  } else {
    await trx()('stock_levels').insert({ tenant: TENANT, service_id: service.service_id, location_id: LOCATION, quantity_on_hand: options.stock, reserved_quantity: 0, held_quantity: 0, reorder_point: options.reorder ?? null });
  }
  return service.service_id;
}
async function seedMaterial(projectId: string, clientId: string, serviceId: string, rate = 100): Promise<string> {
  const [material] = await trx()('project_materials').insert({ tenant: TENANT, project_id: projectId, client_id: clientId, service_id: serviceId, quantity: 1, rate, currency_code: 'USD', billing_destination: 'next_project_invoice' }).returning('project_material_id');
  return material.project_material_id;
}
async function seedConsumedMaterial(projectId: string, clientId: string, serviceId: string): Promise<string> {
  const material: any = await addInventoryMaterial(trx(), TENANT, {
    parent_type: 'project', parent_id: projectId, client_id: clientId, service_id: serviceId,
    quantity: 1, rate: 321, currency_code: 'USD',
  }, USER);
  return material.project_material_id;
}
const count = async (table: string, where: Record<string, unknown>) => Number((await trx()(table).where({ tenant: TENANT, ...where }).count<{ c: string }>('* as c').first())?.c ?? 0);

describe('project material actions: coarse RBAC and record scope', () => {
  beforeEach(() => { testState.user = { user_id: RESTRICTED, user_type: 'internal', roles: [] }; });

  it('denies out-of-bundle list and billing reads while preserving in-bundle data', async () => {
    const projectA = await makeProject(CLIENT_A);
    const projectB = await makeProject(CLIENT_B);
    const product = await makeProduct({ stock: 4 });
    await seedMaterial(projectA, CLIENT_A, product, 125);
    await seedMaterial(projectB, CLIENT_B, product, 250);

    expect(isActionPermissionError(await listProjectMaterials(projectB))).toBe(true);
    expect(isActionPermissionError(await getProjectMaterialBillingOptions(projectB))).toBe(true);
    const materials: any = await listProjectMaterials(projectA);
    expect(materials).toHaveLength(1);
    expect(Number(materials[0].rate)).toBe(125);
    expect(await getProjectMaterialBillingOptions(projectA)).toMatchObject({ project_currency: 'USD', entries: [{ description: expect.stringContaining('Milestone') }] });
  });

  it('denies out-of-bundle add without changing material, billing or inventory state', async () => {
    const projectB = await makeProject(CLIENT_B);
    const product = await makeProduct({ stock: 5 });
    const before = { materials: await count('project_materials', { project_id: projectB }), movements: await count('stock_movements', { service_id: product }), stock: Number((await trx()('stock_levels').where({ tenant: TENANT, service_id: product, location_id: LOCATION }).first()).quantity_on_hand), billing: await count('project_billing_configs', { project_id: projectB }) };
    const result = await addProjectMaterial({ project_id: projectB, client_id: CLIENT_B, service_id: product, quantity: 2, rate: 100, currency_code: 'USD' });
    expect(isActionPermissionError(result)).toBe(true);
    expect({ materials: await count('project_materials', { project_id: projectB }), movements: await count('stock_movements', { service_id: product }), stock: Number((await trx()('stock_levels').where({ tenant: TENANT, service_id: product, location_id: LOCATION }).first()).quantity_on_hand), billing: await count('project_billing_configs', { project_id: projectB }) }).toEqual(before);
  });

  it('denies out-of-bundle update by material id without changing billing state', async () => {
    const projectB = await makeProject(CLIENT_B);
    const product = await makeProduct({ stock: 5 });
    const materialId = await seedMaterial(projectB, CLIENT_B, product, 321);
    const beforeMaterial = await trx()('project_materials').where({ tenant: TENANT, project_material_id: materialId }).first();
    expect(isActionPermissionError(await updateProjectMaterial(materialId, { rate: 999, billing_destination: 'separate' }))).toBe(true);
    const afterMaterial = await trx()('project_materials').where({ tenant: TENANT, project_material_id: materialId }).first();
    expect({ rate: Number(afterMaterial.rate), destination: afterMaterial.billing_destination }).toEqual({ rate: Number(beforeMaterial.rate), destination: beforeMaterial.billing_destination });
  });

  it('denies out-of-bundle delete by material id without restoring stock or removing movement history', async () => {
    const projectB = await makeProject(CLIENT_B);
    const product = await makeProduct({ stock: 5 });
    const materialId = await seedConsumedMaterial(projectB, CLIENT_B, product);
    const beforeStock = Number((await trx()('stock_levels').where({ tenant: TENANT, service_id: product, location_id: LOCATION }).first()).quantity_on_hand);
    const beforeMoves = await count('stock_movements', { service_id: product });
    expect(isActionPermissionError(await deleteProjectMaterial(materialId))).toBe(true);
    expect(await trx()('project_materials').where({ tenant: TENANT, project_material_id: materialId }).first()).toBeDefined();
    expect(Number((await trx()('stock_levels').where({ tenant: TENANT, service_id: product, location_id: LOCATION }).first()).quantity_on_hand)).toBe(beforeStock);
    expect(await count('stock_movements', { service_id: product })).toBe(beforeMoves);
  });

  it('maps missing and foreign-tenant material IDs to the same update permission error', async () => {
    const projectB = await makeProject(CLIENT_B);
    const product = await makeProduct({ stock: 5 });
    const inaccessibleId = await seedMaterial(projectB, CLIENT_B, product, 321);
    const beforeInaccessible = await trx()('project_materials').where({ tenant: TENANT, project_material_id: inaccessibleId }).first();
    const beforeForeign = await knex('project_materials').where({ tenant: FOREIGN_TENANT, project_material_id: FOREIGN_MATERIAL_ID }).first();

    const missingUpdate = await updateProjectMaterial(randomUUID(), { rate: 500, billing_destination: 'separate' });
    const foreignUpdate = await updateProjectMaterial(FOREIGN_MATERIAL_ID, { rate: 500, billing_destination: 'separate' });
    const inaccessibleUpdate = await updateProjectMaterial(inaccessibleId, { rate: 500, billing_destination: 'separate' });
    expect(isActionPermissionError(inaccessibleUpdate)).toBe(true);
    expect(missingUpdate).toEqual(inaccessibleUpdate);
    expect(foreignUpdate).toEqual(inaccessibleUpdate);

    const missingDelete = await deleteProjectMaterial(randomUUID());
    const foreignDelete = await deleteProjectMaterial(FOREIGN_MATERIAL_ID);
    const inaccessibleDelete = await deleteProjectMaterial(inaccessibleId);
    expect(isActionPermissionError(inaccessibleDelete)).toBe(true);
    expect(missingDelete).toEqual(inaccessibleDelete);
    expect(foreignDelete).toEqual(inaccessibleDelete);
    expect(await trx()('project_materials').where({ tenant: TENANT, project_material_id: inaccessibleId }).first()).toEqual(beforeInaccessible);
    expect(await knex('project_materials').where({ tenant: FOREIGN_TENANT, project_material_id: FOREIGN_MATERIAL_ID }).first()).toEqual(beforeForeign);
  });

  it.each([true, false])('allows in-bundle edits with billing configuration present=%s', async (hasConfig) => {
    const projectA = await makeProject(CLIENT_A);
    const product = await makeProduct({ stock: 5 });
    const materialId = await seedConsumedMaterial(projectA, CLIENT_A, product);
    const config = await trx()('project_billing_configs').where({ tenant: TENANT, project_id: projectA }).first();
    const entry = await trx()('project_billing_schedule_entries').where({ tenant: TENANT, config_id: config.config_id }).first();
    if (!hasConfig) {
      await trx()('project_billing_schedule_entries').where({ tenant: TENANT, config_id: config.config_id }).delete();
      await trx()('project_billing_configs').where({ tenant: TENANT, config_id: config.config_id }).delete();
    }
    const beforeStock = await trx()('stock_levels').where({ tenant: TENANT, service_id: product }).first();
    const beforeMoves = await count('stock_movements', { service_id: product });
    const input = {
      rate: 750,
      billing_destination: hasConfig ? 'schedule_entry' as const : 'separate' as const,
      billing_schedule_entry_id: hasConfig ? entry.schedule_entry_id : null,
    };
    const updated: any = await updateProjectMaterial(materialId, input);
    expect(updated).toMatchObject({ project_material_id: materialId, billing_destination: input.billing_destination, billing_schedule_entry_id: input.billing_schedule_entry_id });
    expect(Number(updated.rate)).toBe(750);
    const persisted = await trx()('project_materials').where({ tenant: TENANT, project_material_id: materialId }).first();
    expect(persisted).toMatchObject({ billing_destination: input.billing_destination, billing_schedule_entry_id: input.billing_schedule_entry_id });
    expect(Number(persisted.rate)).toBe(750);
    expect(await trx()('stock_levels').where({ tenant: TENANT, service_id: product }).first()).toEqual(beforeStock);
    expect(await count('stock_movements', { service_id: product })).toBe(beforeMoves);
  });

  it('allows in-bundle add/delete and applies inventory effects', async () => {
    const projectA = await makeProject(CLIENT_A);
    const lowStockProduct = await makeProduct({ stock: 3, reorder: 1 });
    const added: any = await addProjectMaterial({ project_id: projectA, client_id: CLIENT_A, service_id: lowStockProduct, quantity: 2, rate: 500, currency_code: 'USD' });
    expect(added).toMatchObject({ project_id: projectA, billing_destination: 'next_project_invoice' });
    expect(Number((await trx()('stock_levels').where({ tenant: TENANT, service_id: lowStockProduct, location_id: LOCATION }).first()).quantity_on_hand)).toBe(1);
    expect(await count('stock_movements', { service_id: lowStockProduct, movement_type: 'consume' })).toBe(1);
    const deleteProduct = await makeProduct({ stock: 2 });
    const materialId = await seedMaterial(projectA, CLIENT_A, deleteProduct, 200);
    expect(await deleteProjectMaterial(materialId)).toBeUndefined();
    expect(await trx()('project_materials').where({ tenant: TENANT, project_material_id: materialId }).first()).toBeUndefined();

    const serialized = await makeProduct({ stock: 0, serialized: true, createsAsset: true });
    const unitId = (await trx()('stock_units').where({ tenant: TENANT, service_id: serialized }).first()).unit_id;
    const delivered: any = await addProjectMaterial({ project_id: projectA, client_id: CLIENT_A, service_id: serialized, unit_id: unitId, quantity: 1, rate: 900, currency_code: 'USD' });
    expect(delivered.project_id).toBe(projectA);
    expect((await trx()('stock_units').where({ tenant: TENANT, unit_id: unitId }).first()).status).toBe('delivered');
  });

  it('runs stock-low publication and persists the delivered asset link after commit', async () => {
    await trx().rollback();
    testState.trx = null;
    let projectId = '';
    let lowStockServiceId = '';
    let serializedServiceId = '';
    let unitId = '';

    await withTransaction(knex, async (outer) => {
      testState.trx = outer;
      projectId = await makeProject(CLIENT_A);
      lowStockServiceId = await makeProduct({ stock: 3, reorder: 1 });
      serializedServiceId = await makeProduct({ stock: 0, serialized: true, createsAsset: true });
      unitId = (await outer('stock_units').where({ tenant: TENANT, service_id: serializedServiceId }).first()).unit_id;
      testState.trx = knex;
    });

    await withTransaction(knex, async (outer) => {
      testState.trx = outer;
      const lowStockAdd: any = await addProjectMaterial({ project_id: projectId, client_id: CLIENT_A, service_id: lowStockServiceId, quantity: 2, rate: 500, currency_code: 'USD' });
      const assetAdd: any = await addProjectMaterial({ project_id: projectId, client_id: CLIENT_A, service_id: serializedServiceId, unit_id: unitId, quantity: 1, rate: 900, currency_code: 'USD' });
      expect(lowStockAdd.project_id).toBe(projectId);
      expect(assetAdd.project_id).toBe(projectId);
      expect(testState.publishedEvents).toEqual([]);
      expect(await outer('assets').where({ tenant: TENANT, stock_unit_id: unitId }).first()).toBeUndefined();
      testState.trx = knex;
    });

    expect(testState.publishedEvents.some((event) => event.eventType === 'INVENTORY_STOCK_LOW')).toBe(true);
    const unit = await knex('stock_units').where({ tenant: TENANT, unit_id: unitId }).first();
    expect(unit.status).toBe('delivered');
    expect(unit.asset_id).toBeTruthy();
    expect(await knex('assets').where({ tenant: TENANT, asset_id: unit.asset_id, stock_unit_id: unitId }).first()).toBeDefined();
    expect(Number((await knex('stock_levels').where({ tenant: TENANT, service_id: lowStockServiceId, location_id: LOCATION }).first()).quantity_on_hand)).toBe(1);
  });

  it('drops stock-low and asset-link effects when the consuming transaction rolls back', async () => {
    await trx().rollback();
    testState.trx = null;
    let projectId = '';
    let lowStockServiceId = '';
    let serializedServiceId = '';
    let unitId = '';

    await withTransaction(knex, async (outer) => {
      testState.trx = outer;
      projectId = await makeProject(CLIENT_A);
      lowStockServiceId = await makeProduct({ stock: 3, reorder: 1 });
      serializedServiceId = await makeProduct({ stock: 0, serialized: true, createsAsset: true });
      unitId = (await outer('stock_units').where({ tenant: TENANT, service_id: serializedServiceId }).first()).unit_id;
      testState.trx = knex;
    });

    testState.publishedEvents = [];
    await expect(withTransaction(knex, async (outer) => {
      testState.trx = outer;
      await addProjectMaterial({ project_id: projectId, client_id: CLIENT_A, service_id: lowStockServiceId, quantity: 2, rate: 500, currency_code: 'USD' });
      await addProjectMaterial({ project_id: projectId, client_id: CLIENT_A, service_id: serializedServiceId, unit_id: unitId, quantity: 1, rate: 900, currency_code: 'USD' });
      testState.trx = knex;
      throw new Error('force material transaction rollback');
    })).rejects.toThrow('force material transaction rollback');
    testState.trx = knex;

    expect(testState.publishedEvents).toEqual([]);
    expect(await knex('project_materials').where({ tenant: TENANT, project_id: projectId })).toHaveLength(0);
    expect(Number((await knex('stock_levels').where({ tenant: TENANT, service_id: lowStockServiceId, location_id: LOCATION }).first()).quantity_on_hand)).toBe(3);
    expect(await knex('stock_movements').where({ tenant: TENANT, service_id: lowStockServiceId, movement_type: 'consume' })).toHaveLength(0);
    const unit = await knex('stock_units').where({ tenant: TENANT, unit_id: unitId }).first();
    expect(unit.status).toBe('in_stock');
    expect(unit.asset_id).toBeNull();
    expect(await knex('assets').where({ tenant: TENANT, stock_unit_id: unitId })).toHaveLength(0);
  });
});
