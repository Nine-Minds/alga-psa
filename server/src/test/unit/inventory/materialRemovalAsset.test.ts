import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';

const mocks = vi.hoisted(() => ({
  reverseStockConsumption: vi.fn(),
  unwindDeliveredAsset: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  admitOperationalWrite: vi.fn(async () => undefined),
  withTransaction: async (connection: Knex, callback: (trx: Knex) => Promise<unknown>) => callback(connection),
}));
vi.mock('../../../../../packages/inventory/src/lib/consume', () => ({
  recordStockConsumption: vi.fn(),
  reverseStockConsumption: mocks.reverseStockConsumption,
}));
vi.mock('../../../../../packages/inventory/src/lib/assetLink', () => ({
  unwindDeliveredAsset: mocks.unwindDeliveredAsset,
}));

import { deleteMaterial } from '../../../../../packages/inventory/src/lib/materials';

const compiler = knexFactory({ client: 'pg' });

afterAll(async () => {
  await compiler.destroy();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function connection() {
  return new Proxy(compiler, {
    apply(target, thisArg, argumentsList) {
      const builder: Knex.QueryBuilder = Reflect.apply(target, thisArg, argumentsList);
      Object.defineProperty(builder, 'then', {
        value: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
          const { sql } = builder.toSQL();
          const result = sql.startsWith('select') && sql.includes('from "ticket_materials"')
            ? { is_billed: false, service_id: 'service-1', quantity: 1, ticket_id: 'ticket-1' }
            : 1;
          return Promise.resolve(result).then(resolve, reject);
        },
      });
      return builder;
    },
  });
}

describe('serialized material removal', () => {
  it('unwinds the asset the delivery created when the unit is restored', async () => {
    mocks.reverseStockConsumption.mockResolvedValue({ restored: true, location_id: 'location-1', unit_id: 'unit-1' });
    const knex = connection();

    await expect(deleteMaterial(knex, 'tenant-1', 'ticket', 'material-1', 'user-1')).resolves.toBe(true);

    expect(mocks.unwindDeliveredAsset).toHaveBeenCalledExactlyOnceWith(knex, 'tenant-1', {
      unitId: 'unit-1',
      parentType: 'ticket',
      parentId: 'ticket-1',
      materialId: 'material-1',
    });
  });

  it('leaves assets alone when no unit came back on this removal', async () => {
    mocks.reverseStockConsumption.mockResolvedValue({ restored: false });

    await expect(deleteMaterial(connection(), 'tenant-1', 'ticket', 'material-1', 'user-1')).resolves.toBe(true);

    expect(mocks.unwindDeliveredAsset).not.toHaveBeenCalled();
  });
});
