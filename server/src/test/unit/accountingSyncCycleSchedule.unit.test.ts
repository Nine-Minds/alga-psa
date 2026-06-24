import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStoredQboCredentialsMapMock = vi.fn();
const scheduleRecurringJobMock = vi.fn();
const cancelJobMock = vi.fn();
const firstMock = vi.fn();

vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('server/src/lib/db', () => ({ runWithTenant: vi.fn() }));
vi.mock('server/src/lib/db/db', () => ({ getConnection: vi.fn() }));
vi.mock('@alga-psa/billing/services', () => ({ runAccountingSyncCycle: vi.fn(), AccountingAdapterRegistry: { createDefault: vi.fn() } }));
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: (...a: unknown[]) => getStoredQboCredentialsMapMock(...a),
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
    vi.stubEnv('EDITION', 'ee');
    getStoredQboCredentialsMapMock.mockReset();
    scheduleRecurringJobMock.mockReset();
    cancelJobMock.mockReset();
    firstMock.mockReset();
    scheduleRecurringJobMock.mockResolvedValue({ jobId: 'job-1', externalId: 'accounting-sync-cycle:t1' });
    cancelJobMock.mockResolvedValue(true);
  });

  it('schedules a connected tenant', async () => {
    getStoredQboCredentialsMapMock.mockResolvedValue({ 'realm-123': { accessToken: 'x' } });

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
    getStoredQboCredentialsMapMock.mockResolvedValue({}); // no realms
    firstMock.mockResolvedValue({ job_id: 'stale-job' }); // a leftover schedule exists

    const result = await scheduleAccountingSyncCycleJob('t2');

    expect(scheduleRecurringJobMock).not.toHaveBeenCalled();
    expect(cancelJobMock).toHaveBeenCalledWith('stale-job', 't2');
    expect(result).toBeNull();
  });

  it('unconnected with no existing schedule is a no-op', async () => {
    getStoredQboCredentialsMapMock.mockResolvedValue({});
    firstMock.mockResolvedValue(undefined);

    const result = await scheduleAccountingSyncCycleJob('t3');

    expect(scheduleRecurringJobMock).not.toHaveBeenCalled();
    expect(cancelJobMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns null in CE without touching the runner', async () => {
    vi.stubEnv('EDITION', 'community');
    const result = await scheduleAccountingSyncCycleJob('t4');
    expect(getStoredQboCredentialsMapMock).not.toHaveBeenCalled();
    expect(scheduleRecurringJobMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
