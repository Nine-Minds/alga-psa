/**
 * Allocation engine integration tests against the real local `server` DB (which
 * has the inventory schema applied). Every test runs inside a transaction that is
 * ALWAYS rolled back, so the dev database is never mutated.
 *
 * Connects directly to Postgres (port 5472) using the wired server/.env.local
 * admin credentials. Run: (cd packages/inventory && npx vitest run src/lib/alloc.test.ts)
 *
 * Covers (engine/DB level):
 *  - T009 soft allocation (reserved): available = on_hand - reserved; on_hand unchanged.
 *  - T010 hard-hold (held): available = on_hand - held; held reduces available.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knexLib, { Knex } from 'knex';
import { recordStockMovement } from './movements';
import { availableQuantity, applyAllocationDelta } from './levels';

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
let LOCATION: string;

beforeAll(async () => {
  const e = readEnv();
  knex = knexLib({
    client: 'pg',
    connection: { host: 'localhost', port: 5472, user: e.DB_USER_ADMIN, password: e.DB_PASSWORD_ADMIN, database: 'server' },
    pool: { min: 1, max: 4 },
  });
  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  const svcs = await knex('service_catalog').where({ tenant: TENANT }).limit(1).select('service_id');
  SERVICE = svcs[0].service_id;
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

async function level(trx: Knex.Transaction, serviceId: string, locationId: string) {
  return trx('stock_levels').where({ tenant: TENANT, service_id: serviceId, location_id: locationId }).first();
}

describe('inventory allocation engine (real server DB, rolled back)', () => {
  it('T009: soft allocation reserves stock — available drops, on_hand unchanged', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SERVICE);
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 10, to_location_id: LOCATION, unit_cost: 5000 });

      // Baseline: on_hand 10, nothing reserved/held → available 10.
      let lvl = await level(trx, SERVICE, LOCATION);
      expect(Number(lvl.quantity_on_hand)).toBe(10);
      expect(availableQuantity(lvl)).toBe(10);

      // Soft-allocate (reserve) 3 — mirrors what the reserve action does.
      await applyAllocationDelta(trx, TENANT, SERVICE, LOCATION, 'reserved_quantity', 3);

      lvl = await level(trx, SERVICE, LOCATION);
      expect(Number(lvl.quantity_on_hand)).toBe(10); // on_hand unchanged by a soft reservation
      expect(Number(lvl.reserved_quantity)).toBe(3);
      expect(availableQuantity(lvl)).toBe(7); // 10 - 3
    });
  });

  it('T009: releasing a reservation restores available back to on_hand', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SERVICE);
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 10, to_location_id: LOCATION, unit_cost: 5000 });

      await applyAllocationDelta(trx, TENANT, SERVICE, LOCATION, 'reserved_quantity', 3);
      let lvl = await level(trx, SERVICE, LOCATION);
      expect(availableQuantity(lvl)).toBe(7);

      // Release the reservation (-3).
      await applyAllocationDelta(trx, TENANT, SERVICE, LOCATION, 'reserved_quantity', -3);
      lvl = await level(trx, SERVICE, LOCATION);
      expect(Number(lvl.reserved_quantity)).toBe(0);
      expect(Number(lvl.quantity_on_hand)).toBe(10);
      expect(availableQuantity(lvl)).toBe(10); // available back to 10
    });
  });

  it('T009: reserved counter is floored at 0 (over-release does not go negative)', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SERVICE);
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 10, to_location_id: LOCATION, unit_cost: 5000 });

      await applyAllocationDelta(trx, TENANT, SERVICE, LOCATION, 'reserved_quantity', 3);
      // Release more than reserved — GREATEST(0, ...) clamps it.
      await applyAllocationDelta(trx, TENANT, SERVICE, LOCATION, 'reserved_quantity', -5);
      const lvl = await level(trx, SERVICE, LOCATION);
      expect(Number(lvl.reserved_quantity)).toBe(0);
      expect(availableQuantity(lvl)).toBe(10);
    });
  });

  it('T010: hard hold reduces available — available = on_hand - held', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SERVICE);
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 10, to_location_id: LOCATION, unit_cost: 5000 });

      // Hard-hold 2 — mirrors the hold action.
      await applyAllocationDelta(trx, TENANT, SERVICE, LOCATION, 'held_quantity', 2);

      const lvl = await level(trx, SERVICE, LOCATION);
      expect(Number(lvl.quantity_on_hand)).toBe(10); // on_hand unchanged by a hold
      expect(Number(lvl.held_quantity)).toBe(2);
      expect(availableQuantity(lvl)).toBe(8); // 10 - 2
    });
  });

  it('T010: reserved and held both subtract from available simultaneously', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SERVICE);
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 10, to_location_id: LOCATION, unit_cost: 5000 });

      await applyAllocationDelta(trx, TENANT, SERVICE, LOCATION, 'reserved_quantity', 3);
      await applyAllocationDelta(trx, TENANT, SERVICE, LOCATION, 'held_quantity', 2);

      const lvl = await level(trx, SERVICE, LOCATION);
      expect(Number(lvl.quantity_on_hand)).toBe(10);
      expect(Number(lvl.reserved_quantity)).toBe(3);
      expect(Number(lvl.held_quantity)).toBe(2);
      expect(availableQuantity(lvl)).toBe(5); // 10 - 3 - 2
    });
  });

  it('T010: releasing a hold restores available', async () => {
    await inTx(async (trx) => {
      await setupSettings(trx, SERVICE);
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 10, to_location_id: LOCATION, unit_cost: 5000 });

      await applyAllocationDelta(trx, TENANT, SERVICE, LOCATION, 'held_quantity', 2);
      let lvl = await level(trx, SERVICE, LOCATION);
      expect(availableQuantity(lvl)).toBe(8);

      await applyAllocationDelta(trx, TENANT, SERVICE, LOCATION, 'held_quantity', -2);
      lvl = await level(trx, SERVICE, LOCATION);
      expect(Number(lvl.held_quantity)).toBe(0);
      expect(availableQuantity(lvl)).toBe(10);
    });
  });
});
