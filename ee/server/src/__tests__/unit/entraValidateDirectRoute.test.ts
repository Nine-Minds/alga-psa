import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireEntraUiFlagEnabledMock = vi.fn();
const resolveMicrosoftCredentialsForTenantMock = vi.fn();
const getSecretProviderInstanceMock = vi.fn();
const refreshEntraDirectTokenMock = vi.fn();
const updateEntraConnectionValidationMock = vi.fn();
const axiosGetMock = vi.fn();

vi.mock('@ee/app/api/integrations/entra/_guards', () => ({
  requireEntraUiFlagEnabled: requireEntraUiFlagEnabledMock,
}));

vi.mock('@ee/lib/integrations/entra/auth/microsoftCredentialResolver', () => ({
  resolveMicrosoftCredentialsForTenant: resolveMicrosoftCredentialsForTenantMock,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: getSecretProviderInstanceMock,
}));

vi.mock('@ee/lib/integrations/entra/auth/refreshDirectToken', () => ({
  refreshEntraDirectToken: refreshEntraDirectTokenMock,
}));

vi.mock('@ee/lib/integrations/entra/connectionRepository', () => ({
  updateEntraConnectionValidation: updateEntraConnectionValidationMock,
}));

vi.mock('axios', () => ({
  default: {
    get: axiosGetMock,
    isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
  },
  get: axiosGetMock,
  isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
}));

describe('validate-direct route', () => {
  beforeEach(() => {
    vi.resetModules();
    requireEntraUiFlagEnabledMock.mockReset();
    resolveMicrosoftCredentialsForTenantMock.mockReset();
    getSecretProviderInstanceMock.mockReset();
    refreshEntraDirectTokenMock.mockReset();
    updateEntraConnectionValidationMock.mockReset();
    axiosGetMock.mockReset();
  });

  it('T038: succeeds with valid credentials and reachable managed-tenant list', async () => {
    requireEntraUiFlagEnabledMock.mockResolvedValue({
      tenantId: 'tenant-38',
      userId: 'user-38',
    });
    resolveMicrosoftCredentialsForTenantMock.mockResolvedValue({
      clientId: 'client-id-38',
      clientSecret: 'client-secret-38',
      tenantId: null,
      source: 'tenant-secret',
    });

    const getTenantSecretMock = vi
      .fn()
      .mockResolvedValueOnce('access-token-38')
      .mockResolvedValueOnce(new Date(Date.now() + 3600_000).toISOString());
    getSecretProviderInstanceMock.mockResolvedValue({
      getTenantSecret: getTenantSecretMock,
    });

    axiosGetMock.mockResolvedValue({
      data: {
        value: [{ tenantId: 'managed-1' }],
      },
    });

    const { POST } = await import('@ee/app/api/integrations/entra/validate-direct/route');
    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toMatchObject({
      valid: true,
      managedTenantSampleCount: 1,
    });

    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/tenantRelationships/managedTenants/tenants?$top=1',
      expect.objectContaining({
        headers: { Authorization: 'Bearer access-token-38' },
      })
    );
    expect(updateEntraConnectionValidationMock).toHaveBeenCalledWith({
      tenant: 'tenant-38',
      connectionType: 'direct',
      status: 'connected',
      snapshot: null,
    });
    expect(refreshEntraDirectTokenMock).not.toHaveBeenCalled();
  });
});
