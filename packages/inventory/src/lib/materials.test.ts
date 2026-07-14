/**
 * Canonical materials service + negative-stock guard (F014/F015/F048, T003/T004/T005).
 * Real server DB; rolled-back transactions except the concurrency case, which must
 * commit to exercise the FOR UPDATE race and cleans up its own fixtures.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import knexLib, { Knex } from 'knex';
import { recordStockMovement } from './movements';
import { recordStockConsumption, InsufficientStockError } from './consume';
import { addMaterial, deleteMaterial, MaterialValidationError } from './materials';
import { queryProductAvailability } from './availability';
import { getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();

let knex: Knex;
let TENANT: string;
let LOCATION: string;
let CLIENT: string;
let TICKET: string;

beforeAll(async () => {
  if (!databaseConnection) return;
  knex = knexLib({ client: 'pg', connection: databaseConnection, pool: { min: 1, max: 6 } });
  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  LOCATION = (await knex('stock_locations').where({ tenant: TENANT, is_default: true }).first()).location_id;
  CLIENT = (await knex('clients').where({ tenant: TENANT }).first()).client_id;
  TICKET = (await knex('tickets').where({ tenant: TENANT }).whereNotNull('client_id').first()).ticket_id;
});

afterAll(async () => { await knex?.destroy(); });

async function inTx(fn: (trx: Knex.Transaction) => Promise<void>) {
  const trx = await knex.transaction();
  try { await fn(trx); } finally { await trx.rollback(); }
}

/** New tracked non-serialized product with `qty` on hand at the default location. */
async function makeTrackedProduct(trx: Knex.Transaction, label: string, qty: number, extras: Record<string, unknown> = {}): Promise<string> {
  const typeRow = await trx('service_catalog').where({ tenant: TENANT }).whereNotNull('custom_service_type_id').first('custom_service_type_id');
  const [svc] = await trx('service_catalog')
    .insert({ tenant: TENANT, service_name: `ZZ Test ${label}`, sku: label, item_kind: 'product', billing_method: 'per_unit', default_rate: 1000, is_active: true, custom_service_type_id: typeRow.custom_service_type_id })
    .returning('service_id');
  await trx('product_inventory_settings')
    .insert({ tenant: TENANT, service_id: svc.service_id, track_stock: true, is_serialized: false, cost_currency: 'USD', default_location_id: LOCATION, average_cost: 500, ...extras });
  if (qty > 0) {
    await recordStockMovement(trx, TENANT, { movement_type: 'receipt', service_id: svc.service_id, quantity: qty, to_location_id: LOCATION });
  }
  return svc.service_id;
}

async function onHand(trx: Knex.Transaction, serviceId: string): Promise<number> {
  const r = await trx('stock_levels').where({ tenant: TENANT, service_id: serviceId, location_id: LOCATION }).first();
  return r ? Number(r.quantity_on_hand) : 0;
}

describe.skipIf(!databaseConnection)('F014/F015 negative-stock guard (T003)', () => {
  it('blocks insufficient consumption naming the available quantity; exact-to-zero succeeds', async () => {
    await inTx(async (trx) => {
      const svc = await makeTrackedProduct(trx, `vitest-t003-${randomUUID().slice(0, 8)}`, 2);

      await expect(
        recordStockConsumption(trx, TENANT, { service_id: svc, quantity: 3, source_doc_type: 'ticket_material', source_doc_id: randomUUID() }),
      ).rejects.toSatisfy((e: unknown) => e instanceof InsufficientStockError && (e as InsufficientStockError).available === 2 && /2 available, 3 requested/.test((e as Error).message));
      expect(await onHand(trx, svc)).toBe(2); // nothing written

      const r = await recordStockConsumption(trx, TENANT, { service_id: svc, quantity: 2, source_doc_type: 'ticket_material', source_doc_id: randomUUID() });
      expect(r.consumed).toBe(true);
      expect(await onHand(trx, svc)).toBe(0);
    });
  });

  it('adjustment path is unguarded (F015) — corrections can move levels freely', async () => {
    await inTx(async (trx) => {
      const svc = await makeTrackedProduct(trx, `vitest-t003b-${randomUUID().slice(0, 8)}`, 0);
      await recordStockMovement(trx, TENANT, { movement_type: 'adjust', service_id: svc, quantity: 5, from_location_id: LOCATION });
      expect(await onHand(trx, svc)).toBe(-5);
    });
  });

  it('throws when a tracked product has no resolvable stock location', async () => {
    await inTx(async (trx) => {
      const typeRow = await trx('service_catalog').where({ tenant: TENANT }).whereNotNull('custom_service_type_id').first('custom_service_type_id');
      const [svcRow] = await trx('service_catalog')
        .insert({ tenant: TENANT, service_name: `ZZ Test noloc-${randomUUID().slice(0, 8)}`, sku: `noloc-${randomUUID().slice(0, 8)}`, item_kind: 'product', billing_method: 'per_unit', default_rate: 1000, is_active: true, custom_service_type_id: typeRow.custom_service_type_id })
        .returning('service_id');
      await trx('stock_locations').where({ tenant: TENANT }).update({ is_default: false });
      await trx('product_inventory_settings')
        .insert({ tenant: TENANT, service_id: svcRow.service_id, track_stock: true, is_serialized: false, cost_currency: 'USD', default_location_id: null });
      await expect(
        recordStockConsumption(trx, TENANT, { service_id: svcRow.service_id, quantity: 1, source_doc_type: 'ticket_material', source_doc_id: randomUUID() }),
      ).rejects.toThrow(/No stock location is configured/);
    });
  });
});

