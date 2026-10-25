/**
 * C6 project staging engine against the isolated migrated test DB. Every case runs in a transaction that
 * is always rolled back, except the concurrency case, which commits its own fixture and removes it.
 * Run from the repository root: node scripts/run-workspace-db-tests.mjs ../packages/inventory/src/lib/staging.db.test.ts
 *
 * Plan: ee/docs/plans/2026-10-24-c6-project-staging/tests.json (T001-T005, T007-T009, T013).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const testState = vi.hoisted(() => ({
  trx: null as any,
  tenant: '',
  user: { user_id: 'staging-test-user' },
  permissions: new Set<string>(),
  assetLinks: [] as unknown[],
  inventoryEvents: [] as Array<{ name: string; payload: unknown }>,
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
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));
// The delivered-asset hook runs after the material's transaction; record what it was handed.
vi.mock('./assetLink', async () => ({
  ...(await vi.importActual<typeof import('./assetLink')>('./assetLink')),
  createAndLinkDeliveredAsset: vi.fn(async (_db: unknown, _tenant: string, link: unknown) => {
    testState.assetLinks.push(link);
    return null;
  }),
}));

vi.mock('./inventoryEvents', async () => ({
  ...(await vi.importActual<typeof import('./inventoryEvents')>('./inventoryEvents')),
  publishInventoryEvent: vi.fn(async (name: string, payload: unknown) => {
    testState.inventoryEvents.push({ name, payload });
  }),
}));

import { recordStockMovement } from './movements';
import { applyAllocationDelta } from './levels';
import { InsufficientStockError, recordStockConsumption } from './consume';
import { addMaterial, deleteMaterial } from './materials';
import { queryProductAvailability } from './availability';
import { reconcileStockLevels } from './reconcile';
import {
  addClientLines,
  adjustReservation,
  installLines,
  listStaging,
  releaseAllProjectClaims,
  releaseLines,
  reserveStagingLines,
  stageLines,
  StagingError,
  swapUnit,
  undoInstall,
} from './staging';
import {
  createContainer,
  deleteContainer,
  getContainers,
  listContainers,
  packLines,
  reopenContainer,
  sealContainer,
  stagingContainerIdentifier,
  unpackLine,
} from './stagingContainers';
import { confirmSalesOrder, createSalesOrder } from '../actions/salesOrderActions';
import { fulfillSalesOrderLine, listFulfillmentCandidateUnits } from '../actions/fulfillmentActions';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();

let knex: Knex;
let TENANT: string;
let LOCATION: string;
let CLIENT: string;
let USER: string;
let TYPE_ID: string;

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: databaseConnection, pool: { min: 1, max: 6 } });
  TENANT = await createInventoryTestTenant(knex);
  testState.tenant = TENANT;
  LOCATION = (await knex('stock_locations').where({ tenant: TENANT, is_default: true }).first()).location_id;
  CLIENT = (await knex('clients').where({ tenant: TENANT }).first()).client_id;
  USER = (await knex('users').where({ tenant: TENANT }).first()).user_id;
  testState.user.user_id = USER;
  TYPE_ID = (await knex('service_types').where({ tenant: TENANT }).first()).id;
});

beforeEach(async () => {
  testState.trx = await knex.transaction();
  testState.permissions = new Set(['sales_order:read', 'sales_order:create', 'sales_order:update']);
  testState.assetLinks = [];
  testState.inventoryEvents = [];
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

async function makeProduct(opts: { onHand?: number; serialized?: boolean; tracked?: boolean; kit?: boolean; createsAsset?: boolean; location?: string | null } = {}): Promise<string> {
  const label = `vitest-c6-${randomUUID().slice(0, 8)}`;
  const [svc] = await trx()('service_catalog')
    .insert({ tenant: TENANT, service_name: `ZZ C6 ${label}`, sku: label, item_kind: 'product', billing_method: 'per_unit', default_rate: 1500, is_active: true, custom_service_type_id: TYPE_ID })
    .returning('service_id');
  const serviceId = svc.service_id as string;
  if (opts.tracked !== false) {
    await trx()('product_inventory_settings').insert({
      tenant: TENANT,
      service_id: serviceId,
      track_stock: true,
      is_serialized: Boolean(opts.serialized),
      is_kit: Boolean(opts.kit),
      creates_asset_on_delivery: Boolean(opts.createsAsset),
      cost_currency: 'USD',
      default_location_id: opts.location === undefined ? LOCATION : opts.location,
      average_cost: 500,
    });
  }
  const onHand = opts.onHand ?? 0;
  if (onHand > 0 && opts.tracked !== false) {
    if (opts.serialized) {
      for (let i = 0; i < onHand; i += 1) await receiveUnit(serviceId, LOCATION, `${label}-${i}`);
    } else {
      await recordStockMovement(trx(), TENANT, { movement_type: 'receipt', service_id: serviceId, quantity: onHand, to_location_id: opts.location ?? LOCATION, unit_cost: 500 });
    }
  }
  return serviceId;
}

async function receiveUnit(serviceId: string, locationId: string, serial: string): Promise<string> {
  const [unit] = await trx()('stock_units')
    .insert({ tenant: TENANT, service_id: serviceId, serial_number: serial, status: 'in_stock', location_id: locationId, cost_currency: 'USD', unit_cost: 500, received_at: new Date(Date.now() - 1000 * 60 * 60).toISOString() })
    .returning('unit_id');
  await recordStockMovement(trx(), TENANT, { movement_type: 'receipt', service_id: serviceId, quantity: 1, to_location_id: locationId, unit_id: unit.unit_id, unit_cost: 500 });
  return unit.unit_id;
}

async function makeLocation(name = 'Second warehouse'): Promise<string> {
  const [loc] = await trx()('stock_locations')
    .insert({ tenant: TENANT, location_id: randomUUID(), name: `${name} ${randomUUID().slice(0, 6)}`, location_type: 'warehouse', is_default: false, is_active: true })
    .returning('location_id');
  return loc.location_id;
}

async function makeProject(clientId = CLIENT): Promise<{ projectId: string; projectNumber: string; taskId: string }> {
  const status = (await trx()('statuses').where({ tenant: TENANT }).first()).status_id;
  const n = randomUUID().slice(0, 8);
  const [p] = await trx()('projects')
    .insert({ tenant: TENANT, project_name: `ZZ C6 ${n}`, client_id: clientId, status, wbs_code: n, project_number: `PRJ-${n}` })
    .returning(['project_id', 'project_number']);
  const [phase] = await trx()('project_phases')
    .insert({ tenant: TENANT, project_id: p.project_id, phase_name: 'Install', status: 'active', order_number: 1, wbs_code: `${n}.1`, order_key: 'a0' })
    .returning('phase_id');
  const [task] = await trx()('project_tasks')
    .insert({ tenant: TENANT, phase_id: phase.phase_id, task_name: 'Rack and stack', wbs_code: `${n}.1.1` })
    .returning('task_id');
  return { projectId: p.project_id, projectNumber: p.project_number, taskId: task.task_id };
}

async function level(serviceId: string, locationId = LOCATION) {
  const r = await trx()('stock_levels').where({ tenant: TENANT, service_id: serviceId, location_id: locationId }).first();
  return { onHand: Number(r?.quantity_on_hand ?? 0), reserved: Number(r?.reserved_quantity ?? 0), held: Number(r?.held_quantity ?? 0) };
}

async function count(table: string, where: Record<string, unknown> = {}): Promise<number> {
  const r = await trx()(table).where({ tenant: TENANT, ...where }).count<{ c: string }>('* as c').first();
  return Number(r?.c ?? 0);
}

/** Run one call in a savepoint of the test transaction, as production runs it in its own transaction. */
async function inSavepoint<T>(fn: () => Promise<T>): Promise<T> {
  const outer = testState.trx;
  const sp = await outer.transaction();
  testState.trx = sp;
  try {
    const result = await fn();
    await sp.commit();
    return result;
  } catch (e) {
    await sp.rollback().catch(() => undefined);
    throw e;
  } finally {
    testState.trx = outer;
  }
}

