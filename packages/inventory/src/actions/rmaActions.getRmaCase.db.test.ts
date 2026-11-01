/**
 * getRmaCase (scan-to-open RMA detail read): same row shape as listRmaCases, null for
 * missing/cross-tenant ids, permission-gated, and strictly read-only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import knexLib, { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const holder: { knex: Knex; tenant: string; userId: string; allowed: boolean } = {
  knex: undefined as never,
  tenant: '',
  userId: '',
  allowed: true,
};

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: any[]) => unknown) => (...args: unknown[]) =>
    fn({ user_id: holder.userId, tenant: holder.tenant }, { tenant: holder.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => holder.allowed }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: holder.knex, tenant: holder.tenant }),
  withTransaction: (db: Knex, fn: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(fn),
}));

import { getRmaCase, listRmaCases } from './rmaActions';

let knex: Knex;
let TENANT: string;
let OTHER_TENANT: string;
let rmaId: string;
let otherRmaId: string;

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: getInventoryTestDatabaseConnection(), pool: { min: 1, max: 4 } });
  TENANT = await createInventoryTestTenant(knex);
  OTHER_TENANT = await createInventoryTestTenant(knex);
  holder.knex = knex;
  holder.tenant = TENANT;
  holder.userId = (await knex('users').where({ tenant: TENANT }).first()).user_id;

  const svc = await knex('service_catalog').where({ tenant: TENANT }).first();
  const client = await knex('clients').where({ tenant: TENANT }).first();
  const vendor = await knex('vendors').where({ tenant: TENANT }).first();
  const [unit] = await knex('stock_units')
    .insert({ tenant: TENANT, service_id: svc.service_id, serial_number: `SN-${randomUUID()}`, status: 'returned', unit_cost: 1000 })
    .returning('unit_id');
  const [rma] = await knex('rma_cases')
    .insert({ tenant: TENANT, rma_number: `RMA-T${randomUUID().slice(0, 8)}`, rma_type: 'standard', returned_unit_id: unit.unit_id, service_id: svc.service_id, client_id: client.client_id, vendor_id: vendor.vendor_id, status: 'sent_to_vendor', reason: 'dead on arrival' })
    .returning('rma_id');
  rmaId = rma.rma_id;
  const oSvc = await knex('service_catalog').where({ tenant: OTHER_TENANT }).first();
  const [oRma] = await knex('rma_cases').insert({ tenant: OTHER_TENANT, rma_number: `RMA-T${randomUUID().slice(0, 8)}`, service_id: oSvc.service_id, status: 'open' }).returning('rma_id');
  otherRmaId = oRma.rma_id;
});

afterAll(async () => {
  await knex?.destroy();
});

beforeEach(() => {
  holder.allowed = true;
  holder.tenant = TENANT;
});

describe('getRmaCase', () => {
  it('returns the same row shape as listRmaCases', async () => {
    const one = await getRmaCase(rmaId);
    const list = (await listRmaCases()) as any[];
    const fromList = list.find((r) => r.rma_id === rmaId);
    expect(one).toBeTruthy();
    const { age_days: a1, ...restOne } = one as any;
    const { age_days: a2, ...restList } = fromList;
    expect(restOne).toEqual(restList);
    expect(Object.keys(one as object).sort()).toEqual(Object.keys(fromList).sort());
    expect((one as any).client_name).toBeTruthy();
    expect((one as any).returned_serial_number).toMatch(/^SN-/);
    expect(a1).toBe(a2);
  });

  it('returns null for a missing id and for another tenant\'s id', async () => {
    expect(await getRmaCase(randomUUID())).toBeNull();
    expect(await getRmaCase(otherRmaId)).toBeNull();
  });

  it('returns a permission error without inventory:read', async () => {
    holder.allowed = false;
    const result = await getRmaCase(rmaId);
    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain('dead on arrival');
  });

  it('is read-only: no movements, no history, updated_at untouched', async () => {
    const count = async (table: string) => Number((await knex(table).where({ tenant: TENANT }).count('* as n').first())!.n);
    const before = { mv: await count('stock_movements'), ah: await count('asset_history'), upd: (await knex('rma_cases').where({ tenant: TENANT, rma_id: rmaId }).first()).updated_at };
    await getRmaCase(rmaId);
    await getRmaCase(otherRmaId);
    expect(await count('stock_movements')).toBe(before.mv);
    expect(await count('asset_history')).toBe(before.ah);
    expect((await knex('rma_cases').where({ tenant: TENANT, rma_id: rmaId }).first()).updated_at).toEqual(before.upd);
  });
});
