import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knexLib, { Knex } from 'knex';
import { adjustStockCore } from './adjust';
import { receivePoLineCore } from './purchaseOrders';
import { receiveStockCore } from './receive';
import { getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();

let knex: Knex;
let tenant: string;
let userId: string;
let locationId: string;
let serviceId: string;
let serializedServiceId: string;

beforeAll(async () => {
  if (!databaseConnection) return;
  knex = knexLib({ client: 'pg', connection: databaseConnection, pool: { min: 1, max: 4 } });
  tenant = (await knex('tenants').select('tenant').first()).tenant;
  const location = await knex('stock_locations').where({ tenant, is_default: true }).first();
  locationId = location.location_id;
  userId =
    location.assigned_user_id ??
    location.manager_user_id ??
    (await knex('users').where({ tenant }).select('user_id').first()).user_id;
  const services = await knex('service_catalog')
    .where({ tenant, item_kind: 'service' })
    .whereRaw(
      'NOT EXISTS (SELECT 1 FROM stock_levels sl WHERE sl.tenant = service_catalog.tenant AND sl.service_id = service_catalog.service_id)',
    )
    .whereRaw(
      'NOT EXISTS (SELECT 1 FROM stock_units su WHERE su.tenant = service_catalog.tenant AND su.service_id = service_catalog.service_id)',
    )
    .orderBy('service_id')
    .limit(2)
    .select('service_id');
  serviceId = services[0].service_id;
  serializedServiceId = services[1].service_id;
});

afterAll(async () => {
  await knex?.destroy();
});

async function inRollbackTransaction(work: (trx: Knex.Transaction) => Promise<void>): Promise<void> {
  const trx = await knex.transaction();
  try {
    await work(trx);
  } finally {
    await trx.rollback();
  }
}

async function setSettings(trx: Knex.Transaction, selectedServiceId: string, serialized: boolean): Promise<void> {
  await trx('product_inventory_settings')
    .insert({
      tenant,
      service_id: selectedServiceId,
      track_stock: true,
      is_serialized: serialized,
      average_cost: 1000,
      cost_currency: 'USD',
      default_location_id: locationId,
    })
    .onConflict(['tenant', 'service_id'])
    .merge({
      track_stock: true,
      is_serialized: serialized,
      average_cost: 1000,
      cost_currency: 'USD',
      default_location_id: locationId,
    });
}

describe.skipIf(!databaseConnection)('session-free inventory extraction cores (real DB, rolled back)', () => {
  it('T006: receiveStockCore records the receipt, level delta, moving average, and pending events', async () => {
    await inRollbackTransaction(async (trx) => {
      await setSettings(trx, serviceId, false);
      const result = await receiveStockCore(trx, tenant, userId, {
        service_id: serviceId,
        location_id: locationId,
        quantity: 4,
        unit_cost: 1500,
      });

      expect(result.movements).toHaveLength(1);
      expect(result.movements[0]).toMatchObject({
        movement_type: 'receipt',
        service_id: serviceId,
        to_location_id: locationId,
        performed_by: userId,
      });
      expect(Number(result.movements[0].quantity)).toBe(4);
      expect(result.average_cost).toBe(1500);
      expect(result.stock_unit_created_events).toEqual([]);
      const level = await trx('stock_levels').where({ tenant, service_id: serviceId, location_id: locationId }).first();
      expect(Number(level.quantity_on_hand)).toBe(4);
    });
  });

  it('T006: adjustStockCore records the signed adjustment and identical maintained level', async () => {
    await inRollbackTransaction(async (trx) => {
      await setSettings(trx, serviceId, false);
      await receiveStockCore(trx, tenant, userId, {
        service_id: serviceId,
        location_id: locationId,
        quantity: 5,
        unit_cost: 1000,
      });
      const result = await adjustStockCore(trx, tenant, userId, {
        service_id: serviceId,
        location_id: locationId,
        delta: -2,
        reason: 'core regression adjustment',
      });

      expect(result.movements).toHaveLength(1);
      expect(result.movements[0]).toMatchObject({
        movement_type: 'adjust',
        service_id: serviceId,
        from_location_id: locationId,
        reason: 'core regression adjustment',
        performed_by: userId,
      });
      expect(Number(result.movements[0].quantity)).toBe(2);
      expect(result.warnings).toEqual([]);
      const level = await trx('stock_levels').where({ tenant, service_id: serviceId, location_id: locationId }).first();
      expect(Number(level.quantity_on_hand)).toBe(3);
    });
  });

  it('T006: receiveStockCore enforces serialized quantity and batch uniqueness without a session', async () => {
    await inRollbackTransaction(async (trx) => {
      await setSettings(trx, serializedServiceId, true);
      await expect(
        receiveStockCore(trx, tenant, userId, {
          service_id: serializedServiceId,
          location_id: locationId,
          quantity: 2,
          unit_cost: 1000,
          serials: [{ serial_number: 'CORE-SERIAL-ONE' }],
        }),
      ).rejects.toThrow('Serialized receipt requires exactly 2 serial(s); got 1');
      await expect(
        receiveStockCore(trx, tenant, userId, {
          service_id: serializedServiceId,
          location_id: locationId,
          quantity: 2,
          unit_cost: 1000,
          serials: [
            { serial_number: 'CORE-DUPLICATE', mac_address: '00:11:22:33:44:55' },
            { serial_number: 'core-duplicate', mac_address: '00:11:22:33:44:56' },
          ],
        }),
      ).rejects.toThrow('Duplicate serial in batch: core-duplicate');
    });
  });

  it('T007: receivePoLineCore rejects a receiving location assigned to another user', async () => {
    await inRollbackTransaction(async (trx) => {
      const owner = await trx('users').where({ tenant }).select('user_id').first();
      const [restrictedLocation] = await trx('stock_locations')
        .insert({
          tenant,
          name: `CORE-PO-SCOPE-${randomUUID()}`,
          location_type: 'van',
          assigned_user_id: owner.user_id,
          is_default: false,
          is_active: true,
        })
        .returning('location_id');
      let vendor = await trx('vendors').where({ tenant }).first();
      if (!vendor) {
        [vendor] = await trx('vendors')
          .insert({ tenant, vendor_name: `CORE-PO-VENDOR-${randomUUID()}`, is_active: true })
          .returning('*');
      }
      const [po] = await trx('purchase_orders')
        .insert({
          tenant,
          po_number: `CORE-PO-${randomUUID()}`,
          vendor_id: vendor.vendor_id,
          status: 'open',
          currency_code: 'USD',
          created_by: owner.user_id,
        })
        .returning('*');
      const [line] = await trx('purchase_order_lines')
        .insert({
          tenant,
          po_id: po.po_id,
          service_id: serviceId,
          quantity_ordered: 1,
          quantity_received: 0,
          unit_cost: 1000,
          cost_currency: 'USD',
        })
        .returning('*');

      await expect(
        receivePoLineCore(trx, tenant, randomUUID(), {
          po_line_id: line.po_line_id,
          location_id: restrictedLocation.location_id,
          quantity: 1,
        }),
      ).rejects.toThrow("Permission denied: this location is a technician's van assigned to someone else");
      expect(Number((await trx('purchase_order_lines').where({ tenant, po_line_id: line.po_line_id }).first()).quantity_received)).toBe(0);
    });
  });
});
