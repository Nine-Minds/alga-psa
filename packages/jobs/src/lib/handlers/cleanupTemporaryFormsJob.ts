/**
 * Job to clean up temporary forms across all tenants
 *
 * This job is meant to be run periodically to remove temporary forms
 * that were created for inline workflow tasks
 */

import { withAdminTransaction } from '@alga-psa/db';
import { getTaskInboxService } from '@alga-psa/shared/task-inbox';
import logger from '@alga-psa/core/logger';

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
