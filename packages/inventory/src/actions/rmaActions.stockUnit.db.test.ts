/**
 * Regression pin for the stock-unit RMA tracks (standard + advance replacement).
 * Written for C5 (warranty review) BEFORE rmaActions.ts was touched, to prove that
 * openRma / openAdvanceRma and every unit-based transition keep their behaviour
 * (statuses, stock movements, unit state) once client-asset claims share the table.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const holder: { knex: Knex; tenant: string; userId: string } = { knex: undefined as never, tenant: '', userId: '' };

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: any[]) => unknown) => (...args: unknown[]) =>
    fn({ user_id: holder.userId, tenant: holder.tenant }, { tenant: holder.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createTenantKnex: async () => ({ knex: holder.knex, tenant: holder.tenant }),
  withTransaction: (db: Knex, fn: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(fn),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined), reviveStoredWorkflowPayload: () => null,
}));

import {
  closeRma, deployReplacement, markDeadUnitOwed, openAdvanceRma, openRma, receiveReturn,
  recordDeadUnitReturned, recordReplacementReceived, resolveReplacement, sendToVendor, resolveScrap, resolveRepair, resolveCredit,
} from './rmaActions';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

let knex: Knex;
let SERVICE: string;
let LOCATION: string;
let VENDOR: string;

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: getInventoryTestDatabaseConnection(), pool: { min: 1, max: 4 } });
  holder.knex = knex;
  holder.tenant = await createInventoryTestTenant(knex);
  holder.userId = (await knex('users').where({ tenant: holder.tenant }).first()).user_id;
  SERVICE = (await knex('service_catalog').where({ tenant: holder.tenant }).first()).service_id;
  LOCATION = (await knex('stock_locations').where({ tenant: holder.tenant }).first()).location_id;
  VENDOR = (await knex('vendors').where({ tenant: holder.tenant }).first()).vendor_id;
});
afterAll(async () => { await knex?.destroy(); });

const ok = <T,>(r: T): Exclude<T, { type: string }> => {
  expect((r as any)?.actionError ?? (r as any)?.permissionError).toBeUndefined();
  return r as never;
};

async function deliveredUnit(withAsset = false) {
  const clientId = (await knex('clients').where({ tenant: holder.tenant }).first()).client_id;
  const [u] = await knex('stock_units')
    .insert({ tenant: holder.tenant, service_id: SERVICE, serial_number: `SN-${randomUUID()}`, status: 'delivered', client_id: clientId, unit_cost: 1000 })
    .returning('*');
  return u;
}
const unitRow = (id: string) => knex('stock_units').where({ tenant: holder.tenant, unit_id: id }).first();
const movementTypes = async (rmaId: string) =>
  (await knex('stock_movements').where({ tenant: holder.tenant, source_doc_type: 'rma', source_doc_id: rmaId }).orderBy('created_at').select('movement_type'))
    .map((r: any) => r.movement_type);

describe('stock-unit RMA regression (C5 must not change these)', () => {
  it('standard track: open → return → vendor → replacement → deployed → close', async () => {
    const unit = await deliveredUnit();
    const rma: any = ok(await openRma({ returned_unit_id: unit.unit_id, reason: 'dead' }));
    expect(rma.status).toBe('awaiting_return');
    expect(rma.rma_type).toBe('standard');
    expect(rma.returned_unit_id).toBe(unit.unit_id);
    expect(rma.rma_number).toMatch(/^RMA-\d+$/);

    expect(ok(await receiveReturn(rma.rma_id, { location_id: LOCATION })).status).toBe('returned');
    expect((await unitRow(unit.unit_id)).status).toBe('returned');
    expect(ok(await sendToVendor(rma.rma_id, { vendor_id: VENDOR, rma_reference: 'V-1' })).status).toBe('sent_to_vendor');
    expect((await unitRow(unit.unit_id)).status).toBe('in_rma');

    const replaced: any = ok(await resolveReplacement(rma.rma_id, { serial_number: `NEW-${randomUUID()}`, location_id: LOCATION }));
    expect(replaced.status).toBe('replaced');
    expect(replaced.replacement_unit_id).toBeTruthy();
    expect((await unitRow(replaced.replacement_unit_id)).status).toBe('in_stock');
    expect(ok(await deployReplacement(rma.rma_id)).status).toBe('replacement_deployed');
    expect((await unitRow(replaced.replacement_unit_id)).status).toBe('delivered');
    const closed: any = ok(await closeRma(rma.rma_id));
    expect(closed.status).toBe('closed');
    expect(closed.closed_at).toBeTruthy();
    expect(await movementTypes(rma.rma_id)).toEqual(['return_defective', 'rma_out', 'rma_in', 'consume']);
  });

  it('standard track: repair, credit and scrap resolve the dead unit as before', async () => {
    const repair: any = await (async () => {
      const u = await deliveredUnit();
      const r: any = ok(await openRma({ returned_unit_id: u.unit_id }));
      ok(await receiveReturn(r.rma_id, { location_id: LOCATION }));
      ok(await sendToVendor(r.rma_id, { vendor_id: VENDOR }));
      return { r, u };
    })();
    const done: any = ok(await resolveRepair(repair.r.rma_id, { location_id: LOCATION }));
    expect(done.status).toBe('closed');
    expect((await unitRow(repair.u.unit_id)).status).toBe('in_stock');

    const u2 = await deliveredUnit();
    const r2: any = ok(await openRma({ returned_unit_id: u2.unit_id }));
    ok(await receiveReturn(r2.rma_id, { location_id: LOCATION }));
    ok(await sendToVendor(r2.rma_id, { vendor_id: VENDOR }));
    expect(ok(await resolveCredit(r2.rma_id)).status).toBe('credited');
    expect((await unitRow(u2.unit_id)).status).toBe('retired');

    const u3 = await deliveredUnit();
    const r3: any = ok(await openRma({ returned_unit_id: u3.unit_id }));
    ok(await receiveReturn(r3.rma_id, { location_id: LOCATION }));
    expect(ok(await resolveScrap(r3.rma_id)).status).toBe('closed');
    expect((await unitRow(u3.unit_id)).status).toBe('retired');
  });

  it('advance track: open → replacement → deployed → dead unit owed → returned/closed', async () => {
    const unit = await deliveredUnit();
    const rma: any = ok(await openAdvanceRma({ returned_unit_id: unit.unit_id, vendor_id: VENDOR }));
    expect(rma.status).toBe('open');
    expect(rma.rma_type).toBe('advance_replacement');
    expect(rma.rma_number).toMatch(/^RMA-\d+$/);
    expect(ok(await recordReplacementReceived(rma.rma_id, { serial_number: `ADV-${randomUUID()}`, location_id: LOCATION })).status).toBe('replacement_received');
    expect(ok(await deployReplacement(rma.rma_id)).status).toBe('replacement_deployed');
    const owed: any = ok(await markDeadUnitOwed(rma.rma_id, '2030-01-01'));
    expect(owed.status).toBe('dead_unit_owed');
    const fin: any = ok(await recordDeadUnitReturned(rma.rma_id));
    expect(fin.status).toBe('closed');
    expect(fin.dead_unit_returned_at).toBeTruthy();
    expect((await unitRow(unit.unit_id)).status).toBe('in_rma');
  });

  it('allocates a distinct, sequential rma_number per case', async () => {
    const a: any = ok(await openRma({ returned_unit_id: (await deliveredUnit()).unit_id }));
    const b: any = ok(await openRma({ returned_unit_id: (await deliveredUnit()).unit_id }));
    expect(b.rma_number).not.toBe(a.rma_number);
    expect(Number(b.rma_number.replace(/\D/g, ''))).toBe(Number(a.rma_number.replace(/\D/g, '')) + 1);
  });

  it('out-of-order transitions are still refused by status', async () => {
    const unit = await deliveredUnit();
    const rma: any = ok(await openRma({ returned_unit_id: unit.unit_id }));
    const r: any = await sendToVendor(rma.rma_id, { vendor_id: VENDOR });
    expect(r.actionError).toMatch(/RMA status changed/);
  });
});