async function refusal(fn: () => Promise<unknown>): Promise<InsufficientStockError> {
  try {
    await inSavepoint(fn);
  } catch (e) {
    expect(e).toBeInstanceOf(InsufficientStockError);
    return e as InsufficientStockError;
  }
  throw new Error('expected a stock refusal');
}

async function stagingRefusal(fn: () => Promise<unknown>, code?: string): Promise<StagingError> {
  try {
    await inSavepoint(fn);
  } catch (e) {
    expect(e).toBeInstanceOf(StagingError);
    if (code) expect((e as StagingError).code).toBe(code);
    return e as StagingError;
  }
  throw new Error('expected a staging refusal');
}

async function makeSalesOrder(serviceId: string, quantity: number, mode: 'soft' | 'hard'): Promise<{ soId: string; soLineId: string }> {
  const so: any = await createSalesOrder({ client_id: CLIENT, currency_code: 'USD', invoice_mode: 'manual', allocation_mode: mode, lines: [{ service_id: serviceId, quantity_ordered: quantity, unit_price: 1000 }] });
  if (!so?.so_id) throw new Error(`createSalesOrder failed: ${JSON.stringify(so)}`);
  const confirmed: any = await confirmSalesOrder(so.so_id);
  if (!confirmed?.so_id) throw new Error(`confirmSalesOrder failed: ${JSON.stringify(confirmed)}`);
  return { soId: so.so_id, soLineId: confirmed.lines[0].so_line_id };
}

const reserve = (projectId: string, serviceId: string, quantity: number, extra: Record<string, unknown> = {}) =>
  reserveStagingLines(db(), TENANT, { project_id: projectId, service_id: serviceId, quantity, currency_code: 'USD', ...extra }, USER);

