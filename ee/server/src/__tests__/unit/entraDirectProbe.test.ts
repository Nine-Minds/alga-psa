import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const axiosGetMock = vi.fn();

vi.mock('axios', () => ({
  default: {
    get: axiosGetMock,
    isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
  },
  get: axiosGetMock,
  isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
}));

const MANAGED_TENANTS_URL =
  'https://graph.microsoft.com/v1.0/tenantRelationships/managedTenants/tenants?$top=1';

describe('probeEntraDirectAccess', () => {
  const originalSmokeMode = process.env.ENTRA_DIRECT_SMOKE_SELF_TENANT_MODE;

  beforeEach(() => {
    vi.resetModules();
    axiosGetMock.mockReset();
    delete process.env.ENTRA_DIRECT_SMOKE_SELF_TENANT_MODE;
  });

  afterEach(() => {
    if (originalSmokeMode === undefined) {
      delete process.env.ENTRA_DIRECT_SMOKE_SELF_TENANT_MODE;
    } else {
      process.env.ENTRA_DIRECT_SMOKE_SELF_TENANT_MODE = originalSmokeMode;
    }
  });

  it('reports the managed tenant sample and writes nothing', async () => {
    axiosGetMock.mockResolvedValue({ data: { value: [{ tenantId: 'a' }, { tenantId: 'b' }] } });

    const { probeEntraDirectAccess } = await import(
      '@ee/lib/integrations/entra/providers/direct/directProbe'
    );
    const result = await probeEntraDirectAccess('token-1');

    expect(result).toMatchObject({
      valid: true,
      managedTenantSampleCount: 2,
      endpoint: MANAGED_TENANTS_URL,
    });
    expect(axiosGetMock).toHaveBeenCalledWith(
      MANAGED_TENANTS_URL,
      expect.objectContaining({ headers: { Authorization: 'Bearer token-1' } })
    );
  });

  it('separates a rejected token from missing admin consent', async () => {
    const { probeEntraDirectAccess } = await import(
      '@ee/lib/integrations/entra/providers/direct/directProbe'
    );

    axiosGetMock.mockRejectedValue({ isAxiosError: true, response: { status: 401 } });
    await expect(probeEntraDirectAccess('token-1')).resolves.toMatchObject({
      valid: false,
      code: 'auth_rejected',
      status: 401,
    });

    axiosGetMock.mockRejectedValue({ isAxiosError: true, response: { status: 403 } });
    await expect(probeEntraDirectAccess('token-1')).resolves.toMatchObject({
      valid: false,
      code: 'consent_missing',
      status: 403,
    });

    axiosGetMock.mockRejectedValue(new Error('socket hang up'));
    await expect(probeEntraDirectAccess('token-1')).resolves.toMatchObject({
      valid: false,
      code: 'validation_failed',
    });
  });

  it('follows MICROSOFT_GRAPH_BASE_URL, so the emulator can be probed like Graph', async () => {
    const originalBaseUrl = process.env.MICROSOFT_GRAPH_BASE_URL;
    process.env.MICROSOFT_GRAPH_BASE_URL = 'http://127.0.0.1:4010/v1.0';
    axiosGetMock.mockResolvedValue({ data: { value: [{ tenantId: 'a' }] } });

    try {
      const { probeEntraDirectAccess } = await import(
        '@ee/lib/integrations/entra/providers/direct/directProbe'
      );
      const result = await probeEntraDirectAccess('token-1');

      expect(result).toMatchObject({
        valid: true,
        endpoint: 'http://127.0.0.1:4010/v1.0/tenantRelationships/managedTenants/tenants?$top=1',
      });
    } finally {
      if (originalBaseUrl === undefined) {
        delete process.env.MICROSOFT_GRAPH_BASE_URL;
      } else {
        process.env.MICROSOFT_GRAPH_BASE_URL = originalBaseUrl;
      }
    }
  });

  it('probes the endpoint the adapter actually uses in self-tenant smoke mode', async () => {
    process.env.ENTRA_DIRECT_SMOKE_SELF_TENANT_MODE = 'true';
    axiosGetMock.mockResolvedValue({ data: { value: [{ id: 'org-1' }] } });

    const { probeEntraDirectAccess } = await import(
      '@ee/lib/integrations/entra/providers/direct/directProbe'
    );
    const result = await probeEntraDirectAccess('token-1');

    expect(result).toMatchObject({ valid: true });
    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/organization?$top=1',
      expect.anything()
    );
  });
});
