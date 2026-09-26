import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getTemporalClientMock, getConnectionMock, createServiceMock } = vi.hoisted(() => ({
  getTemporalClientMock: vi.fn(), getConnectionMock: vi.fn(), createServiceMock: vi.fn(),
}));

vi.mock('@ee/lib/temporal/client', () => ({ getTemporalClient: getTemporalClientMock }));
vi.mock('@alga-psa/db', () => ({ getConnection: getConnectionMock, tenantDb: vi.fn() }));
vi.mock('@ee/lib/payments/AutopayWorkerService', () => ({ AutopayWorkerService: { create: createServiceMock } }));

import { listAutopayReconcileWork } from '../autopay-activities';

describe('listAutopayReconcileWork', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const candidates = [
      { invoiceId: 'failed', hasOpenAttempt: true },
      { invoiceId: 'running', hasOpenAttempt: true },
      { invoiceId: 'missing', hasOpenAttempt: true },
      { invoiceId: 'cancelled', hasOpenAttempt: true },
      { invoiceId: 'timed-out', hasOpenAttempt: true },
      { invoiceId: 'lost-start', hasOpenAttempt: false },
    ];
    const configQuery: any = {
      whereExists(callback: (this: any) => void) { callback.call({ select() { return this; }, from() { return this; }, whereRaw() { return this; }, where() { return this; } }); return this; },
      select: async () => [{ tenant: 'tenant-1' }],
    };
    const knex: any = Object.assign(() => configQuery, { raw: vi.fn() });
    getConnectionMock.mockResolvedValue(knex);
    createServiceMock.mockReturnValue({ listAutopayReconcileWork: async () => candidates });
    const statuses: Record<string, string> = { failed: 'FAILED', running: 'RUNNING', cancelled: 'CANCELLED', 'timed-out': 'TIMED_OUT' };
    getTemporalClientMock.mockResolvedValue({ workflow: { getHandle: (id: string) => ({
      describe: async () => {
        const invoice = id.split(':').at(-1)!;
        if (invoice === 'missing') throw Object.assign(new Error('not found'), { name: 'WorkflowNotFoundError' });
        return { status: { code: 1, name: statuses[invoice] } };
      },
    }) } });
  });

  it('restarts only open attempts whose workflow is closed or missing, and retains lost starts', async () => {
    await expect(listAutopayReconcileWork()).resolves.toEqual([
      { invoiceId: 'failed', hasOpenAttempt: true, tenantId: 'tenant-1' },
      { invoiceId: 'missing', hasOpenAttempt: true, tenantId: 'tenant-1' },
      { invoiceId: 'cancelled', hasOpenAttempt: true, tenantId: 'tenant-1' },
      { invoiceId: 'timed-out', hasOpenAttempt: true, tenantId: 'tenant-1' },
      { invoiceId: 'lost-start', hasOpenAttempt: false, tenantId: 'tenant-1' },
    ]);
    expect(createServiceMock).toHaveBeenCalledWith('tenant-1');
  });
});
