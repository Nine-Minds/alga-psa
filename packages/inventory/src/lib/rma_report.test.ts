/**
 * RMA advance-replacement state machine, dead-units-owed report, serial/MAC
 * search, and inventory-value reporting — engine/DB level, against the real
 * server DB, rolled back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knexLib, { Knex } from 'knex';
import { recordStockMovement } from './movements';

function readEnv(): Record<string, string> {
  const p = path.resolve(__dirname, '../../../../server/.env.local');
  const e: Record<string, string> = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) e[m[1]] = m[2];
  }
  return e;
}

let knex: Knex;
let TENANT: string;
let SERVICE: string;
let SER_SERVICE: string;
let LOCATION: string;

beforeAll(async () => {
  const e = readEnv();
  knex = knexLib({
    client: 'pg',
    connection: { host: 'localhost', port: 5472, user: e.DB_USER_ADMIN, password: e.DB_PASSWORD_ADMIN, database: 'server' },
    pool: { min: 1, max: 4 },
  });
  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  const svcs = await knex('service_catalog').where({ tenant: TENANT, item_kind: 'service' }).orderBy('service_id').limit(2).select('service_id');
  SERVICE = svcs[0].service_id;
  SER_SERVICE = svcs[1].service_id;
  LOCATION = (await knex('stock_locations').where({ tenant: TENANT, is_default: true }).first()).location_id;
});

afterAll(async () => {
  await knex?.destroy();
});

async function inTx(fn: (trx: Knex.Transaction) => Promise<void>) {
  const trx = await knex.transaction();
  try {
    await fn(trx);
  } finally {
    await trx.rollback();
  }
}

describe('inventory — RMA / reports / search (real DB, rolled back)', () => {
  it('T029/T030: advance-replacement RMA walks its full status path; bad status rejected', async () => {
    await inTx(async (trx) => {
      const [c] = await trx('rma_cases').insert({ tenant: TENANT, rma_type: 'advance_replacement', service_id: SERVICE, status: 'open', reason: 'DOA' }).returning('rma_id');
      const setStatus = (s: string, extra: any = {}) => trx('rma_cases').where({ tenant: TENANT, rma_id: c.rma_id }).update({ status: s, ...extra });
      await setStatus('replacement_received');
      await setStatus('replacement_deployed');
      await setStatus('dead_unit_owed', { dead_unit_due_date: knex.raw("now() + interval '30 days'") });
      await setStatus('closed', { dead_unit_returned_at: knex.raw('now()'), closed_at: knex.raw('now()') });
      const row = await trx('rma_cases').where({ tenant: TENANT, rma_id: c.rma_id }).first();
      expect(row.status).toBe('closed');
      // CHECK constraint rejects an invalid status
      await expect(setStatus('bogus_status')).rejects.toThrow();
    });
  });

  it('T031: dead-units-owed lists owed cases ordered by due date (soonest first)', async () => {
    await inTx(async (trx) => {
      await trx('rma_cases').insert([
        { tenant: TENANT, rma_type: 'advance_replacement', service_id: SERVICE, status: 'dead_unit_owed', reason: 'late', dead_unit_due_date: knex.raw("now() + interval '20 days'") },
        { tenant: TENANT, rma_type: 'advance_replacement', service_id: SERVICE, status: 'dead_unit_owed', reason: 'soon', dead_unit_due_date: knex.raw("now() + interval '3 days'") },
      ]);
      const owed = await trx('rma_cases')
        .where({ tenant: TENANT, status: 'dead_unit_owed' })
        .whereIn('reason', ['soon', 'late'])
        .orderBy('dead_unit_due_date', 'asc')
        .select('reason');
      expect(owed[0].reason).toBe('soon');
    });
  });

  it('T040: units are findable by serial AND MAC', async () => {
    await inTx(async (trx) => {
      await trx('stock_units').insert({ tenant: TENANT, service_id: SER_SERVICE, serial_number: 'FIND-SN-123', mac_address: '11:22:33:44:55:66', status: 'in_stock', location_id: LOCATION });
      const bySerial = await trx('stock_units').where({ tenant: TENANT }).whereRaw('serial_number ILIKE ?', ['%FIND-SN%']).first();
      const byMac = await trx('stock_units').where({ tenant: TENANT }).whereRaw('LOWER(mac_address) = LOWER(?)', ['11:22:33:44:55:66']).first();
      expect(bySerial?.serial_number).toBe('FIND-SN-123');
      expect(byMac?.serial_number).toBe('FIND-SN-123');
    });
  });

  it('T043: inventory value = sum(on_hand * cost)', async () => {
    await inTx(async (trx) => {
      await trx('product_inventory_settings').insert({ tenant: TENANT, service_id: SERVICE, track_stock: true, is_serialized: false, average_cost: 2500, cost_currency: 'USD', default_location_id: LOCATION }).onConflict(['tenant', 'service_id']).merge({ average_cost: 2500 });
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 4, to_location_id: LOCATION, unit_cost: 2500 });
      const level = await trx('stock_levels').where({ tenant: TENANT, service_id: SERVICE, location_id: LOCATION }).first();
      const settings = await trx('product_inventory_settings').where({ tenant: TENANT, service_id: SERVICE }).first();
      const value = Number(level.quantity_on_hand) * Number(settings.average_cost);
      expect(value).toBe(4 * 2500); // 10,000 cents = $100.00
    });
  });
});
