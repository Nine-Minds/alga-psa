import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosCreateMock = vi.fn();
const axiosPostMock = vi.fn();
const axiosIsAxiosErrorMock = vi.fn(() => false);
const setTenantSecretMock = vi.fn();
const scheduleNinjaOneProactiveRefreshMock = vi.fn();

vi.mock('axios', () => ({
  default: {
    create: axiosCreateMock,
    post: axiosPostMock,
    isAxiosError: axiosIsAxiosErrorMock,
  },
  create: axiosCreateMock,
  post: axiosPostMock,
  isAxiosError: axiosIsAxiosErrorMock,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: vi.fn(async (_tenantId: string, key: string) => {
      if (key === 'ninjaone_client_id') {
        return 'client-id';
      }
      if (key === 'ninjaone_client_secret') {
        return 'client-secret';
      }
      return undefined;
    }),
    getAppSecret: vi.fn(async () => undefined),
    setTenantSecret: setTenantSecretMock,
  })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildIntegrationTokenExpiringPayload: vi.fn(),
  buildIntegrationTokenRefreshFailedPayload: vi.fn(),
  getIntegrationTokenExpiringStatus: vi.fn(() => ({ shouldNotify: false, daysUntilExpiry: 0 })),
}));

vi.mock('@ee/lib/integrations/ninjaone/proactiveRefresh', () => ({
  scheduleNinjaOneProactiveRefresh: scheduleNinjaOneProactiveRefreshMock,
}));

describe('NinjaOneClient lazy refresh schedule handoff', () => {
  beforeEach(() => {
    axiosCreateMock.mockReset();
    axiosPostMock.mockReset();
    axiosIsAxiosErrorMock.mockReset();
    setTenantSecretMock.mockReset();
    scheduleNinjaOneProactiveRefreshMock.mockReset();

    axiosIsAxiosErrorMock.mockReturnValue(false);
    axiosCreateMock.mockReturnValue({
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      get: vi.fn(),
      post: vi.fn(),
    });
    axiosPostMock.mockResolvedValue({
      data: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      },
    });
  });

  it('reschedules proactive refresh after successful lazy refresh', async () => {
    const { NinjaOneClient } = await import('@ee/lib/integrations/ninjaone/ninjaOneClient');

    const client = new NinjaOneClient({
      tenantId: 'tenant-1',
      instanceUrl: 'https://ca.ninjarmm.com',
      workflowContext: {
        integrationId: 'integration-1',
        connectionId: 'integration-1',
        provider: 'ninjaone',
      },
    });

    (client as any).credentials = {
      access_token: 'old-access-token',
      refresh_token: 'old-refresh-token',
      expires_at: Date.now() - 1000,
      instance_url: 'https://ca.ninjarmm.com',
    };

    await (client as any).refreshAccessToken();

    expect(setTenantSecretMock).toHaveBeenCalledTimes(1);
    expect(scheduleNinjaOneProactiveRefreshMock).toHaveBeenCalledTimes(1);
    expect(scheduleNinjaOneProactiveRefreshMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        integrationId: 'integration-1',
        source: 'lazy_refresh_success',
      })
    );
  });
});
