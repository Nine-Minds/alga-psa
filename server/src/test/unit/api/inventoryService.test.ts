import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => unknown) => callback(_knex)),
  queryStockLevelsForProduct: vi.fn(),
  queryStockUnits: vi.fn(),
  queryStockLocations: vi.fn(),
  queryStockLocation: vi.fn(),
  queryStockAtLocation: vi.fn(),
  queryUnitDetail: vi.fn(),
  queryPurchaseOrders: vi.fn(),
  queryPurchaseOrder: vi.fn(),
  queryTransfers: vi.fn(),
  receiveStockCore: vi.fn(),
  adjustStockCore: vi.fn(),
  startCountSessionCore: vi.fn(),
  recordCountCore: vi.fn(),
  submitCountForReviewCore: vi.fn(),
  receivePoLineCore: vi.fn(),
  receiveTransferCore: vi.fn(),
  assertLocationWritable: vi.fn(),
  publishInventoryEvent: vi.fn(),
  timestampPayload: vi.fn((payload: object) => ({ ...payload, timestamp: '2026-07-16T00:00:00.000Z' })),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, withTransaction: mocks.withTransaction };
});

vi.mock('@alga-psa/inventory', () => ({
  queryStockLevelsForProduct: mocks.queryStockLevelsForProduct,
  queryStockUnits: mocks.queryStockUnits,
  queryStockLocations: mocks.queryStockLocations,
  queryStockLocation: mocks.queryStockLocation,
  queryStockAtLocation: mocks.queryStockAtLocation,
  queryUnitDetail: mocks.queryUnitDetail,
  queryPurchaseOrders: mocks.queryPurchaseOrders,
  queryPurchaseOrder: mocks.queryPurchaseOrder,
  queryTransfers: mocks.queryTransfers,
  receiveStockCore: mocks.receiveStockCore,
  adjustStockCore: mocks.adjustStockCore,
  startCountSessionCore: mocks.startCountSessionCore,
  recordCountCore: mocks.recordCountCore,
  submitCountForReviewCore: mocks.submitCountForReviewCore,
  receivePoLineCore: mocks.receivePoLineCore,
  receiveTransferCore: mocks.receiveTransferCore,
  assertLocationWritable: mocks.assertLocationWritable,
  publishInventoryEvent: mocks.publishInventoryEvent,
  timestampPayload: mocks.timestampPayload,
}));

import { InventoryService, normalizeMacForLookup } from '../../../lib/api/services/InventoryService';

const TENANT = 'tenant-1';
const USER = 'user-1';
const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const LOCATION_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, any>;

class FakeQuery implements PromiseLike<Row[]> {
  private rows: Row[];

  constructor(rows: Row[]) {
    this.rows = [...rows];
  }

  join() { return this; }
  leftJoin() { return this; }
  select() { return this; }
  orderBy() { return this; }
  limit(value: number) { this.rows = this.rows.slice(0, value); return this; }
  whereIn(column: string, values: any[]) {
    const field = column.split('.').pop()!;
    this.rows = this.rows.filter((row) => values.includes(row[field]));
    return this;
  }

  where(arg1: any, arg2?: any) {
    if (typeof arg1 === 'function') return this;
    if (typeof arg1 === 'object') {
      for (const [key, value] of Object.entries(arg1)) {
        const field = key.split('.').pop()!;
        if (field === 'tenant') continue;
        this.rows = this.rows.filter((row) => row[field] === value);
      }
      return this;
    }
    const field = String(arg1).split('.').pop()!;
    this.rows = this.rows.filter((row) => row[field] === arg2);
    return this;
  }

  andWhere(arg1: any, arg2?: any) { return this.where(arg1, arg2); }

  whereRaw(sql: string, bindings: any[]) {
    if (sql.includes('LOWER(sc.sku)')) {
      const expected = String(bindings[0]).toLowerCase();
      this.rows = this.rows.filter((row) => String(row.sku ?? '').toLowerCase() === expected);
    } else if (sql.includes('regexp_replace') && sql.includes(' = ?')) {
      const expected = bindings[0];
      this.rows = this.rows.filter((row) => normalizeMacForLookup(String(row.mac_address ?? '')) === expected);
    }
    return this;
  }

