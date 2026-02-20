import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  startMock,
  getHandleMock,
  closeMock,
  connectMock,
  clientConstructorMock,
} = vi.hoisted(() => ({
  startMock: vi.fn(),
  getHandleMock: vi.fn(),
  closeMock: vi.fn(async () => undefined),
  connectMock: vi.fn(),
  clientConstructorMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(),
  runWithTenant: vi.fn(),
}));

vi.mock('@temporalio/client', () => {
  const Client = function Client(this: any) {
    clientConstructorMock();
    this.workflow = {
      start: startMock,
      getHandle: getHandleMock,
    };
  } as any;

  return {
    Connection: {
      connect: connectMock,
    },
    Client,
  };
});

describe('entraWorkflowClient start helpers', () => {
  beforeEach(() => {
    startMock.mockReset();
    getHandleMock.mockReset();
    closeMock.mockReset();
    connectMock.mockReset();
    clientConstructorMock.mockReset();
    closeMock.mockResolvedValue(undefined);
    connectMock.mockResolvedValue({ close: closeMock });
  });

  it('T079: startEntraInitialSyncWorkflow returns workflow/run IDs', async () => {
    startMock.mockResolvedValue({
      workflowId: 'wf-initial-79',
      firstExecutionRunId: 'run-initial-79',
    });

    const { startEntraInitialSyncWorkflow } = await import(
      '@ee/lib/integrations/entra/entraWorkflowClient'
    );
    const result = await startEntraInitialSyncWorkflow({
      tenantId: 'tenant-79',
      requestedAt: '2026-02-20T12:00:00.000Z',
      actor: { userId: 'user-79' },
      startImmediately: true,
    });

    expect(result).toEqual({
      available: true,
      workflowId: 'wf-initial-79',
      runId: 'run-initial-79',
    });
    expect(startMock).toHaveBeenCalledWith(
      'entraInitialSyncWorkflow',
      expect.objectContaining({
        args: [expect.objectContaining({ tenantId: 'tenant-79' })],
        workflowId: expect.stringContaining('entra-initial-sync:tenant-79:bucket-'),
      })
    );
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('T080: startEntraAllTenantsSyncWorkflow returns workflow/run IDs', async () => {
    startMock.mockResolvedValue({
      workflowId: 'wf-all-80',
      firstExecutionRunId: 'run-all-80',
    });

    const { startEntraAllTenantsSyncWorkflow } = await import(
      '@ee/lib/integrations/entra/entraWorkflowClient'
    );
    const result = await startEntraAllTenantsSyncWorkflow({
      tenantId: 'tenant-80',
      requestedAt: '2026-02-20T12:05:00.000Z',
      trigger: 'manual',
      actor: { userId: 'user-80' },
    });

    expect(result).toEqual({
      available: true,
      workflowId: 'wf-all-80',
      runId: 'run-all-80',
    });
    expect(startMock).toHaveBeenCalledWith(
      'entraAllTenantsSyncWorkflow',
      expect.objectContaining({
        workflowId: expect.stringContaining('entra-all-tenants-sync:tenant-80:manual:bucket-'),
      })
    );
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('T081: startEntraTenantSyncWorkflow returns workflow/run IDs', async () => {
    startMock.mockResolvedValue({
      workflowId: 'wf-tenant-81',
      firstExecutionRunId: 'run-tenant-81',
    });

    const { startEntraTenantSyncWorkflow } = await import(
      '@ee/lib/integrations/entra/entraWorkflowClient'
    );
    const result = await startEntraTenantSyncWorkflow({
      tenantId: 'tenant-81',
      managedTenantId: 'managed-81',
      clientId: 'client-81',
      requestedAt: '2026-02-20T12:10:00.000Z',
      actor: { userId: 'user-81' },
    });

    expect(result).toEqual({
      available: true,
      workflowId: 'wf-tenant-81',
      runId: 'run-tenant-81',
    });
    expect(startMock).toHaveBeenCalledWith(
      'entraTenantSyncWorkflow',
      expect.objectContaining({
        workflowId: expect.stringContaining('entra-tenant-sync:tenant-81:managed-81:client-81:bucket-'),
      })
    );
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
