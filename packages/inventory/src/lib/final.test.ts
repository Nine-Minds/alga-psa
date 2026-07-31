/**
 * Final DB-level tests: PO-number uniqueness per tenant, and low-stock detection
 * (available <= reorder point). Real server DB, rolled back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knexLib, { Knex } from 'knex';
import { recordStockMovement } from './movements';
import { availableQuantity } from './levels';
import { getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();

let knex: Knex;
let TENANT: string;
let SERVICE: string;
let LOCATION: string;

beforeAll(async () => {
  if (!databaseConnection) return;
  knex = knexLib({
    client: 'pg',
    connection: databaseConnection,
    pool: { min: 1, max: 4 },
  });
  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  SERVICE = (await knex('service_catalog').where({ tenant: TENANT, item_kind: 'service' }).orderBy('service_id').first()).service_id;
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

describe.skipIf(!databaseConnection)('inventory — PO numbering + reorder (real DB, rolled back)', () => {
  it('T018: a duplicate po_number within a tenant is rejected', async () => {
    await inTx(async (trx) => {
      const [v] = await trx('vendors').insert({ tenant: TENANT, vendor_name: 'PO Test Vendor', is_active: true }).returning('vendor_id');
      await trx('purchase_orders').insert({ tenant: TENANT, po_number: 'PO-DUP-1', vendor_id: v.vendor_id, status: 'draft', currency_code: 'USD' });
      await expect(
        trx('purchase_orders').insert({ tenant: TENANT, po_number: 'PO-DUP-1', vendor_id: v.vendor_id, status: 'draft', currency_code: 'USD' }),
      ).rejects.toThrow();
    });
  });

  it('T041: low-stock detection flags products at/under their reorder point', async () => {
    await inTx(async (trx) => {
      await trx('product_inventory_settings')
        .insert({ tenant: TENANT, service_id: SERVICE, track_stock: true, is_serialized: false, reorder_point: 5, cost_currency: 'USD', default_location_id: LOCATION })
        .onConflict(['tenant', 'service_id'])
        .merge({ track_stock: true, reorder_point: 5 });
      // receive only 3 -> available (3) <= reorder_point (5) -> low stock
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 3, to_location_id: LOCATION });
      const level = await trx('stock_levels').where({ tenant: TENANT, service_id: SERVICE, location_id: LOCATION }).first();
      const settings = await trx('product_inventory_settings').where({ tenant: TENANT, service_id: SERVICE }).first();
      const reorder = level.reorder_point ?? settings.reorder_point;
      const isLow = availableQuantity(level) <= reorder;
      expect(availableQuantity(level)).toBe(3);
      expect(isLow).toBe(true);

      // receive 10 more -> available 13 > 5 -> no longer low
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 10, to_location_id: LOCATION });
      const level2 = await trx('stock_levels').where({ tenant: TENANT, service_id: SERVICE, location_id: LOCATION }).first();
      expect(availableQuantity(level2) <= reorder).toBe(false);
    });
  });
});
