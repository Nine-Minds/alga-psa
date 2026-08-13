import { describe, expect, it, vi, beforeEach } from 'vitest';
import { convergeSchedule, RMM_DEVICE_SYNC_JOB } from './rmmAlertPollingHandlers';

/**
 * The create / recreate / cancel decision the RMM reconciler makes per schedule.
 *
 * This is the part that was refactored when device sync was added: the loop
 * used to inline one schedule's logic and `continue` out of it, which meant a
 * provider with no alert fetcher (Level.io) took an early exit before its
 * device sync was ever considered. The behaviour now lives here and is shared
 * by both capabilities, so it is worth pinning directly rather than only
 * through whichever caller happens to exercise it.
 */

import type { Knex } from 'knex';
import type { IJobRunner } from '../jobs/interfaces';

const adminKnex = {} as Knex;

/** Only the two methods convergeSchedule touches; cast at the call site. */
function fakeRunner() {
  return {
    scheduleRecurringJob: vi.fn().mockResolvedValue(undefined),
    cancelJob: vi.fn().mockResolvedValue(true),
  };
}

const asRunner = (runner: ReturnType<typeof fakeRunner>) => runner as unknown as IJobRunner;

const baseArgs = {
  tenantId: 'tenant-1',
  integrationId: 'integration-1',
  provider: 'levelio',
  jobName: RMM_DEVICE_SYNC_JOB,
  singletonKey: `${RMM_DEVICE_SYNC_JOB}:tenant-1:integration-1`,
  eligible: true,
  desiredCron: '0 * * * *',
  data: { tenantId: 'tenant-1', integrationId: 'integration-1', provider: 'levelio' },
};

const none = async () => null;
const existing = (interval: string) => async () => ({ job_id: 'job-1', tenant: 'tenant-1', interval });

describe('convergeSchedule', () => {
  let runner: ReturnType<typeof fakeRunner>;
  beforeEach(() => {
    runner = fakeRunner();
  });

  it('creates a schedule when eligible and none exists', async () => {
    const outcome = await convergeSchedule(asRunner(runner), adminKnex, baseArgs, none);

    expect(runner.scheduleRecurringJob).toHaveBeenCalledWith(
      RMM_DEVICE_SYNC_JOB,
      baseArgs.data,
      '0 * * * *',
      { singletonKey: baseArgs.singletonKey },
    );
    expect(outcome).toEqual({ ensured: 1, cancelled: 0 });
  });

  it('does nothing when an identical schedule already exists', async () => {
    // Converged: the reconciler runs every few minutes, so churning here would
    // tear down and recreate every schedule on every pass.
    const outcome = await convergeSchedule(asRunner(runner), adminKnex, baseArgs, existing('0 * * * *'));

    expect(runner.scheduleRecurringJob).not.toHaveBeenCalled();
    expect(runner.cancelJob).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ensured: 0, cancelled: 0 });
  });

  it('recreates the schedule when the interval changed', async () => {
    const outcome = await convergeSchedule(asRunner(runner), adminKnex, baseArgs, existing('*/15 * * * *'));

    expect(runner.cancelJob).toHaveBeenCalledWith('job-1', 'tenant-1');
    expect(runner.scheduleRecurringJob).toHaveBeenCalledWith(
      RMM_DEVICE_SYNC_JOB,
      baseArgs.data,
      '0 * * * *',
      { singletonKey: baseArgs.singletonKey },
    );
    expect(outcome).toEqual({ ensured: 1, cancelled: 1 });
  });

  it('cancels the schedule when the integration became ineligible', async () => {
    const outcome = await convergeSchedule(
      asRunner(runner),
      adminKnex,
      { ...baseArgs, eligible: false },
      existing('0 * * * *'),
    );

    expect(runner.cancelJob).toHaveBeenCalledWith('job-1', 'tenant-1');
    expect(runner.scheduleRecurringJob).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ensured: 0, cancelled: 1 });
  });

  it('does nothing when ineligible and no schedule exists', async () => {
    const outcome = await convergeSchedule(asRunner(runner), adminKnex, { ...baseArgs, eligible: false }, none);

    expect(runner.cancelJob).not.toHaveBeenCalled();
    expect(runner.scheduleRecurringJob).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ensured: 0, cancelled: 0 });
  });

  it('falls back to an any-status lookup when cancelling', async () => {
    // A failed last run must not strand the underlying schedule: the live
    // lookup filters on status, so cancellation retries without that filter.
    const findExisting = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ job_id: 'job-stale', tenant: 'tenant-1', interval: '0 * * * *' });

    const outcome = await convergeSchedule(asRunner(runner), adminKnex, { ...baseArgs, eligible: false }, findExisting);

    expect(findExisting).toHaveBeenNthCalledWith(2, adminKnex, 'tenant-1', baseArgs.singletonKey, {
      anyStatus: true,
    });
    expect(runner.cancelJob).toHaveBeenCalledWith('job-stale', 'tenant-1');
    expect(outcome).toEqual({ ensured: 0, cancelled: 1 });
  });

  it('does not count a cancel the runner reported as a no-op', async () => {
    runner.cancelJob.mockResolvedValue(false);
    const outcome = await convergeSchedule(
      asRunner(runner),
      adminKnex,
      { ...baseArgs, eligible: false },
      existing('0 * * * *'),
    );
    expect(outcome).toEqual({ ensured: 0, cancelled: 0 });
  });

  it('swallows a scheduling error so one integration cannot abort the pass', async () => {
    // The reconciler walks every tenant's integrations; one bad row must not
    // stop the rest from converging.
    runner.scheduleRecurringJob.mockRejectedValue(new Error('temporal unavailable'));

    const outcome = await convergeSchedule(asRunner(runner), adminKnex, baseArgs, none);
    expect(outcome).toEqual({ ensured: 0, cancelled: 0 });
  });

  it('swallows a lookup error the same way', async () => {
    const outcome = await convergeSchedule(asRunner(runner), adminKnex, baseArgs, async () => {
      throw new Error('integration deleted mid-pass');
    });
    expect(outcome).toEqual({ ensured: 0, cancelled: 0 });
  });

  it('keys the schedule per tenant and integration', async () => {
    // Two integrations in one tenant must not share a singleton key, or
    // enabling one would silently cancel the other.
    await convergeSchedule(
      asRunner(runner),
      adminKnex,
      { ...baseArgs, integrationId: 'integration-2', singletonKey: `${RMM_DEVICE_SYNC_JOB}:tenant-1:integration-2` },
      none,
    );

    expect(runner.scheduleRecurringJob).toHaveBeenCalledWith(
      RMM_DEVICE_SYNC_JOB,
      expect.anything(),
      expect.anything(),
      { singletonKey: `${RMM_DEVICE_SYNC_JOB}:tenant-1:integration-2` },
    );
  });
});
