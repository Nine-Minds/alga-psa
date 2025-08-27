import { initializeScheduler, scheduleExpiredCreditsJob, scheduleExpiringCreditsNotificationJob, scheduleCreditReconciliationJob, scheduleReconcileBucketUsageJob, scheduleCleanupTemporaryFormsJob } from './index';
import logger from '@shared/core/logger';
import { getConnection } from 'server/src/lib/db/db';

/**
 * Initialize all scheduled jobs for the application
 * This function sets up recurring jobs that need to run on a schedule
 */
export async function initializeScheduledJobs(): Promise<void> {
  try {
    // Initialize the scheduler
    await initializeScheduler();
    logger.info('Job scheduler initialized');
    
    // Get all tenants using root connection
    const knex = await getConnection(null);
    const tenants = await knex('tenants').select('tenant');
    logger.info(`Preparing to schedule jobs for ${tenants.length} tenants`);
    
    // Set up expired credits job for each tenant
    for (const tenantRecord of tenants) {
      const tenantId = tenantRecord.tenant;
      
      // Schedule daily job to process expired credits (runs at 1:00 AM)
      try {
        const cron = '0 1 * * *';
        const expiredJobId = await scheduleExpiredCreditsJob(tenantId, undefined, cron);
        if (expiredJobId) {
          logger.info(`Scheduled expired credits job for tenant ${tenantId} with job ID ${expiredJobId}`);
        } else {
          logger.info('Expired credits job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: expiredJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule expired credits job for tenant ${tenantId}`, error);
      }
      
      // Schedule daily job to send notifications about expiring credits (runs at 9:00 AM)
      try {
        const cron = '0 9 * * *';
        const notificationJobId = await scheduleExpiringCreditsNotificationJob(tenantId, undefined, cron);
        if (notificationJobId) {
          logger.info(`Scheduled expiring credits notification job for tenant ${tenantId} with job ID ${notificationJobId}`);
        } else {
          logger.info('Expiring credits notification job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: notificationJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule expiring credits notification job for tenant ${tenantId}`, error);
      }
      
      // Schedule daily job to run credit reconciliation (runs at 2:00 AM)
      try {
        const cron = '0 2 * * *';
        const reconciliationJobId = await scheduleCreditReconciliationJob(tenantId, undefined, cron);
        if (reconciliationJobId) {
          logger.info(`Scheduled credit reconciliation job for tenant ${tenantId} with job ID ${reconciliationJobId}`);
        } else {
          logger.info('Credit reconciliation job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: reconciliationJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule credit reconciliation job for tenant ${tenantId}`, error);
      }
     
     // Schedule daily job to reconcile bucket usage (runs at 3:00 AM)
     try {
       const cron = '0 3 * * *';
       const reconcileJobId = await scheduleReconcileBucketUsageJob(tenantId); // Default cron used internally
       if (reconcileJobId) {
         logger.info(`Scheduled bucket usage reconciliation job for tenant ${tenantId} with job ID ${reconcileJobId}`);
       } else {
         logger.info('Bucket usage reconciliation job already scheduled (singleton active)', {
           tenantId,
           cron,
           returnedJobId: reconcileJobId
         });
       }
     } catch (error) {
       logger.error(`Failed to schedule bucket usage reconciliation job for tenant ${tenantId}`, error);
     }
   }
   
   // Schedule temporary forms cleanup job (system-wide)
   try {
     const cleanupJobId = await scheduleCleanupTemporaryFormsJob();
     if (cleanupJobId) {
       logger.info(`Scheduled temporary forms cleanup job with ID ${cleanupJobId}`);
     } else {
       logger.info('Temporary forms cleanup job already scheduled (singleton active)', {
         returnedJobId: cleanupJobId
       });
     }
   } catch (error) {
     logger.error('Failed to schedule temporary forms cleanup job', error);
   }
   
   logger.info('All scheduled jobs initialized');
  } catch (error: any) {
    logger.error('Failed to initialize scheduled jobs', error);
    throw error;
  }
}
