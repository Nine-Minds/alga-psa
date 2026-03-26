import { beforeEach, describe, expect, it, vi } from 'vitest';

type IntegrationRow = {
  tenant: string;
  integration_id: string;
  provider: 'ninjaone';
  is_active: boolean;
  settings: string;
};

const state = {
  integration: {
    tenant: 'tenant-1',
    integration_id: 'integration-1',
    provider: 'ninjaone' as const,
    is_active: true,
    settings: JSON.stringify({
      tokenLifecycle: {
        scheduleNonce: 1,
        activeWorkflowId: 'ninjaone:token-refresh:tenant-1:integration-1:1',
      },
    }),
  } as IntegrationRow,
  secrets: {
    ninjaone_credentials: JSON.stringify({
      access_token: 'old-access',
      refresh_token: 'latest-refresh-token',
      expires_at: Date.now() + 30 * 60 * 1000,
      instance_url: 'https://ca.ninjarmm.com',
    }),
    ninjaone_client_id: 'client-id',
    ninjaone_client_secret: 'client-secret',
  } as Record<string, string | undefined>,
};

const axiosPostMock = vi.fn();
const workflowStartMock = vi.fn();
const terminateMock = vi.fn();
const getHandleMock = vi.fn(() => ({ terminate: terminateMock }));
const connectMock = vi.fn(async () => ({}));
const publishWorkflowEventMock = vi.fn(async () => undefined);

vi.mock('axios', () => ({
  default: {
    post: axiosPostMock,
    isAxiosError: (error: unknown) => Boolean((error as any)?.isAxiosError),
  },
  post: axiosPostMock,
  isAxiosError: (error: unknown) => Boolean((error as any)?.isAxiosError),
}));

vi.mock('@temporalio/client', () => ({
  Connection: {
    connect: connectMock,
  },
  Client: vi.fn(() => ({
    workflow: {
      start: workflowStartMock,
      getHandle: getHandleMock,
    },
  })),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: async (_tenantId: string, key: string) => state.secrets[key],
    setTenantSecret: async (_tenantId: string, key: string, value: string) => {
      state.secrets[key] = value;
    },
    getAppSecret: async () => undefined,
  })),
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<unknown>) => fn()),
  createTenantKnex: vi.fn(async () => {
    const builder = {
      where: vi.fn(() => builder),
      select: vi.fn(() => builder),
      first: vi.fn(async () => state.integration),
      update: vi.fn(async (payload: { settings?: string }) => {
        if (payload.settings) {
          state.integration.settings = payload.settings;
        }
        return 1;
      }),
    };

    const knex = vi.fn(() => builder) as unknown as ((table: string) => typeof builder) & {
      fn: { now: () => Date };
    };
    knex.fn = { now: () => new Date() };

    return { knex, tenant: state.integration.tenant };
  }),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: publishWorkflowEventMock,
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildIntegrationTokenRefreshFailedPayload: vi.fn((payload: unknown) => payload),
}));

