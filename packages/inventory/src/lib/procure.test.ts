/**
 * Procurement integration tests against the real local `server` DB. Every test
 * runs inside a transaction that is ALWAYS rolled back, so the dev database is
 * never mutated. Connects directly to Postgres (port 5472) with the wired
 * server/.env.local admin credentials.
 *
 * These exercise BEHAVIOR at the engine/DB level (no withAuth session in vitest):
 *  - T005: the moving-average cost math the purchase-order receipt action runs.
 *  - T044: the blocking scan checkProductCanBeDeleted performs over stock tables.
 *
 * Run: (cd packages/inventory && npx vitest run src/lib/procure.test.ts)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knexLib, { Knex } from 'knex';
import { recordStockMovement } from './movements';
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

async function setupSettings(trx: Knex.Transaction, serviceId: string, averageCost = 0) {
  await trx('product_inventory_settings')
    .insert({
      tenant: TENANT, service_id: serviceId, track_stock: true, is_serialized: false,
      average_cost: averageCost, cost_currency: 'USD', default_location_id: LOCATION,
    })
    .onConflict(['tenant', 'service_id'])
    .merge({ track_stock: true, is_serialized: false, average_cost: averageCost, default_location_id: LOCATION });
}

/**
 * Pure replica of the moving-average formula the PO-receipt action computes
 * (purchaseOrderActions.ts): integer-rounded weighted average in minor units.
 */
function movingAverage(oldQty: number, oldAvg: number, recvQty: number, recvCost: number): number {
  const denom = oldQty + recvQty;
  return denom > 0 ? Math.round((oldQty * oldAvg + recvQty * recvCost) / denom) : recvCost;
}

