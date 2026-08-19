import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireEntraAccessMock = vi.fn();
const resolveMicrosoftCredentialsForTenantMock = vi.fn();
const getSecretProviderInstanceMock = vi.fn();
const refreshEntraDirectTokenMock = vi.fn();
const updateEntraConnectionValidationMock = vi.fn();
const axiosGetMock = vi.fn();

vi.mock('@ee/app/api/integrations/entra/_guards', () => ({
  requireEntraAccess: requireEntraAccessMock,
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
    requireEntraAccessMock.mockReset();
    resolveMicrosoftCredentialsForTenantMock.mockReset();
    getSecretProviderInstanceMock.mockReset();
    refreshEntraDirectTokenMock.mockReset();
    updateEntraConnectionValidationMock.mockReset();
    axiosGetMock.mockReset();
  });

  it('T038: succeeds with valid credentials and reachable managed-tenant list', async () => {
    requireEntraAccessMock.mockResolvedValue({
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
      'https://graph.microsoft.com/beta/tenantRelationships/managedTenants/tenants?$top=1',
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

  it('persists validation_failed with the Graph detail and answers 502 when the probe fails', async () => {
    requireEntraAccessMock.mockResolvedValue({
      tenantId: 'tenant-39',
      userId: 'user-39',
    });
    resolveMicrosoftCredentialsForTenantMock.mockResolvedValue({
      clientId: 'client-id-39',
      clientSecret: 'client-secret-39',
      tenantId: null,
      source: 'tenant-secret',
    });

    const getTenantSecretMock = vi
      .fn()
      .mockResolvedValueOnce('access-token-39')
      .mockResolvedValueOnce(new Date(Date.now() + 3600_000).toISOString());
    getSecretProviderInstanceMock.mockResolvedValue({
      getTenantSecret: getTenantSecretMock,
    });

    // The exact production failure: a non-401/403 Graph refusal of the
    // managed-tenant list. It must be recorded on the connection and surfaced
    // as 502 — not swallowed, and not misfiled as a consent problem.
    axiosGetMock.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          error: {
            code: 'BadRequest',
            message: "Resource not found for the segment 'managedTenants'.",
          },
        },
      },
    });

    const { POST } = await import('@ee/app/api/integrations/entra/validate-direct/route');
    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.success).toBe(false);

    expect(updateEntraConnectionValidationMock).toHaveBeenCalledWith({
      tenant: 'tenant-39',
      connectionType: 'direct',
      status: 'validation_failed',
      snapshot: expect.objectContaining({
        code: 'upstream_error',
        details: { graph: "BadRequest: Resource not found for the segment 'managedTenants'." },
      }),
    });
    expect(refreshEntraDirectTokenMock).not.toHaveBeenCalled();
  });
});
