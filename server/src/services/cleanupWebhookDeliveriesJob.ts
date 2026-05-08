import logger from '@alga-psa/core/logger';

import { getConnection } from 'server/src/lib/db/db';

const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;
const WEBHOOK_DELIVERY_CLEANUP_BATCH_SIZE = 10_000;

export async function cleanupWebhookDeliveriesJob(): Promise<{
  success: boolean;
  deletedCount: number;
}> {
  try {
    logger.info('[WebhookCleanupJob] Starting webhook delivery retention cleanup');

    const knex = await getConnection(null);
    let deletedCount = 0;

    while (true) {
      const result = await knex.raw(
        `
          WITH doomed AS (
            SELECT tenant, delivery_id
            FROM webhook_deliveries
            WHERE attempted_at < now() - interval '${WEBHOOK_DELIVERY_RETENTION_DAYS} days'
            ORDER BY attempted_at ASC
            LIMIT ?
          )
          DELETE FROM webhook_deliveries wd
          USING doomed
          WHERE wd.tenant = doomed.tenant
            AND wd.delivery_id = doomed.delivery_id
          RETURNING wd.delivery_id
        `,
        [WEBHOOK_DELIVERY_CLEANUP_BATCH_SIZE],
      );

      const batchDeleted = Array.isArray(result?.rows) ? result.rows.length : 0;
      deletedCount += batchDeleted;

      if (batchDeleted < WEBHOOK_DELIVERY_CLEANUP_BATCH_SIZE) {
        break;
      }
    }

    logger.info('[WebhookCleanupJob] Completed webhook delivery retention cleanup', {
      deletedCount,
      retentionDays: WEBHOOK_DELIVERY_RETENTION_DAYS,
    });

    return {
      success: true,
      deletedCount,
    };
  } catch (error) {
    logger.error('[WebhookCleanupJob] Failed webhook delivery retention cleanup', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      deletedCount: 0,
    };
  }
}

export async function scheduleCleanupWebhookDeliveriesJob(
  cronExpression: string = '*/15 * * * *',
): Promise<string | null> {
  try {
    const { initializeScheduler } = await import('server/src/lib/jobs/index');
    const scheduler = await initializeScheduler();

    if (!scheduler) {
      logger.error('[WebhookCleanupJob] Scheduler unavailable, skipping webhook delivery cleanup scheduling');
      return null;
    }

    const jobId = await scheduler.scheduleRecurringJob(
      'cleanup-webhook-deliveries',
      cronExpression,
      { tenantId: 'system' },
    );

    if (jobId) {
      logger.info('[WebhookCleanupJob] Scheduled webhook delivery cleanup job', {
        jobId,
        cronExpression,
      });
      return jobId;
    }

    logger.info('[WebhookCleanupJob] Cleanup job already scheduled (singleton active)', {
      cronExpression,
      returnedJobId: jobId,
    });
    return null;
  } catch (error) {
    logger.error('[WebhookCleanupJob] Error scheduling webhook delivery cleanup job', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}