describe('executeNinjaOneProactiveRefresh', () => {
  beforeEach(() => {
    state.integration = {
      tenant: 'tenant-1',
      integration_id: 'integration-1',
      provider: 'ninjaone',
      is_active: true,
      settings: JSON.stringify({
        tokenLifecycle: {
          scheduleNonce: 1,
          activeWorkflowId: 'ninjaone:token-refresh:tenant-1:integration-1:1',
        },
      }),
    };

    state.secrets = {
      ninjaone_credentials: JSON.stringify({
        access_token: 'old-access',
        refresh_token: 'latest-refresh-token',
        expires_at: Date.now() + 30 * 60 * 1000,
        instance_url: 'https://ca.ninjarmm.com',
      }),
      ninjaone_client_id: 'client-id',
      ninjaone_client_secret: 'client-secret',
    };

    axiosPostMock.mockReset();
    workflowStartMock.mockReset();
    terminateMock.mockReset();
    getHandleMock.mockClear();
    connectMock.mockClear();
    publishWorkflowEventMock.mockReset();
  });

  it('reloads latest stored credentials at execution time and persists rotated credentials on success', async () => {
    axiosPostMock.mockResolvedValue({
      data: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      },
    });

    const { executeNinjaOneProactiveRefresh } = await import(
      '@/lib/integrations/ninjaone/proactiveRefresh'
    );

    const result = await executeNinjaOneProactiveRefresh({
      tenantId: 'tenant-1',
      integrationId: 'integration-1',
      scheduleNonce: 1,
      scheduledFor: new Date().toISOString(),
    });

    expect(result.outcome).toBe('success');

    const refreshBody = String(axiosPostMock.mock.calls[0]?.[1] || '');
    expect(refreshBody).toContain('refresh_token=latest-refresh-token');

    const savedCredentials = JSON.parse(String(state.secrets.ninjaone_credentials));
    expect(savedCredentials.access_token).toBe('new-access');
    expect(savedCredentials.refresh_token).toBe('new-refresh');
    expect(savedCredentials.expires_at).toBeGreaterThan(Date.now());

    // Successful proactive refresh should immediately seed the next delayed run.
    expect(workflowStartMock).toHaveBeenCalledTimes(1);
    expect(getHandleMock).toHaveBeenCalledTimes(1);
    expect(terminateMock).toHaveBeenCalledTimes(1);

    const lifecycle = (JSON.parse(state.integration.settings) as { tokenLifecycle: any }).tokenLifecycle;
    expect(lifecycle.scheduleNonce).toBe(2);
    expect(typeof lifecycle.activeWorkflowId).toBe('string');
    expect(lifecycle.activeWorkflowId).toContain(':2');
    expect(state.integration.settings).not.toContain('new-access');
    expect(state.integration.settings).not.toContain('new-refresh');
  });

  it('marks reconnect-required and does not schedule next refresh on terminal invalid_token errors', async () => {
    const axiosError = {
      isAxiosError: true,
      message: 'Request failed',
      response: { status: 400, data: { error: 'invalid_token' } },
      code: 'ERR_BAD_REQUEST',
    };
    axiosPostMock.mockRejectedValue(axiosError);

    const { executeNinjaOneProactiveRefresh } = await import(
      '@/lib/integrations/ninjaone/proactiveRefresh'
    );

    const result = await executeNinjaOneProactiveRefresh({
      tenantId: 'tenant-1',
      integrationId: 'integration-1',
      scheduleNonce: 1,
      scheduledFor: new Date().toISOString(),
    });

    expect(result.outcome).toBe('reconnect_required');
    expect(workflowStartMock).not.toHaveBeenCalled();

    const lifecycle = (JSON.parse(state.integration.settings) as { tokenLifecycle: any }).tokenLifecycle;
    expect(lifecycle.reconnectRequired).toBe(true);
    expect(lifecycle.status).toBe('reconnect_required');
    expect(publishWorkflowEventMock).toHaveBeenCalledTimes(1);
    expect(String(JSON.stringify(publishWorkflowEventMock.mock.calls[0]?.[0] || {}))).toContain(
      'INTEGRATION_TOKEN_REFRESH_FAILED'
    );
  });

  it('marks missing credentials as unschedulable and avoids reschedule loops', async () => {
    state.secrets.ninjaone_credentials = undefined;
    const { executeNinjaOneProactiveRefresh } = await import(
      '@/lib/integrations/ninjaone/proactiveRefresh'
    );

    const result = await executeNinjaOneProactiveRefresh({
      tenantId: 'tenant-1',
      integrationId: 'integration-1',
      scheduleNonce: 1,
      scheduledFor: new Date().toISOString(),
    });

    expect(result.outcome).toBe('unschedulable');
    expect(workflowStartMock).not.toHaveBeenCalled();

    const serializedSettings = state.integration.settings;
    expect(serializedSettings).not.toContain('access_token');
    expect(serializedSettings).not.toContain('refresh_token');
    expect(serializedSettings).toContain('unschedulable');
  });

  it('no-ops proactive execution for inactive integrations to protect disconnect flow', async () => {
    state.integration.is_active = false;
    const credentialsBefore = state.secrets.ninjaone_credentials;

    const { executeNinjaOneProactiveRefresh } = await import(
      '@/lib/integrations/ninjaone/proactiveRefresh'
    );

    const result = await executeNinjaOneProactiveRefresh({
      tenantId: 'tenant-1',
      integrationId: 'integration-1',
      scheduleNonce: 1,
      scheduledFor: new Date().toISOString(),
    });

    expect(result.outcome).toBe('inactive');
    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(workflowStartMock).not.toHaveBeenCalled();
    expect(state.secrets.ninjaone_credentials).toBe(credentialsBefore);
  });
});
