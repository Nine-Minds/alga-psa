import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleMarketingJobsForTenant } from '../../lib/jobs/marketingScheduleCutover';

describe('marketing scheduled-job edition boundary', () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  };
  const scheduleFlipDuePosts = vi.fn();
  const scheduleExpireStaleTargets = vi.fn();
  const scheduleSendSequenceSteps = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    scheduleFlipDuePosts.mockResolvedValue('flip-job');
    scheduleExpireStaleTargets.mockResolvedValue('expire-job');
    scheduleSendSequenceSteps.mockResolvedValue('send-job');
  });

  it('does not create per-tenant marketing schedules in EE', async () => {
    await scheduleMarketingJobsForTenant({
      tenantId: 'tenant-1',
      enterpriseWorkflowEdition: true,
      dependencies: {
        logger,
        scheduleFlipDuePosts,
        scheduleExpireStaleTargets,
        scheduleSendSequenceSteps,
      },
    });

    expect(scheduleFlipDuePosts).not.toHaveBeenCalled();
    expect(scheduleExpireStaleTargets).not.toHaveBeenCalled();
    expect(scheduleSendSequenceSteps).not.toHaveBeenCalled();
  });

  it('keeps the existing per-tenant marketing cadences in CE', async () => {
    await scheduleMarketingJobsForTenant({
      tenantId: 'tenant-1',
      enterpriseWorkflowEdition: false,
      dependencies: {
        logger,
        scheduleFlipDuePosts,
        scheduleExpireStaleTargets,
        scheduleSendSequenceSteps,
      },
    });

    expect(scheduleFlipDuePosts).toHaveBeenCalledWith('tenant-1', '*/5 * * * *');
    expect(scheduleExpireStaleTargets).toHaveBeenCalledWith('tenant-1', '11 * * * *');
    expect(scheduleSendSequenceSteps).toHaveBeenCalledWith('tenant-1', '*/5 * * * *');
  });
});
