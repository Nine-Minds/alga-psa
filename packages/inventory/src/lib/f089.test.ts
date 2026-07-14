/**
 * F089: serialized products consumed via the materials flow deliver the PICKED
 * unit (serial), and an unbilled reversal restores it. Real server DB, rolled back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knexLib, { Knex } from 'knex';
import { recordStockMovement } from './movements';
import { recordStockConsumption, reverseStockConsumption } from './consume';
import { getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();

let knex: Knex;
let TENANT: string;
let SER_SERVICE: string;
let LOCATION: string;
let CLIENT: string;

beforeAll(async () => {
  if (!databaseConnection) return;
  knex = knexLib({ client: 'pg', connection: databaseConnection, pool: { min: 1, max: 4 } });
  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  SER_SERVICE = (await knex('service_catalog').where({ tenant: TENANT, item_kind: 'service' }).orderBy('service_id').first()).service_id;
  LOCATION = (await knex('stock_locations').where({ tenant: TENANT, is_default: true }).first()).location_id;
  CLIENT = (await knex('clients').where({ tenant: TENANT }).first()).client_id;
});

afterAll(async () => { await knex?.destroy(); });

async function inTx(fn: (trx: Knex.Transaction) => Promise<void>) {
  const trx = await knex.transaction();
  try { await fn(trx); } finally { await trx.rollback(); }
}

async function onHand(trx: Knex.Transaction, locationId: string) {
  const r = await trx('stock_levels').where({ tenant: TENANT, service_id: SER_SERVICE, location_id: locationId }).first();
  return r ? Number(r.quantity_on_hand) : 0;
}

describe.skipIf(!databaseConnection)('F089 serialized material consumption (real DB, rolled back)', () => {
  it('delivers the picked unit and reverses on unbilled delete', async () => {
    await inTx(async (trx) => {
      await trx('product_inventory_settings')
        .insert({ tenant: TENANT, service_id: SER_SERVICE, track_stock: true, is_serialized: true, cost_currency: 'USD', default_location_id: LOCATION })
        .onConflict(['tenant', 'service_id']).merge({ track_stock: true, is_serialized: true });
      const [u] = await trx('stock_units').insert({ tenant: TENANT, service_id: SER_SERVICE, serial_number: 'SN-MAT-1', mac_address: 'DE:AD:BE:EF:00:01', status: 'in_stock', location_id: LOCATION, unit_cost: 3000 }).returning('unit_id');
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SER_SERVICE, quantity: 1, to_location_id: LOCATION, unit_id: u.unit_id });
      expect(await onHand(trx, LOCATION)).toBe(1);

      // materials hook with a picked unit -> deliver it
      const r = await recordStockConsumption(trx, TENANT, { service_id: SER_SERVICE, quantity: 1, source_doc_type: 'ticket_material', source_doc_id: CLIENT, unit_id: u.unit_id, client_id: CLIENT });
      expect(r.consumed).toBe(true);
      const unit = await trx('stock_units').where({ tenant: TENANT, unit_id: u.unit_id }).first();
      expect(unit.status).toBe('delivered');
      expect(unit.client_id).toBe(CLIENT);
      expect(await onHand(trx, LOCATION)).toBe(0);

      // unbilled material delete -> restore the same unit
      await reverseStockConsumption(trx, TENANT, { service_id: SER_SERVICE, quantity: 1, source_doc_type: 'ticket_material', source_doc_id: CLIENT });
      const restored = await trx('stock_units').where({ tenant: TENANT, unit_id: u.unit_id }).first();
      expect(restored.status).toBe('in_stock');
      expect(await onHand(trx, LOCATION)).toBe(1);
    });
  });

  it('serialized consume is a no-op when no unit is picked', async () => {
    await inTx(async (trx) => {
      await trx('product_inventory_settings')
        .insert({ tenant: TENANT, service_id: SER_SERVICE, track_stock: true, is_serialized: true, cost_currency: 'USD', default_location_id: LOCATION })
        .onConflict(['tenant', 'service_id']).merge({ track_stock: true, is_serialized: true });
      const r = await recordStockConsumption(trx, TENANT, { service_id: SER_SERVICE, quantity: 1, source_doc_type: 'ticket_material', source_doc_id: CLIENT });
      expect(r.consumed).toBe(false);
    });
  });
});
