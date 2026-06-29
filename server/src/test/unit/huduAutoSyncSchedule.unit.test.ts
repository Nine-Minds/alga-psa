import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDesiredStateMock = vi.fn();
const scheduleRecurringJobMock = vi.fn();
const cancelJobMock = vi.fn();
const firstMock = vi.fn();

vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('server/src/lib/db', () => ({ runWithTenant: vi.fn() }));
vi.mock('@enterprise/lib/integrations/hudu/tenantSync', () => ({
  getHuduAutoSyncDesiredState: (...a: unknown[]) => getDesiredStateMock(...a),
}));
vi.mock('@/lib/jobs/JobRunnerFactory', () => ({
  getJobRunner: async () => ({
    scheduleRecurringJob: (...a: unknown[]) => scheduleRecurringJobMock(...a),
    cancelJob: (...a: unknown[]) => cancelJobMock(...a),
  }),
}));

// admin knex query builder used by cancelHuduAutoSync (jobs table lookup)
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

import { scheduleHuduAutoSyncJob } from '@/lib/jobs/handlers/huduAutoSyncHandler';

describe('scheduleHuduAutoSyncJob (connected + auto-sync-enabled only)', () => {
  beforeEach(() => {
    vi.stubEnv('EDITION', 'ee');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
    getDesiredStateMock.mockReset();
    scheduleRecurringJobMock.mockReset();
    cancelJobMock.mockReset();
    firstMock.mockReset();
    scheduleRecurringJobMock.mockResolvedValue({ jobId: 'job-1', externalId: 'hudu-auto-sync:t1' });
    cancelJobMock.mockResolvedValue(true);
  });

  it('schedules a connected tenant with auto-sync enabled', async () => {
    getDesiredStateMock.mockResolvedValue({ isActive: true, autoSyncEnabled: true });

    const result = await scheduleHuduAutoSyncJob('t1');

    expect(scheduleRecurringJobMock).toHaveBeenCalledWith(
      'hudu-auto-sync',
      { tenantId: 't1' },
      '0 2 * * *',
      { singletonKey: 'hudu-auto-sync:t1' }
    );
    expect(cancelJobMock).not.toHaveBeenCalled();
    expect(result).toBe('job-1');
  });

  it('cancels a stray schedule when auto-sync is disabled', async () => {
    getDesiredStateMock.mockResolvedValue({ isActive: true, autoSyncEnabled: false });
    firstMock.mockResolvedValue({ job_id: 'stale-job' });

    const result = await scheduleHuduAutoSyncJob('t2');

    expect(scheduleRecurringJobMock).not.toHaveBeenCalled();
    expect(cancelJobMock).toHaveBeenCalledWith('stale-job', 't2');
    expect(result).toBeNull();
  });

  it('cancels when the connection is inactive', async () => {
    getDesiredStateMock.mockResolvedValue({ isActive: false, autoSyncEnabled: true });
    firstMock.mockResolvedValue({ job_id: 'stale-job' });

    await scheduleHuduAutoSyncJob('t2b');

    expect(scheduleRecurringJobMock).not.toHaveBeenCalled();
    expect(cancelJobMock).toHaveBeenCalledWith('stale-job', 't2b');
  });

  it('no connection row + no existing schedule is a no-op', async () => {
    getDesiredStateMock.mockResolvedValue(null);
    firstMock.mockResolvedValue(undefined);

    const result = await scheduleHuduAutoSyncJob('t3');

    expect(scheduleRecurringJobMock).not.toHaveBeenCalled();
    expect(cancelJobMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns null in CE without reading state or touching the runner', async () => {
    vi.stubEnv('EDITION', 'community');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'community');

    const result = await scheduleHuduAutoSyncJob('t4');

    expect(getDesiredStateMock).not.toHaveBeenCalled();
    expect(scheduleRecurringJobMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
