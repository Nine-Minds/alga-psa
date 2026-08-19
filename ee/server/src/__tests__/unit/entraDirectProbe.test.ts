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

// managedTenants is a beta-only Graph API: v1.0 has no such segment and
// answers 400, which is the bug this pin guards against regressing.
const MANAGED_TENANTS_URL =
  'https://graph.microsoft.com/beta/tenantRelationships/managedTenants/tenants?$top=1';

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

  it('follows MICROSOFT_GRAPH_BETA_BASE_URL, so the emulator can be probed like Graph', async () => {
    const originalBetaBaseUrl = process.env.MICROSOFT_GRAPH_BETA_BASE_URL;
    process.env.MICROSOFT_GRAPH_BETA_BASE_URL = 'http://127.0.0.1:4010/beta';
    axiosGetMock.mockResolvedValue({ data: { value: [{ tenantId: 'a' }] } });

    try {
      const { probeEntraDirectAccess } = await import(
        '@ee/lib/integrations/entra/providers/direct/directProbe'
      );
      const result = await probeEntraDirectAccess('token-1');

      expect(result).toMatchObject({
        valid: true,
        endpoint: 'http://127.0.0.1:4010/beta/tenantRelationships/managedTenants/tenants?$top=1',
      });
    } finally {
      if (originalBetaBaseUrl === undefined) {
        delete process.env.MICROSOFT_GRAPH_BETA_BASE_URL;
      } else {
        process.env.MICROSOFT_GRAPH_BETA_BASE_URL = originalBetaBaseUrl;
      }
    }
  });

  it('ignores MICROSOFT_GRAPH_BASE_URL: the v1.0 emulator hook must not drag managedTenants back to v1.0', async () => {
    const originalBaseUrl = process.env.MICROSOFT_GRAPH_BASE_URL;
    process.env.MICROSOFT_GRAPH_BASE_URL = 'http://127.0.0.1:4010/v1.0';
    axiosGetMock.mockResolvedValue({ data: { value: [{ tenantId: 'a' }] } });

    try {
      const { probeEntraDirectAccess } = await import(
        '@ee/lib/integrations/entra/providers/direct/directProbe'
      );
      const result = await probeEntraDirectAccess('token-1');

      expect(result).toMatchObject({ valid: true, endpoint: MANAGED_TENANTS_URL });
    } finally {
      if (originalBaseUrl === undefined) {
        delete process.env.MICROSOFT_GRAPH_BASE_URL;
      } else {
        process.env.MICROSOFT_GRAPH_BASE_URL = originalBaseUrl;
      }
    }
  });

  it('carries Graph\'s error code and message as detail, so logs name the refusal', async () => {
    const { probeEntraDirectAccess } = await import(
      '@ee/lib/integrations/entra/providers/direct/directProbe'
    );

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

    await expect(probeEntraDirectAccess('token-1')).resolves.toMatchObject({
      valid: false,
      code: 'validation_failed',
      status: 400,
      detail: "BadRequest: Resource not found for the segment 'managedTenants'.",
    });
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
