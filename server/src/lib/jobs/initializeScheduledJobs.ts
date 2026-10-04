import { initializeScheduler, scheduleExpiredCreditsJob, scheduleExpiringCreditsNotificationJob, schedulePrepaidBalanceAlertScanJob, scheduleExpiredHourBlocksJob, scheduleExpiringHourBlocksNotificationJob, scheduleQuoteAutoExpirationJob, scheduleReconcileBucketUsageJob, scheduleReconcileHourBlockAllocationsJob, scheduleCleanupTemporaryFormsJob, scheduleCleanupWebhookDeliveriesJob, scheduleMicrosoftWebhookRenewalJob, scheduleGooglePubSubVerificationJob, scheduleGoogleGmailWatchRenewalJob, scheduleEmailWebhookMaintenanceJob, scheduleRenewalQueueProcessingJob, scheduleDateTriggerScanJob, scheduleGenerateRecurringTicketsJob, scheduleSlaTimerJob, scheduleSearchReconcileJob, scheduleAutoCloseTicketsJob, scheduleLowStockNotificationJob, scheduleOpportunityDisciplineJob, scheduleOpportunityWeeklyDigestJob, scheduleOpportunityGeneratorsJob, scheduleMarketingFlipDuePostsJob, scheduleMarketingExpireStaleTargetsJob, scheduleMarketingSendSequenceStepsJob, scheduleProjectDateReadinessJob, scheduleInboundEmailRecoveryJob, scheduleProviderDisconnectRetryJob } from './index';
import logger from '@alga-psa/core/logger';
import { getConnection } from 'server/src/lib/db/db';
import { tenantDb } from '@alga-psa/db';
import { scheduleMarketingJobsForTenant } from './marketingScheduleCutover';

const isEnterpriseWorkflowEdition = (): boolean =>
  process.env.EDITION === 'enterprise'
  || process.env.EDITION === 'ee'
  || process.env.NEXT_PUBLIC_EDITION === 'enterprise';

/**
 * Initialize all scheduled jobs for the application.
 *
 * CE converges its per-tenant pg-boss schedules here. EE/appliance does not:
 * every recurring job there is a global Temporal schedule owned by the worker
 * (packages/types/src/constants/maintenanceFanoutSchedules.ts), so boot
 * time never grows with the tenant count.
 */
