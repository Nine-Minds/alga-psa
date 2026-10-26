/**
 * C6 T010 (actions): staging mutations need project:update AND the record-level project read decision;
 * reads need project:read; unit pickers need inventory:read. A project the caller may not read answers
 * exactly like a missing one, and a refused call writes nothing.
 *
 * Real kernel and bundle narrowing against the isolated migrated test DB (RBAC itself is stubbed per
 * case); every case runs in a transaction that is rolled back.
 * Run from the repository root: node scripts/run-workspace-db-tests.mjs ../packages/projects/src/actions/stagingActions.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const testState = vi.hoisted(() => ({
  trx: null as any,
  tenant: '',
  user: { user_id: '', user_type: 'internal', roles: [] as unknown[] } as Record<string, unknown>,
  permissions: new Set<string>(),
}));

vi.mock('@alga-psa/db', async () => ({
  ...(await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db')),
  createTenantKnex: vi.fn(async () => ({ knex: testState.trx })),
  withTransaction: vi.fn(async (_db: unknown, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
    testState.trx.transaction(callback)),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: unknown[]) => fn(testState.user, { tenant: testState.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) =>
    testState.permissions.has(`${resource}:${action}`)),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(async () => undefined) }));

import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  createProjectStagingBox,
  addProjectClientItems,
  getProjectStaging,
  getProjectStagingAvailability,
  installProjectStagingLines,
  listProjectStagingUnits,
  packProjectStagingBox,
  releaseAllProjectStaging,
  reserveProjectStaging,
  stageProjectStagingLines,
} from './stagingActions';
import {
  createInventoryTestTenant,
  getInventoryTestDatabaseConnection,
} from '../../../inventory/src/test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();

let knex: Knex;
let TENANT: string;
let LOCATION: string;
let USER: string;
let RESTRICTED: string;
let CLIENT_A: string;
let CLIENT_B: string;
let TYPE_ID: string;

const ALL = ['project:read', 'project:update', 'inventory:read', 'billing:create', 'asset:read'];

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: databaseConnection, pool: { min: 1, max: 4 } });
  TENANT = await createInventoryTestTenant(knex);
  testState.tenant = TENANT;
  LOCATION = (await knex('stock_locations').where({ tenant: TENANT, is_default: true }).first()).location_id;
  USER = (await knex('users').where({ tenant: TENANT }).first()).user_id;
  CLIENT_A = (await knex('clients').where({ tenant: TENANT }).first()).client_id;
  TYPE_ID = (await knex('service_types').where({ tenant: TENANT }).first()).id;

  // Committed fixture shared by every case: a second client and a user narrowed to client A by a
  // published authorization bundle (record-level project read deny for client B's projects).
  CLIENT_B = randomUUID();
  RESTRICTED = randomUUID();
  await knex.transaction(async (trx) => {
    await trx('clients').insert({ tenant: TENANT, client_id: CLIENT_B, client_name: 'Client B', billing_cycle: 'monthly' });
    await trx('users').insert({ tenant: TENANT, user_id: RESTRICTED, username: `restricted-${RESTRICTED}`, email: `r-${RESTRICTED}@example.invalid`, hashed_password: 'x', user_type: 'internal', first_name: 'R', last_name: 'User' });
    const bundle_id = randomUUID();
    const revision_id = randomUUID();
    await trx('authorization_bundles').insert({ tenant: TENANT, bundle_id, bundle_key: `c6-${bundle_id.slice(0, 8)}`, name: 'Client A projects', is_system: false, status: 'active' });
    await trx('authorization_bundle_revisions').insert({ tenant: TENANT, revision_id, bundle_id, revision_number: 1, lifecycle_state: 'published' });
    await trx('authorization_bundles').where({ tenant: TENANT, bundle_id }).update({ published_revision_id: revision_id });
    await trx('authorization_bundle_rules').insert({
      tenant: TENANT, bundle_id, revision_id, resource_type: 'project', action: 'read', template_key: 'selected_clients',
      effect: 'narrow', config: JSON.stringify({ selectedClientIds: [CLIENT_A] }), position: 0,
    });
    await trx('authorization_bundle_assignments').insert({ tenant: TENANT, bundle_id, target_type: 'user', target_id: RESTRICTED, status: 'active' });
  });
});

beforeEach(async () => {
  testState.trx = await knex.transaction();
  testState.user = { user_id: USER, user_type: 'internal', roles: [] };
  testState.permissions = new Set(ALL);
});

afterEach(async () => {
  await testState.trx?.rollback();
  testState.trx = null;
});

afterAll(async () => {
  await knex?.destroy();
});

const trx = (): Knex.Transaction => testState.trx;

async function makeProject(clientId: string): Promise<string> {
  const status = (await trx()('statuses').where({ tenant: TENANT }).first()).status_id;
  const n = randomUUID().slice(0, 8);
  const [p] = await trx()('projects')
    .insert({ tenant: TENANT, project_name: `ZZ C6 ${n}`, client_id: clientId, status, wbs_code: n, project_number: `AZ-${n}` })
    .returning('project_id');
  return p.project_id;
}

async function makeProduct(onHand: number): Promise<string> {
  const label = `c6-act-${randomUUID().slice(0, 8)}`;
  const [svc] = await trx()('service_catalog')
    .insert({ tenant: TENANT, service_name: `ZZ ${label}`, sku: label, item_kind: 'product', billing_method: 'per_unit', default_rate: 100, is_active: true, custom_service_type_id: TYPE_ID })
    .returning('service_id');
  await trx()('product_inventory_settings').insert({ tenant: TENANT, service_id: svc.service_id, track_stock: true, is_serialized: false, cost_currency: 'USD', default_location_id: LOCATION });
  await trx()('stock_levels').insert({ tenant: TENANT, service_id: svc.service_id, location_id: LOCATION, quantity_on_hand: onHand, reserved_quantity: 0, held_quantity: 0 });
  return svc.service_id;
}

const count = async (table: string, where: Record<string, unknown>) =>
  Number((await trx()(table).where({ tenant: TENANT, ...where }).count<{ c: string }>('* as c').first())?.c ?? 0);

describe('staging actions: RBAC and record-level authorization', () => {
  it('mutations need project:update; a refused call writes nothing', async () => {
    const projectId = await makeProject(CLIENT_A);
    const svc = await makeProduct(5);
    testState.permissions = new Set(['project:read', 'inventory:read']);
    const results = [
      await reserveProjectStaging({ project_id: projectId, service_id: svc, quantity: 1, currency_code: 'USD' }),
      await createProjectStagingBox(projectId, {}),
      await releaseAllProjectStaging(projectId),
    ];
    for (const result of results) expect(isActionPermissionError(result)).toBe(true);
    expect(await count('project_staging_lines', { project_id: projectId })).toBe(0);
    expect(await count('staging_containers', { project_id: projectId })).toBe(0);
    // Read is still allowed.
    const state: any = await getProjectStaging(projectId);
    expect(state).toMatchObject({ lines: [], containers: [], canUpdate: false, canReadInventory: true });
  });

  it('reads need project:read', async () => {
    const projectId = await makeProject(CLIENT_A);
    testState.permissions = new Set(['project:update']);
    expect(isActionPermissionError(await getProjectStaging(projectId))).toBe(true);
  });

  it('a project outside the caller’s record-level scope reads exactly like a missing project, and nothing is written', async () => {
    const projectB = await makeProject(CLIENT_B);
    const projectA = await makeProject(CLIENT_A);
    const svc = await makeProduct(5);
    testState.user = { user_id: RESTRICTED, user_type: 'internal', roles: [] };

    const forbidden = await reserveProjectStaging({ project_id: projectB, service_id: svc, quantity: 1, currency_code: 'USD' });
    const missing = await reserveProjectStaging({ project_id: randomUUID(), service_id: svc, quantity: 1, currency_code: 'USD' });
    expect(isActionMessageError(forbidden)).toBe(true);
    expect(forbidden).toEqual(missing);
    expect(await getProjectStaging(projectB)).toEqual(await getProjectStaging(randomUUID()));
    expect(await createProjectStagingBox(projectB, {})).toEqual(missing);
    expect(await count('project_staging_lines', { project_id: projectB })).toBe(0);
    expect(await count('staging_containers', { project_id: projectB })).toBe(0);
    expect(Number((await trx()('stock_levels').where({ tenant: TENANT, service_id: svc }).first()).reserved_quantity)).toBe(0);

    // The same user can work on client A's project.
    const ok: any = await reserveProjectStaging({ project_id: projectA, service_id: svc, quantity: 2, currency_code: 'USD' });
    expect(Array.isArray(ok)).toBe(true);
  });

  it('lines and boxes are only reachable through their own project', async () => {
    const projectA = await makeProject(CLIENT_A);
    const projectB = await makeProject(CLIENT_A);
    const svc = await makeProduct(5);
    const [line]: any = await reserveProjectStaging({ project_id: projectA, service_id: svc, quantity: 2, currency_code: 'USD' });
    const boxB: any = await createProjectStagingBox(projectB, {});

    const viaOtherProject = await stageProjectStagingLines(projectB, [line.staging_line_id]);
    expect(isActionMessageError(viaOtherProject)).toBe(true);
    const install = await installProjectStagingLines(projectB, [line.staging_line_id]);
    expect(isActionMessageError(install)).toBe(true);
    const pack = await packProjectStagingBox(projectA, boxB.container_id, [{ staging_line_id: line.staging_line_id }]);
    expect(isActionMessageError(pack)).toBe(true);
    const after = await trx()('project_staging_lines').where({ tenant: TENANT, staging_line_id: line.staging_line_id }).first();
    expect(after.status).toBe('reserved');
    expect(await count('project_materials', { project_id: projectA })).toBe(0);
  });

  it('the unit picker needs inventory:read', async () => {
    const projectId = await makeProject(CLIENT_A);
    const svc = await makeProduct(0);
    testState.permissions = new Set(['project:read', 'project:update']);
    expect(await listProjectStagingUnits(projectId, svc)).toEqual([]);
    const pick = await reserveProjectStaging({ project_id: projectId, service_id: svc, quantity: 1, unit_ids: [randomUUID()], currency_code: 'USD' });
    expect(isActionPermissionError(pick)).toBe(true);
  });
});

describe('staging actions: install, availability and client-item gates (repair round)', () => {
  it('install needs billing:create; a denied install consumes nothing and creates no material', async () => {
    const projectId = await makeProject(CLIENT_A);
    const svc = await makeProduct(5);
    const [line]: any = await reserveProjectStaging({ project_id: projectId, service_id: svc, quantity: 2, currency_code: 'USD' });
    testState.permissions = new Set(['project:read', 'project:update', 'inventory:read']);

    const denied = await installProjectStagingLines(projectId, [line.staging_line_id]);
    expect(isActionPermissionError(denied)).toBe(true);

    const after = await trx()('project_staging_lines').where({ tenant: TENANT, staging_line_id: line.staging_line_id }).first();
    expect(after.status).toBe('reserved');
    const level = await trx()('stock_levels').where({ tenant: TENANT, service_id: svc, location_id: LOCATION }).first();
    expect([Number(level.quantity_on_hand), Number(level.reserved_quantity)]).toEqual([5, 2]);
    expect(await count('project_materials', { project_id: projectId })).toBe(0);
    expect(await count('stock_movements', { service_id: svc })).toBe(0);

    // With billing:create the same call installs.
    testState.permissions = new Set(ALL);
    const ok: any = await installProjectStagingLines(projectId, [line.staging_line_id]);
    expect(ok[0]).toMatchObject({ ok: true });
  });

  it('availability needs inventory:read', async () => {
    const projectId = await makeProject(CLIENT_A);
    const svc = await makeProduct(5);
    testState.permissions = new Set(['project:read', 'project:update']);
    expect(isActionPermissionError(await getProjectStagingAvailability(projectId, svc))).toBe(true);
    testState.permissions = new Set(ALL);
    const ok: any = await getProjectStagingAvailability(projectId, svc);
    expect(ok.locations[0]).toMatchObject({ on_hand: 5, free: 5 });
  });

  it('client items that link an asset need asset:read; the refusal names no asset and writes nothing', async () => {
    const projectId = await makeProject(CLIENT_A);
    const assetId = randomUUID();
    testState.permissions = new Set(['project:read', 'project:update']);
    const denied: any = await addProjectClientItems(projectId, { items: [{ kind: 'client_asset', asset_id: assetId }] });
    expect(isActionPermissionError(denied)).toBe(true);
    expect(JSON.stringify(denied)).not.toContain(assetId);
    expect(await count('project_staging_lines', { project_id: projectId })).toBe(0);
    // Free-text items do not need asset:read.
    const ok: any = await addProjectClientItems(projectId, { items: [{ kind: 'client_item', description: 'Rack rails' }] });
    expect(Array.isArray(ok)).toBe(true);
  });
});
