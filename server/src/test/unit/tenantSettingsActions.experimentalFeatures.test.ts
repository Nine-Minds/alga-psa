import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers.js', () => ({
  headers: async () => new Headers(),
}));

vi.mock('@alga-psa/db', () => ({
  getTenantContext: () => null,
  createTenantKnex: async () => {
    throw new Error('createTenantKnex should not be called when tenant is unresolved');
  },
}));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(),
  getCurrentUserPermissions: vi.fn(),
}));

describe('tenantSettingsActions.getExperimentalFeatures', () => {
  it('returns defaults when tenant settings are unavailable', async () => {
    const { getExperimentalFeatures } = await import(
      '../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'
    );

    await expect(getExperimentalFeatures()).resolves.toEqual({ aiAssistant: false });
  });
});

