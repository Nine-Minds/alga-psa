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
    settings: '{}',
  } as IntegrationRow,
};

const workflowStartMock = vi.fn();
const workflowSignalMock = vi.fn();
const getHandleMock = vi.fn(() => ({ signal: workflowSignalMock }));
const connectMock = vi.fn(async () => ({}));

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

vi.mock('@/lib/db', () => ({
  runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<unknown>) => fn()),
  createTenantKnex: vi.fn(async () => {
    const builder = {
      where: vi.fn(() => builder),
      select: vi.fn(() => builder),
      first: vi.fn(async () => state.integration),
      update: vi.fn(async (payload: { settings: string }) => {
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

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(),
}));

describe('scheduleNinjaOneProactiveRefresh', () => {
  beforeEach(() => {
    state.integration = {
      tenant: 'tenant-1',
      integration_id: 'integration-1',
      provider: 'ninjaone',
      is_active: true,
      settings: '{}',
    };

    workflowStartMock.mockReset();
    workflowSignalMock.mockReset();
    getHandleMock.mockClear();
    connectMock.mockClear();
  });

  it('starts the stable lifecycle workflow and records the next refresh window', async () => {
    const { scheduleNinjaOneProactiveRefresh } = await import(
      '@/lib/integrations/ninjaone/proactiveRefresh'
    );

    const expiresAtMs = Date.now() + 60 * 60 * 1000;
    const result = await scheduleNinjaOneProactiveRefresh({
      tenantId: 'tenant-1',
      integrationId: 'integration-1',
      expiresAtMs,
      source: 'oauth_connected',
    });

    expect(result.scheduled).toBe(true);
    expect(workflowStartMock).toHaveBeenCalledTimes(1);
    expect(workflowSignalMock).not.toHaveBeenCalled();

    const startArgs = workflowStartMock.mock.calls[0]?.[1] as {
      workflowId: string;
      args: Array<{ expiresAtMs: number; scheduledBy: string }>;
    };

    expect(startArgs.workflowId).toBe('ninjaone:token-lifecycle:tenant-1:integration-1');
    expect(startArgs.args[0]).toEqual(
      expect.objectContaining({
        expiresAtMs,
        scheduledBy: 'oauth_connected',
      })
    );

    const lifecycle = (JSON.parse(state.integration.settings) as { tokenLifecycle: any }).tokenLifecycle;
    expect(lifecycle.status).toBe('scheduled');
    expect(typeof lifecycle.nextRefreshAt).toBe('string');
  });

  it('signals the existing stable workflow when it is already running', async () => {
    workflowStartMock.mockRejectedValueOnce(new Error('Workflow execution already started'));

    const { scheduleNinjaOneProactiveRefresh } = await import(
      '@/lib/integrations/ninjaone/proactiveRefresh'
    );

    const expiresAtMs = Date.now() + 2 * 60 * 60 * 1000;
    const result = await scheduleNinjaOneProactiveRefresh({
      tenantId: 'tenant-1',
      integrationId: 'integration-1',
      expiresAtMs,
      source: 'lazy_refresh_success',
    });

    expect(result.scheduled).toBe(true);
    expect(workflowStartMock).toHaveBeenCalledTimes(1);
    expect(getHandleMock).toHaveBeenCalledWith('ninjaone:token-lifecycle:tenant-1:integration-1');
    expect(workflowSignalMock).toHaveBeenCalledWith(
      'reconcileNinjaOneProactiveTokenRefresh',
      expect.objectContaining({
        expiresAtMs,
        scheduledBy: 'lazy_refresh_success',
      })
    );
  });

  it('clears reconnect-required lifecycle state and seeds a fresh schedule on reconnect', async () => {
    state.integration.settings = JSON.stringify({
      tokenLifecycle: {
        reconnectRequired: true,
        status: 'reconnect_required',
      },
    });

    const { clearNinjaOneReconnectRequiredState, scheduleNinjaOneProactiveRefresh } = await import(
      '@/lib/integrations/ninjaone/proactiveRefresh'
    );

    await clearNinjaOneReconnectRequiredState('tenant-1', 'integration-1');

    const result = await scheduleNinjaOneProactiveRefresh({
      tenantId: 'tenant-1',
      integrationId: 'integration-1',
      expiresAtMs: Date.now() + 45 * 60 * 1000,
      source: 'reconnected',
    });

    expect(result.scheduled).toBe(true);
    const lifecycle = (JSON.parse(state.integration.settings) as { tokenLifecycle: any }).tokenLifecycle;
    expect(lifecycle.reconnectRequired).toBe(false);
    expect(lifecycle.status).toBe('scheduled');
    expect(typeof lifecycle.nextRefreshAt).toBe('string');
  });
});