  first() { return Promise.resolve(this.rows[0]); }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

function makeDb(tables: Record<string, Row[]>) {
  return ((table: string) => new FakeQuery(tables[table] ?? [])) as any;
}

function context(db: any) {
  return { tenant: TENANT, userId: USER, user: { user_id: USER }, db };
}

describe('InventoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryStockLevelsForProduct.mockResolvedValue([]);
  });

  it('T020: returns multi when a product and unit both exactly match', async () => {
    const product = {
      service_id: SERVICE_ID,
      service_name: 'Switch',
      sku: 'SW-1',
      barcode: 'ABC123',
      unit_of_measure: 'each',
      item_kind: 'product',
      is_serialized: true,
      track_stock: true,
    };
    const unit = {
      ...product,
      unit_id: UNIT_ID,
      serial_number: 'ABC123',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      status: 'in_stock',
      location_id: LOCATION_ID,
      location_name: 'Main',
    };
    const service = new InventoryService();
    const result = await service.lookup('ABC123', context(makeDb({
      'service_catalog as sc': [product],
      'stock_units as su': [unit],
    })));

    expect(result.type).toBe('multi');
    if (result.type === 'multi') {
      expect(result.matches.map((match) => match.kind)).toEqual(['product', 'unit']);
    }
  });

  it('T020: matches MAC case-insensitively while ignoring separators', async () => {
    const row = {
      service_id: SERVICE_ID,
      service_name: 'Switch',
      sku: 'SW-1',
      barcode: null,
      unit_of_measure: 'each',
      is_serialized: true,
      unit_id: UNIT_ID,
      serial_number: 'SN-1',
      mac_address: 'aa:BB.cc-DD EE ff',
      status: 'in_stock',
      location_id: LOCATION_ID,
    };
    const service = new InventoryService();
    const result = await service.lookup('AABBCCDDEEFF', context(makeDb({
      'service_catalog as sc': [],
      'stock_units as su': [row],
    })));

    expect(normalizeMacForLookup('aa:BB.cc-DD EE ff')).toBe('aabbccddeeff');
    expect(result.type).toBe('unit');
  });

  it('T023: passes unit list filters to the extracted core and paginates the result', async () => {
    mocks.queryStockUnits.mockResolvedValue([
      { unit_id: 'u1', service_id: SERVICE_ID, serial_number: 'FIRST', status: 'in_stock' },
      { unit_id: 'u2', service_id: SERVICE_ID, serial_number: 'SECOND', status: 'in_stock' },
    ]);
    const service = new InventoryService();
    const result = await service.listUnits({
      page: 2,
      limit: 1,
      service_id: SERVICE_ID,
      status: 'in_stock',
      location_id: LOCATION_ID,
      client_id: '44444444-4444-4444-8444-444444444444',
    }, context(makeDb({})));

    expect(mocks.queryStockUnits).toHaveBeenCalledWith(expect.anything(), TENANT, {
      service_id: SERVICE_ID,
      status: 'in_stock',
      location_id: LOCATION_ID,
      client_id: '44444444-4444-4444-8444-444444444444',
    });
    expect(result.total).toBe(2);
    expect(result.data[0].serial_number).toBe('SECOND');
  });

  it('T023: delegates stock loading to the location core and applies REST-only filters', async () => {
    const otherServiceId = '55555555-5555-4555-8555-555555555555';
    mocks.queryStockLocation.mockResolvedValue({ location_id: LOCATION_ID, name: 'Main Warehouse' });
    mocks.queryStockAtLocation.mockResolvedValue([
      {
        service_id: SERVICE_ID,
        service_name: 'Patch Cable',
        sku: 'CAB-1',
        location_id: LOCATION_ID,
        quantity_on_hand: 1,
        reserved_quantity: 0,
        held_quantity: 0,
        available: 1,
        reorder_point: null,
      },
      {
        service_id: otherServiceId,
        service_name: 'Router',
        sku: 'RTR-1',
        location_id: LOCATION_ID,
        quantity_on_hand: 20,
        reserved_quantity: 0,
        held_quantity: 0,
        available: 20,
        reorder_point: null,
      },
    ]);
    const service = new InventoryService();
    const result = await service.listStock({
      page: 1,
      limit: 10,
      location_id: LOCATION_ID,
      service_id: SERVICE_ID,
      search: 'cable',
      low_stock: true,
    }, context(makeDb({
      product_inventory_settings: [
        { service_id: SERVICE_ID, reorder_point: 2 },
        { service_id: otherServiceId, reorder_point: 1 },
      ],
    })));

    expect(mocks.queryStockLocation).toHaveBeenCalledWith(expect.anything(), TENANT, LOCATION_ID);
    expect(mocks.queryStockAtLocation).toHaveBeenCalledWith(expect.anything(), TENANT, LOCATION_ID);
    expect(result).toMatchObject({ total: 1, data: [{ service_id: SERVICE_ID, is_low_stock: true }] });
  });

  it('T025: rejects a serialized receipt whose serial count does not match quantity', async () => {
    const service = new InventoryService();
    await expect(service.receiveStock({
      service_id: SERVICE_ID,
      location_id: LOCATION_ID,
      quantity: 2,
      serials: [{ serial_number: 'ONLY-ONE' }],
    }, context(makeDb({
      product_inventory_settings: [{ service_id: SERVICE_ID, is_serialized: true, average_cost: 100, cost_currency: 'USD' }],
    })))).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.receiveStockCore).not.toHaveBeenCalled();
  });

  it('T026: rejects an adjustment without a reason before calling the core', async () => {
    const service = new InventoryService();
    await expect(service.adjustStock({
      service_id: SERVICE_ID,
      location_id: LOCATION_ID,
      quantity_delta: 1,
      reason: '',
    }, context(makeDb({})))).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.adjustStockCore).not.toHaveBeenCalled();
  });
});
