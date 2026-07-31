/**
 * Flow-level engine tests (transfers, loaners, restock, RMA transitions, negative
 * consume) against the real local `server` DB, each rolled back. Exercises the
 * movement primitive for every movement type the action layer relies on.
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
let SER_SERVICE: string;
let LOCATION: string;

beforeAll(async () => {
  if (!databaseConnection) return;
  knex = knexLib({
    client: 'pg',
    connection: databaseConnection,
    pool: { min: 1, max: 4 },
  });
  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  const svcs = await knex('service_catalog').where({ tenant: TENANT, item_kind: 'service' }).whereRaw("NOT EXISTS (SELECT 1 FROM stock_levels sl WHERE sl.tenant = service_catalog.tenant AND sl.service_id = service_catalog.service_id) AND NOT EXISTS (SELECT 1 FROM stock_units su WHERE su.tenant = service_catalog.tenant AND su.service_id = service_catalog.service_id)").orderBy('service_id').limit(2).select('service_id'); // seed-independent: skip services carrying real stock
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

async function settings(trx: Knex.Transaction, serviceId: string, serialized = false) {
  await trx('product_inventory_settings')
    .insert({ tenant: TENANT, service_id: serviceId, track_stock: true, is_serialized: serialized, average_cost: 1000, cost_currency: 'USD', default_location_id: LOCATION })
    .onConflict(['tenant', 'service_id'])
    .merge({ track_stock: true, is_serialized: serialized });
}

async function makeUnit(trx: Knex.Transaction, serial: string, status: string, locationId: string | null) {
  const [u] = await trx('stock_units')
    .insert({ tenant: TENANT, service_id: SER_SERVICE, serial_number: serial, status, location_id: locationId, unit_cost: 1000 })
    .returning('unit_id');
  return u.unit_id as string;
}

async function onHand(trx: Knex.Transaction, serviceId: string, locationId: string) {
  const r = await trx('stock_levels').where({ tenant: TENANT, service_id: serviceId, location_id: locationId }).first();
  return r ? Number(r.quantity_on_hand) : 0;
}

async function makeLocation(trx: Knex.Transaction, name: string) {
  const [l] = await trx('stock_locations')
    .insert({ tenant: TENANT, name, location_type: 'van', is_default: false, is_active: true })
    .returning('location_id');
  return l.location_id as string;
}

describe.skipIf(!databaseConnection)('inventory flows (real server DB, rolled back)', () => {
  it('T023/T024: transfer moves stock via in_transit (source -1 at dispatch, dest +1 at receive)', async () => {
    await inTx(async (trx) => {
      await settings(trx, SER_SERVICE, true);
      const loc2 = await makeLocation(trx, 'ENG-TEST-VAN-1');
      const unit = await makeUnit(trx, 'SN-XF-1', 'in_stock', LOCATION);
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SER_SERVICE, quantity: 1, to_location_id: LOCATION, unit_id: unit });
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(1);
      // dispatch
      await recordStockMovement(trx, TENANT, { movement_type: 'transfer_out', service_id: SER_SERVICE, quantity: 1, from_location_id: LOCATION, to_location_id: loc2, unit_id: unit, unitPatch: { status: 'in_transit', location_id: null } });
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(0);
      expect(await onHand(trx, SER_SERVICE, loc2)).toBe(0); // not at dest yet
      // receive
      await recordStockMovement(trx, TENANT, { movement_type: 'transfer_in', service_id: SER_SERVICE, quantity: 1, from_location_id: LOCATION, to_location_id: loc2, unit_id: unit, unitPatch: { status: 'in_stock', location_id: loc2 } });
      expect(await onHand(trx, SER_SERVICE, loc2)).toBe(1);
    });
  });

  it('T025: loan out excludes from on_hand (no sale); loan return restores', async () => {
    await inTx(async (trx) => {
      await settings(trx, SER_SERVICE, true);
      const unit = await makeUnit(trx, 'SN-LN-1', 'in_stock', LOCATION);
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SER_SERVICE, quantity: 1, to_location_id: LOCATION, unit_id: unit });
      await recordStockMovement(trx, TENANT, { movement_type: 'loan_out', service_id: SER_SERVICE, quantity: 1, from_location_id: LOCATION, unit_id: unit, unitPatch: { status: 'on_loan', location_id: null } });
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(0);
      await recordStockMovement(trx, TENANT, { movement_type: 'loan_in', service_id: SER_SERVICE, quantity: 1, to_location_id: LOCATION, unit_id: unit, unitPatch: { status: 'in_stock', location_id: LOCATION } });
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(1);
    });
  });

  it('T026: restock-return puts a delivered unit back to SELLABLE on_hand', async () => {
    await inTx(async (trx) => {
      await settings(trx, SER_SERVICE, true);
      const unit = await makeUnit(trx, 'SN-RS-1', 'delivered', null);
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(0);
      await recordStockMovement(trx, TENANT, { movement_type: 'return_restock', service_id: SER_SERVICE, quantity: 1, to_location_id: LOCATION, unit_id: unit, unitPatch: { status: 'in_stock', location_id: LOCATION, client_id: null } });
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(1);
    });
  });

  it('T027/T028: RMA — returned is NOT sellable; rma_in restores to stock', async () => {
    await inTx(async (trx) => {
      await settings(trx, SER_SERVICE, true);
      const unit = await makeUnit(trx, 'SN-RMA-1', 'delivered', null);
      // client returns a defective unit -> returned (NOT added to on_hand)
      await recordStockMovement(trx, TENANT, { movement_type: 'return_defective', service_id: SER_SERVICE, quantity: 1, to_location_id: LOCATION, unit_id: unit, unitPatch: { status: 'returned', location_id: LOCATION } });
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(0);
      // send to vendor -> in_rma (still not sellable)
      await recordStockMovement(trx, TENANT, { movement_type: 'rma_out', service_id: SER_SERVICE, quantity: 1, from_location_id: LOCATION, unit_id: unit, unitPatch: { status: 'in_rma' } });
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(0);
      // refurb returns to stock -> in_stock (sellable)
      await recordStockMovement(trx, TENANT, { movement_type: 'rma_in', service_id: SER_SERVICE, quantity: 1, to_location_id: LOCATION, unit_id: unit, unitPatch: { status: 'in_stock', location_id: LOCATION } });
      expect(await onHand(trx, SER_SERVICE, LOCATION)).toBe(1);
    });
  });

  it('T013: consuming more than available soft-warns (engine does not block; on_hand goes negative)', async () => {
    await inTx(async (trx) => {
      await settings(trx, SERVICE, false);
      await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: SERVICE, quantity: 2, to_location_id: LOCATION });
      await recordStockMovement(trx, TENANT, { movement_type: 'consume', service_id: SERVICE, quantity: 5, from_location_id: LOCATION });
      expect(await onHand(trx, SERVICE, LOCATION)).toBe(-3);
    });
  });
});
