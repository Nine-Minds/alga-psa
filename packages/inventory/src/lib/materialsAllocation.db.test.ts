/**
 * B1: ticket/project materials must not consume stock allocated to sales orders.
 * Real server DB; every test runs in a transaction that is always rolled back.
 *
 * Allocation is set up with applyAllocationDelta — the exact counter bump
 * salesOrderActions.allocateLine performs for a confirmed non-serialized line
 * (soft → reserved_quantity, hard → held_quantity).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { Knex } from 'knex';
import { recordStockMovement } from './movements';
import { applyAllocationDelta } from './levels';
import { InsufficientStockError } from './consume';
import { addMaterial } from './materials';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();

let knex: Knex;
let TENANT: string;
let LOCATION: string;
let TICKET: string;

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: databaseConnection, pool: { min: 1, max: 4 } });
  TENANT = await createInventoryTestTenant(knex);
  LOCATION = (await knex('stock_locations').where({ tenant: TENANT, is_default: true }).first()).location_id;
  TICKET = (await knex('tickets').where({ tenant: TENANT }).whereNotNull('client_id').first()).ticket_id;
});

afterAll(async () => { await knex?.destroy(); });

async function inTx(fn: (trx: Knex.Transaction) => Promise<void>) {
  const trx = await knex.transaction();
  try { await fn(trx); } finally { await trx.rollback(); }
}

/** Tracked non-serialized product with `onHand` units and a sales-order claim on it. */
async function makeAllocatedProduct(
  trx: Knex.Transaction,
  onHand: number,
  alloc: { reserved?: number; held?: number },
): Promise<string> {
  const label = `vitest-b1-${randomUUID().slice(0, 8)}`;
  const typeRow = await trx('service_catalog').where({ tenant: TENANT }).whereNotNull('custom_service_type_id').first('custom_service_type_id');
  const [svc] = await trx('service_catalog')
    .insert({ tenant: TENANT, service_name: `ZZ Test ${label}`, sku: label, item_kind: 'product', billing_method: 'per_unit', default_rate: 1000, is_active: true, custom_service_type_id: typeRow.custom_service_type_id })
    .returning('service_id');
  await trx('product_inventory_settings')
    .insert({ tenant: TENANT, service_id: svc.service_id, track_stock: true, is_serialized: false, cost_currency: 'USD', default_location_id: LOCATION, average_cost: 500 });
  await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: svc.service_id, quantity: onHand, to_location_id: LOCATION });
  if (alloc.reserved) await applyAllocationDelta(trx, TENANT, svc.service_id, LOCATION, 'reserved_quantity', alloc.reserved);
  if (alloc.held) await applyAllocationDelta(trx, TENANT, svc.service_id, LOCATION, 'held_quantity', alloc.held);
  return svc.service_id;
}

/** The tenant fixture has no project; create one inside the (rolled-back) transaction. */
async function makeProject(trx: Knex.Transaction): Promise<string> {
  const client = (await trx('clients').where({ tenant: TENANT }).first()).client_id;
  const status = (await trx('statuses').where({ tenant: TENANT }).first()).status_id;
  const n = randomUUID().slice(0, 8);
  const [p] = await trx('projects')
    .insert({ tenant: TENANT, project_name: `ZZ B1 ${n}`, client_id: client, status, wbs_code: n, project_number: `B1-${n}` })
    .returning('project_id');
  return p.project_id;
}

async function level(trx: Knex.Transaction, serviceId: string) {
  const r = await trx('stock_levels').where({ tenant: TENANT, service_id: serviceId, location_id: LOCATION }).first();
  return { onHand: Number(r.quantity_on_hand), reserved: Number(r.reserved_quantity), held: Number(r.held_quantity) };
}

const ticketInput = (service_id: string, quantity: number, extra: Record<string, unknown> = {}) =>
  ({ parent_type: 'ticket' as const, parent_id: TICKET, service_id, quantity, rate: 100, currency_code: 'USD', ...extra });

async function expectRefusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(InsufficientStockError);
    return e as InsufficientStockError;
  }
  throw new Error('expected addMaterial to be refused');
}

