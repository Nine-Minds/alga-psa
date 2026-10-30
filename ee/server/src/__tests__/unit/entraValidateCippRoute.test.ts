import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireEntraAccessMock = vi.fn();
const getEntraCippCredentialsMock = vi.fn();
const updateEntraConnectionValidationMock = vi.fn();
const axiosGetMock = vi.fn();

vi.mock('@ee/app/api/integrations/entra/_guards', () => ({
  requireEntraAccess: requireEntraAccessMock,
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

import type { CippFetch } from '@ee/lib/integrations/entra/providers/cipp/cippTokenService';

describe('validate-cipp route', () => {
  beforeEach(() => {
    vi.resetModules();
    requireEntraAccessMock.mockReset();
    getEntraCippCredentialsMock.mockReset();
    updateEntraConnectionValidationMock.mockReset();
    axiosGetMock.mockReset();
  });

  it('T039: succeeds with valid CIPP token and tenant endpoint response', async () => {
    requireEntraAccessMock.mockResolvedValue({
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

  const API_CLIENT = {
    authType: 'api_client',
    baseUrl: 'https://cipp.example.com',
    clientId: 'client-1',
    clientSecret: 'route-secret-VALUE',
    directoryId: 'dir-1',
  };

  // Import after vi.resetModules() so the stub lands in the same module graph
  // the route will load.
  async function stubMint(body: unknown, ok = true, status = 200) {
    const { CippTokenService, setCippTokenServiceForTests } = await import(
      '@ee/lib/integrations/entra/providers/cipp/cippTokenService'
    );
    const fetch = vi.fn(async () => ({ ok, status, text: async () => JSON.stringify(body) }));
    setCippTokenServiceForTests(new CippTokenService({ fetch: fetch as unknown as CippFetch }));
    return fetch;
  }

  it('validates an API-client credential with a minted Bearer token and no X-API-KEY', async () => {
    requireEntraAccessMock.mockResolvedValue({ tenantId: 'tenant-ac', userId: 'user-ac' });
    getEntraCippCredentialsMock.mockResolvedValue(API_CLIENT);
    await stubMint({ access_token: 'route-minted-token', expires_in: 3600 });
    axiosGetMock.mockResolvedValue({ data: [{ id: 't1' }], headers: {} });

    const { POST } = await import('@ee/app/api/integrations/entra/validate-cipp/route');
    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({ valid: true, tenantCountSample: 1 });
    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://cipp.example.com/api/listtenants',
      expect.objectContaining({ headers: { Authorization: 'Bearer route-minted-token' } })
    );
    expect(JSON.stringify(payload)).not.toContain('route-secret-VALUE');
  });

  it('records a failed token mint as validation_failed with the actionable message', async () => {
    requireEntraAccessMock.mockResolvedValue({ tenantId: 'tenant-ac', userId: 'user-ac' });
    getEntraCippCredentialsMock.mockResolvedValue(API_CLIENT);
    await stubMint({ error: 'invalid_client', error_description: 'AADSTS7000215: bad', error_codes: [7000215] }, false, 401);

    const { POST } = await import('@ee/app/api/integrations/entra/validate-cipp/route');
    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(JSON.stringify(payload)).toMatch(/secret ID instead of its Value/);
    expect(JSON.stringify(payload)).not.toContain('route-secret-VALUE');
    expect(axiosGetMock).not.toHaveBeenCalled();
    expect(updateEntraConnectionValidationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'validation_failed',
        snapshot: expect.objectContaining({ code: 'token_mint_failed' }),
      })
    );
  });

  it('keeps a legacy credential row (no authType) validating with both headers', async () => {
    requireEntraAccessMock.mockResolvedValue({ tenantId: 'tenant-lg', userId: 'user-lg' });
    getEntraCippCredentialsMock.mockResolvedValue({ baseUrl: 'https://cipp.example.com', apiToken: 'old-key' });
    axiosGetMock.mockResolvedValue({ data: [{ id: 't1' }] });

    const { POST } = await import('@ee/app/api/integrations/entra/validate-cipp/route');
    expect((await POST()).status).toBe(200);
    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://cipp.example.com/api/listtenants',
      expect.objectContaining({ headers: { Authorization: 'Bearer old-key', 'X-API-KEY': 'old-key' } })
    );
  });
});
