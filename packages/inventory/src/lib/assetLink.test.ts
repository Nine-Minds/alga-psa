import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAndLinkDeliveredAsset, detachDeliveredAssetAssociation } from './assetLink';

const h = vi.hoisted(() => ({
  createAsset: vi.fn(),
  revalidatePath: vi.fn(),
  updates: [] as Array<{ table: string; values: unknown }>,
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  deletes: [] as Array<{ table: string; where: Record<string, unknown> }>,
  firsts: {} as Record<string, unknown>,
}));
vi.mock('@alga-psa/assets/actions', () => ({ createAsset: h.createAsset }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => h.revalidatePath(...args) }));
vi.mock('@alga-psa/db', () => ({
  withTransaction: async (db: unknown, callback: (trx: unknown) => Promise<unknown>) => callback(db),
  admitOperationalWrite: vi.fn(async () => undefined),
  tenantDb: (trx: unknown) => trx,
}));

/** Query recorder: `first()` answers from h.firsts by table; mutations are captured. */
function database() {
  const db: any = (table: string) => {
    const builder: any = {
      where(w: Record<string, unknown>) { builder._where = w; return builder; },
      select() { return builder; },
      orderBy() { return builder; },
      first: async () => (table in h.firsts ? h.firsts[table] : undefined),
      update: async (values: unknown) => { h.updates.push({ table, values }); return 1; },
      insert: async (row: Record<string, unknown>) => { h.inserts.push({ table, row }); return [row]; },
      delete: async () => { h.deletes.push({ table, where: builder._where ?? {} }); return 1; },
    };
    return builder;
  };
  db.fn = { now: () => '2026-11-05T00:00:00Z' };
  db.table = (t: string) => db(t); // the tenantDb mock returns trx; code calls .table(name)
  return db;
}

describe('delivered inventory asset identity', () => {
  beforeEach(() => {
    h.createAsset.mockReset();
    h.createAsset.mockResolvedValue({ asset_id: 'asset-1', asset_tag: 'FTS-00431' });
    h.revalidatePath.mockReset();
    h.updates = [];
    h.inserts = [];
    h.deletes = [];
    h.firsts = { product_inventory_settings: { default_asset_type: 'unknown' } };
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
    expect(h.inserts).toHaveLength(0); // no parent context → no association row
  });

  it('does not turn an internal unit ID into a tag when the serial is absent', async () => {
    await createAndLinkDeliveredAsset(database(), 'tenant-1', {
      unit: { unit_id: 'internal-unit-2' } as any,
      serviceId: 'service-1', serviceName: 'Laptop', clientId: 'client-1',
    });
    expect(h.createAsset.mock.calls[0][0].asset_tag).toBeUndefined();
    expect(h.createAsset.mock.calls[0][0].serial_number).toBeUndefined();
  });

  it('associates the created asset with the delivering ticket and revalidates its page', async () => {
    await createAndLinkDeliveredAsset(database(), 'tenant-1', {
      unit: { unit_id: 'unit-1', serial_number: 'SERIAL-99' } as any,
      serviceId: 'service-1', serviceName: 'Laptop', clientId: 'client-1',
      parentType: 'ticket', parentId: 'ticket-1', createdBy: 'user-1',
    });
    expect(h.inserts).toEqual([
      {
        table: 'asset_associations',
        row: expect.objectContaining({
          tenant: 'tenant-1',
          asset_id: 'asset-1',
          entity_id: 'ticket-1',
          entity_type: 'ticket',
          relationship_type: 'affected',
          created_by: 'user-1',
        }),
      },
    ]);
    expect(h.revalidatePath.mock.calls.map((c) => c[0])).toEqual(['/msp/tickets/ticket-1', '/msp/assets']);
  });

  it("falls back to the tenant's earliest user for created_by", async () => {
    h.firsts.users = { user_id: 'audit-user-1' };
    await createAndLinkDeliveredAsset(database(), 'tenant-1', {
      unit: { unit_id: 'unit-1', serial_number: 'SERIAL-99' } as any,
      serviceId: 'service-1', serviceName: 'Laptop', clientId: 'client-1',
      parentType: 'project', parentId: 'project-1',
    });
    expect(h.inserts[0].row).toMatchObject({ created_by: 'audit-user-1', entity_type: 'project' });
    expect(h.revalidatePath.mock.calls.map((c) => c[0])).toEqual(['/msp/projects/project-1', '/msp/assets']);
  });

  it('seeds the built-in extension payload from the product default metadata', async () => {
    h.firsts.product_inventory_settings = {
      default_asset_type: 'workstation',
      default_asset_metadata: { os_type: 'Windows', os_version: '11 Pro' },
    };
    await createAndLinkDeliveredAsset(database(), 'tenant-1', {
      unit: { unit_id: 'unit-1', serial_number: 'SERIAL-99' } as any,
      serviceId: 'service-1', serviceName: 'Laptop', clientId: 'client-1',
    });
    expect(h.createAsset.mock.calls[0][0].workstation).toEqual({
      os_type: 'Windows',
      os_version: '11 Pro',
      cpu_model: '',
      cpu_cores: null,
      ram_gb: null,
      storage_type: '',
      storage_capacity_gb: null,
      installed_software: [],
    });
  });
});

describe('detachDeliveredAssetAssociation', () => {
  beforeEach(() => {
    h.updates = [];
    h.deletes = [];
    h.firsts = {};
  });

  it("is a no-op when the unit never produced an asset", async () => {
    h.firsts.stock_units = { asset_id: null };
    await detachDeliveredAssetAssociation(database() as any, 'tenant-1', 'unit-1', 'ticket', 'ticket-1');
    expect(h.deletes).toHaveLength(0);
  });

  it("deletes the association rows for the unit's asset on the entity", async () => {
    h.firsts.stock_units = { asset_id: 'asset-9' };
    await detachDeliveredAssetAssociation(database() as any, 'tenant-1', 'unit-1', 'project', 'project-1');
    expect(h.deletes).toEqual([
      { table: 'asset_associations', where: { asset_id: 'asset-9', entity_id: 'project-1', entity_type: 'project' } },
    ]);
  });
});
