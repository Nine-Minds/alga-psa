/**
 * C6 repair: deleting a task, phase or project must return its staging claims (no phantom reserved/held
 * counters or allocated units), detach boxes and installed lines instead of cascading them away, and never
 * fail on a raw FK error. Real DB; every case runs in a rolled-back transaction.
 * Run: DB_HOST=127.0.0.1 DB_PORT=5472 DB_NAME=test_database node scripts/run-workspace-db-tests.mjs stagingTaskDelete
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
vi.mock('@alga-psa/auth', async () => ({
  ...(await vi.importActual<typeof import('@alga-psa/auth')>('@alga-psa/auth')),
  withAuth: (fn: any) => (...args: unknown[]) => fn(testState.user, { tenant: testState.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) =>
    testState.permissions.has(`${resource}:${action}`)),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(async () => undefined) }));

import { deleteTask } from './projectTaskActions';
import ProjectModel from '../models/project';
import {
  addClientLines,
  computeAllocationsFromTruth,
  createContainer,
  installLines,
  packLines,
  recordStockMovement,
  releaseStagingForTask,
  reserveStagingLines,
  sealContainer,
  stageLines,
} from '@alga-psa/inventory/lib';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../../../inventory/src/test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();

let knex: Knex;
let TENANT: string;
let LOCATION: string;
let CLIENT: string;
let USER: string;
let TYPE_ID: string;

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: databaseConnection, pool: { min: 1, max: 4 } });
  TENANT = await createInventoryTestTenant(knex);
  testState.tenant = TENANT;
  LOCATION = (await knex('stock_locations').where({ tenant: TENANT, is_default: true }).first()).location_id;
  CLIENT = (await knex('clients').where({ tenant: TENANT }).first()).client_id;
  USER = (await knex('users').where({ tenant: TENANT }).first()).user_id;
  TYPE_ID = (await knex('service_types').where({ tenant: TENANT }).first()).id;
});

beforeEach(async () => {
  testState.trx = await knex.transaction();
  testState.user = { user_id: USER, user_type: 'internal', roles: [] };
  testState.permissions = new Set(['project:read', 'project:update', 'project:delete']);
});

afterEach(async () => {
  await testState.trx?.rollback();
  testState.trx = null;
});

afterAll(async () => {
  await knex?.destroy();
});

const trx = (): Knex.Transaction => testState.trx;
const db = (): Knex => testState.trx as unknown as Knex;

async function makeProduct(opts: { onHand: number; serialized?: boolean }): Promise<string> {
  const label = `c6-del-${randomUUID().slice(0, 8)}`;
  const [svc] = await trx()('service_catalog')
    .insert({ tenant: TENANT, service_name: `ZZ ${label}`, sku: label, item_kind: 'product', billing_method: 'per_unit', default_rate: 1500, is_active: true, custom_service_type_id: TYPE_ID })
    .returning('service_id');
  const serviceId = svc.service_id as string;
  await trx()('product_inventory_settings').insert({
    tenant: TENANT, service_id: serviceId, track_stock: true, is_serialized: Boolean(opts.serialized),
    cost_currency: 'USD', default_location_id: LOCATION, average_cost: 500,
  });
  if (opts.serialized) {
    for (let i = 0; i < opts.onHand; i += 1) await receiveUnit(serviceId, `${label}-${i}`);
  } else {
    await recordStockMovement(trx(), TENANT, { movement_type: 'receipt', service_id: serviceId, quantity: opts.onHand, to_location_id: LOCATION, unit_cost: 500 });
  }
  return serviceId;
}

async function receiveUnit(serviceId: string, serial: string): Promise<string> {
  const [unit] = await trx()('stock_units')
    .insert({ tenant: TENANT, service_id: serviceId, serial_number: serial, status: 'in_stock', location_id: LOCATION, cost_currency: 'USD', unit_cost: 500, received_at: new Date(Date.now() - 3600_000).toISOString() })
    .returning('unit_id');
  await recordStockMovement(trx(), TENANT, { movement_type: 'receipt', service_id: serviceId, quantity: 1, to_location_id: LOCATION, unit_id: unit.unit_id, unit_cost: 500 });
  return unit.unit_id;
}

async function makeProject(): Promise<{ projectId: string; phaseId: string; taskId: string }> {
  const status = (await trx()('statuses').where({ tenant: TENANT }).first()).status_id;
  const n = randomUUID().slice(0, 8);
  const [p] = await trx()('projects')
    .insert({ tenant: TENANT, project_name: `ZZ C6 ${n}`, client_id: CLIENT, status, wbs_code: n, project_number: `PRJ-${n}` })
    .returning('project_id');
  const [phase] = await trx()('project_phases')
    .insert({ tenant: TENANT, project_id: p.project_id, phase_name: 'Install', status: 'active', order_number: 1, wbs_code: `${n}.1`, order_key: 'a0' })
    .returning('phase_id');
  const [task] = await trx()('project_tasks')
    .insert({ tenant: TENANT, phase_id: phase.phase_id, task_name: 'Rack and stack', wbs_code: `${n}.1.1` })
    .returning('task_id');
  return { projectId: p.project_id, phaseId: phase.phase_id, taskId: task.task_id };
}

async function levelOf(serviceId: string) {
  const r = await trx()('stock_levels').where({ tenant: TENANT, service_id: serviceId, location_id: LOCATION }).first();
  return { onHand: Number(r.quantity_on_hand), reserved: Number(r.reserved_quantity), held: Number(r.held_quantity) };
}

const count = async (table: string, where: Record<string, unknown> = {}) =>
  Number((await trx()(table).where({ tenant: TENANT, ...where }).count<{ c: string }>('* as c').first())?.c ?? 0);

async function expectCacheMatchesTruth(serviceId: string) {
  const truth = await computeAllocationsFromTruth(trx(), TENANT, serviceId, false);
  const cache = await levelOf(serviceId);
  expect(truth.get(LOCATION) ?? { reserved: 0, held: 0 }).toEqual({ reserved: cache.reserved, held: cache.held });
}

/** reserved non-serialized line + staged non-serialized line + staged serialized unit, all on the task. */
async function stageFixture(projectId: string, taskId: string) {
  const plain = await makeProduct({ onHand: 10 });
  const serial = await makeProduct({ onHand: 2, serialized: true });
  const [reserved]: any = await reserveStagingLines(db(), TENANT, { project_id: projectId, task_id: taskId, service_id: plain, quantity: 2, currency_code: 'USD' }, USER);
  const [toStage]: any = await reserveStagingLines(db(), TENANT, { project_id: projectId, task_id: taskId, service_id: plain, quantity: 3, currency_code: 'USD' }, USER);
  await stageLines(db(), TENANT, [toStage.staging_line_id], USER);
  const [unitLine]: any = await reserveStagingLines(db(), TENANT, { project_id: projectId, task_id: taskId, service_id: serial, quantity: 1, currency_code: 'USD' }, USER);
  await stageLines(db(), TENANT, [unitLine.staging_line_id], USER);
  expect(await levelOf(plain)).toMatchObject({ reserved: 2, held: 3 });
  const unit = await trx()('stock_units').where({ tenant: TENANT, allocated_staging_line_id: unitLine.staging_line_id }).first();
  expect(unit.status).toBe('allocated');
  return { plain, serial, reserved, toStage, unitLine, unitId: unit.unit_id as string };
}

