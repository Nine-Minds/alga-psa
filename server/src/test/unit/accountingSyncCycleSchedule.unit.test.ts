import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveConnectedAccountingIntegrationMock = vi.fn();
const scheduleRecurringJobMock = vi.fn();
const cancelJobMock = vi.fn();
const firstMock = vi.fn();

vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('server/src/lib/db', () => ({ runWithTenant: vi.fn() }));
vi.mock('server/src/lib/db/db', () => ({ getConnection: vi.fn() }));
vi.mock('@alga-psa/billing/services', () => ({
  runAccountingSyncCycle: vi.fn(),
  AccountingAdapterRegistry: { createDefault: vi.fn() },
  resolveConnectedAccountingIntegration: (...a: unknown[]) => resolveConnectedAccountingIntegrationMock(...a),
}));
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: vi.fn(),
}));
vi.mock('@/lib/jobs/JobRunnerFactory', () => ({
  getJobRunner: async () => ({
    scheduleRecurringJob: (...a: unknown[]) => scheduleRecurringJobMock(...a),
    cancelJob: (...a: unknown[]) => cancelJobMock(...a),
  }),
}));

// admin knex query builder used by cancelAccountingSyncCycle
const queryBuilder = {
  where: () => queryBuilder,
  whereRaw: () => queryBuilder,
  whereNotNull: () => queryBuilder,
  orderBy: () => queryBuilder,
  first: (...a: unknown[]) => firstMock(...a),
};
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => () => queryBuilder,
}));

import { scheduleAccountingSyncCycleJob } from '@/lib/jobs/handlers/accountingSyncCycleHandler';

describe('scheduleAccountingSyncCycleJob (connected-only)', () => {
  beforeEach(() => {
    // Pin BOTH edition env vars so the isEnterpriseEdition() guard is deterministic
    // even if an earlier test file leaks NEXT_PUBLIC_EDITION into the worker.
    vi.stubEnv('EDITION', 'ee');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
    resolveConnectedAccountingIntegrationMock.mockReset();
    scheduleRecurringJobMock.mockReset();
    cancelJobMock.mockReset();
    firstMock.mockReset();
    scheduleRecurringJobMock.mockResolvedValue({ jobId: 'job-1', externalId: 'accounting-sync-cycle:t1' });
    cancelJobMock.mockResolvedValue(true);
  });

  it('schedules a connected tenant', async () => {
    resolveConnectedAccountingIntegrationMock.mockResolvedValue({
      adapterType: 'quickbooks_online',
      targetRealm: 'realm-123',
    });

    const result = await scheduleAccountingSyncCycleJob('t1');

    expect(scheduleRecurringJobMock).toHaveBeenCalledTimes(1);
    expect(scheduleRecurringJobMock).toHaveBeenCalledWith(
      'accounting-sync-cycle',
      { tenantId: 't1' },
      '*/15 * * * *',
      { singletonKey: 'accounting-sync-cycle:t1' },
    );
    expect(cancelJobMock).not.toHaveBeenCalled();
    expect(result).toBe('job-1');
  });

  it('does NOT schedule an unconnected tenant, and cancels a stray schedule', async () => {
    resolveConnectedAccountingIntegrationMock.mockResolvedValue(null);
    firstMock.mockResolvedValue({ job_id: 'stale-job' }); // a leftover schedule exists

    const result = await scheduleAccountingSyncCycleJob('t2');

    expect(scheduleRecurringJobMock).not.toHaveBeenCalled();
    expect(cancelJobMock).toHaveBeenCalledWith('stale-job', 't2');
    expect(result).toBeNull();
  });

  it('unconnected with no existing schedule is a no-op', async () => {
    resolveConnectedAccountingIntegrationMock.mockResolvedValue(null);
    firstMock.mockResolvedValue(undefined);

    const result = await scheduleAccountingSyncCycleJob('t3');

    expect(scheduleRecurringJobMock).not.toHaveBeenCalled();
    expect(cancelJobMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns null in CE without touching the runner', async () => {
    vi.stubEnv('EDITION', 'community');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'community');
    const result = await scheduleAccountingSyncCycleJob('t4');
    expect(resolveConnectedAccountingIntegrationMock).not.toHaveBeenCalled();
    expect(scheduleRecurringJobMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