export async function initializeScheduledJobs(): Promise<void> {
  try {
    // Registers the legacy pg-boss handlers, which both editions still need
    // for immediate jobs (invoice generation, imports, ...).
    await initializeScheduler();
    logger.info('Job scheduler initialized');

    if (isEnterpriseWorkflowEdition()) {
      logger.info('Skipping server-side recurring schedule convergence (Temporal owns recurring schedules in EE)');
      return;
    }

    // Get all tenants using root connection
    const knex = await getConnection(null);
    const tenants = await tenantDb(knex, '__scheduled_jobs_tenant_enumeration__')
      .unscoped('tenants', 'scheduler enumerates all tenants to register recurring jobs')
      .whereNull('suspended_at')
      .select('tenant');
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

      // Schedule daily prepaid balance alert scan (runs at 9:00 AM)
      try {
        const cron = '0 9 * * *';
        const scanJobId = await schedulePrepaidBalanceAlertScanJob(tenantId, cron);
        if (scanJobId) {
          logger.info(`Scheduled prepaid balance alert scan job for tenant ${tenantId} with job ID ${scanJobId}`);
        } else {
          logger.info('Prepaid balance alert scan job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: scanJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule prepaid balance alert scan job for tenant ${tenantId}`, error);
      }

      // Schedule daily job to expire hour blocks (runs at 1:30 AM)
      try {
        const cron = '30 1 * * *';
        const expiredJobId = await scheduleExpiredHourBlocksJob(tenantId, cron);
        if (expiredJobId) {
          logger.info(`Scheduled expired hour blocks job for tenant ${tenantId} with job ID ${expiredJobId}`);
        } else {
          logger.info('Expired hour blocks job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: expiredJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule expired hour blocks job for tenant ${tenantId}`, error);
      }

      // Schedule daily job to notify about expiring hour blocks (runs at 9:15 AM)
      try {
        const cron = '15 9 * * *';
        const notificationJobId = await scheduleExpiringHourBlocksNotificationJob(tenantId, cron);
        if (notificationJobId) {
          logger.info(`Scheduled expiring hour blocks notification job for tenant ${tenantId} with job ID ${notificationJobId}`);
        } else {
          logger.info('Expiring hour blocks notification job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: notificationJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule expiring hour blocks notification job for tenant ${tenantId}`, error);
      }

      // Schedule daily per-location low-stock alerts (runs at 7:30 AM) — inventory F037/F038
      try {
        const cron = '30 7 * * *';
        const lowStockJobId = await scheduleLowStockNotificationJob(tenantId, cron);
        if (lowStockJobId) {
          logger.info(`Scheduled low-stock notification job for tenant ${tenantId} with job ID ${lowStockJobId}`);
        } else {
          logger.info('Low-stock notification job already scheduled (singleton active)', { tenantId, cron });
        }
      } catch (error) {
        logger.error(`Failed to schedule low-stock notification job for tenant ${tenantId}`, error);
      }

      try {
        const disciplineJobId = await scheduleOpportunityDisciplineJob(tenantId, '0 7 * * *');
        logger.info('Opportunity discipline schedule converged', { tenantId, disciplineJobId });
      } catch (error) {
        logger.error(`Failed to schedule opportunity discipline job for tenant ${tenantId}`, error);
      }

      try {
        const generatorsJobId = await scheduleOpportunityGeneratorsJob(tenantId, '0 6 * * *');
        logger.info('Opportunity generators schedule converged', { tenantId, generatorsJobId });
      } catch (error) {
        logger.error(`Failed to schedule opportunity generators job for tenant ${tenantId}`, error);
      }

      try {
        const cron = '15 0 * * *';
        const readinessJobId = await scheduleProjectDateReadinessJob(tenantId, cron);
        logger.info('Project date readiness schedule converged', { tenantId, readinessJobId, cron });
      } catch (error) {
        logger.error(`Failed to schedule project date readiness job for tenant ${tenantId}`, error);
      }

      try {
        const digestJobId = await scheduleOpportunityWeeklyDigestJob(tenantId, '0 8 * * 1');
        logger.info('Opportunity weekly digest schedule converged', { tenantId, digestJobId });
      } catch (error) {
        logger.error(`Failed to schedule opportunity weekly digest job for tenant ${tenantId}`, error);
      }

      try { await scheduleDateTriggerScanJob(tenantId, '5 * * * *'); } catch (error) { logger.error(`Failed to schedule workflow date trigger scan for tenant ${tenantId}`, error); }

      try { await scheduleGenerateRecurringTicketsJob(tenantId); } catch (error) { logger.error(`Failed to schedule recurring ticket generation for tenant ${tenantId}`, error); }

      await scheduleMarketingJobsForTenant({
        tenantId,
        enterpriseWorkflowEdition: false,
        dependencies: {
          logger,
          scheduleFlipDuePosts: scheduleMarketingFlipDuePostsJob,
          scheduleExpireStaleTargets: scheduleMarketingExpireStaleTargetsJob,
          scheduleSendSequenceSteps: scheduleMarketingSendSequenceStepsJob,
        },
      });

     
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

      // Schedule daily job to reconcile hour-block allocations (runs at 3:15 AM)
      try {
        const cron = '15 3 * * *';
        const reconcileJobId = await scheduleReconcileHourBlockAllocationsJob(tenantId, cron);
        if (reconcileJobId) {
          logger.info(`Scheduled hour-block allocation reconciliation job for tenant ${tenantId} with job ID ${reconcileJobId}`);
        } else {
          logger.info('Hour-block allocation reconciliation job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: reconcileJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule hour-block allocation reconciliation job for tenant ${tenantId}`, error);
      }

      // Schedule auto-close scan (every 15 minutes; closes stale tickets per board auto-close rules)
      try {
        const cron = '*/15 * * * *';
        const autoCloseJobId = await scheduleAutoCloseTicketsJob(tenantId); // Default cron used internally
        if (autoCloseJobId) {
          logger.info(`Scheduled auto-close tickets job for tenant ${tenantId} with job ID ${autoCloseJobId}`);
        } else {
          logger.info('Auto-close tickets job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: autoCloseJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule auto-close tickets job for tenant ${tenantId}`, error);
      }

      // Schedule daily job to reconcile the app-wide search index (runs at 6:00 AM)
      try {
        const cron = '0 6 * * *';
        const searchReconcileJobId = await scheduleSearchReconcileJob(tenantId, cron);
        if (searchReconcileJobId) {
          logger.info(`Scheduled search index reconciliation job for tenant ${tenantId} with job ID ${searchReconcileJobId}`);
        } else {
          logger.info('Search index reconciliation job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: searchReconcileJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule search index reconciliation job for tenant ${tenantId}`, error);
      }

      // Schedule Microsoft calendar webhook renewal (every 30 minutes)
      try {
        const cron = '*/30 * * * *';
        const renewalJobId = await scheduleMicrosoftWebhookRenewalJob(tenantId, cron);
        if (renewalJobId) {
          logger.info(`Scheduled Microsoft calendar webhook renewal job for tenant ${tenantId} with job ID ${renewalJobId}`);
        } else {
          logger.info('Microsoft calendar webhook renewal job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: renewalJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule Microsoft calendar webhook renewal job for tenant ${tenantId}`, error);
      }

      // Schedule Google Pub/Sub subscription verification (hourly)
      try {
        const cron = '15 * * * *';
        const verificationJobId = await scheduleGooglePubSubVerificationJob(tenantId, cron);
        if (verificationJobId) {
          logger.info(`Scheduled Google Pub/Sub verification job for tenant ${tenantId} with job ID ${verificationJobId}`);
        } else {
          logger.info('Google Pub/Sub verification job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: verificationJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule Google Pub/Sub verification job for tenant ${tenantId}`, error);
      }

      // Schedule Gmail watch renewal (every 30 minutes)
      try {
        const cron = '*/30 * * * *';
        const renewalJobId = await scheduleGoogleGmailWatchRenewalJob(tenantId, cron);
        if (renewalJobId) {
          logger.info(`Scheduled Gmail watch renewal job for tenant ${tenantId} with job ID ${renewalJobId}`);
        } else {
          logger.info('Gmail watch renewal job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: renewalJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule Gmail watch renewal job for tenant ${tenantId}`, error);
      }

      // Schedule Email Webhook Maintenance (daily at 4:00 AM)
      try {
        const cron = '0 4 * * *';
        const maintenanceJobId = await scheduleEmailWebhookMaintenanceJob(tenantId, cron);
        if (maintenanceJobId) {
          logger.info(`Scheduled email webhook maintenance job for tenant ${tenantId} with job ID ${maintenanceJobId}`);
        } else {
          logger.info('Email webhook maintenance job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: maintenanceJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule email webhook maintenance job for tenant ${tenantId}`, error);
      }

      // Schedule inbound email recovery sweep (every minute) for durable ledgers.
      try {
        const recoveryCron = process.env.UNIFIED_INBOUND_EMAIL_RECOVERY_CRON || '*/1 * * * *';
        const recoveryJobId = await scheduleInboundEmailRecoveryJob(tenantId, recoveryCron);
        if (recoveryJobId) {
          logger.info(`Scheduled inbound email recovery job for tenant ${tenantId} with job ID ${recoveryJobId}`);
        } else {
          logger.info('Inbound email recovery job already scheduled (singleton active)', {
            tenantId,
            cron: recoveryCron,
            returnedJobId: recoveryJobId,
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule inbound email recovery job for tenant ${tenantId}`, error);
      }

      // Schedule provider disconnect retry sweep (every 5 minutes). Cheap
      // per-tenant no-op when no disconnect is pending.
      try {
        const retryCron = process.env.PROVIDER_DISCONNECT_RETRY_CRON || '*/5 * * * *';
        const retryJobId = await scheduleProviderDisconnectRetryJob(tenantId, retryCron);
        if (retryJobId) {
          logger.info(`Scheduled provider disconnect retry job for tenant ${tenantId} with job ID ${retryJobId}`);
        } else {
          logger.info('Provider disconnect retry job already scheduled (singleton active)', {
            tenantId,
            cron: retryCron,
            returnedJobId: retryJobId,
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule provider disconnect retry job for tenant ${tenantId}`, error);
      }

      // Schedule renewal queue processing (daily at 5:00 AM)
      try {
        const cron = '0 5 * * *';
        const renewalQueueJobId = await scheduleRenewalQueueProcessingJob(tenantId, 90, cron);
        if (renewalQueueJobId) {
          logger.info(`Scheduled renewal queue processing job for tenant ${tenantId} with job ID ${renewalQueueJobId}`);
        } else {
          logger.info('Renewal queue processing job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: renewalQueueJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule renewal queue processing job for tenant ${tenantId}`, error);
      }

      // Schedule SLA Timer (every 5 minutes)
      try {
        const cron = '*/5 * * * *';
        const slaTimerJobId = await scheduleSlaTimerJob(tenantId, cron);
        if (slaTimerJobId) {
          logger.info(`Scheduled SLA timer job for tenant ${tenantId} with job ID ${slaTimerJobId}`);
        } else {
          logger.info('SLA timer job already scheduled (singleton active)', {
            tenantId,
            cron,
            returnedJobId: slaTimerJobId
          });
        }
      } catch (error) {
        logger.error(`Failed to schedule SLA timer job for tenant ${tenantId}`, error);
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

   try {
     const cleanupJobId = await scheduleCleanupWebhookDeliveriesJob();
     if (cleanupJobId) {
       logger.info(`Scheduled webhook delivery cleanup job with ID ${cleanupJobId}`);
     } else {
       logger.info('Webhook delivery cleanup job already scheduled (singleton active)', {
         returnedJobId: cleanupJobId,
       });
     }
   } catch (error) {
     logger.error('Failed to schedule webhook delivery cleanup job', error);
   }

   logger.info('All scheduled jobs initialized');
  } catch (error: any) {
    logger.error('Failed to initialize scheduled jobs', error);
    throw error;
  }
}