describe.skipIf(!databaseConnection)('F048 canonical materials service (T005)', () => {
  it('addMaterial writes the row, consumes stock, derives client from the ticket; deleteMaterial reverses', async () => {
    await inTx(async (trx) => {
      const svc = await makeTrackedProduct(trx, `vitest-t005-${randomUUID().slice(0, 8)}`, 3);

      const row: any = await addMaterial(trx as unknown as Knex, TENANT, {
        parent_type: 'ticket', parent_id: TICKET, service_id: svc,
        quantity: 2, rate: 12345, currency_code: 'USD',
      }, null);

      expect(row.ticket_material_id).toBeTruthy();
      expect(row.client_id).toBeTruthy(); // derived from the ticket, not passed
      expect(row.is_billed).toBe(false);
      expect(await onHand(trx, svc)).toBe(1);
      const mv = await trx('stock_movements').where({ tenant: TENANT, source_doc_type: 'ticket_material', source_doc_id: row.ticket_material_id, movement_type: 'consume' }).first();
      expect(mv).toBeTruthy();
      expect(Number(mv.quantity)).toBe(2);

      const deleted = await deleteMaterial(trx as unknown as Knex, TENANT, 'ticket', row.ticket_material_id, null);
      expect(deleted).toBe(true);
      expect(await onHand(trx, svc)).toBe(3);
    });
  });

  it('validates: bad quantity, non-product service, serialized without a unit, billed delete refused', async () => {
    await inTx(async (trx) => {
      const svc = await makeTrackedProduct(trx, `vitest-t005b-${randomUUID().slice(0, 8)}`, 1);

      await expect(
        addMaterial(trx as unknown as Knex, TENANT, { parent_type: 'ticket', parent_id: TICKET, service_id: svc, quantity: 0, rate: 100 }, null),
      ).rejects.toSatisfy((e: unknown) => e instanceof MaterialValidationError && (e as MaterialValidationError).path === 'quantity');

      const nonProduct = (await trx('service_catalog').where({ tenant: TENANT, item_kind: 'service' }).first()).service_id;
      await expect(
        addMaterial(trx as unknown as Knex, TENANT, { parent_type: 'ticket', parent_id: TICKET, service_id: nonProduct, quantity: 1, rate: 100 }, null),
      ).rejects.toSatisfy((e: unknown) => e instanceof MaterialValidationError && (e as MaterialValidationError).path === 'service_id');

      const serialized = await makeTrackedProduct(trx, `vitest-t005c-${randomUUID().slice(0, 8)}`, 0, { is_serialized: true });
      await expect(
        addMaterial(trx as unknown as Knex, TENANT, { parent_type: 'ticket', parent_id: TICKET, service_id: serialized, quantity: 1, rate: 100 }, null),
      ).rejects.toSatisfy((e: unknown) => e instanceof MaterialValidationError && (e as MaterialValidationError).path === 'unit_id');

      const row: any = await addMaterial(trx as unknown as Knex, TENANT, { parent_type: 'ticket', parent_id: TICKET, service_id: svc, quantity: 1, rate: 100 }, null);
      await trx('ticket_materials').where({ tenant: TENANT, ticket_material_id: row.ticket_material_id }).update({ is_billed: true });
      await expect(
        deleteMaterial(trx as unknown as Knex, TENANT, 'ticket', row.ticket_material_id, null),
      ).rejects.toThrow(/billed material/);
    });
  });
});

