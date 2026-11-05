import { afterEach, expect, it, vi } from 'vitest';
import { CO_MANAGED_TENANT, clearWriteAdmissionCacheForTests, createFakeKnex, withReadOnlyWorkspace } from './fakeKnex';

const createAsset = vi.hoisted(() => vi.fn());
const consumption = vi.hoisted(() => vi.fn());
vi.mock('@alga-psa/assets/actions', () => ({ createAsset }));
vi.mock('@alga-psa/inventory/lib/consume', async (original) => ({
  ...(await original<object>()),
  recordStockConsumption: consumption,
}));

afterEach(() => {
  clearWriteAdmissionCacheForTests();
  vi.clearAllMocks();
});

it.each(['ticket', 'project'] as const)('refuses %s material additions and removals before stock writes', async (parentType) => {
  const fake = createFakeKnex();
  const { addMaterial, deleteMaterial } = await import('@alga-psa/inventory/lib/materials');
  await withReadOnlyWorkspace(async () => {
    await expect(addMaterial(fake.knex, CO_MANAGED_TENANT, {
      parent_type: parentType, parent_id: 'p', service_id: 's', quantity: 1, rate: 1,
    }, null)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    await expect(deleteMaterial(fake.knex, CO_MANAGED_TENANT, parentType, 'm', null))
      .rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    expect(fake.writes()).toEqual([]);
  });
  await fake.destroy();
});

it('reports an action-error result from post-commit asset creation instead of treating it as a missing asset', async () => {
  const fake = createFakeKnex();
  createAsset.mockResolvedValue({ actionError: 'Workspace is read only', messageKey: 'common:errors.coManaged.readOnly' });
  const { createAndLinkDeliveredAsset } = await import('@alga-psa/inventory/lib/assetLink');
  await expect(createAndLinkDeliveredAsset(fake.knex, CO_MANAGED_TENANT, {
    unit: { unit_id: 'u' } as any, clientId: 'c', serviceId: 's', serviceName: 'Product',
  })).rejects.toMatchObject({ message: 'Workspace is read only', messageKey: 'common:errors.coManaged.readOnly' });
  expect(fake.writes()).toEqual([]);
  await fake.destroy();
});

it('returns the committed material when the later asset action returns a refusal', async () => {
  const material = { ticket_material_id: 'm', service_id: 's', quantity: 1 };
  const fake = createFakeKnex((sql) => {
    if (/insert into "ticket_materials"/.test(sql)) return [material];
    if (/from "tickets"/.test(sql)) return [{ client_id: 'c' }];
    if (/from "service_catalog"/.test(sql)) return [{ service_id: 's' }];
    return undefined;
  });
  consumption.mockResolvedValue({ consumed: false, pending_asset_link: {
    unit: { unit_id: 'u' }, clientId: 'c', serviceId: 's', serviceName: 'Product',
  } });
  createAsset.mockResolvedValue({ actionError: 'Workspace is read only', messageKey: 'common:errors.coManaged.readOnly' });
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const { addMaterial } = await import('@alga-psa/inventory/lib/materials');
    await expect(addMaterial(fake.knex, CO_MANAGED_TENANT, {
      parent_type: 'ticket', parent_id: 'p', service_id: 's', quantity: 1, rate: 1, currency_code: 'USD',
    }, null)).resolves.toEqual(material);
    expect(fake.statements.some((sql) => /^commit/i.test(sql))).toBe(true);
    expect(log).toHaveBeenCalled();
  } finally {
    log.mockRestore();
    await fake.destroy();
  }
});
