import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IJobScheduler } from 'server/src/lib/jobs/jobScheduler';

const sweepMock = vi.fn();

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('server/src/lib/jobs/handlers/replenishContractCadenceServicePeriodsHandler', () => ({
  CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME: 'replenishContractCadenceServicePeriods',
  replenishContractCadenceServicePeriodsSweep: (...args: unknown[]) => sweepMock(...args),
}));

import { registerContractCadenceReplenishmentSchedule } from 'server/src/lib/jobs/scheduleContractCadenceReplenishment';

function createFakeScheduler(existingJobs: unknown[] = []) {
  const registered = new Map<string, () => Promise<void>>();
  const scheduled: Array<{ jobName: string; interval: string; data: unknown }> = [];
  const scheduler = {
    getJobs: vi.fn(async () => existingJobs),
    registerJobHandler: vi.fn((name: string, handler: () => Promise<void>) => {
      registered.set(name, handler);
    }),
    scheduleRecurringJob: vi.fn(async (jobName: string, interval: string, data: unknown) => {
      scheduled.push({ jobName, interval, data });
      return 'job-1';
    }),
  };
  return { scheduler, registered, scheduled };
}

describe('registerContractCadenceReplenishmentSchedule', () => {
  beforeEach(() => {
    sweepMock.mockReset();
    sweepMock.mockResolvedValue({ tenantsProcessed: 0, tenantsFailed: 0, summaries: [] });
  });

  it('does not use the pg-boss scheduler when Enterprise owns scheduling', async () => {
    const { scheduler } = createFakeScheduler();

    const outcome = await registerContractCadenceReplenishmentSchedule(
      scheduler as unknown as IJobScheduler,
      { isEnterprise: true },
    );

    expect(outcome).toBe('temporal-authority');
    expect(scheduler.getJobs).not.toHaveBeenCalled();
    expect(scheduler.registerJobHandler).not.toHaveBeenCalled();
    expect(scheduler.scheduleRecurringJob).not.toHaveBeenCalled();
  });

  it('registers, schedules daily, and executes the sweep', async () => {
    const { scheduler, registered, scheduled } = createFakeScheduler();

    const outcome = await registerContractCadenceReplenishmentSchedule(
      scheduler as unknown as IJobScheduler,
      { isEnterprise: false },
    );

    expect(outcome).toBe('scheduled');
    expect(scheduler.registerJobHandler).toHaveBeenCalledWith(
      'replenishContractCadenceServicePeriods',
      expect.any(Function),
    );
    expect(scheduled).toEqual([
      {
        jobName: 'replenishContractCadenceServicePeriods',
        interval: '24 hours',
        data: { tenantId: 'system' },
      },
    ]);

    await registered.get('replenishContractCadenceServicePeriods')?.();
    expect(sweepMock).toHaveBeenCalledTimes(1);
  });

  it('leaves an existing recurring job untouched on repeated initialization', async () => {
    const { scheduler } = createFakeScheduler([{ name: 'replenishContractCadenceServicePeriods' }]);

    const outcome = await registerContractCadenceReplenishmentSchedule(
      scheduler as unknown as IJobScheduler,
      { isEnterprise: false },
    );

    expect(outcome).toBe('already-scheduled');
    expect(scheduler.registerJobHandler).not.toHaveBeenCalled();
    expect(scheduler.scheduleRecurringJob).not.toHaveBeenCalled();
  });
});
