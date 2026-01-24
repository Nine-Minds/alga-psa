import { Job } from 'pg-boss';
import { JobScheduler, JobFilter, IJobScheduler, DummyJobScheduler } from './jobScheduler';
import { InvoiceZipJobHandler } from 'server/src/lib/jobs/handlers/invoiceZipHandler';
import { InvoiceEmailHandler, InvoiceEmailJobData } from 'server/src/lib/jobs/handlers/invoiceEmailHandler';
import type { InvoiceZipJobData } from 'server/src/lib/jobs/handlers/invoiceZipHandler';
import { generateInvoiceHandler, GenerateInvoiceData } from './handlers/generateInvoiceHandler';
import { expiredCreditsHandler, ExpiredCreditsJobData } from './handlers/expiredCreditsHandler';
import { expiringCreditsNotificationHandler, ExpiringCreditsNotificationJobData } from './handlers/expiringCreditsNotificationHandler';
import { creditReconciliationHandler, CreditReconciliationJobData } from './handlers/creditReconciliationHandler';
// Import the new handler
import { handleReconcileBucketUsage, ReconcileBucketUsageJobData } from './handlers/reconcileBucketUsageHandler';
import { handleAssetImportJob, AssetImportJobData } from './handlers/assetImportHandler';
import { emailWebhookMaintenanceHandler, EmailWebhookMaintenanceJobData } from './handlers/emailWebhookMaintenanceHandler';
import { renewGoogleGmailWatchSubscriptions, GoogleGmailWatchRenewalJobData } from './handlers/googleGmailWatchRenewalHandler';
import { cleanupTemporaryFormsJob } from '../../services/cleanupTemporaryFormsJob';
import { cleanupAiSessionKeysHandler, CleanupAiSessionKeysJobData } from './handlers/cleanupAiSessionKeysHandler';
import {
  renewMicrosoftCalendarWebhooks,
  verifyGoogleCalendarProvisioning,
  MicrosoftWebhookRenewalJobData,
  GooglePubSubVerificationJobData
} from './handlers/calendarWebhookMaintenanceHandler';
import { slaTimerHandler, SlaTimerJobData } from './handlers/slaTimerHandler';
import { JobService } from '../../services/job.service';
import { getConnection } from '../db/db';
import { StorageService } from '../../lib/storage/StorageService';
import logger from '@alga-psa/core/logger';

// =============================================================================
// NEW JOB RUNNER ABSTRACTION EXPORTS
// =============================================================================
// These exports provide the new abstraction layer that supports both PG Boss (CE)
// and Temporal (EE) as backend job runners. The existing exports below are
// maintained for backward compatibility.

export * from './interfaces';
export { JobRunnerFactory, getJobRunner } from './JobRunnerFactory';
export { PgBossJobRunner } from './runners/PgBossJobRunner';
export {
  initializeJobRunner,
  getJobRunnerInstance,
  stopJobRunner,
} from './initializeJobRunner';
export {
  JobHandlerRegistry,
  registerJobHandler,
  executeJobHandler,
} from './jobHandlerRegistry';
export {
  registerAllJobHandlers,
  getAvailableJobHandlers,
} from './registerAllHandlers';

// =============================================================================
// LEGACY EXPORTS (Backward Compatibility)
// =============================================================================
// The following exports maintain backward compatibility with existing code.
// New code should prefer using the IJobRunner interface via getJobRunner().

// Initialize the job scheduler singleton
let jobScheduler: IJobScheduler;

