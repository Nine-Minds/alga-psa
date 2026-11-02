import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const state = {
    allowed: true,
    tables: {} as Record<string, Row[]>,
    queried: [] as string[],
  };
  const trx: any = (table: string) => {
    state.queried.push(table);
    let rows = [...(state.tables[table] ?? [])];
    const qb: any = {
      where(w: any) {
        if (typeof w === 'function') return qb;
        rows = rows.filter((r) => Object.entries(w).every(([k, v]) => r[k] === v));
        return qb;
      },
      andWhere() { return qb; },
      whereNotNull() { return qb; },
      select() { return qb; },
      orderBy() { return qb; },
      first() { return Promise.resolve(rows[0]); },
      then(res: any, rej: any) { return Promise.resolve(rows).then(res, rej); },
    };
    return qb;
  };
  return { state, trx };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1', tenant: 't1' }, { tenant: 't1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.trx })),
  withTransaction: vi.fn(async (_k: unknown, cb: (t: unknown) => Promise<unknown>) => cb(h.trx)),
}));
vi.mock('../../lib/assetReadAuthorization', () => ({
  createAssetReadContext: vi.fn(async () => ({})),
  isAssetReadAllowed: vi.fn(async () => h.state.allowed),
}));

import { getAssetInventoryProvenance } from '../assetInventoryActions';

const EMPTY = {
  service_id: null, service_name: null, sku: null, unit_id: null, serial_number: null,
  mac_address: null, origin_so_id: null, origin_so_number: null, delivered_at: null, rma_history: [],
};
const rma = { rma_id: 'r1', rma_number: 'RMA-1', status: 'open', created_at: '2026-01-01T00:00:00.000Z', asset_id: 'a1', tenant: 't1' };

function seedLinked() {
  h.state.tables = {
    assets: [{ tenant: 't1', asset_id: 'a1', client_id: 'c1', service_id: 's1', stock_unit_id: 'u1' }],
    stock_units: [{ tenant: 't1', unit_id: 'u1', service_id: 's1', serial_number: 'SN', mac_address: 'MAC', delivered_at: '2026-01-02T00:00:00.000Z' }],
    service_catalog: [{ tenant: 't1', service_id: 's1', service_name: 'Router', sku: 'SKU1' }],
    stock_movements: [{ tenant: 't1', unit_id: 'u1', movement_type: 'consume', source_doc_type: 'sales_order', source_doc_id: 'so1' }],
    sales_orders: [{ tenant: 't1', so_id: 'so1', so_number: 'SO-1' }],
    rma_cases: [rma],
  };
}

describe('getAssetInventoryProvenance record-level authorization', () => {
  beforeEach(() => {
    h.state.allowed = true;
    h.state.queried = [];
    seedLinked();
  });

  it('(a) denied asset with unit, SO and RMA rows returns the empty shape', async () => {
    h.state.allowed = false;
    expect(await getAssetInventoryProvenance('a1')).toEqual(EMPTY);
  });

  it('(b) missing asset returns the identical shape', async () => {
    const missing = await getAssetInventoryProvenance('does-not-exist');
    h.state.allowed = false;
    expect(await getAssetInventoryProvenance('a1')).toEqual(missing);
    expect(missing).toEqual(EMPTY);
  });

  it('(c) allowed asset returns the full payload', async () => {
    expect(await getAssetInventoryProvenance('a1')).toEqual({
      service_id: 's1', service_name: 'Router', sku: 'SKU1', unit_id: 'u1', serial_number: 'SN',
      mac_address: 'MAC', origin_so_id: 'so1', origin_so_number: 'SO-1',
      delivered_at: '2026-01-02T00:00:00.000Z',
      rma_history: [{ rma_id: 'r1', rma_number: 'RMA-1', status: 'open', created_at: '2026-01-01T00:00:00.000Z', resolution: null }],
    });
  });

  it('(d) asset-only RMA branch returns empty rma_history when denied (and claims when allowed)', async () => {
    h.state.tables.assets = [{ tenant: 't1', asset_id: 'a1', client_id: 'c1', service_id: null, stock_unit_id: null }];
    expect((await getAssetInventoryProvenance('a1')).rma_history).toHaveLength(1);
    h.state.allowed = false;
    expect(await getAssetInventoryProvenance('a1')).toEqual(EMPTY);
  });

  it('(e) denied asset queries no table other than assets', async () => {
    h.state.allowed = false;
    h.state.queried = [];
    await getAssetInventoryProvenance('a1');
    expect(h.state.queried).toEqual(['assets']);
  });
});
