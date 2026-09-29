import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  whereArgs: [] as unknown[],
  start: vi.fn(),
  signal: vi.fn(),
  runnerType: 'temporal' as 'temporal' | 'pgboss',
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: (_knex: unknown, tenant: string) => ({
    table: () => ({
      where: (args: unknown) => {
        mocks.whereArgs.push({ tenant, args });
        return { first: async () => mocks.row };
      },
    }),
  }),
}));

vi.mock('@temporalio/client', () => ({
  WorkflowExecutionAlreadyStartedError: class WorkflowExecutionAlreadyStartedError extends Error {},
}));

vi.mock('../jobRunnerAccessor', () => ({
  getJobRunner: async () => ({
    getRunnerType: () => mocks.runnerType,
    getClient: () => ({
      workflow: {
        start: mocks.start,
        getHandle: () => ({ signal: mocks.signal }),
      },
    }),
  }),
}));

const connectedConfig = {
  pbx: { baseUrl: 'https://pbx.example.com', clientId: 'app', status: 'connected', capabilities: { xapi: true, callControl: true } },
};

describe('reconcileThreecxCallControlHandler', () => {
  beforeEach(() => {
    mocks.row = null;
    mocks.whereArgs = [];
    mocks.runnerType = 'temporal';
    mocks.start.mockReset();
    mocks.signal.mockReset();
  });

  it('starts the workflow for a connected tenant with callControl (T041)', async () => {
    mocks.row = { status: 'active', config: connectedConfig };
    const { reconcileThreecxCallControlHandler } = await import('./threecxCallControlReconcileHandler');

    const result = await reconcileThreecxCallControlHandler({ tenantId: 'tenant-1' });

    expect(result).toEqual({ success: true, tenantId: 'tenant-1', shouldRun: true, action: 'started' });
    expect(mocks.start).toHaveBeenCalledWith('threecxCallControlWorkflow', {
      taskQueue: 'tenant-workflows',
      workflowId: 'threecx-callcontrol:tenant-1',
      args: [{ tenantId: 'tenant-1' }],
    });
    expect(mocks.signal).not.toHaveBeenCalled();
    expect(mocks.whereArgs).toEqual([{ tenant: 'tenant-1', args: { provider: '3cx' } }]);
  });

  it('leaves an already running execution alone', async () => {
    mocks.row = { status: 'active', config: JSON.stringify(connectedConfig) };
    const { WorkflowExecutionAlreadyStartedError } = await import('@temporalio/client');
    mocks.start.mockRejectedValueOnce(
      new WorkflowExecutionAlreadyStartedError('running', 'threecx-callcontrol:tenant-1', 'threecxCallControlWorkflow'),
    );
    const { reconcileThreecxCallControlHandler } = await import('./threecxCallControlReconcileHandler');

    await expect(reconcileThreecxCallControlHandler({ tenantId: 'tenant-1' })).resolves.toMatchObject({ action: 'already_running' });
  });

  it('signals stop for a tenant whose provider is disabled (T042)', async () => {
    mocks.row = { status: 'disabled', config: connectedConfig };
    const { reconcileThreecxCallControlHandler } = await import('./threecxCallControlReconcileHandler');

    const result = await reconcileThreecxCallControlHandler({ tenantId: 'tenant-1' });

    expect(result).toMatchObject({ shouldRun: false, action: 'stopped' });
    expect(mocks.signal).toHaveBeenCalledWith('stop');
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('does not start a workflow when capabilities.callControl is false (T043)', async () => {
    mocks.row = {
      status: 'active',
      config: { pbx: { ...connectedConfig.pbx, capabilities: { xapi: true, callControl: false } } },
    };
    mocks.signal.mockRejectedValueOnce(Object.assign(new Error('workflow not found'), { name: 'WorkflowNotFoundError' }));
    const { reconcileThreecxCallControlHandler } = await import('./threecxCallControlReconcileHandler');

    const result = await reconcileThreecxCallControlHandler({ tenantId: 'tenant-1' });

    expect(mocks.start).not.toHaveBeenCalled();
    expect(result).toMatchObject({ shouldRun: false, action: 'not_running' });
  });

  it('does not start when the PBX is in error or there is no row', async () => {
    const { reconcileThreecxCallControlHandler, shouldRunThreecxCallControl } = await import('./threecxCallControlReconcileHandler');

    expect(shouldRunThreecxCallControl(null)).toBe(false);
    expect(shouldRunThreecxCallControl({ status: 'active', config: { pbx: { ...connectedConfig.pbx, status: 'error' } } })).toBe(false);
    expect(shouldRunThreecxCallControl({ status: 'active', config: 'not json' })).toBe(false);
    expect(shouldRunThreecxCallControl({ status: 'active', config: connectedConfig })).toBe(true);

    mocks.row = null;
    await expect(reconcileThreecxCallControlHandler({ tenantId: 'tenant-1' })).resolves.toMatchObject({ action: 'stopped' });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('skips without a Temporal client and without a tenant', async () => {
    const { reconcileThreecxCallControlHandler } = await import('./threecxCallControlReconcileHandler');
    await expect(reconcileThreecxCallControlHandler({})).resolves.toMatchObject({ action: 'skipped' });

    mocks.runnerType = 'pgboss';
    mocks.row = { status: 'active', config: connectedConfig };
    await expect(reconcileThreecxCallControlHandler({ tenantId: 'tenant-1' })).resolves.toMatchObject({ action: 'skipped', shouldRun: true });
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
