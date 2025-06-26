/**
 * Job to clean up temporary forms across all tenants
 * 
 * This job is meant to be run periodically to remove temporary forms
 * that were created for inline workflow tasks
 */

import { withAdminTransaction } from '@shared/db';
import { getTaskInboxService } from '@shared/workflow/core/taskInboxService.js';

/**
 * Execute the cleanup job
 */
export async function cleanupTemporaryFormsJob(): Promise<{ success: boolean; deletedCount: number }> {
  try {
    console.log('Starting cleanup job for temporary workflow forms');
    
    // Use transaction for cleanup operations
    const result = await withAdminTransaction(async (trx) => {
      // Get the task inbox service
      const taskInboxService = getTaskInboxService();
      
      // Run the cleanup
      const deletedCount = await taskInboxService.cleanupAllTemporaryForms(trx);
      
      return deletedCount;
    });
    
    console.log(`Cleanup job completed successfully. Deleted ${result} temporary forms.`);
    
    return {
      success: true,
      deletedCount: result
    };
  } catch (error) {
    console.error('Error executing cleanup job for temporary workflow forms:', error);
    
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
  try {
    // Import here to avoid circular dependencies
    const { initializeScheduler } = await import('server/src/lib/jobs/index');
    const scheduler = await initializeScheduler();
    
    if (!scheduler) {
      console.warn('Scheduler not available, skipping scheduling of cleanupTemporaryFormsJob');
      return null;
    }
    
    // This is a system-wide job, so we use a special tenant ID
    const jobId = await scheduler.scheduleRecurringJob(
      'cleanup-temporary-workflow-forms',
      cronExpression,
      { tenantId: 'system' } // System-wide job
    );
    
    console.log('Successfully scheduled cleanupTemporaryFormsJob with ID:', jobId);
    return jobId;
  } catch (error) {
    console.error('Error scheduling cleanupTemporaryFormsJob:', error);
    return null;
  }
}