describe('T001 reserve respects availability (all or nothing, one location)', () => {
  it('refuses above free stock counting SO soft and hard claims; exact-to-free succeeds', async () => {
    const svc = await makeProduct({ onHand: 10 });
    await applyAllocationDelta(trx(), TENANT, svc, LOCATION, 'reserved_quantity', 3);
    await applyAllocationDelta(trx(), TENANT, svc, LOCATION, 'held_quantity', 2); // free = 5
    const { projectId } = await makeProject();

    const err = await refusal(() => reserve(projectId, svc, 6));
    expect(err.overrideable).toBe(false);
    expect(err).toMatchObject({ free: 5, reserved: 3, held: 2, requested: 6 });
    expect(await level(svc)).toEqual({ onHand: 10, reserved: 3, held: 2 });
    expect(await count('project_staging_lines', { project_id: projectId })).toBe(0);

    const [line] = await reserve(projectId, svc, 5);
    expect(line).toMatchObject({ kind: 'stock', status: 'reserved', quantity: 5, reserved_location_id: LOCATION, reserved_by: USER });
    expect(await level(svc)).toEqual({ onHand: 10, reserved: 8, held: 2 });
  });

  it('reserves at a named non-default location and refuses where that location is short', async () => {
    const other = await makeLocation();
    const svc = await makeProduct({ onHand: 2 });
    await recordStockMovement(trx(), TENANT, { movement_type: 'receipt', service_id: svc, quantity: 7, to_location_id: other, unit_cost: 500 });
    const { projectId } = await makeProject();
    await refusal(() => reserve(projectId, svc, 3)); // default location only has 2
    const [line] = await reserve(projectId, svc, 3, { location_id: other });
    expect(line.reserved_location_id).toBe(other);
    expect(await level(svc, other)).toMatchObject({ onHand: 7, reserved: 3 });
    expect(await level(svc)).toMatchObject({ onHand: 2, reserved: 0 });
  });

  it('serialized: one line per unit; FIFO reserve of N fails as a whole when fewer than N are free', async () => {
    const svc = await makeProduct({ onHand: 3, serialized: true });
    const { projectId } = await makeProject();
    await refusal(() => reserve(projectId, svc, 4));
    expect(await count('stock_units', { service_id: svc, status: 'allocated' })).toBe(0);
    expect(await count('project_staging_lines', { project_id: projectId })).toBe(0);

    const lines = await reserve(projectId, svc, 3);
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.quantity === 1 && l.unit_id && l.reserved_location_id === null)).toBe(true);
    const units = await trx()('stock_units').where({ tenant: TENANT, service_id: svc });
    expect(units.every((u: any) => u.status === 'allocated' && lines.some((l) => l.staging_line_id === u.allocated_staging_line_id))).toBe(true);
    expect((await level(svc)).onHand).toBe(0); // on-hand recomputed from in_stock units
  });

  it('serialized: a unit claimed by a sales order or another project, or not in stock, cannot be reserved', async () => {
    const svc = await makeProduct({ onHand: 3, serialized: true });
    const { projectId } = await makeProject();
    const { projectId: other } = await makeProject();
    const units = (await trx()('stock_units').where({ tenant: TENANT, service_id: svc }).orderBy('received_at')).map((u: any) => u.unit_id);

    await makeSalesOrder(svc, 1, 'soft'); // claims the FIFO-first unit
    const soUnit = (await trx()('stock_units').where({ tenant: TENANT, service_id: svc, status: 'allocated' }).first()).unit_id;
    await stagingRefusal(() => reserve(projectId, svc, 1, { unit_ids: [soUnit] }), 'unit_unavailable');

    const freeUnits = units.filter((u: string) => u !== soUnit);
    await reserve(other, svc, 1, { unit_ids: [freeUnits[0]] });
    await stagingRefusal(() => reserve(projectId, svc, 1, { unit_ids: [freeUnits[0]] }), 'unit_unavailable');

    await trx()('stock_units').where({ tenant: TENANT, unit_id: freeUnits[1] }).update({ status: 'retired' });
    await stagingRefusal(() => reserve(projectId, svc, 1, { unit_ids: [freeUnits[1]] }), 'unit_unavailable');
    expect(await count('project_staging_lines', { project_id: projectId })).toBe(0);
  });

  it('refuses kits and non-products; untracked products become plain lines with no claim', async () => {
    const { projectId } = await makeProject();
    const kit = await makeProduct({ kit: true });
    await stagingRefusal(() => reserve(projectId, kit, 1), 'kit_not_stageable');
    const service = (await trx()('service_catalog').where({ tenant: TENANT, item_kind: 'service' }).first()).service_id;
    await stagingRefusal(() => reserve(projectId, service, 1), 'not_a_product');

    const untracked = await makeProduct({ tracked: false });
    const [line] = await reserve(projectId, untracked, 4);
    expect(line).toMatchObject({ status: 'reserved', quantity: 4, reserved_location_id: null, unit_id: null, rate: 1500 });
    expect(await count('stock_levels', { service_id: untracked })).toBe(0);
  });

  it('two concurrent reserves of the last units serialize: one wins, the other gets a typed refusal', async () => {
    // Committed fixture (separate transactions must see it); no movements, so it can be removed again.
    const serviceId = randomUUID();
    const status = (await knex('statuses').where({ tenant: TENANT }).first()).status_id;
    const projectId = randomUUID();
    const n = randomUUID().slice(0, 8);
    await knex('service_catalog').insert({ tenant: TENANT, service_id: serviceId, service_name: `ZZ C6 race ${n}`, sku: `race-${n}`, item_kind: 'product', billing_method: 'per_unit', default_rate: 100, is_active: true, custom_service_type_id: TYPE_ID });
    await knex('product_inventory_settings').insert({ tenant: TENANT, service_id: serviceId, track_stock: true, is_serialized: false, cost_currency: 'USD', default_location_id: LOCATION });
    await knex('stock_levels').insert({ tenant: TENANT, service_id: serviceId, location_id: LOCATION, quantity_on_hand: 5, reserved_quantity: 0, held_quantity: 0 });
    await knex('projects').insert({ tenant: TENANT, project_id: projectId, project_name: `ZZ C6 race ${n}`, client_id: CLIENT, status, wbs_code: `race-${n}`, project_number: `RACE-${n}` });
    try {
      const a = await knex.transaction();
      const b = await knex.transaction();
      try {
        await reserveStagingLines(a as unknown as Knex, TENANT, { project_id: projectId, service_id: serviceId, quantity: 4, currency_code: 'USD' }, USER);
        // b blocks on a's row lock, then re-reads the committed balance.
        const pending = reserveStagingLines(b as unknown as Knex, TENANT, { project_id: projectId, service_id: serviceId, quantity: 4, currency_code: 'USD' }, USER)
          .then(() => null, (e) => e);
        await new Promise((r) => setTimeout(r, 150));
        await a.commit();
        const err = await pending;
        expect(err).toBeInstanceOf(InsufficientStockError);
        expect(err).toMatchObject({ free: 1, requested: 4 });
      } finally {
        if (!a.isCompleted()) await a.rollback();
        if (!b.isCompleted()) await b.rollback();
      }
      const lvl = await knex('stock_levels').where({ tenant: TENANT, service_id: serviceId, location_id: LOCATION }).first();
      expect(Number(lvl.reserved_quantity)).toBe(4);
    } finally {
      await knex('project_staging_lines').where({ tenant: TENANT, project_id: projectId }).delete();
      await knex('projects').where({ tenant: TENANT, project_id: projectId }).delete();
      await knex('stock_levels').where({ tenant: TENANT, service_id: serviceId }).delete();
      await knex('product_inventory_settings').where({ tenant: TENANT, service_id: serviceId }).delete();
      await knex('service_catalog').where({ tenant: TENANT, service_id: serviceId }).delete();
    }
  });
});