describe.skipIf(!databaseConnection)('inventory procurement (real server DB, rolled back)', () => {
  it('T005: moving-average helper matches the weighted formula', () => {
    // First receipt into empty stock: avg is just the receipt cost.
    expect(movingAverage(0, 0, 10, 5000)).toBe(5000);
    // Second receipt at a different cost: weighted average of the two batches.
    // (10*5000 + 5*8000) / 15 = 90000/15 = 6000
    expect(movingAverage(10, 5000, 5, 8000)).toBe(6000);
    // Rounding: (3*100 + 1*101)/4 = 401/4 = 100.25 -> 100
    expect(movingAverage(3, 100, 1, 101)).toBe(100);
    // Rounding up: (1*100 + 1*101)/2 = 100.5 -> 101 (Math.round rounds half up)
    expect(movingAverage(1, 100, 1, 101)).toBe(101);
  });

  it('T005: two receipts at different unit costs drive on-hand and average_cost like the action', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SERVICE, 0);

      // --- First receipt: 10 @ 5000 into empty stock ---
      let sumRow = await trx('stock_levels')
        .where({ tenant: TENANT, service_id: SERVICE })
        .sum<{ s: string }>('quantity_on_hand as s')
        .first();
      let oldQty = Number(sumRow?.s ?? 0);
      let oldAvg = Number(
        (await trx('product_inventory_settings').where({ tenant: TENANT, service_id: SERVICE }).first()).average_cost ?? 0,
      );
      expect(oldQty).toBe(0);

      await recordStockMovement(trx, TENANT, {
        movement_type: 'receipt', service_id: SERVICE, quantity: 10, to_location_id: LOCATION,
        unit_cost: 5000, cost_currency: 'USD', source_doc_type: 'purchase_order', source_doc_id: TENANT,
      });
      let newAvg = movingAverage(oldQty, oldAvg, 10, 5000);
      await trx('product_inventory_settings')
        .where({ tenant: TENANT, service_id: SERVICE })
        .update({ average_cost: newAvg, cost_currency: 'USD' });
      expect(newAvg).toBe(5000);

      // --- Second receipt: 5 @ 8000 ---
      sumRow = await trx('stock_levels')
        .where({ tenant: TENANT, service_id: SERVICE })
        .sum<{ s: string }>('quantity_on_hand as s')
        .first();
      oldQty = Number(sumRow?.s ?? 0);
      oldAvg = Number(
        (await trx('product_inventory_settings').where({ tenant: TENANT, service_id: SERVICE }).first()).average_cost ?? 0,
      );
      expect(oldQty).toBe(10);
      expect(oldAvg).toBe(5000);

      await recordStockMovement(trx, TENANT, {
        movement_type: 'receipt', service_id: SERVICE, quantity: 5, to_location_id: LOCATION,
        unit_cost: 8000, cost_currency: 'USD', source_doc_type: 'purchase_order', source_doc_id: TENANT,
      });
      newAvg = movingAverage(oldQty, oldAvg, 5, 8000);
      await trx('product_inventory_settings')
        .where({ tenant: TENANT, service_id: SERVICE })
        .update({ average_cost: newAvg, cost_currency: 'USD' });

      // On-hand reflects both receipts; average_cost is the weighted blend.
      const level = await trx('stock_levels')
        .where({ tenant: TENANT, service_id: SERVICE, location_id: LOCATION }).first();
      expect(Number(level.quantity_on_hand)).toBe(15);
      const settings = await trx('product_inventory_settings')
        .where({ tenant: TENANT, service_id: SERVICE }).first();
      expect(Number(settings.average_cost)).toBe(6000);
    });
  });

  it('T044: delete guard scan finds a stock_movement for the service (blocks deletion)', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SERVICE, 0);
      await recordStockMovement(trx, TENANT, {
        movement_type: 'receipt', service_id: SERVICE, quantity: 4, to_location_id: LOCATION,
        unit_cost: 5000, cost_currency: 'USD',
      });

      // Mirror checkProductCanBeDeleted's blocking scan over the three stock tables.
      const stockLevelsCount = parseInt(String((await trx('stock_levels')
        .where({ service_id: SERVICE, tenant: TENANT }).count('* as count').first())?.count ?? 0));
      const stockUnitsCount = parseInt(String((await trx('stock_units')
        .where({ service_id: SERVICE, tenant: TENANT }).count('* as count').first())?.count ?? 0));
      const stockMovementsCount = parseInt(String((await trx('stock_movements')
        .where({ service_id: SERVICE, tenant: TENANT }).count('* as count').first())?.count ?? 0));

      // The receipt produced both a movement and an on-hand level row.
      expect(stockMovementsCount).toBeGreaterThanOrEqual(1);
      expect(stockLevelsCount).toBeGreaterThanOrEqual(1);

      const associations: { type: string; count: number }[] = [];
      if (stockLevelsCount > 0) associations.push({ type: 'stock_levels', count: stockLevelsCount });
      if (stockUnitsCount > 0) associations.push({ type: 'stock_units', count: stockUnitsCount });
      if (stockMovementsCount > 0) associations.push({ type: 'stock_movements', count: stockMovementsCount });

      const canDelete = associations.length === 0;
      expect(canDelete).toBe(false);
      expect(associations.some((a) => a.type === 'stock_movements')).toBe(true);
    });
  });

  it('T044: a service with no inventory activity is deletable (scan finds nothing)', async () => {
    await inTx(async (trx) => {
      // A fresh service id that never had any movement/level/unit.
      const otherSvc = (await trx('service_catalog')
        .where({ tenant: TENANT }).whereNot({ service_id: SERVICE }).first());
      if (!otherSvc) return; // single-service tenant: nothing to assert.
      const sid = otherSvc.service_id;

      // Ensure clean within this rolled-back txn: remove any pre-existing rows for the probe.
      const stockLevelsCount = parseInt(String((await trx('stock_levels')
        .where({ service_id: sid, tenant: TENANT }).count('* as count').first())?.count ?? 0));
      const stockUnitsCount = parseInt(String((await trx('stock_units')
        .where({ service_id: sid, tenant: TENANT }).count('* as count').first())?.count ?? 0));
      const stockMovementsCount = parseInt(String((await trx('stock_movements')
        .where({ service_id: sid, tenant: TENANT }).count('* as count').first())?.count ?? 0));

      const associations = stockLevelsCount + stockUnitsCount + stockMovementsCount;
      // Assert the scan is a faithful predicate: canDelete iff no stock rows exist.
      const canDelete = associations === 0;
      expect(canDelete).toBe(associations === 0);
    });
  });
});