describe('B1 materials respect sales-order allocations', () => {
  it('soft reservation, no override → refused with an overrideable error; on-hand unchanged', async () => {
    await inTx(async (trx) => {
      const svc = await makeAllocatedProduct(trx, 10, { reserved: 6 }); // free = 4
      const err = await expectRefusal(addMaterial(trx as unknown as Knex, TENANT, ticketInput(svc, 5), null));
      expect(err.overrideable).toBe(true);
      expect(err.reason).toBe('reserved');
      expect(err).toMatchObject({ free: 4, reserved: 6, held: 0, requested: 5 });
      expect(await level(trx, svc)).toEqual({ onHand: 10, reserved: 6, held: 0 });
    });
  });

  it('soft reservation, with override → consumed; reserved untouched; movement records the override', async () => {
    await inTx(async (trx) => {
      const svc = await makeAllocatedProduct(trx, 10, { reserved: 6 });
      const performer = (await trx('users').where({ tenant: TENANT }).first()).user_id;
      const row: any = await addMaterial(trx as unknown as Knex, TENANT, ticketInput(svc, 5, { allow_reserved_override: true }), performer);
      expect(await level(trx, svc)).toEqual({ onHand: 5, reserved: 6, held: 0 }); // free is now -1
      const mv = await trx('stock_movements').where({ tenant: TENANT, source_doc_type: 'ticket_material', source_doc_id: row.ticket_material_id, movement_type: 'consume' }).first();
      expect(mv.performed_by).toBe(performer);
      expect(mv.reason).toMatch(/^reserved_stock_override:/);
      expect(JSON.parse(mv.reason.replace(/^reserved_stock_override:\s*/, ''))).toMatchObject({ requested: 5, free: 4, reserved: 6, held: 0 });
    });
  });

  it('override cannot take more than is physically on hand', async () => {
    await inTx(async (trx) => {
      const svc = await makeAllocatedProduct(trx, 10, { reserved: 6 });
      const err = await expectRefusal(addMaterial(trx as unknown as Knex, TENANT, ticketInput(svc, 11, { allow_reserved_override: true }), null));
      expect(err.overrideable).toBe(false);
      expect(err.reason).toBe('on_hand');
      expect((await level(trx, svc)).onHand).toBe(10);
    });
  });

  it('hard hold → refused even with the override flag; error is not overrideable', async () => {
    await inTx(async (trx) => {
      const svc = await makeAllocatedProduct(trx, 10, { held: 7 }); // free = 3
      for (const override of [false, true]) {
        const err = await expectRefusal(addMaterial(trx as unknown as Knex, TENANT, ticketInput(svc, 4, { allow_reserved_override: override }), null));
        expect(err.overrideable).toBe(false);
        expect(err.reason).toBe('held');
        expect(err).toMatchObject({ free: 3, held: 7, requested: 4 });
      }
      // reserved + held: the override may cover the reserved part only
      const mixed = await makeAllocatedProduct(trx, 10, { held: 4, reserved: 4 }); // free 2, non-held 6
      const refused = await expectRefusal(addMaterial(trx as unknown as Knex, TENANT, ticketInput(mixed, 7, { allow_reserved_override: true }), null));
      expect(refused.reason).toBe('held');
      await addMaterial(trx as unknown as Knex, TENANT, ticketInput(mixed, 6, { allow_reserved_override: true }), null);
      expect(await level(trx, mixed)).toEqual({ onHand: 4, reserved: 4, held: 4 });
      expect((await level(trx, svc)).onHand).toBe(10);
    });
  });

  it('quantity ≤ free succeeds as before, exact-to-free included, no override needed', async () => {
    await inTx(async (trx) => {
      const svc = await makeAllocatedProduct(trx, 10, { reserved: 6 });
      await addMaterial(trx as unknown as Knex, TENANT, ticketInput(svc, 4), null);
      expect(await level(trx, svc)).toEqual({ onHand: 6, reserved: 6, held: 0 });
      const mv = await trx('stock_movements').where({ tenant: TENANT, service_id: svc, movement_type: 'consume' }).first();
      expect(mv.reason ?? '').not.toMatch(/override/);
    });
  });

  it('project-material path applies the same rule', async () => {
    await inTx(async (trx) => {
      const svc = await makeAllocatedProduct(trx, 10, { reserved: 6 });
      const input = { parent_type: 'project' as const, parent_id: await makeProject(trx), service_id: svc, quantity: 5, rate: 100, currency_code: 'USD' };
      const err = await expectRefusal(addMaterial(trx as unknown as Knex, TENANT, input, null));
      expect(err.overrideable).toBe(true);
      const row: any = await addMaterial(trx as unknown as Knex, TENANT, { ...input, allow_reserved_override: true }, null);
      expect(row.project_material_id).toBeTruthy();
      expect(await level(trx, svc)).toEqual({ onHand: 5, reserved: 6, held: 0 });
      const held = await makeAllocatedProduct(trx, 10, { held: 8 });
      const heldErr = await expectRefusal(addMaterial(trx as unknown as Knex, TENANT, { ...input, service_id: held, quantity: 3, allow_reserved_override: true }, null));
      expect(heldErr.overrideable).toBe(false);
    });
  });
});
