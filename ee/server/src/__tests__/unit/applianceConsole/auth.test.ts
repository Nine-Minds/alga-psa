import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateApiKeyAnyTenant: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: mocks.validateApiKeyAnyTenant,
  },
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

function requestWithHeaders(headers: Record<string, string>) {
  return {
    headers: new Headers(headers),
  } as never;
}

describe('assertMasterTenantAccess', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('MASTER_BILLING_TENANT_ID', 'master-tenant');
  });

  it('rejects an invalid API key without falling back to session authentication', async () => {
    mocks.validateApiKeyAnyTenant.mockResolvedValue(null);
    mocks.getCurrentUser.mockResolvedValue({
      tenant: 'master-tenant',
      user_id: 'victim-master-user',
      email: 'victim@example.test',
    });

    const { assertMasterTenantAccess } = await import('@ee/lib/applianceConsole/auth');

    await expect(assertMasterTenantAccess(requestWithHeaders({ 'x-api-key': 'junk' }))).rejects.toThrow(
      'Invalid API key',
    );
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });

  it('continues to allow session authentication when no API key is present', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      tenant: 'master-tenant',
      user_id: 'master-user',
      email: 'master@example.test',
    });

    const { assertMasterTenantAccess } = await import('@ee/lib/applianceConsole/auth');

    await expect(assertMasterTenantAccess(requestWithHeaders({}))).resolves.toEqual({
      tenantId: 'master-tenant',
      userId: 'master-user',
      userEmail: 'master@example.test',
    });
  });
});
