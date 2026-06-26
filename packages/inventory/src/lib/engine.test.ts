/**
 * Engine integration tests against the real local `server` DB (which has the
 * inventory schema applied). Every test runs inside a transaction that is ALWAYS
 * rolled back, so the dev database is never mutated.
 *
 * Connects directly to Postgres (port 5472) using the wired server/.env.local
 * admin credentials. Run: (cd packages/inventory && npx vitest run src/lib/engine.test.ts)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knexLib, { Knex } from 'knex';
import { recordStockMovement } from './movements';
import { reconcileStockLevels } from './reconcile';
import { recordStockConsumption, reverseStockConsumption } from './consume';
import { availableQuantity } from './levels';

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

async function setupSettings(trx: Knex.Transaction, serviceId: string, serialized = false) {
  await trx('product_inventory_settings')
    .insert({
      tenant: TENANT, service_id: serviceId, track_stock: true, is_serialized: serialized,
      average_cost: 5000, cost_currency: 'USD', default_location_id: LOCATION,
    })
    .onConflict(['tenant', 'service_id'])
    .merge({ track_stock: true, is_serialized: serialized, average_cost: 5000, default_location_id: LOCATION });
}

async function onHand(trx: Knex.Transaction, serviceId: string, locationId: string) {
  const r = await trx('stock_levels').where({ tenant: TENANT, service_id: serviceId, location_id: locationId }).first();
  return r ? Number(r.quantity_on_hand) : 0;
}

describe('inventory engine (real server DB, rolled back)', () => {
  it('T004: receipt increments on_hand and reconcile matches the ledger', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SERVICE);
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 10, to_location_id: LOCATION, unit_cost: 5000 });
      expect(await onHand(trx, SERVICE, LOCATION)).toBe(10);
      const recomputed = await reconcileStockLevels(trx, TENANT, SERVICE, false);
      expect(recomputed.find((r) => r.location_id === LOCATION)?.quantity_on_hand).toBe(10);
    });
  });

  it('consume decrements on_hand and captures COGS', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SERVICE);
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 10, to_location_id: LOCATION });
      const mv = await recordStockMovement(trx, TENANT, { movement_type: 'consume', service_id: SERVICE, quantity: 3, from_location_id: LOCATION, cogs_cost: 5000 });
      expect(await onHand(trx, SERVICE, LOCATION)).toBe(7);
      expect(Number(mv.cogs_cost)).toBe(5000);
    });
  });

  it('T007: serialized on_hand counts only in_stock units (delivered excluded)', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SER_SERVICE, true);
      for (const sn of ['SN-ENG-A', 'SN-ENG-B']) {
        const [u] = await trx('stock_units')
          .insert({ tenant: TENANT, service_id: SER_SERVICE, serial_number: sn, status: 'in_stock', location_id: LOCATION, unit_cost: 5000 })
          .returning('unit_id');
        await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SER_SERVICE, quantity: 1, to_location_id: LOCATION, unit_id: u.unit_id });
      }
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(2);
      const unit = await trx('stock_units').where({ tenant: TENANT, service_id: SER_SERVICE, status: 'in_stock' }).first();
      await recordStockMovement(trx, TENANT, {
        movement_type: 'consume', service_id: SER_SERVICE, quantity: 1, from_location_id: LOCATION, unit_id: unit.unit_id,
        unitPatch: { status: 'delivered', location_id: null },
      });
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(1);
    });
  });

  it('T014: materials consume hook decrements (non-serialized); reverse restores', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SERVICE);
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 5, to_location_id: LOCATION });
      const r = await recordStockConsumption(trx, TENANT, { service_id: SERVICE, quantity: 2, source_doc_type: 'ticket_material', source_doc_id: TENANT });
      expect(r.consumed).toBe(true);
      expect(await onHand(trx, SERVICE, LOCATION)).toBe(3);
      await reverseStockConsumption(trx, TENANT, { service_id: SERVICE, quantity: 2, source_doc_type: 'ticket_material', source_doc_id: TENANT });
      expect(await onHand(trx, SERVICE, LOCATION)).toBe(5);
    });
  });

  it('materials consume hook is a no-op for serialized products', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SER_SERVICE, true);
      const r = await recordStockConsumption(trx, TENANT, { service_id: SER_SERVICE, quantity: 1, source_doc_type: 'ticket_material', source_doc_id: TENANT });
      expect(r.consumed).toBe(false);
    });
  });

  it('available = on_hand - reserved - held', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SERVICE);
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 8, to_location_id: LOCATION });
      await trx('stock_levels').where({ tenant: TENANT, service_id: SERVICE, location_id: LOCATION }).update({ reserved_quantity: 2, held_quantity: 1 });
      const lvl = await trx('stock_levels').where({ tenant: TENANT, service_id: SERVICE, location_id: LOCATION }).first();
      expect(availableQuantity(lvl)).toBe(5);
    });
  });
});
