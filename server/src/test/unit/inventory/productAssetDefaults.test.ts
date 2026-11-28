import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  connect: vi.fn(),
  facade: vi.fn(),
  first: vi.fn(),
  update: vi.fn(),
  returning: vi.fn(),
  trx: { fn: { now: () => 'now' } },
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => action({}, { tenant: 'tenant-a' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.connect,
  tenantDb: mocks.facade,
  withTransaction: (_db: unknown, callback: (trx: object) => unknown) => callback(mocks.trx),
}));
vi.mock('@alga-psa/inventory/lib', () => ({ resolveTenantCurrency: vi.fn() }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (actionError: string) => ({ actionError }),
  permissionError: (permissionError: string) => ({ permissionError }),
}));

import { updateInventorySettings } from '@alga-psa/inventory/actions/productInventorySettingsActions';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.connect.mockResolvedValue({ knex: {} });
  mocks.first.mockResolvedValue({ default_asset_type: 'workstation', default_asset_metadata: { os_type: 'Windows' } });
  mocks.returning.mockResolvedValue([{ service_id: 'product-a' }]);
  const query = {
    where: vi.fn(() => query), forUpdate: vi.fn(() => query),
    first: mocks.first, update: mocks.update, returning: mocks.returning,
  };
  mocks.update.mockReturnValue(query);
  mocks.facade.mockReturnValue({ table: () => query });
});

describe('persisted product asset defaults', () => {
  it('uses the tenant facade and stores canonical dropdown, numeric and boolean values as JSONB', async () => {
    await updateInventorySettings('product-a', {
      default_asset_metadata: { os_type: 'Windows', storage_type: 'SSD', cpu_cores: '8', ram_gb: 32, gpu_model: 'RTX' },
    });
    expect(mocks.facade).toHaveBeenCalledWith(mocks.trx, 'tenant-a');
    expect(JSON.parse(mocks.update.mock.calls[0][0].default_asset_metadata)).toEqual({
      os_type: 'windows', storage_type: 'ssd', cpu_cores: 8, ram_gb: 32, gpu_model: 'RTX',
    });
    await updateInventorySettings('product-a', { default_asset_type: 'printer', default_asset_metadata: { supports_color: false } });
    expect(JSON.parse(mocks.update.mock.calls[1][0].default_asset_metadata)).toEqual({ supports_color: false });
  });

  it('persists the Model default for every built-in asset type', async () => {
    await updateInventorySettings('product-a', { default_asset_metadata: { model: ' OptiPlex 7020 ' } });
    expect(JSON.parse(mocks.update.mock.calls[0][0].default_asset_metadata)).toEqual({ model: 'OptiPlex 7020' });
    await updateInventorySettings('product-a', { default_asset_type: 'printer', default_asset_metadata: { model: 'M479' } });
    expect(JSON.parse(mocks.update.mock.calls[1][0].default_asset_metadata)).toEqual({ model: 'M479' });
  });

  it('clears incompatible defaults when the asset type changes without new metadata', async () => {
    await updateInventorySettings('product-a', { default_asset_type: 'network_device' });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ default_asset_metadata: null }));
  });

  it('rejects invalid numeric defaults before updating the database', async () => {
    await expect(updateInventorySettings('product-a', { default_asset_metadata: { cpu_cores: 'wrong' } }))
      .rejects.toThrow('workstation.cpu_cores');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('checks inventory update permission before accessing product defaults', async () => {
    mocks.permission.mockResolvedValue(false);
    expect(await updateInventorySettings('product-a', { default_asset_metadata: { ram_gb: 64 } }))
      .toHaveProperty('permissionError');
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