// Initialize function to ensure scheduler is ready
export const initializeScheduler = async (storageService?: StorageService) => {
  if (!jobScheduler) {
    const rootKnex = await getConnection(null);
    const jobService = await JobService.create();
    const storageService = new StorageService();
    jobScheduler = await JobScheduler.getInstance(jobService, storageService);

    if (!jobScheduler) {
      logger.error('Failed to initialize job scheduler');
      return DummyJobScheduler.getInstance();
    }
    
    // Register job handlers
    jobScheduler.registerJobHandler<GenerateInvoiceData>('generate-invoice', async (job: Job<GenerateInvoiceData>) => {
      await generateInvoiceHandler(job.data);
    });
    jobScheduler.registerJobHandler<AssetImportJobData>('asset_import', handleAssetImportJob);
    
    // Register expired credits handler
    jobScheduler.registerJobHandler<ExpiredCreditsJobData>('expired-credits', async (job: Job<ExpiredCreditsJobData>) => {
      await expiredCreditsHandler(job.data);
    });
    
    // Register expiring credits notification handler
    jobScheduler.registerJobHandler<ExpiringCreditsNotificationJobData>('expiring-credits-notification', async (job: Job<ExpiringCreditsNotificationJobData>) => {
      await expiringCreditsNotificationHandler(job.data);
    });
    
    // Register credit reconciliation handler
    jobScheduler.registerJobHandler<CreditReconciliationJobData>('credit-reconciliation', async (job: Job<CreditReconciliationJobData>) => {
      await creditReconciliationHandler(job.data);
    });
    
    // Register invoice handlers if storageService is provided
    if (storageService && jobService) {
      const invoiceZipHandler = new InvoiceZipJobHandler(jobService, storageService);
      jobScheduler.registerJobHandler<InvoiceZipJobData>('invoice_zip', async (job: Job<InvoiceZipJobData>) => {
        await invoiceZipHandler.handleInvoiceZipJob(job.id, job.data);
      });
        
      // Register invoice email handler
      jobScheduler.registerJobHandler<InvoiceEmailJobData>('invoice_email', async (job: Job<InvoiceEmailJobData>) => {
        if (!job.data || typeof job.data !== 'object') {
          logger.error(`Invalid job data received for invoice_email job ${job.id}`);
          return;
        }
        await InvoiceEmailHandler.handle(job.id, job.data);
      });
    }

    // Register reconcile bucket usage handler
    jobScheduler.registerJobHandler<ReconcileBucketUsageJobData>('reconcile-bucket-usage', async (job: Job<ReconcileBucketUsageJobData>) => {
      // Directly call the handler function
      await handleReconcileBucketUsage(job);
    });

    // Register email webhook maintenance handler
    jobScheduler.registerJobHandler<EmailWebhookMaintenanceJobData>('email-webhook-maintenance', async (job: Job<EmailWebhookMaintenanceJobData>) => {
      await emailWebhookMaintenanceHandler(job);
    });

    jobScheduler.registerJobHandler<GoogleGmailWatchRenewalJobData>('renew-google-gmail-watch', async (job: Job<GoogleGmailWatchRenewalJobData>) => {
      await renewGoogleGmailWatchSubscriptions(job.data);
    });

    // Register cleanup temporary forms handler
    jobScheduler.registerJobHandler('cleanup-temporary-workflow-forms', async (job: Job<{ tenantId: string }>) => {
      await cleanupTemporaryFormsJob();
    });

    if (process.env.EDITION === 'enterprise') {
      jobScheduler.registerJobHandler<CleanupAiSessionKeysJobData>('cleanup-ai-session-keys', async () => {
        await cleanupAiSessionKeysHandler();
      });
    }

    jobScheduler.registerJobHandler<MicrosoftWebhookRenewalJobData>(
      'renew-microsoft-calendar-webhooks',
      async (job: Job<MicrosoftWebhookRenewalJobData>) => {
        await renewMicrosoftCalendarWebhooks(job.data);
      }
    );

    jobScheduler.registerJobHandler<GooglePubSubVerificationJobData>(
      'verify-google-calendar-pubsub',
      async (job: Job<GooglePubSubVerificationJobData>) => {
        await verifyGoogleCalendarProvisioning(job.data);
      }
    );

    // Register SLA timer handler
    jobScheduler.registerJobHandler<SlaTimerJobData>(
      'sla-timer',
      async (job: Job<SlaTimerJobData>) => {
        await slaTimerHandler(job.data);
      }
    );

    // Note: Password reset token cleanup is handled automatically during token operations
    // No pg-boss job needed

  }
  return jobScheduler;
};


// Export types
export type {
  JobFilter,
  GenerateInvoiceData,
  ExpiredCreditsJobData,
  ExpiringCreditsNotificationJobData,
  CreditReconciliationJobData,
  ReconcileBucketUsageJobData,
  CleanupAiSessionKeysJobData,
  MicrosoftWebhookRenewalJobData,
  GooglePubSubVerificationJobData,
  GoogleGmailWatchRenewalJobData,
  AssetImportJobData,
  EmailWebhookMaintenanceJobData,
  SlaTimerJobData
};
// Export job scheduling helper functions
export const scheduleInvoiceGeneration = async (
  clientId: string,
  billingCycleId: string,
  runAt: Date,
  tenantId: string
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleScheduledJob<GenerateInvoiceData>(
    'generate-invoice',
    runAt,
    { clientId, billingCycleId, tenantId }
  );
};

// Export monitoring functions
export interface JobHistoryFilter {
  jobName?: string;
  startDate?: Date;
  endDate?: Date;
  status?: 'completed' | 'failed' | 'active' | 'expired';
  limit?: number;
  offset?: number;
}

export interface JobDetails {
  id: string;
  name: string;
  data: Record<string, unknown>;
  state: string;
  createdOn: Date;
  startedOn?: Date;
  completedOn?: Date;
}

export const scheduleImmediateJob = async <T extends Record<string, unknown>>(
  jobName: string,
  data: T
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleImmediateJob(jobName, data);
};

/**
 * Schedule a recurring job to process expired credits
 *
 * @param tenantId The tenant ID
 * @param clientId Optional client ID to limit processing to a specific client
 * @param cronExpression Cron expression for job scheduling (e.g., '0 0 * * *' for daily at midnight)
 * @returns Job ID if successful, null otherwise
 */