describe('T002 shared counter', () => {
  it('after a project reserve, SO allocation, availability and the consume guard all see less free stock', async () => {
    const svc = await makeProduct({ onHand: 10 });
    const { projectId } = await makeProject();
    await reserve(projectId, svc, 7);

    const [avail] = await queryProductAvailability(trx(), TENANT, [svc]);
    expect(avail).toMatchObject({ on_hand_total: 10, available_total: 3 });

    const { soLineId } = await makeSalesOrder(svc, 5, 'soft');
    const soLine = await trx()('sales_order_lines').where({ tenant: TENANT, so_line_id: soLineId }).first();
    expect(Number(soLine.quantity_reserved)).toBe(3); // capped at what the project left free
    expect(await level(svc)).toEqual({ onHand: 10, reserved: 10, held: 0 });

    const err = await refusal(() => recordStockConsumption(trx(), TENANT, { service_id: svc, quantity: 1, source_doc_type: 'ticket_material', source_doc_id: randomUUID() }));
    expect(err.reason).toBe('reserved');
    expect(err.message).toMatch(/reserved for sales orders and projects/);
  });

  it('staging moves the claim from reserved to held; the consume guard then refuses even with the override', async () => {
    const svc = await makeProduct({ onHand: 4 });
    const { projectId } = await makeProject();
    const [line] = await reserve(projectId, svc, 4);
    // Soft: an explicit override could still take it.
    const soft = await refusal(() => recordStockConsumption(trx(), TENANT, { service_id: svc, quantity: 1, source_doc_type: 'ticket_material', source_doc_id: randomUUID() }));
    expect(soft.overrideable).toBe(true);
    expect(soft.message).toMatch(/reserved for projects\./);

    await stageLines(db(), TENANT, [line.staging_line_id], USER);
    expect(await level(svc)).toEqual({ onHand: 4, reserved: 0, held: 4 });
    const hard = await refusal(() => recordStockConsumption(trx(), TENANT, { service_id: svc, quantity: 1, source_doc_type: 'ticket_material', source_doc_id: randomUUID(), allow_reserved_override: true }));
    expect(hard.reason).toBe('held');
    expect(hard.overrideable).toBe(false);
    expect(hard.message).toMatch(/on hard hold for projects/);
    expect((await level(svc)).onHand).toBe(4);
  });

  it('a soft override that consumed reserved stock shows as a shortfall, and staging the line is then refused', async () => {
    const svc = await makeProduct({ onHand: 5 });
    const { projectId } = await makeProject();
    const [line] = await reserve(projectId, svc, 5);
    await recordStockConsumption(trx(), TENANT, { service_id: svc, quantity: 2, source_doc_type: 'ticket_material', source_doc_id: randomUUID(), allow_reserved_override: true });
    const [view] = await listStaging(trx(), TENANT, projectId);
    expect(view.stock_shortfall).toBe(2);
    await refusal(() => stageLines(db(), TENANT, [line.staging_line_id], USER));
  });
});

describe('T003 reconcile', () => {
  it('"Rebuild stock caches" preserves project reserved and held claims and clears drift', async () => {
    const svc = await makeProduct({ onHand: 10 });
    const { projectId } = await makeProject();
    const [reserved] = await reserve(projectId, svc, 3);
    const [staged] = await reserve(projectId, svc, 2);
    await stageLines(db(), TENANT, [staged.staging_line_id], USER);
    const [released] = await reserve(projectId, svc, 1);
    await releaseLines(db(), TENANT, [released.staging_line_id], USER);
    expect(reserved.status).toBe('reserved');

    // Drift: counters that no claim explains.
    await trx()('stock_levels').where({ tenant: TENANT, service_id: svc, location_id: LOCATION }).update({ reserved_quantity: 9, held_quantity: 0 });
    const [rebuilt] = await reconcileStockLevels(trx(), TENANT, svc, false);
    expect(rebuilt).toMatchObject({ location_id: LOCATION, quantity_on_hand: 10, reserved_quantity: 3, held_quantity: 2 });
    expect(await level(svc)).toEqual({ onHand: 10, reserved: 3, held: 2 });
  });
});

