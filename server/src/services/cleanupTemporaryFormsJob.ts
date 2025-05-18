/**
 * Job to clean up temporary forms across all tenants
 * 
 * This job is meant to be run periodically to remove temporary forms
 * that were created for inline workflow tasks
 */

import { getAdminConnection } from '@shared/db/admin.js';
import { getTaskInboxService } from '@shared/workflow/core/taskInboxService.js';

/**
 * Execute the cleanup job
 */
export async function cleanupTemporaryFormsJob(): Promise<{ success: boolean; deletedCount: number }> {
  try {
    console.log('Starting cleanup job for temporary workflow forms');
    
    // Get database connection
    const knex = await getAdminConnection();
    
    // Get the task inbox service
    const taskInboxService = getTaskInboxService();
    
    // Run the cleanup
    const deletedCount = await taskInboxService.cleanupAllTemporaryForms(knex);
    
    console.log(`Cleanup job completed successfully. Deleted ${deletedCount} temporary forms.`);
    
    return {
      success: true,
      deletedCount
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
 * Register this job with the scheduler
 * 
 * @param jobService The job service instance
 */
export function registerCleanupTemporaryFormsJob(jobService: any): void {
  if (!jobService) {
    console.warn('Job service not available, skipping registration of cleanupTemporaryFormsJob');
    return;
  }
  
  try {
    // Register the job to run daily at 2 AM
    jobService.registerJob({
      name: 'cleanup-temporary-workflow-forms',
      displayName: 'Cleanup Temporary Workflow Forms',
      description: 'Removes temporary forms created for inline workflow tasks',
      schedule: '0 2 * * *', // Daily at 2 AM (cron syntax)
      handler: cleanupTemporaryFormsJob,
      singleInstance: true,
      timeout: 30 * 60 * 1000, // 30 minutes timeout
      retryOnFailure: true,
      maxRetries: 3,
      retryDelay: 5 * 60 * 1000 // 5 minutes
    });
    
    console.log('Successfully registered cleanupTemporaryFormsJob');
  } catch (error) {
    console.error('Error registering cleanupTemporaryFormsJob:', error);
  }
}