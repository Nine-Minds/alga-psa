import { initializeScheduler, scheduleExpiredCreditsJob, scheduleExpiringCreditsNotificationJob, scheduleCreditReconciliationJob } from './index';
import logger from '@shared/core/logger';
import { createTenantKnex } from 'server/src/lib/db';

/**
 * Initialize all scheduled jobs for the application
 * This function sets up recurring jobs that need to run on a schedule
 */
export async function initializeScheduledJobs(): Promise<void> {
  try {
    // Initialize the scheduler
    await initializeScheduler();
    logger.info('Job scheduler initialized');
    
    // Get all tenants
    const { knex } = await createTenantKnex();
    const tenants = await knex('tenants').select('tenant_id');
    
    // Set up expired credits job for each tenant
    for (const tenantRecord of tenants) {
      const tenantId = tenantRecord.tenant_id;
      
      // Schedule daily job to process expired credits (runs at 1:00 AM)
      const expiredJobId = await scheduleExpiredCreditsJob(tenantId, undefined, '0 1 * * *');
      
      if (expiredJobId) {
        logger.info(`Scheduled expired credits job for tenant ${tenantId} with job ID ${expiredJobId}`);
      } else {
        logger.error(`Failed to schedule expired credits job for tenant ${tenantId}`);
      }
      
      // Schedule daily job to send notifications about expiring credits (runs at 9:00 AM)
      const notificationJobId = await scheduleExpiringCreditsNotificationJob(tenantId, undefined, '0 9 * * *');
      
      if (notificationJobId) {
        logger.info(`Scheduled expiring credits notification job for tenant ${tenantId} with job ID ${notificationJobId}`);
      } else {
        logger.error(`Failed to schedule expiring credits notification job for tenant ${tenantId}`);
      }
      
      // Schedule daily job to run credit reconciliation (runs at 2:00 AM)
      const reconciliationJobId = await scheduleCreditReconciliationJob(tenantId, undefined, '0 2 * * *');
      
      if (reconciliationJobId) {
        logger.info(`Scheduled credit reconciliation job for tenant ${tenantId} with job ID ${reconciliationJobId}`);
      } else {
        logger.error(`Failed to schedule credit reconciliation job for tenant ${tenantId}`);
      }
    }
    
    logger.info('All scheduled jobs initialized');
  } catch (error: any) {
    logger.error('Failed to initialize scheduled jobs:', error);
    throw error;
  }
}