describe('task delete releases staging', () => {
  it('(a) deleteTask returns reserved/held counters and serial units, empties boxes, and the cache agrees with truth', async () => {
    const { projectId, taskId } = await makeProject();
    const f = await stageFixture(projectId, taskId);
    const box: any = await createContainer(db(), TENANT, { project_id: projectId, task_id: taskId }, USER);
    await packLines(db(), TENANT, box.container_id, [{ staging_line_id: f.toStage.staging_line_id }], USER);
    expect(await count('staging_container_members')).toBe(1);

    const result = await deleteTask(taskId);
    expect(result).toBeUndefined();

    expect(await levelOf(f.plain)).toMatchObject({ reserved: 0, held: 0, onHand: 10 });
    const unit = await trx()('stock_units').where({ tenant: TENANT, unit_id: f.unitId }).first();
    expect(unit).toMatchObject({ status: 'in_stock', allocated_staging_line_id: null });
    expect(await count('staging_container_members')).toBe(0);
    expect(await count('project_tasks', { task_id: taskId })).toBe(0);
    const lines = await trx()('project_staging_lines').where({ tenant: TENANT, project_id: projectId });
    expect(lines.map((l: any) => l.status)).toEqual(['released', 'released', 'released']);
    expect(lines.every((l: any) => l.task_id === null)).toBe(true);
    await expectCacheMatchesTruth(f.plain);
  });

  it('(a) a line in a sealed box is released too (the box is reopened)', async () => {
    const { projectId, taskId } = await makeProject();
    const f = await stageFixture(projectId, taskId);
    const box: any = await createContainer(db(), TENANT, { project_id: projectId, task_id: taskId }, USER);
    await packLines(db(), TENANT, box.container_id, [{ staging_line_id: f.toStage.staging_line_id }], USER);
    await sealContainer(db(), TENANT, box.container_id, USER);

    expect(await deleteTask(taskId)).toBeUndefined();
    expect(await levelOf(f.plain)).toMatchObject({ reserved: 0, held: 0 });
    const kept = await trx()('staging_containers').where({ tenant: TENANT, container_id: box.container_id }).first();
    expect(kept).toMatchObject({ task_id: null, status: 'open' });
  });

  it('(b) boxes are detached and stay on the project; installed lines stay as history with no task; no raw FK error', async () => {
    const { projectId, taskId } = await makeProject();
    const plain = await makeProduct({ onHand: 5 });
    const [line]: any = await reserveStagingLines(db(), TENANT, { project_id: projectId, task_id: taskId, service_id: plain, quantity: 2, currency_code: 'USD' }, USER);
    const [res] = await installLines(db(), TENANT, [line.staging_line_id], USER, { projectId });
    expect(res).toMatchObject({ ok: true });
    const client: any = await addClientLines(db(), TENANT, { project_id: projectId, task_id: taskId, items: [{ kind: 'client_item', description: 'Rack rails' }] }, USER);
    const box: any = await createContainer(db(), TENANT, { project_id: projectId, task_id: taskId }, USER);

    expect(await deleteTask(taskId)).toBeUndefined();

    const installed = await trx()('project_staging_lines').where({ tenant: TENANT, staging_line_id: line.staging_line_id }).first();
    expect(installed).toMatchObject({ status: 'installed', task_id: null });
    expect(installed.project_material_id).toBeTruthy();
    expect(await count('project_materials', { project_material_id: installed.project_material_id })).toBe(1);
    expect(await trx()('project_staging_lines').where({ tenant: TENANT, staging_line_id: client[0].staging_line_id }).first()).toMatchObject({ status: 'released', task_id: null });
    expect(await trx()('staging_containers').where({ tenant: TENANT, container_id: box.container_id }).first()).toMatchObject({ task_id: null, project_id: projectId });
    // Consumed stock stays consumed; nothing was handed back.
    expect(await levelOf(plain)).toMatchObject({ onHand: 3, reserved: 0, held: 0 });
  });

  it('the database refuses a task delete that skips the helper (NO ACTION, not a silent cascade)', async () => {
    const { projectId, taskId } = await makeProject();
    const plain = await makeProduct({ onHand: 5 });
    await reserveStagingLines(db(), TENANT, { project_id: projectId, task_id: taskId, service_id: plain, quantity: 1, currency_code: 'USD' }, USER);
    const sp = await trx().transaction();
    await expect(sp('project_tasks').where({ tenant: TENANT, task_id: taskId }).del()).rejects.toMatchObject({ code: '23503' });
    await sp.rollback();
    expect(await levelOf(plain)).toMatchObject({ reserved: 1 });
    await releaseStagingForTask(trx(), TENANT, taskId, USER);
    expect(await levelOf(plain)).toMatchObject({ reserved: 0 });
  });
});

