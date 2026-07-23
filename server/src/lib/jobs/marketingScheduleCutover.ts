interface MarketingScheduleLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, error: unknown): void;
}

interface MarketingScheduleDependencies {
  logger: MarketingScheduleLogger;
  scheduleFlipDuePosts(tenantId: string, cron: string): Promise<string | null>;
  scheduleExpireStaleTargets(tenantId: string, cron: string): Promise<string | null>;
  scheduleSendSequenceSteps(tenantId: string, cron: string): Promise<string | null>;
}

interface ScheduleMarketingJobsInput {
  tenantId: string;
  enterpriseWorkflowEdition: boolean;
  dependencies: MarketingScheduleDependencies;
}

export async function scheduleMarketingJobsForTenant({
  tenantId,
  enterpriseWorkflowEdition,
  dependencies,
}: ScheduleMarketingJobsInput): Promise<void> {
  if (enterpriseWorkflowEdition) {
    dependencies.logger.info(
      'Skipping per-tenant marketing schedules because EE uses Temporal fan-out',
      { tenantId },
    );
    return;
  }

  try {
    const flipJobId = await dependencies.scheduleFlipDuePosts(tenantId, '*/5 * * * *');
    dependencies.logger.info('Marketing flip-due-posts schedule converged', {
      tenantId,
      flipJobId,
    });
  } catch (error) {
    dependencies.logger.error(
      `Failed to schedule marketing flip-due-posts job for tenant ${tenantId}`,
      error,
    );
  }

  try {
    const expireJobId = await dependencies.scheduleExpireStaleTargets(tenantId, '11 * * * *');
    dependencies.logger.info('Marketing expire-stale-targets schedule converged', {
      tenantId,
      expireJobId,
    });
  } catch (error) {
    dependencies.logger.error(
      `Failed to schedule marketing expire-stale-targets job for tenant ${tenantId}`,
      error,
    );
  }

  try {
    const sendJobId = await dependencies.scheduleSendSequenceSteps(tenantId, '*/5 * * * *');
    dependencies.logger.info('Marketing send-sequence-steps schedule converged', {
      tenantId,
      sendJobId,
    });
  } catch (error) {
    dependencies.logger.error(
      `Failed to schedule marketing send-sequence-steps job for tenant ${tenantId}`,
      error,
    );
  }
}
