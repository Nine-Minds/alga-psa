import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockTenantContext: string | null = null;
let allowTenantKnex = false;
let tenantSettingsRow: any = null;

const knexWhereMock = vi.fn();
const knexFromMock = vi.fn();
const knexSelectMock = vi.fn();
const createTenantKnexMock = vi.fn();

vi.mock('next/headers.js', () => ({
  headers: async () => new Headers(),
}));

vi.mock('@alga-psa/db', () => ({
  getTenantContext: () => mockTenantContext,
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(),
  getCurrentUserPermissions: vi.fn(),
}));

describe('tenantSettingsActions.getExperimentalFeatures', () => {
  beforeEach(() => {
    mockTenantContext = null;
    allowTenantKnex = false;
    tenantSettingsRow = null;

    knexWhereMock.mockReset();
    knexFromMock.mockReset();
    knexSelectMock.mockReset();
    createTenantKnexMock.mockReset();

    knexWhereMock.mockImplementation(() => ({
      first: vi.fn(async () => tenantSettingsRow),
    }));

    knexFromMock.mockImplementation(() => ({
      where: knexWhereMock,
    }));

    knexSelectMock.mockImplementation(() => ({
      from: knexFromMock,
    }));

    createTenantKnexMock.mockImplementation(async () => {
      if (!allowTenantKnex) {
        throw new Error(
          'createTenantKnex should not be called when tenant is unresolved'
        );
      }

      return {
        knex: {
          select: knexSelectMock,
        },
      };
    });
  });

  it('returns defaults when tenant settings are unavailable', async () => {
    const { getExperimentalFeatures } = await import(
      '../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'
    );

    await expect(getExperimentalFeatures()).resolves.toEqual({ aiAssistant: false });
  });

  it('returns saved experimental features from tenant_settings', async () => {
    mockTenantContext = 'tenant-test';
    allowTenantKnex = true;
    tenantSettingsRow = {
      settings: {
        experimentalFeatures: {
          aiAssistant: true,
        },
      },
    };

    const { getExperimentalFeatures } = await import(
      '../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'
    );

    await expect(getExperimentalFeatures()).resolves.toEqual({ aiAssistant: true });
    expect(knexWhereMock).toHaveBeenCalledWith({ tenant: 'tenant-test' });
  });
});
