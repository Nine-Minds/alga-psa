import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';

const mocks = vi.hoisted(() => ({
  recordStockMovement: vi.fn(async () => ({ movement_id: 'reversal-1' })),
}));

vi.mock('../../../../../packages/inventory/src/lib/movements', () => ({
  recordStockMovement: mocks.recordStockMovement,
}));

import { reverseStockConsumption } from '../../../../../packages/inventory/src/lib/consume';

const compiler = knexFactory({ client: 'pg' });

afterAll(async () => {
  await compiler.destroy();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function connectionFor(latestDeliveryId: string, unitStatus = 'delivered') {
  return new Proxy(compiler, {
    apply(target, thisArg, argumentsList) {
      const builder: Knex.QueryBuilder = Reflect.apply(target, thisArg, argumentsList);
      Object.defineProperty(builder, 'then', {
        value: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
          const { sql } = builder.toSQL();
          let result: unknown;
          if (sql.includes('from "product_inventory_settings"')) {
            result = { track_stock: true, is_serialized: true };
          } else if (sql.includes('from "stock_movements"') && sql.includes('"source_doc_id" = ?')) {
            result = { movement_id: 'material-delivery', unit_id: 'unit-1', from_location_id: 'location-1' };
          } else if (sql.includes('from "stock_movements"')) {
            result = { movement_id: latestDeliveryId, source_doc_type: 'sales_order', source_doc_id: 'so-1' };
          } else if (sql.includes('from "stock_units"')) {
            result = { status: unitStatus };
          } else {
            return Promise.reject(new Error(`Unexpected query: ${sql}`)).then(resolve, reject);
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      });
      return builder;
    },
  }) as unknown as Knex.Transaction;
}

const reversal = {
  service_id: 'service-1',
  quantity: 1,
  source_doc_type: 'ticket_material' as const,
  source_doc_id: 'material-1',
  performed_by: 'user-1',
};

describe('serialized material reversal', () => {
  it('restores the unit while this material is still its latest delivery', async () => {
    await expect(reverseStockConsumption(connectionFor('material-delivery'), 'tenant-1', reversal))
      .resolves.toEqual({ restored: true, location_id: 'location-1', unit_id: 'unit-1' });
    expect(mocks.recordStockMovement).toHaveBeenCalledWith(expect.anything(), 'tenant-1', expect.objectContaining({
      movement_type: 'return_restock',
      unit_id: 'unit-1',
    }));
  });

  it('does not pull back a unit that has since been delivered elsewhere', async () => {
    await expect(reverseStockConsumption(connectionFor('sales-order-delivery'), 'tenant-1', reversal))
      .resolves.toEqual({ restored: false });
    expect(mocks.recordStockMovement).not.toHaveBeenCalled();
  });

  it('does not restore a unit that is already back in stock', async () => {
    await expect(reverseStockConsumption(connectionFor('material-delivery', 'in_stock'), 'tenant-1', reversal))
      .resolves.toEqual({ restored: false });
    expect(mocks.recordStockMovement).not.toHaveBeenCalled();
  });
});
