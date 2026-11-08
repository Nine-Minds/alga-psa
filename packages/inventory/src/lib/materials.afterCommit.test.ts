// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  createAsset: vi.fn(),
  publishInventoryEvent: vi.fn(),
  collectDefaultLocationStockLowSignalAfterConsume: vi.fn(),
  recordStockConsumption: vi.fn(),
  addOperationalWrite: vi.fn(),
  insertedMaterials: [] as unknown[],
}));

vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  admitOperationalWrite: (...args: any[]) => h.addOperationalWrite(...args),
}));
vi.mock('./consume', () => ({
  recordStockConsumption: (...args: any[]) => h.recordStockConsumption(...args),
  reverseStockConsumption: vi.fn(),
}));
vi.mock('./inventoryEvents', () => ({ publishInventoryEvent: (...args: any[]) => h.publishInventoryEvent(...args) }));
vi.mock('./stockLowSignal', () => ({
  collectDefaultLocationStockLowSignalAfterConsume: (...args: any[]) => h.collectDefaultLocationStockLowSignalAfterConsume(...args),
  collectStockLowSignalAfterConsume: vi.fn(),
}));
vi.mock('./tenantCurrency', () => ({ resolveTenantCurrency: vi.fn() }));
vi.mock('./assetLink', () => ({ createAndLinkDeliveredAsset: (...args: any[]) => h.createAsset(...args) }));

import type { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import { addMaterial } from './materials';

const TENANT = 'tenant-1';
const input = {
  parent_type: 'ticket' as const,
  parent_id: 'ticket-1',
  service_id: 'product-1',
  quantity: 1,
  rate: 100,
  currency_code: 'USD',
  unit_id: 'unit-1',
};
const pendingAsset = {
  unit: { unit_id: 'unit-1', serial_number: 'SERIAL-1' },
  serviceId: 'product-1',
  serviceName: 'Serialized product',
  clientId: 'client-1',
};
const pendingStockLow = { tenant: TENANT, service_id: 'product-1', remaining: 0 };

function makeRootConnection() {
  const root: any = (table: string) => {
    if (table === 'usable-root-probe') {
      root.rootProbeCount += 1;
      return Promise.resolve({ usable: true });
    }
    throw new Error(`Unexpected query on root connection: ${table}`);
  };
  root.rootProbeCount = 0;
  root.transaction = vi.fn(async (callback: (trx: any) => Promise<unknown>) => {
    const trx: any = (table: string) => makeQuery(table);
    trx.commit = vi.fn();
    trx.rollback = vi.fn();
    trx.fn = { now: () => new Date() };
    try {
      const result = await callback(trx);
      trx.commit();
      root.committed = true;
      return result;
    } catch (error) {
      trx.rollback(error);
      throw error;
    }
  });
  return root;
}

function makeQuery(table: string) {
  let insertedRow: Record<string, unknown> | undefined;
  const builder: any = {
    where: () => builder,
    select: () => builder,
    first: async () => {
      if (table === 'tickets') return { ticket_id: input.parent_id, client_id: 'client-1' };
      if (table === 'service_catalog') return { service_id: input.service_id };
      if (table === 'product_inventory_settings') return { track_stock: true, is_serialized: true };
      return undefined;
    },
    insert: (row: Record<string, unknown>) => {
      insertedRow = { ...row, ticket_material_id: 'material-1' };
      h.insertedMaterials.push(insertedRow);
      return builder;
    },
    returning: async () => [insertedRow],
  };
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.insertedMaterials = [];
  h.recordStockConsumption.mockResolvedValue({ consumed: true, pending_asset_link: pendingAsset });
  h.collectDefaultLocationStockLowSignalAfterConsume.mockResolvedValue(pendingStockLow);
  h.createAsset.mockImplementation(async (root: any) => {
    if (typeof root !== 'function' || typeof root.transaction !== 'function') {
      throw new Error('asset linking requires the root connection');
    }
    expect(root.committed).toBe(true);
    await root('usable-root-probe');
    return 'asset-1';
  });
});

describe('addMaterial post-commit effects', () => {
  it('keeps effects pending until the outer commit, then runs each once with the root connection', async () => {
    const root = makeRootConnection();
    const result = await withTransaction(root, async (outerTrx: Knex.Transaction) => {
      const row = await addMaterial(outerTrx as Knex, TENANT, input, 'user-1');
      expect((row as any).ticket_material_id).toBe('material-1');
      expect(h.createAsset).not.toHaveBeenCalled();
      expect(h.publishInventoryEvent).not.toHaveBeenCalled();
      return row;
    });

    expect(result).toMatchObject({ ticket_material_id: 'material-1' });
    expect(h.createAsset).toHaveBeenCalledExactlyOnceWith(root, TENANT, pendingAsset);
    expect(root.rootProbeCount).toBe(1);
    expect(h.publishInventoryEvent).toHaveBeenCalledExactlyOnceWith('INVENTORY_STOCK_LOW', pendingStockLow);
  });

  it('suppresses delivered-asset creation and stock-low publication when the outer transaction rolls back', async () => {
    const root = makeRootConnection();
    await expect(withTransaction(root, async (outerTrx: Knex.Transaction) => {
      await addMaterial(outerTrx as Knex, TENANT, input, 'user-1');
      expect(h.createAsset).not.toHaveBeenCalled();
      expect(h.publishInventoryEvent).not.toHaveBeenCalled();
      throw new Error('outer transaction failed');
    })).rejects.toThrow('outer transaction failed');

    expect(h.createAsset).not.toHaveBeenCalled();
    expect(h.publishInventoryEvent).not.toHaveBeenCalled();
  });
});
