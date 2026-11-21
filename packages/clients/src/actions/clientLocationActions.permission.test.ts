import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => unknown) => callback({})),
  createLocation: vi.fn(),
  updatePermission: vi.fn(async () => false),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: () => mocks.createTenantKnex(),
  withTransaction: (knex: unknown, callback: (trx: unknown) => unknown) => mocks.withTransaction(knex, callback),
  tenantDb: vi.fn(),
}));
vi.mock('@alga-psa/auth', () => ({ withAuth: (action: Function) => (...args: any[]) => action({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/authHelpers', () => ({
  assertMspOrClientPortalOwnClientPermission: async (_user: unknown, _tenant: string, _clientId: string, _resource: string, action: string) => {
    if (action === 'update' && !await mocks.updatePermission()) throw new Error('Permission denied: Cannot update client locations');
  },
}));
vi.mock('../models/clientLocation', () => ({
  createLocation: (...args: any[]) => mocks.createLocation(...args),
  deleteLocation: vi.fn(),
  updateLocation: vi.fn(),
}));
vi.mock('@alga-psa/validation', () => ({
  clientLocationCoreFieldsSchema: {},
  isUnchangedFromStored: () => false,
  normalizePhone: (value: string) => ({ value }),
  parseSubmittedFields: (_schema: unknown, value: unknown) => ({ success: true, data: value }),
}));
vi.mock('../lib/structuralResult', () => ({ isStructuralFailure: () => false }));

import { createClientLocation } from './clientLocationActions';

describe('client location mutation authorization', () => {
  beforeEach(() => {
    mocks.createTenantKnex.mockClear();
    mocks.withTransaction.mockClear();
    mocks.createLocation.mockReset();
    mocks.updatePermission.mockReset().mockResolvedValue(false);
  });

  it('does not create a client location without client:update', async () => {
    const result = await createClientLocation('client-1', {
      location_name: 'Main office', address_line1: '1 Main St', address_line2: null,
      city: 'Seattle', state_province: 'WA', postal_code: '98101', country_code: 'US',
      phone: null, phone_extension: null, fax: null, fax_extension: null, email: null,
      is_default: false, is_active: true, notes: null, region_code: null,
    } as any);

    expect(result).toMatchObject({ permissionError: expect.stringContaining('Permission denied') });
    expect(mocks.createLocation).not.toHaveBeenCalled();
  });
});