describe('T004 SO fulfillment never poaches a project claim', () => {
  it('FIFO skips project-claimed units, an explicit pick of one fails, and the picker marks it unselectable', async () => {
    const svc = await makeProduct({ onHand: 2, serialized: true });
    const { projectId } = await makeProject();
    const [claim] = await reserve(projectId, svc, 1); // FIFO-first unit
    const { soLineId } = await makeSalesOrder(svc, 1, 'soft');

    const candidates: any = await listFulfillmentCandidateUnits(soLineId);
    const projectUnit = candidates.find((u: any) => u.unit_id === claim.unit_id);
    expect(projectUnit).toMatchObject({ foreign_hard_hold: true, allocated_to_project: true });

    const explicit: any = await fulfillSalesOrderLine(soLineId, { unit_ids: [claim.unit_id!] });
    expect(JSON.stringify(explicit)).toMatch(/allocated to project staging/);
    const unit = await trx()('stock_units').where({ tenant: TENANT, unit_id: claim.unit_id }).first();
    expect(unit).toMatchObject({ status: 'allocated', allocated_staging_line_id: claim.staging_line_id });

    const fifo: any = await fulfillSalesOrderLine(soLineId, {});
    expect(fifo.unit_ids).toHaveLength(1);
    expect(fifo.unit_ids[0]).not.toBe(claim.unit_id);
  });

  it('documents the existing behaviour: non-serialized SO fulfillment warns but can take staged (held) stock', async () => {
    const svc = await makeProduct({ onHand: 3 });
    const { projectId } = await makeProject();
    const [line] = await reserve(projectId, svc, 3);
    await stageLines(db(), TENANT, [line.staging_line_id], USER);
    const { soLineId } = await makeSalesOrder(svc, 1, 'soft'); // reserves nothing: free is 0
    const result: any = await fulfillSalesOrderLine(soLineId, { quantity: 1 });
    expect(result.quantity_fulfilled).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('T005 install, undo and delete', () => {
  it('low-stock signal after install names the claimed-from location, not the product default', async () => {
    const other = await makeLocation('Reserve warehouse');
    const svc = await makeProduct({ onHand: 1 });
    await trx()('product_inventory_settings').where({ tenant: TENANT, service_id: svc }).update({ reorder_point: 5 });
    await recordStockMovement(trx(), TENANT, { movement_type: 'receipt', service_id: svc, quantity: 6, to_location_id: other, unit_cost: 500 });
    const { projectId } = await makeProject();
    const [line] = await reserve(projectId, svc, 4, { location_id: other });
    await stageLines(db(), TENANT, [line.staging_line_id], USER);

    const [result] = await installLines(db(), TENANT, [line.staging_line_id], USER);
    expect(result.ok).toBe(true);
    const low = testState.inventoryEvents.filter((e) => e.name === 'INVENTORY_STOCK_LOW');
    expect(low).toHaveLength(1);
    expect(JSON.stringify(low[0].payload)).toContain(other);
    expect(JSON.stringify(low[0].payload)).not.toContain(LOCATION);
  });

  it('non-serialized: consumes once at the claim location, releases the claim, one material with the planned billing fields', async () => {
    const other = await makeLocation();
    const svc = await makeProduct({ onHand: 1 });
    await recordStockMovement(trx(), TENANT, { movement_type: 'receipt', service_id: svc, quantity: 6, to_location_id: other, unit_cost: 500 });
    const { projectId } = await makeProject();
    const [line] = await reserve(projectId, svc, 4, { location_id: other, rate: 2500, billing_destination: 'on_hold' });
    await stageLines(db(), TENANT, [line.staging_line_id], USER);

    const [result] = await installLines(db(), TENANT, [line.staging_line_id], USER);
    expect(result.ok).toBe(true);
    expect(await level(svc, other)).toEqual({ onHand: 2, reserved: 0, held: 0 });
    expect(await level(svc)).toEqual({ onHand: 1, reserved: 0, held: 0 });
    const materials = await trx()('project_materials').where({ tenant: TENANT, project_id: projectId });
    expect(materials).toHaveLength(1);
    expect({ ...materials[0], rate: Number(materials[0].rate) }).toMatchObject({ service_id: svc, quantity: 4, rate: 2500, currency_code: 'USD', billing_destination: 'on_hold', is_billed: false });
    const moves = await trx()('stock_movements').where({ tenant: TENANT, service_id: svc, movement_type: 'consume' });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ from_location_id: other, source_doc_type: 'project_material', source_doc_id: materials[0].project_material_id });
    const after = await trx()('project_staging_lines').where({ tenant: TENANT, staging_line_id: line.staging_line_id }).first();
    expect(after).toMatchObject({ status: 'installed', project_material_id: materials[0].project_material_id, installed_by: USER });

    // A second install of the same line is refused and consumes nothing.
    const [again] = await installLines(db(), TENANT, [line.staging_line_id], USER);
    expect(again.ok).toBe(false);
    expect(await count('stock_movements', { service_id: svc, movement_type: 'consume' })).toBe(1);
  });

  it('serialized: delivers the claimed unit to the client and hands the asset link over after the material', async () => {
    const svc = await makeProduct({ onHand: 2, serialized: true, createsAsset: true });
    const { projectId } = await makeProject();
    const [line] = await reserve(projectId, svc, 1);
    const [result] = await installLines(db(), TENANT, [line.staging_line_id], USER);
    expect(result.ok).toBe(true);
    const unit = await trx()('stock_units').where({ tenant: TENANT, unit_id: line.unit_id }).first();
    expect(unit).toMatchObject({ status: 'delivered', client_id: CLIENT, allocated_staging_line_id: null, location_id: null });
    expect(testState.assetLinks).toHaveLength(1);
    expect((testState.assetLinks[0] as any).unit.unit_id).toBe(line.unit_id);
    expect((testState.assetLinks[0] as any).clientId).toBe(CLIENT);
  });

  it('one failing line does not undo the others; the result lists each outcome', async () => {
    const svc = await makeProduct({ onHand: 3 });
    const { projectId } = await makeProject();
    const [good] = await reserve(projectId, svc, 2);
    const [released] = await reserve(projectId, svc, 1);
    await releaseLines(db(), TENANT, [released.staging_line_id], USER);
    const results = await installLines(db(), TENANT, [released.staging_line_id, good.staging_line_id], USER);
    expect(results.map((r) => r.ok)).toEqual([false, true]);
    expect(await count('project_materials', { project_id: projectId })).toBe(1);
  });

  it('undo install restores the hard claim at the original location; deleting the material releases the line', async () => {
    const svc = await makeProduct({ onHand: 5 });
    const { projectId } = await makeProject();
    const [line] = await reserve(projectId, svc, 3);
    await installLines(db(), TENANT, [line.staging_line_id], USER);
    expect(await level(svc)).toEqual({ onHand: 2, reserved: 0, held: 0 });

    const undone = await undoInstall(db(), TENANT, line.staging_line_id, USER);
    expect(undone).toMatchObject({ status: 'staged', project_material_id: null });
    expect(await level(svc)).toEqual({ onHand: 5, reserved: 0, held: 3 });
    expect(await count('project_materials', { project_id: projectId })).toBe(0);

    await installLines(db(), TENANT, [line.staging_line_id], USER);
    const material = await trx()('project_materials').where({ tenant: TENANT, project_id: projectId }).first();
    expect(await deleteMaterial(db(), TENANT, 'project', material.project_material_id, USER)).toBe(true);
    const after = await trx()('project_staging_lines').where({ tenant: TENANT, staging_line_id: line.staging_line_id }).first();
    expect(after).toMatchObject({ status: 'released', project_material_id: null });
    expect(await level(svc)).toEqual({ onHand: 5, reserved: 0, held: 0 }); // never back to a claim
  });

  it('undo is refused for a billed material and when the restored stock is no longer free', async () => {
    const svc = await makeProduct({ onHand: 2, serialized: true });
    const { projectId } = await makeProject();
    const [billed, unbilled] = await reserve(projectId, svc, 2);
    await installLines(db(), TENANT, [billed.staging_line_id, unbilled.staging_line_id], USER);
    const billedLine = await trx()('project_staging_lines').where({ tenant: TENANT, staging_line_id: billed.staging_line_id }).first();
    await trx()('project_materials').where({ tenant: TENANT, project_material_id: billedLine.project_material_id }).update({ is_billed: true });
    await expect(inSavepoint(() => undoInstall(db(), TENANT, billed.staging_line_id, USER))).rejects.toThrow(/billed/);
    expect(await count('project_materials', { project_id: projectId })).toBe(2);

    // Non-serialized: a hard hold landed on the location since install, so the returned stock is not free.
    const svc2 = await makeProduct({ onHand: 2 });
    const [line] = await reserve(projectId, svc2, 2);
    await installLines(db(), TENANT, [line.staging_line_id], USER);
    await applyAllocationDelta(trx(), TENANT, svc2, LOCATION, 'held_quantity', 1);
    await refusal(() => undoInstall(db(), TENANT, line.staging_line_id, USER));
    expect(await count('project_materials', { project_id: projectId, service_id: svc2 })).toBe(1);
    expect(await level(svc2)).toEqual({ onHand: 0, reserved: 0, held: 1 });
  });

  it('install of a soft reservation whose stock was taken surfaces the B1 refusal, and the override path consumes', async () => {
    const svc = await makeProduct({ onHand: 4 });
    const { projectId } = await makeProject();
    const [line] = await reserve(projectId, svc, 4);
    // Someone else's soft reservation lands on stock the project's override-consumption freed.
    await recordStockConsumption(trx(), TENANT, { service_id: svc, quantity: 1, source_doc_type: 'ticket_material', source_doc_id: randomUUID(), allow_reserved_override: true });
    const [refused] = await installLines(db(), TENANT, [line.staging_line_id], USER);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.stockConflict?.reason).toBe('on_hand');
    expect(await level(svc)).toEqual({ onHand: 3, reserved: 4, held: 0 }); // the claim was restored with the rollback
  });
});

describe('T007 reserve, stage and pack are not consumption', () => {
  it('write no stock_movements and no project_materials', async () => {
    const svc = await makeProduct({ onHand: 6 });
    const unitSvc = await makeProduct({ onHand: 1, serialized: true });
    const { projectId } = await makeProject();
    const movementsBefore = await count('stock_movements');
    const [line] = await reserve(projectId, svc, 4);
    const [unitLine] = await reserve(projectId, unitSvc, 1);
    await adjustReservation(db(), TENANT, line.staging_line_id, 5, USER);
    await stageLines(db(), TENANT, [line.staging_line_id], USER);
    const box = await createContainer(db(), TENANT, { project_id: projectId }, USER);
    await packLines(db(), TENANT, box.container_id, [{ staging_line_id: line.staging_line_id, quantity: 2 }, { staging_line_id: unitLine.staging_line_id }], USER);
    await sealContainer(db(), TENANT, box.container_id, USER);
    expect(await count('stock_movements')).toBe(movementsBefore);
    expect(await count('project_materials', { project_id: projectId })).toBe(0);
    expect(await level(svc)).toEqual({ onHand: 6, reserved: 0, held: 5 });
  });
});

describe('T008 client-provided items', () => {
  it('never create stock units, movements or levels, and never become billable; another client’s asset is refused', async () => {
    const { projectId } = await makeProject();
    const [asset] = await trx()('assets').insert({ tenant: TENANT, asset_tag: `CL-${randomUUID().slice(0, 6)}`, name: 'Client NAS', status: 'active', client_id: CLIENT, asset_type: 'unknown' }).returning('asset_id');
    const otherClient = randomUUID();
    await trx()('clients').insert({ tenant: TENANT, client_id: otherClient, client_name: 'Other client', billing_cycle: 'monthly' });
    const [foreign] = await trx()('assets').insert({ tenant: TENANT, asset_tag: `OT-${randomUUID().slice(0, 6)}`, name: 'Not theirs', status: 'active', client_id: otherClient, asset_type: 'unknown' }).returning('asset_id');

    const before = { units: await count('stock_units'), moves: await count('stock_movements'), levels: await count('stock_levels'), materials: await count('project_materials') };
    await stagingRefusal(() => addClientLines(db(), TENANT, { project_id: projectId, items: [{ kind: 'client_asset', asset_id: foreign.asset_id }] }, USER), 'wrong_client');

    const lines = await addClientLines(db(), TENANT, { project_id: projectId, items: [
      { kind: 'client_asset', asset_id: asset.asset_id },
      { kind: 'client_item', description: 'Client-supplied patch cables', quantity: 12 },
    ] }, USER);
    expect(lines.map((l) => [l.kind, l.status, l.quantity])).toEqual([['client_asset', 'received', 1], ['client_item', 'received', 12]]);
    await stagingRefusal(() => addClientLines(db(), TENANT, { project_id: projectId, items: [{ kind: 'client_asset', asset_id: asset.asset_id }] }, USER), 'already_staged_elsewhere');

    const box = await createContainer(db(), TENANT, { project_id: projectId }, USER);
    await packLines(db(), TENANT, box.container_id, lines.map((l) => ({ staging_line_id: l.staging_line_id })), USER);
    const results = await installLines(db(), TENANT, lines.map((l) => l.staging_line_id), USER);
    expect(results.every((r) => r.ok && r.project_material_id === null)).toBe(true);
    expect({ units: await count('stock_units'), moves: await count('stock_movements'), levels: await count('stock_levels'), materials: await count('project_materials') }).toEqual(before);
    const staged = await trx()('project_staging_lines').where({ tenant: TENANT, project_id: projectId });
    expect(staged.every((l: any) => l.status === 'installed' && l.service_id === null && Number(l.rate) === 0)).toBe(true);
  });
});

describe('T009 boxes', () => {
  it('member sums never exceed the line; singletons live in one box; packing stages; sealed refuses; delete only when empty; n of m after deletions', async () => {
    const { projectId, projectNumber, taskId } = await makeProject();
    const svc = await makeProduct({ onHand: 10 });
    const unitSvc = await makeProduct({ onHand: 1, serialized: true });
    const [qty] = await reserve(projectId, svc, 5);
    const [unit] = await reserve(projectId, unitSvc, 1);

    const b1 = await createContainer(db(), TENANT, { project_id: projectId, task_id: taskId, name: 'Rack 1' }, USER);
    const b2 = await createContainer(db(), TENANT, { project_id: projectId }, USER);
    const b3 = await createContainer(db(), TENANT, { project_id: projectId }, USER);
    expect([b1.sequence, b2.sequence, b3.sequence]).toEqual([1, 2, 3]);
    expect(stagingContainerIdentifier(projectNumber, b2.sequence)).toBe(`${projectNumber}-B02`);

    await packLines(db(), TENANT, b1.container_id, [{ staging_line_id: qty.staging_line_id, quantity: 3 }], USER);
    expect((await trx()('project_staging_lines').where({ tenant: TENANT, staging_line_id: qty.staging_line_id }).first()).status).toBe('staged');
    expect(await level(svc)).toMatchObject({ reserved: 0, held: 5 });
    await stagingRefusal(() => packLines(db(), TENANT, b2.container_id, [{ staging_line_id: qty.staging_line_id, quantity: 3 }], USER), 'packed_exceeds_quantity');
    await packLines(db(), TENANT, b2.container_id, [{ staging_line_id: qty.staging_line_id }], USER); // the remaining 2
    await stagingRefusal(() => adjustReservation(db(), TENANT, qty.staging_line_id, 4, USER), 'packed_exceeds_quantity');

    await packLines(db(), TENANT, b1.container_id, [{ staging_line_id: unit.staging_line_id }], USER);
    await stagingRefusal(() => packLines(db(), TENANT, b2.container_id, [{ staging_line_id: unit.staging_line_id }], USER), 'already_staged_elsewhere');

    await sealContainer(db(), TENANT, b1.container_id, USER);
    await stagingRefusal(() => unpackLine(db(), TENANT, b1.container_id, unit.staging_line_id), 'invalid_state');
    await stagingRefusal(() => packLines(db(), TENANT, b1.container_id, [{ staging_line_id: qty.staging_line_id }], USER), 'invalid_state');
    await stagingRefusal(() => releaseLines(db(), TENANT, [unit.staging_line_id], USER), 'in_sealed_box');
    await stagingRefusal(() => swapUnit(db(), TENANT, unit.staging_line_id, randomUUID(), USER), 'in_sealed_box');
    const [sealedView] = await getContainers(trx(), TENANT, [b1.container_id]);
    expect(sealedView).toMatchObject({ status: 'sealed', sealed_by: USER, task_name: 'Rack and stack', position: { n: 1, total: 3 } });
    expect(sealedView!.members.map((m) => [m.staging_line_id, m.quantity]).sort()).toEqual([[qty.staging_line_id, 3], [unit.staging_line_id, 1]].sort());
    await reopenContainer(db(), TENANT, b1.container_id);
    await unpackLine(db(), TENANT, b1.container_id, unit.staging_line_id);

    await stagingRefusal(() => deleteContainer(db(), TENANT, b2.container_id, USER), 'invalid_state');
    await deleteContainer(db(), TENANT, b3.container_id, USER);
    await unpackLine(db(), TENANT, b2.container_id, qty.staging_line_id, 2);
    await deleteContainer(db(), TENANT, b2.container_id, USER);
    const b4 = await createContainer(db(), TENANT, { project_id: projectId }, USER);
    expect(b4.sequence).toBe(4); // never reused
    const boxes = await listContainers(trx(), TENANT, projectId);
    expect(boxes.map((b) => [b.sequence, b.position.n, b.position.total])).toEqual([[1, 1, 2], [4, 2, 2]]);
    expect(await getContainers(trx(), TENANT, [b2.container_id])).toEqual([null]);
  });

  it('released lines leave their boxes; release all reopens sealed boxes and returns every claim', async () => {
    const { projectId } = await makeProject();
    const svc = await makeProduct({ onHand: 4 });
    const [a] = await reserve(projectId, svc, 2);
    const [b] = await reserve(projectId, svc, 1);
    const box = await createContainer(db(), TENANT, { project_id: projectId }, USER);
    await packLines(db(), TENANT, box.container_id, [{ staging_line_id: a.staging_line_id }], USER);
    await sealContainer(db(), TENANT, box.container_id, USER);
    const { released } = await releaseAllProjectClaims(db(), TENANT, projectId, USER);
    expect(released).toBe(2);
    expect(await level(svc)).toEqual({ onHand: 4, reserved: 0, held: 0 });
    expect(await count('staging_container_members', { container_id: box.container_id })).toBe(0);
    const statuses = await trx()('project_staging_lines').whereIn('staging_line_id', [a.staging_line_id, b.staging_line_id]).pluck('status');
    expect(statuses).toEqual(['released', 'released']);
  });

  it('swapping a unit releases the old one and claims the new one', async () => {
    const { projectId } = await makeProject();
    const svc = await makeProduct({ onHand: 2, serialized: true });
    const [line] = await reserve(projectId, svc, 1);
    const other = (await trx()('stock_units').where({ tenant: TENANT, service_id: svc, status: 'in_stock' }).first()).unit_id;
    await swapUnit(db(), TENANT, line.staging_line_id, other, USER);
    const units = await trx()('stock_units').where({ tenant: TENANT, service_id: svc }).select('unit_id', 'status', 'allocated_staging_line_id');
    expect(units.find((u: any) => u.unit_id === other)).toMatchObject({ status: 'allocated', allocated_staging_line_id: line.staging_line_id });
    expect(units.find((u: any) => u.unit_id === line.unit_id)).toMatchObject({ status: 'in_stock', allocated_staging_line_id: null });
  });
});

describe('T013 migration constraints', () => {
  it('a unit cannot carry both claims; a serialized staging line is one unit; client lines carry no stock fields', async () => {
    const { projectId } = await makeProject();
    const svc = await makeProduct({ onHand: 1, serialized: true });
    const [line] = await reserve(projectId, svc, 1);
    const { soLineId } = await (async () => {
      const so: any = await createSalesOrder({ client_id: CLIENT, currency_code: 'USD', invoice_mode: 'manual', allocation_mode: 'soft', lines: [{ service_id: svc, quantity_ordered: 1, unit_price: 1 }] });
      return { soLineId: so.lines[0].so_line_id as string };
    })();
    const sp = await trx().transaction();
    await expect(sp('stock_units').where({ tenant: TENANT, unit_id: line.unit_id }).update({ allocated_so_line_id: soLineId })).rejects.toThrow(/stock_units_single_claimant_ck/);
    await sp.rollback();

    const sp2 = await trx().transaction();
    await expect(sp2('project_staging_lines').where({ tenant: TENANT, staging_line_id: line.staging_line_id }).update({ quantity: 2 })).rejects.toThrow(/project_staging_lines_unit_quantity_ck/);
    await sp2.rollback();

    const sp3 = await trx().transaction();
    await expect(sp3('project_staging_lines').insert({ tenant: TENANT, project_id: projectId, kind: 'client_item', status: 'reserved', description: 'x', quantity: 1 })).rejects.toThrow(/project_staging_lines_client_ck/);
    await sp3.rollback();

    const sp4 = await trx().transaction();
    await expect(sp4('project_staging_lines').where({ tenant: TENANT, staging_line_id: line.staging_line_id }).update({ status: 'installed' })).rejects.toThrow(/project_staging_lines_installed_ck/);
    await sp4.rollback();
  });

  it('project materials added outside staging still behave exactly as before (no staging line written)', async () => {
    const { projectId } = await makeProject();
    const svc = await makeProduct({ onHand: 3 });
    await addMaterial(db(), TENANT, { parent_type: 'project', parent_id: projectId, service_id: svc, quantity: 2, rate: 100, currency_code: 'USD' }, USER);
    expect(await level(svc)).toEqual({ onHand: 1, reserved: 0, held: 0 });
    expect(await count('project_staging_lines', { project_id: projectId })).toBe(0);
  });
});
