import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosCreateMock = vi.fn();
const axiosPostMock = vi.fn();
const axiosIsAxiosErrorMock = vi.fn(() => false);

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
  getSecretProviderInstance: vi.fn(),
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
  getIntegrationTokenExpiringStatus: vi.fn(),
}));

describe('NinjaOneClient base URL', () => {
  beforeEach(() => {
    axiosCreateMock.mockReset();
    axiosPostMock.mockReset();
    axiosIsAxiosErrorMock.mockReset();
    axiosIsAxiosErrorMock.mockReturnValue(false);

    axiosCreateMock.mockReturnValue({
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      get: vi.fn(),
      post: vi.fn(),
    });
  });

  it('uses the documented /api/v2 prefix for regional instance URLs', async () => {
    const { NinjaOneClient } = await import('@ee/lib/integrations/ninjaone/ninjaOneClient');

    new NinjaOneClient({
      tenantId: 'tenant-raw-instance',
      instanceUrl: 'https://app.ninjarmm.com',
    });

    expect(axiosCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://app.ninjarmm.com/api/v2',
    }));
  });

  it('normalizes stored instance URLs that already include the API path', async () => {
    const { NinjaOneClient } = await import('@ee/lib/integrations/ninjaone/ninjaOneClient');

    new NinjaOneClient({
      tenantId: 'tenant-normalized-instance',
      instanceUrl: 'https://eu.ninjarmm.com/api/v2/',
    });

    expect(axiosCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://eu.ninjarmm.com/api/v2',
    }));
  });
});