describe('phase and project delete release staging', () => {
  it('(c) ProjectModel.deletePhase returns the claims of every task in the phase', async () => {
    const { projectId, phaseId, taskId } = await makeProject();
    const f = await stageFixture(projectId, taskId);
    await ProjectModel.deletePhase(trx(), TENANT, phaseId);
    expect(await levelOf(f.plain)).toMatchObject({ reserved: 0, held: 0 });
    expect(await trx()('stock_units').where({ tenant: TENANT, unit_id: f.unitId }).first()).toMatchObject({ status: 'in_stock', allocated_staging_line_id: null });
    expect(await count('project_phases', { phase_id: phaseId })).toBe(0);
    await expectCacheMatchesTruth(f.plain);
  });

  it('(c) ProjectModel.delete returns every claim of the project and removes its staging rows', async () => {
    const { projectId, taskId } = await makeProject();
    const f = await stageFixture(projectId, taskId);
    // A project-level (no task) reservation and a box too.
    const [projectLevel]: any = await reserveStagingLines(db(), TENANT, { project_id: projectId, service_id: f.plain, quantity: 1, currency_code: 'USD' }, USER);
    await createContainer(db(), TENANT, { project_id: projectId }, USER);

    await ProjectModel.delete(trx(), TENANT, projectId);

    expect(projectLevel.staging_line_id).toBeTruthy();
    expect(await levelOf(f.plain)).toMatchObject({ reserved: 0, held: 0 });
    expect(await trx()('stock_units').where({ tenant: TENANT, unit_id: f.unitId }).first()).toMatchObject({ status: 'in_stock', allocated_staging_line_id: null });
    expect(await count('project_staging_lines', { project_id: projectId })).toBe(0);
    expect(await count('staging_containers', { project_id: projectId })).toBe(0);
    expect(await count('projects', { project_id: projectId })).toBe(0);
    await expectCacheMatchesTruth(f.plain);
  });
});
