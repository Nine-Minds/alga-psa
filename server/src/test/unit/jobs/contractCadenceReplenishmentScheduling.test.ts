import { describe, expect, it, vi } from 'vitest';
import type { IJobRunner } from 'server/src/lib/jobs/interfaces';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  CONTRACT_CADENCE_REPLENISHMENT_CRON,
  CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID,
  registerContractCadenceReplenishmentSchedule,
} from 'server/src/lib/jobs/scheduleContractCadenceReplenishment';

function fakeRunner(overrides: Partial<IJobRunner> = {}): IJobRunner {
  return {
    getRunnerType: () => 'pgboss',
    registerHandler: vi.fn(),
    scheduleJob: vi.fn(),
    scheduleJobAt: vi.fn(),
    scheduleRecurringJob: vi.fn(),
    scheduleGlobalRecurringJob: vi.fn(async () => ({
      scheduleId: CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID,
    })),
    cancelJob: vi.fn(),
    getJobStatus: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    isHealthy: vi.fn(),
    ...overrides,
  } as unknown as IJobRunner;
}

describe('registerContractCadenceReplenishmentSchedule', () => {
  it('does not schedule on pg-boss when Enterprise owns scheduling', async () => {
    const runner = fakeRunner();

    const outcome = await registerContractCadenceReplenishmentSchedule({
      isEnterprise: true,
      getRunner: () => runner,
    });

    expect(outcome).toBe('temporal-authority');
    expect(runner.scheduleGlobalRecurringJob).not.toHaveBeenCalled();
  });

  it('schedules the daily global cron through the pg-boss runner', async () => {
    const runner = fakeRunner();

    const outcome = await registerContractCadenceReplenishmentSchedule({
      isEnterprise: false,
      getRunner: () => runner,
    });

    expect(outcome).toBe('scheduled');
    expect(runner.scheduleGlobalRecurringJob).toHaveBeenCalledWith(
      'replenishContractCadenceServicePeriods',
      CONTRACT_CADENCE_REPLENISHMENT_CRON,
      { scheduleId: CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID },
    );
  });

  it('uses one stable schedule id across repeated initialization', async () => {
    const runner = fakeRunner();

    await registerContractCadenceReplenishmentSchedule({ isEnterprise: false, getRunner: () => runner });
    await registerContractCadenceReplenishmentSchedule({ isEnterprise: false, getRunner: () => runner });

    const scheduleIds = vi.mocked(runner.scheduleGlobalRecurringJob!).mock.calls.map(
      ([, , options]) => options?.scheduleId,
    );
    expect(scheduleIds).toEqual([
      CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID,
      CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID,
    ]);
  });

  it('returns temporal-authority when the runner is not pg-boss', async () => {
    const runner = fakeRunner({ getRunnerType: () => 'temporal' });

    const outcome = await registerContractCadenceReplenishmentSchedule({
      isEnterprise: false,
      getRunner: () => runner,
    });

    expect(outcome).toBe('temporal-authority');
    expect(runner.scheduleGlobalRecurringJob).not.toHaveBeenCalled();
  });

  it('fails loudly when the runner is unavailable', async () => {
    await expect(
      registerContractCadenceReplenishmentSchedule({ isEnterprise: false, getRunner: () => null }),
    ).rejects.toThrow(/job runner is not initialized/);
  });

  it('fails loudly when the pg-boss runner lacks global scheduling', async () => {
    const runner = fakeRunner({ scheduleGlobalRecurringJob: undefined });

    await expect(
      registerContractCadenceReplenishmentSchedule({ isEnterprise: false, getRunner: () => runner }),
    ).rejects.toThrow(/does not support global recurring schedules/);
  });
});
