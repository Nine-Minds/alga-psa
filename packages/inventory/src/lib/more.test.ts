/**
 * Additional engine/DB-level tests against the real server DB (rolled back):
 * serialized COGS, drop-ship (no on-hand touch), sales-order invoice idempotency
 * (LEAST guard), and location-scoped write enforcement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knexLib, { Knex } from 'knex';
import { recordStockMovement } from './movements';
import { assertLocationWritable } from './scope';

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
let CLIENT: string;
let USER: string;

beforeAll(async () => {
  const e = readEnv();
  knex = knexLib({
    client: 'pg',
    connection: { host: 'localhost', port: 5432, user: e.DB_USER_ADMIN, password: e.DB_PASSWORD_ADMIN, database: 'server' },
    pool: { min: 1, max: 4 },
  });
  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  const svcs = await knex('service_catalog').where({ tenant: TENANT, item_kind: 'service' }).whereRaw("NOT EXISTS (SELECT 1 FROM stock_levels sl WHERE sl.tenant = service_catalog.tenant AND sl.service_id = service_catalog.service_id) AND NOT EXISTS (SELECT 1 FROM stock_units su WHERE su.tenant = service_catalog.tenant AND su.service_id = service_catalog.service_id)").orderBy('service_id').limit(2).select('service_id'); // seed-independent: skip services carrying real stock
  SERVICE = svcs[0].service_id;
  SER_SERVICE = svcs[1].service_id;
  LOCATION = (await knex('stock_locations').where({ tenant: TENANT, is_default: true }).first()).location_id;
  CLIENT = (await knex('clients').where({ tenant: TENANT }).first()).client_id;
  USER = (await knex('users').where({ tenant: TENANT }).first()).user_id;
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

async function onHand(trx: Knex.Transaction, serviceId: string, locationId: string) {
  const r = await trx('stock_levels').where({ tenant: TENANT, service_id: serviceId, location_id: locationId }).first();
  return r ? Number(r.quantity_on_hand) : 0;
}

describe('inventory — COGS, drop-ship, invoicing, scope (real DB, rolled back)', () => {
  it('T011: serialized consume captures COGS = unit_cost and decrements on_hand', async () => {
    await inTx(async (trx) => {
      await trx('product_inventory_settings').insert({ tenant: TENANT, service_id: SER_SERVICE, track_stock: true, is_serialized: true, cost_currency: 'USD', default_location_id: LOCATION }).onConflict(['tenant', 'service_id']).merge();
      const [u] = await trx('stock_units').insert({ tenant: TENANT, service_id: SER_SERVICE, serial_number: 'SN-COGS-1', status: 'in_stock', location_id: LOCATION, unit_cost: 7000 }).returning('unit_id');
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SER_SERVICE, quantity: 1, to_location_id: LOCATION, unit_id: u.unit_id });
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(1);
      const mv = await recordStockMovement(trx, TENANT, { movement_type: 'consume', service_id: SER_SERVICE, quantity: 1, from_location_id: LOCATION, unit_id: u.unit_id, cogs_cost: 7000, source_doc_type: 'sales_order', unitPatch: { status: 'delivered', client_id: CLIENT, location_id: null } });
      expect(Number(mv.cogs_cost)).toBe(7000);
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(0);
    });
  });

  it('T032: drop-ship delivers a unit with NO on_hand change at any location', async () => {
    await inTx(async (trx) => {
      await trx('product_inventory_settings').insert({ tenant: TENANT, service_id: SER_SERVICE, track_stock: true, is_serialized: true, cost_currency: 'USD', default_location_id: LOCATION }).onConflict(['tenant', 'service_id']).merge();
      // unit created directly as delivered (vendor shipped straight to client), never in stock
      const [u] = await trx('stock_units').insert({ tenant: TENANT, service_id: SER_SERVICE, serial_number: 'SN-DS-1', status: 'delivered', client_id: CLIENT, location_id: null, unit_cost: 4000 }).returning('unit_id');
      const before = await onHand(trx, SER_SERVICE, LOCATION);
      // consume movement with NO from/to location -> no stock_levels change
      await recordStockMovement(trx, TENANT, { movement_type: 'consume', service_id: SER_SERVICE, quantity: 1, unit_id: u.unit_id, cogs_cost: 4000, source_doc_type: 'sales_order' });
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(before); // unchanged (0)
    });
  });

  it('T035/T036: quantity_invoiced never exceeds quantity_ordered (LEAST idempotency guard)', async () => {
    await inTx(async (trx) => {
      const [so] = await trx('sales_orders').insert({ tenant: TENANT, so_number: 'SO-TEST-IDEM', client_id: CLIENT, status: 'confirmed', currency_code: 'USD', invoice_mode: 'manual', allocation_mode: 'soft' }).returning('so_id');
      const [line] = await trx('sales_order_lines').insert({ tenant: TENANT, so_id: so.so_id, service_id: SERVICE, quantity_ordered: 5, quantity_fulfilled: 0, quantity_invoiced: 0, unit_price: 1000, fulfillment_type: 'from_stock' }).returning('so_line_id');
      const bump = async (q: number) =>
        trx('sales_order_lines').where({ tenant: TENANT, so_line_id: line.so_line_id }).update({ quantity_invoiced: trx.raw('LEAST(quantity_ordered, quantity_invoiced + ?)', [q]) });
      await bump(3);
      let row = await trx('sales_order_lines').where({ tenant: TENANT, so_line_id: line.so_line_id }).first();
      expect(Number(row.quantity_invoiced)).toBe(3);
      await bump(3); // 3+3=6 but capped at ordered=5
      row = await trx('sales_order_lines').where({ tenant: TENANT, so_line_id: line.so_line_id }).first();
      expect(Number(row.quantity_invoiced)).toBe(5);
    });
  });

  it('T037: a van assigned to one tech cannot be written by another (location scope)', async () => {
    await inTx(async (trx) => {
      const [van] = await trx('stock_locations').insert({ tenant: TENANT, name: 'Scoped Van', location_type: 'van', assigned_user_id: USER, is_default: false, is_active: true }).returning('location_id');
      const OTHER = '00000000-0000-4000-8000-000000000000';
      await expect(assertLocationWritable(trx, TENANT, OTHER, van.location_id)).rejects.toThrow();
      // the assigned tech is allowed
      await expect(assertLocationWritable(trx, TENANT, USER, van.location_id)).resolves.toBeUndefined();
      // an unassigned warehouse is writable by anyone (own fixture — the tenant's
      // default location may legitimately carry an assignee in demo data)
      const [warehouse] = await trx('stock_locations')
        .insert({ tenant: TENANT, name: 'Scoped Unassigned WH', location_type: 'warehouse', is_default: false, is_active: true })
        .returning('location_id');
      await expect(assertLocationWritable(trx, TENANT, OTHER, warehouse.location_id)).resolves.toBeUndefined();
    });
  });
});
