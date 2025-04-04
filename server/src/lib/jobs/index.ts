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
import { JobService } from '../../services/job.service';
import { getConnection } from '../db/db';
import { StorageService } from '../../lib/storage/StorageService';
import logger from '@shared/core/logger';

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

  }
  return jobScheduler;
};


// Export types
export type { JobFilter, GenerateInvoiceData, ExpiredCreditsJobData, ExpiringCreditsNotificationJobData, CreditReconciliationJobData, ReconcileBucketUsageJobData };
// Export job scheduling helper functions
export const scheduleInvoiceGeneration = async (
  companyId: string,
  billingCycleId: string,
  runAt: Date,
  tenantId: string
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleScheduledJob<GenerateInvoiceData>(
    'generate-invoice',
    runAt,
    { companyId, billingCycleId, tenantId }
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
 * @param companyId Optional company ID to limit processing to a specific company
 * @param cronExpression Cron expression for job scheduling (e.g., '0 0 * * *' for daily at midnight)
 * @returns Job ID if successful, null otherwise
 */
export const scheduleExpiredCreditsJob = async (
  tenantId: string,
  companyId?: string,
  cronExpression: string = '0 0 * * *' // Default: daily at midnight
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleRecurringJob<ExpiredCreditsJobData>(
    'expired-credits',
    cronExpression,
    { tenantId, companyId }
  );
};

/**
 * Schedule a recurring job to send notifications about credits that will expire soon
 *
 * @param tenantId The tenant ID
 * @param companyId Optional company ID to limit processing to a specific company
 * @param cronExpression Cron expression for job scheduling (e.g., '0 9 * * *' for daily at 9:00 AM)
 * @returns Job ID if successful, null otherwise
 */
export const scheduleExpiringCreditsNotificationJob = async (
  tenantId: string,
  companyId?: string,
  cronExpression: string = '0 9 * * *' // Default: daily at 9:00 AM
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleRecurringJob<ExpiringCreditsNotificationJobData>(
    'expiring-credits-notification',
    cronExpression,
    { tenantId, companyId }
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

/**
 * Schedule a recurring job to run credit reconciliation
 * This job validates credit balances and creates reconciliation reports for any discrepancies
 *
 * @param tenantId The tenant ID
 * @param companyId Optional company ID to limit processing to a specific company
 * @param cronExpression Cron expression for job scheduling (e.g., '0 2 * * *' for daily at 2:00 AM)
 * @returns Job ID if successful, null otherwise
 */
export const scheduleCreditReconciliationJob = async (
  tenantId: string,
  companyId?: string,
  cronExpression: string = '0 2 * * *' // Default: daily at 2:00 AM
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleRecurringJob<CreditReconciliationJobData>(
    'credit-reconciliation',
    cronExpression,
    { tenantId, companyId }
  );
};
