import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAndLinkDeliveredAsset } from './assetLink';

const h = vi.hoisted(() => ({ createAsset: vi.fn(), updates: [] as Array<{ table: string; values: unknown }> }));
vi.mock('@alga-psa/assets/actions', () => ({ createAsset: h.createAsset }));
vi.mock('@alga-psa/db', () => ({
  withTransaction: async (db: unknown, callback: (trx: unknown) => Promise<unknown>) => callback(db),
  admitOperationalWrite: vi.fn(async () => undefined),
}));

function database() {
  const db: any = (table: string) => ({
    where() { return this; },
    select() { return this; },
    first: async () => ({ default_asset_type: 'unknown' }),
    update: async (values: unknown) => { h.updates.push({ table, values }); return 1; },
  });
  db.fn = { now: () => '2026-11-05T00:00:00Z' };
  return db;
}

describe('delivered inventory asset identity', () => {
  beforeEach(() => {
    h.createAsset.mockReset();
    h.createAsset.mockResolvedValue({ asset_id: 'asset-1', asset_tag: 'FTS-00431' });
    h.updates = [];
  });

  it('delegates the physical tag to numbering and preserves the serial plus both inventory links', async () => {
    const result = await createAndLinkDeliveredAsset(database(), 'tenant-1', {
      unit: { unit_id: 'unit-1', serial_number: 'SERIAL-99' } as any,
      serviceId: 'service-1', serviceName: 'Laptop', clientId: 'client-1',
    });
    expect(result).toBe('asset-1');
    expect(h.createAsset.mock.calls[0][0]).toMatchObject({ client_id: 'client-1', serial_number: 'SERIAL-99' });
    expect(h.createAsset.mock.calls[0][0].asset_tag).toBeUndefined();
    expect(h.updates).toEqual([
      { table: 'assets', values: expect.objectContaining({ service_id: 'service-1', stock_unit_id: 'unit-1' }) },
      { table: 'stock_units', values: { asset_id: 'asset-1', updated_at: '2026-11-05T00:00:00Z' } },
    ]);
  });

  it('does not turn an internal unit ID into a tag when the serial is absent', async () => {
    await createAndLinkDeliveredAsset(database(), 'tenant-1', {
      unit: { unit_id: 'internal-unit-2' } as any,
      serviceId: 'service-1', serviceName: 'Laptop', clientId: 'client-1',
    });
    expect(h.createAsset.mock.calls[0][0].asset_tag).toBeUndefined();
    expect(h.createAsset.mock.calls[0][0].serial_number).toBeUndefined();
  });
});
