import logger from '@alga-psa/core/logger';

import { getConnection, tenantDb } from '@alga-psa/db';
import { isEnterprise } from '@alga-psa/core';
import { getJobScheduler } from '../jobSchedulerAccessor';

const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;
const WEBHOOK_DELIVERY_CLEANUP_BATCH_SIZE = 10_000;
const WEBHOOK_DELIVERY_CLEANUP_TENANT = '__webhook_delivery_retention_cleanup__';
const WEBHOOK_DELIVERY_CLEANUP_REASON = 'webhook delivery retention cleanup scans expired deliveries across tenants';

export async function cleanupWebhookDeliveriesJob(): Promise<{
  success: boolean;
  deletedCount: number;
}> {
  try {
    logger.info('[WebhookCleanupJob] Starting webhook delivery retention cleanup');

    const knex = await getConnection(null);
    let deletedCount = 0;

    while (true) {
      const webhookRetentionDb = tenantDb(knex, WEBHOOK_DELIVERY_CLEANUP_TENANT);
      const doomedDeliveries = webhookRetentionDb
        .unscoped('webhook_deliveries', WEBHOOK_DELIVERY_CLEANUP_REASON)
        .select('tenant', 'delivery_id')
        .where(
          'attempted_at',
          '<',
          knex.raw("now() - (? * interval '1 day')", [WEBHOOK_DELIVERY_RETENTION_DAYS]),
        )
        .orderBy('attempted_at', 'asc')
        .limit(WEBHOOK_DELIVERY_CLEANUP_BATCH_SIZE);

      const deletedRows = await webhookRetentionDb
        .unscoped('webhook_deliveries as wd', WEBHOOK_DELIVERY_CLEANUP_REASON)
        .with('doomed', doomedDeliveries)
        .using(['doomed'])
        .where('wd.tenant', knex.ref('doomed.tenant'))
        .where('wd.delivery_id', knex.ref('doomed.delivery_id'))
        .delete()
        .returning('wd.delivery_id');

      const batchDeleted = Array.isArray(deletedRows) ? deletedRows.length : 0;
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
  // EE runs this as a global Temporal Schedule (maintenanceJobWorkflow).
  if (isEnterprise) {
    return null;
  }
  try {
    // The CE server registers its initializeScheduler via registerJobSchedulerAccessor
    // so this package never imports server/src (which would drag the full server handler
    // registry into the Temporal worker build).
    const scheduler = await getJobScheduler();

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
