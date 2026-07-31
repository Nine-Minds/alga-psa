/**
 * Job to clean up temporary forms across all tenants
 *
 * This job is meant to be run periodically to remove temporary forms
 * that were created for inline workflow tasks
 */

import { withAdminTransaction } from '@alga-psa/db';
import { isEnterprise } from '@alga-psa/core';
import { getTaskInboxService } from '@alga-psa/shared/task-inbox';
import logger from '@alga-psa/core/logger';
import { getJobScheduler } from '../jobSchedulerAccessor';

/**
 * Execute the cleanup job
 */
export async function cleanupTemporaryFormsJob(): Promise<{ success: boolean; deletedCount: number }> {
  try {
    logger.info('Starting cleanup job for temporary workflow forms');

    // Use transaction for cleanup operations
    const result = await withAdminTransaction(async (trx) => {
      // Get the task inbox service
      const taskInboxService = getTaskInboxService();

      // Run the cleanup
      const deletedCount = await taskInboxService.cleanupAllTemporaryForms(trx);

      return deletedCount;
    });

    logger.info(`Cleanup job completed successfully. Deleted ${result} temporary forms.`);

    return {
      success: true,
      deletedCount: result
    };
  } catch (error) {
    logger.error('Error executing cleanup job for temporary workflow forms', error);

    return {
      success: false,
      deletedCount: 0
    };
  }
}

/**
 * Schedule the cleanup job to run daily
 *
 * @param cronExpression Optional cron expression, defaults to daily at 2:00 AM
 * @returns The job ID or null if scheduling failed
 */
export async function scheduleCleanupTemporaryFormsJob(
  cronExpression: string = '0 2 * * *' // Default: daily at 2:00 AM
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
      logger.error('Scheduler not available, skipping scheduling of cleanupTemporaryFormsJob');
      return null;
    }

    // This is a system-wide job, so we use a special tenant ID
    const jobId = await scheduler.scheduleRecurringJob(
      'cleanup-temporary-workflow-forms',
      cronExpression,
      { tenantId: 'system' } // System-wide job
    );
    if (jobId) {
      logger.info(`Scheduled cleanupTemporaryFormsJob with ID ${jobId}`);
      return jobId;
    }
    logger.info('cleanupTemporaryFormsJob already scheduled (singleton active)', {
      returnedJobId: jobId,
      cron: cronExpression
    });
    return null;
  } catch (error) {
    logger.error('Error scheduling cleanupTemporaryFormsJob', error);
    return null;
  }
}
