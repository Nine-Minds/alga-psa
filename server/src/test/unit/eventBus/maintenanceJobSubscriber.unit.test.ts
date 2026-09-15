import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const runMaintenanceJobMock = vi.fn();
const acquireLockMock = vi.fn();
const releaseMock = vi.fn();
const executeJobHandlerMock = vi.fn();
let subscribedHandler: ((event: unknown) => Promise<void>) | null = null;

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/jobs/fanout', () => ({
  runMaintenanceJob: (...args: unknown[]) => runMaintenanceJobMock(...args),
  isKnownMaintenanceJob: (name: string) => name !== 'rmm-device-sync',
}));
vi.mock('@alga-psa/db', () => ({
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../../lib/eventBus/index', () => ({
  getEventBus: () => ({
    subscribe: async (_channel: string, handler: (event: unknown) => Promise<void>) => {
      subscribedHandler = handler;
    },
    unsubscribe: async () => undefined,
  }),
}));
vi.mock('../../../lib/jobs/jobHandlerRegistry', () => ({
  executeJobHandler: (...args: unknown[]) => executeJobHandlerMock(...args),
}));
vi.mock('../../../lib/eventBus/subscribers/maintenanceJobLock', () => ({
  acquireMaintenanceJobLock: (...args: unknown[]) => acquireLockMock(...args),
}));

import { registerMaintenanceJobSubscriber } from '../../../lib/eventBus/subscribers/maintenanceJobSubscriber';

function event(jobName: string, extra: Record<string, unknown> = {}) {
  return {
    id: '0d1a6e1e-5b9a-4c3e-9f3a-1a2b3c4d5e6f',
    eventType: 'MAINTENANCE_JOB_REQUESTED',
    timestamp: new Date().toISOString(),
    payload: {
      tenantId: '11111111-1111-1111-1111-111111111111',
      occurredAt: new Date().toISOString(),
      jobName,
      ...extra,
    },
  };
}

describe('maintenanceJobSubscriber', () => {
  beforeAll(async () => {
    // The subscriber registers once per process; capture the handler it hands the bus.
    await registerMaintenanceJobSubscriber();
    expect(subscribedHandler).toBeTypeOf('function');
  });

  beforeEach(() => {
    runMaintenanceJobMock.mockReset().mockResolvedValue({ jobName: 'x', scope: 'tenant', total: 1, succeeded: 1, failed: 0 });
    acquireLockMock.mockReset().mockResolvedValue({ release: releaseMock });
    releaseMock.mockReset().mockResolvedValue(undefined);
    executeJobHandlerMock.mockReset().mockResolvedValue(undefined);
  });

  it('takes the job lock, runs the fan-out, and releases the lock', async () => {
    await subscribedHandler!(event('sweep-teams-online-meetings'));
    expect(acquireLockMock).toHaveBeenCalledWith('sweep-teams-online-meetings');
    expect(runMaintenanceJobMock).toHaveBeenCalledWith('sweep-teams-online-meetings');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('skips the run when another run of the same job holds the lock', async () => {
    acquireLockMock.mockResolvedValue(null);
    await subscribedHandler!(event('sweep-teams-online-meetings'));
    expect(runMaintenanceJobMock).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('releases the lock when the fan-out throws, and still surfaces the error', async () => {
    runMaintenanceJobMock.mockRejectedValue(new Error('boom'));
    await expect(subscribedHandler!(event('auto-close-tickets'))).rejects.toThrow('boom');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('does not lock forwarded per-tenant jobs', async () => {
    await subscribedHandler!(event('rmm-device-sync', { jobId: 'job-1', data: { tenantId: '11111111-1111-1111-1111-111111111111' } }));
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(executeJobHandlerMock).toHaveBeenCalledWith('rmm-device-sync', 'job-1', expect.any(Object));
  });
});