export const scheduleExpiredCreditsJob = async (
  tenantId: string,
  clientId?: string,
  cronExpression: string = '0 0 * * *' // Default: daily at midnight
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleRecurringJob<ExpiredCreditsJobData>(
    'expired-credits',
    cronExpression,
    { tenantId, clientId }
  );
};

/**
 * Schedule a recurring job to send notifications about credits that will expire soon
 *
 * @param tenantId The tenant ID
 * @param clientId Optional client ID to limit processing to a specific client
 * @param cronExpression Cron expression for job scheduling (e.g., '0 9 * * *' for daily at 9:00 AM)
 * @returns Job ID if successful, null otherwise
 */
export const scheduleExpiringCreditsNotificationJob = async (
  tenantId: string,
  clientId?: string,
  cronExpression: string = '0 9 * * *' // Default: daily at 9:00 AM
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleRecurringJob<ExpiringCreditsNotificationJobData>(
    'expiring-credits-notification',
    cronExpression,
    { tenantId, clientId }
  );
};

/**
 * Schedule a recurring job to reconcile bucket usage records.
 * This job recalculates usage based on time entries and usage tracking.
 *
 * @param tenantId The tenant ID for which to reconcile records.
 * @param cronExpression Cron expression for job scheduling (e.g., '0 3 * * *' for daily at 3:00 AM).
 * @returns Job ID if successful, null otherwise.
 */
export const scheduleReconcileBucketUsageJob = async (
  tenantId: string,
  cronExpression: string = '0 3 * * *' // Default: daily at 3:00 AM
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleRecurringJob<ReconcileBucketUsageJobData>(
    'reconcile-bucket-usage',
    cronExpression,
    { tenantId } // Only needs tenantId
  );
};

export const scheduleMicrosoftWebhookRenewalJob = async (
  tenantId: string,
  cronExpression: string = '*/30 * * * *'
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleRecurringJob<MicrosoftWebhookRenewalJobData>(
    'renew-microsoft-calendar-webhooks',
    cronExpression,
    { tenantId }
  );
};

export const scheduleGooglePubSubVerificationJob = async (
  tenantId: string,
  cronExpression: string = '15 * * * *'
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleRecurringJob<GooglePubSubVerificationJobData>(
    'verify-google-calendar-pubsub',
    cronExpression,
    { tenantId }
  );
};

export const scheduleGoogleGmailWatchRenewalJob = async (
  tenantId: string,
  cronExpression: string = '*/30 * * * *'
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleRecurringJob<GoogleGmailWatchRenewalJobData>(
    'renew-google-gmail-watch',
    cronExpression,
    { tenantId }
  );
};

export const scheduleCleanupAiSessionKeysJob = async (
  cronExpression: string = '*/10 * * * *'
): Promise<string | null> => {
  if (process.env.EDITION !== 'enterprise') {
    return null;
  }
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleRecurringJob<CleanupAiSessionKeysJobData>(
    'cleanup-ai-session-keys',
    cronExpression,
    { trigger: 'cron' }
  );
};

/**
 * Schedule a recurring job to run credit reconciliation
 * This job validates credit balances and creates reconciliation reports for any discrepancies
 *
 * @param tenantId The tenant ID
 * @param clientId Optional client ID to limit processing to a specific client
 * @param cronExpression Cron expression for job scheduling (e.g., '0 2 * * *' for daily at 2:00 AM)
 * @returns Job ID if successful, null otherwise
 */
export const scheduleCreditReconciliationJob = async (
  tenantId: string,
  clientId?: string,
  cronExpression: string = '0 2 * * *' // Default: daily at 2:00 AM
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleRecurringJob<CreditReconciliationJobData>(
    'credit-reconciliation',
    cronExpression,
    { tenantId, clientId }
  );
};

// Re-export the cleanup temporary forms scheduling function
export { scheduleCleanupTemporaryFormsJob } from '../../services/cleanupTemporaryFormsJob';

// Note: Password reset token cleanup is handled automatically during token operations
// No scheduled job needed since pg-boss is unreliable and auto-cleanup is more efficient

export const scheduleEmailWebhookMaintenanceJob = async (
  tenantId?: string,
  cronExpression: string = '0 0 * * *' // Daily at midnight
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleRecurringJob<EmailWebhookMaintenanceJobData>(
    'email-webhook-maintenance',
    cronExpression,
    { tenantId }
  );
};

/**
 * Schedule a recurring job to check SLA thresholds and send notifications.
 * This job monitors all active tickets for SLA warnings and breaches.
 *
 * @param tenantId The tenant ID
 * @param cronExpression Cron expression for job scheduling (default: every 5 minutes)
 * @returns Job ID if successful, null otherwise
 */
export const scheduleSlaTimerJob = async (
  tenantId: string,
  cronExpression: string = '*/5 * * * *' // Default: every 5 minutes
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleRecurringJob<SlaTimerJobData>(
    'sla-timer',
    cronExpression,
    { tenantId }
  );
};
