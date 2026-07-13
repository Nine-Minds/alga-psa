import { initializeScheduler, scheduleExpiredCreditsJob, scheduleExpiringCreditsNotificationJob, scheduleCreditReconciliationJob, scheduleQuoteAutoExpirationJob, scheduleReconcileBucketUsageJob, scheduleCleanupTemporaryFormsJob, scheduleCleanupWebhookDeliveriesJob, scheduleCleanupAiSessionKeysJob, scheduleMicrosoftWebhookRenewalJob, scheduleTeamsMeetingArtifactSubscriptionRenewalJob, scheduleTeamsMeetingSweepJob, scheduleGooglePubSubVerificationJob, scheduleGoogleGmailWatchRenewalJob, scheduleEmailWebhookMaintenanceJob, scheduleRenewalQueueProcessingJob, scheduleSlaTimerJob, scheduleWorkflowQuotaResumeScanJob, scheduleSearchReconcileJob, scheduleAutoCloseTicketsJob, scheduleLowStockNotificationJob, scheduleOpportunityDisciplineJob, scheduleOpportunityWeeklyDigestJob, scheduleOpportunityGeneratorsJob } from './index';
import { scheduleAccountingSyncCycleJob } from './handlers/accountingSyncCycleHandler';
import { scheduleHuduAutoSyncJob } from './handlers/huduAutoSyncHandler';
import logger from '@alga-psa/core/logger';
import { getConnection } from 'server/src/lib/db/db';
import { tenantDb } from '@alga-psa/db';

const isEnterpriseWorkflowEdition = (): boolean =>
  process.env.EDITION === 'enterprise'
  || process.env.EDITION === 'ee'
  || process.env.NEXT_PUBLIC_EDITION === 'enterprise';

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
    const tenants = await tenantDb(knex, '__scheduled_jobs_tenant_enumeration__')
      .unscoped('tenants', 'scheduler enumerates all tenants to register recurring jobs')
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
        const digestJobId = await scheduleOpportunityWeeklyDigestJob(tenantId, '0 8 * * 1');
        logger.info('Opportunity weekly digest schedule converged', { tenantId, digestJobId });
      } catch (error) {
        logger.error(`Failed to schedule opportunity weekly digest job for tenant ${tenantId}`, error);
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

      // Schedule the accounting sync cycle (every 15 minutes, EE only; cheap
      // no-op for tenants without a connected accounting integration)
      try {
        const syncJobId = await scheduleAccountingSyncCycleJob(tenantId);
        if (syncJobId) {
          logger.info(`Scheduled accounting sync cycle for tenant ${tenantId} with job ID ${syncJobId}`);
        }
      } catch (error) {
        logger.error(`Failed to schedule accounting sync cycle for tenant ${tenantId}`, error);
      }

      // Converge the Hudu daily auto-sync schedule (EE only; created only for
      // tenants with an active Hudu connection AND settings.autoSync.enabled)
      try {
        const huduJobId = await scheduleHuduAutoSyncJob(tenantId);
        if (huduJobId) {
          logger.info(`Scheduled Hudu auto-sync for tenant ${tenantId} with job ID ${huduJobId}`);
        }
      } catch (error) {
        logger.error(`Failed to schedule Hudu auto-sync for tenant ${tenantId}`, error);
      }

      // Schedule Microsoft calendar webhook renewal (every 30 minutes)
      // Note: In EE, this is handled by Temporal workflows, so we skip pg-boss scheduling
      if (process.env.EDITION !== 'enterprise') {
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
      } else {
        logger.info(`Skipping pg-boss calendar webhook renewal for tenant ${tenantId} (EE uses Temporal workflows)`);
      }

      if (isEnterpriseWorkflowEdition()) {
        try {
          const cron = '*/30 * * * *';
          const renewalJobId = await scheduleTeamsMeetingArtifactSubscriptionRenewalJob(tenantId, cron);
          if (renewalJobId) {
            logger.info(`Scheduled Teams meeting artifact subscription renewal job for tenant ${tenantId} with job ID ${renewalJobId}`);
          } else {
            logger.info('Teams meeting artifact subscription renewal covered by the Temporal fan-out schedule (or singleton already active)', {
              tenantId,
              cron,
              returnedJobId: renewalJobId
            });
          }
        } catch (error) {
          logger.error(`Failed to schedule Teams meeting artifact subscription renewal job for tenant ${tenantId}`, error);
        }

        try {
          const cron = '*/10 * * * *';
          const sweepJobId = await scheduleTeamsMeetingSweepJob(tenantId, cron);
          if (sweepJobId) {
            logger.info(`Scheduled Teams meeting sweep job for tenant ${tenantId} with job ID ${sweepJobId}`);
          } else {
            logger.info('Teams meeting sweep covered by the Temporal fan-out schedule (or singleton already active)', {
              tenantId,
              cron,
              returnedJobId: sweepJobId
            });
          }
        } catch (error) {
          logger.error(`Failed to schedule Teams meeting sweep job for tenant ${tenantId}`, error);
        }
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

   if (process.env.EDITION === 'enterprise') {
     try {
       const aiCleanupJobId = await scheduleCleanupAiSessionKeysJob();
       if (aiCleanupJobId) {
         logger.info(`Scheduled AI session key cleanup job with ID ${aiCleanupJobId}`);
       } else {
         logger.info('AI session key cleanup job already scheduled (singleton active)', {
           returnedJobId: aiCleanupJobId,
         });
       }
     } catch (error) {
       logger.error('Failed to schedule AI session key cleanup job', error);
     }
   }

   if (isEnterpriseWorkflowEdition()) {
     try {
       const cron = '*/5 * * * *';
       const quotaResumeJobId = await scheduleWorkflowQuotaResumeScanJob(cron);
       if (quotaResumeJobId) {
         logger.info(`Scheduled workflow quota resume scan job with ID ${quotaResumeJobId}`);
       } else {
         logger.info('Workflow quota resume scan job already scheduled (singleton active)', {
           cron,
           returnedJobId: quotaResumeJobId,
         });
       }
     } catch (error) {
       logger.error('Failed to schedule workflow quota resume scan job', error);
     }
   }
   
   logger.info('All scheduled jobs initialized');
  } catch (error: any) {
    logger.error('Failed to initialize scheduled jobs', error);
    throw error;
  }
}