describe.skipIf(!databaseConnection)('F005 availability (T002)', () => {
  it('reports on-hand, available (minus reservations), reorder point, and per-location rows', async () => {
    await inTx(async (trx) => {
      const svc = await makeTrackedProduct(trx, `vitest-t002-${randomUUID().slice(0, 8)}`, 5, { reorder_point: 2 });
      await trx('stock_levels').where({ tenant: TENANT, service_id: svc, location_id: LOCATION }).update({ reserved_quantity: 1 });

      const [a] = await queryProductAvailability(trx, TENANT, [svc]);
      expect(a.track_stock).toBe(true);
      expect(a.on_hand_total).toBe(5);
      expect(a.available_total).toBe(4);
      expect(a.reorder_point).toBe(2);
      expect(a.locations).toHaveLength(1);
      expect(a.locations[0].location_id).toBe(LOCATION);

      const untrackedService = (await trx('service_catalog').where({ tenant: TENANT, item_kind: 'service' }).first()).service_id;
      const [b] = await queryProductAvailability(trx, TENANT, [untrackedService]);
      expect(b.track_stock).toBe(false);
      expect(b.locations).toHaveLength(0);
    });
  });
});

describe.skipIf(!databaseConnection)('F014 concurrency (T004) — committed race on a persistent fixture', () => {
  // stock_movements is an append-only ledger (no DELETE), so this test uses a single
  // idempotent get-or-create fixture (inactive product, hidden from pickers) instead of
  // disposable rows, and resets its level via `adjust` movements each run.
  const FIXTURE_SKU = 'ZZ-vitest-t004-race-fixture';

  it('two parallel consumptions of the last unit: exactly one wins, on-hand ends at zero', async () => {
    const serviceId = await knex.transaction(async (trx) => {
      const existing = await trx('service_catalog').where({ tenant: TENANT, sku: FIXTURE_SKU }).first('service_id');
      const id = existing?.service_id ?? (await makeTrackedProduct(trx, FIXTURE_SKU, 0));
      await trx('service_catalog').where({ tenant: TENANT, service_id: id }).update({ is_active: false });
      await trx('product_inventory_settings')
        .insert({ tenant: TENANT, service_id: id, track_stock: true, is_serialized: false, cost_currency: 'USD', default_location_id: LOCATION, average_cost: 500 })
        .onConflict(['tenant', 'service_id']).merge({ track_stock: true, is_serialized: false, default_location_id: LOCATION });
      return id;
    });

    const readOnHand = async () => {
      const r = await knex('stock_levels').where({ tenant: TENANT, service_id: serviceId, location_id: LOCATION }).first();
      return r ? Number(r.quantity_on_hand) : 0;
    };
    const adjustTo = async (target: number) => {
      const current = await readOnHand();
      if (current === target) return;
      await knex.transaction(async (trx) => {
        const delta = target - current;
        await recordStockMovement(trx, TENANT, {
          movement_type: 'adjust', service_id: serviceId, quantity: Math.abs(delta),
          ...(delta > 0 ? { to_location_id: LOCATION } : { from_location_id: LOCATION }),
          reason: 'vitest T004 fixture reset',
        });
      });
    };

    try {
      await adjustTo(1);
      const before = await knex('stock_movements')
        .where({ tenant: TENANT, service_id: serviceId, movement_type: 'consume' })
        .count<{ c: string }>('* as c').first();

      const consumeOnce = () =>
        knex.transaction(async (trx) => {
          await recordStockConsumption(trx, TENANT, { service_id: serviceId, quantity: 1, source_doc_type: 'ticket_material', source_doc_id: randomUUID() });
        });

      const results = await Promise.allSettled([consumeOnce(), consumeOnce()]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason?.name).toBe('InsufficientStockError');

      expect(await readOnHand()).toBe(0);
      const after = await knex('stock_movements')
        .where({ tenant: TENANT, service_id: serviceId, movement_type: 'consume' })
        .count<{ c: string }>('* as c').first();
      expect(Number(after?.c) - Number(before?.c)).toBe(1);
    } finally {
      await adjustTo(0);
    }
  });
});
