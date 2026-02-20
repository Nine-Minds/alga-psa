import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireEntraUiFlagEnabledMock = vi.fn();
const getEntraCippCredentialsMock = vi.fn();
const updateEntraConnectionValidationMock = vi.fn();
const axiosGetMock = vi.fn();

vi.mock('@ee/app/api/integrations/entra/_guards', () => ({
  requireEntraUiFlagEnabled: requireEntraUiFlagEnabledMock,
}));

vi.mock('@ee/lib/integrations/entra/providers/cipp/cippSecretStore', () => ({
  getEntraCippCredentials: getEntraCippCredentialsMock,
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

describe('validate-cipp route', () => {
  beforeEach(() => {
    vi.resetModules();
    requireEntraUiFlagEnabledMock.mockReset();
    getEntraCippCredentialsMock.mockReset();
    updateEntraConnectionValidationMock.mockReset();
    axiosGetMock.mockReset();
  });

  it('T039: succeeds with valid CIPP token and tenant endpoint response', async () => {
    requireEntraUiFlagEnabledMock.mockResolvedValue({
      tenantId: 'tenant-39',
      userId: 'user-39',
    });
    getEntraCippCredentialsMock.mockResolvedValue({
      baseUrl: 'https://cipp.example.com',
      apiToken: 'cipp-token-39',
    });
    axiosGetMock.mockResolvedValue({
      data: {
        tenants: [{ id: 't1' }, { id: 't2' }],
      },
    });

    const { POST } = await import('@ee/app/api/integrations/entra/validate-cipp/route');
    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toMatchObject({
      valid: true,
      tenantCountSample: 2,
      endpoint: 'https://cipp.example.com/api/listtenants',
    });

    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://cipp.example.com/api/listtenants',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer cipp-token-39',
          'X-API-KEY': 'cipp-token-39',
        },
      })
    );
    expect(updateEntraConnectionValidationMock).toHaveBeenCalledWith({
      tenant: 'tenant-39',
      connectionType: 'cipp',
      status: 'connected',
      snapshot: null,
    });
  });
});
