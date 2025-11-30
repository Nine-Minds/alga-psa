import { Job } from 'pg-boss';
import logger from '@shared/core/logger';
import { JobRunnerFactory, getJobRunner } from './JobRunnerFactory';
import { IJobRunner, JobHandlerConfig, BaseJobData } from './interfaces';
import { StorageService } from '../storage/StorageService';
import { JobService } from '../../services/job.service';

// Import all job handlers
import { generateInvoiceHandler, GenerateInvoiceData } from './handlers/generateInvoiceHandler';
import { handleAssetImportJob, AssetImportJobData } from './handlers/assetImportHandler';
import { expiredCreditsHandler, ExpiredCreditsJobData } from './handlers/expiredCreditsHandler';
import {
  expiringCreditsNotificationHandler,
  ExpiringCreditsNotificationJobData,
} from './handlers/expiringCreditsNotificationHandler';
import {
  creditReconciliationHandler,
  CreditReconciliationJobData,
} from './handlers/creditReconciliationHandler';
import { InvoiceZipJobHandler, InvoiceZipJobData } from './handlers/invoiceZipHandler';
import { InvoiceEmailHandler, InvoiceEmailJobData } from './handlers/invoiceEmailHandler';
import {
  handleReconcileBucketUsage,
  ReconcileBucketUsageJobData,
} from './handlers/reconcileBucketUsageHandler';
import { cleanupTemporaryFormsJob } from '../../services/cleanupTemporaryFormsJob';
import {
  cleanupAiSessionKeysHandler,
  CleanupAiSessionKeysJobData,
} from './handlers/cleanupAiSessionKeysHandler';
import {
  renewMicrosoftCalendarWebhooks,
  verifyGoogleCalendarProvisioning,
  MicrosoftWebhookRenewalJobData,
  GooglePubSubVerificationJobData,
} from './handlers/calendarWebhookMaintenanceHandler';

/**
 * Initialize the job runner and register all job handlers
 *
 * This function initializes the appropriate job runner (PG Boss for CE,
 * Temporal for EE) and registers all application job handlers.
 *
 * @returns The initialized job runner instance
 */
export async function initializeJobRunner(): Promise<IJobRunner> {
  logger.info('Initializing job runner...');

  // Get or create the job runner
  const runner = await getJobRunner();

  // Create services needed by some handlers
  const jobService = await JobService.create();
  const storageService = new StorageService();

  // Register all job handlers
  await registerJobHandlers(runner, jobService, storageService);

  // Start the runner
  await runner.start();

  logger.info(`Job runner initialized successfully`, {
    type: runner.getRunnerType(),
  });

  return runner;
}

/**
 * Register all application job handlers with the job runner
 */
async function registerJobHandlers(
  runner: IJobRunner,
  jobService: JobService,
  storageService: StorageService
): Promise<void> {
  // Generate invoice handler
  runner.registerHandler<GenerateInvoiceData & BaseJobData>({
    name: 'generate-invoice',
    handler: async (_jobId, data) => {
      await generateInvoiceHandler(data);
    },
    retry: { maxAttempts: 3 },
    timeoutMs: 300000, // 5 minutes
  });

  // Asset import handler
  runner.registerHandler<AssetImportJobData & BaseJobData>({
    name: 'asset_import',
    handler: async (_jobId, data) => {
      // The asset import handler expects a Job object, so we wrap it
      await handleAssetImportJob({ id: _jobId, data } as Job<AssetImportJobData>);
    },
    retry: { maxAttempts: 3 },
    timeoutMs: 600000, // 10 minutes for large imports
  });

  // Expired credits handler
  runner.registerHandler<ExpiredCreditsJobData & BaseJobData>({
    name: 'expired-credits',
    handler: async (_jobId, data) => {
      await expiredCreditsHandler(data);
    },
    retry: { maxAttempts: 3 },
  });

  // Expiring credits notification handler
  runner.registerHandler<ExpiringCreditsNotificationJobData & BaseJobData>({
    name: 'expiring-credits-notification',
    handler: async (_jobId, data) => {
      await expiringCreditsNotificationHandler(data);
    },
    retry: { maxAttempts: 3 },
  });

  // Credit reconciliation handler
  runner.registerHandler<CreditReconciliationJobData & BaseJobData>({
    name: 'credit-reconciliation',
    handler: async (_jobId, data) => {
      await creditReconciliationHandler(data);
    },
    retry: { maxAttempts: 3 },
  });

  // Invoice ZIP handler
  const invoiceZipHandler = new InvoiceZipJobHandler(jobService, storageService);
  runner.registerHandler<InvoiceZipJobData & BaseJobData>({
    name: 'invoice_zip',
    handler: async (jobId, data) => {
      await invoiceZipHandler.handleInvoiceZipJob(jobId, data);
    },
    retry: { maxAttempts: 3 },
    timeoutMs: 600000, // 10 minutes
  });

  // Invoice email handler
  runner.registerHandler<InvoiceEmailJobData & BaseJobData>({
    name: 'invoice_email',
    handler: async (jobId, data) => {
      if (!data || typeof data !== 'object') {
        logger.error(`Invalid job data received for invoice_email job ${jobId}`);
        return;
      }
      await InvoiceEmailHandler.handle(jobId, data);
    },
    retry: { maxAttempts: 3 },
  });

  // Reconcile bucket usage handler
  runner.registerHandler<ReconcileBucketUsageJobData & BaseJobData>({
    name: 'reconcile-bucket-usage',
    handler: async (jobId, data) => {
      await handleReconcileBucketUsage({ id: jobId, data } as Job<ReconcileBucketUsageJobData>);
    },
    retry: { maxAttempts: 3 },
  });

  // Cleanup temporary workflow forms handler
  runner.registerHandler<{ tenantId: string } & BaseJobData>({
    name: 'cleanup-temporary-workflow-forms',
    handler: async () => {
      await cleanupTemporaryFormsJob();
    },
    retry: { maxAttempts: 2 },
  });

  // Enterprise-only: Cleanup AI session keys handler
  if (process.env.EDITION === 'enterprise') {
    runner.registerHandler<CleanupAiSessionKeysJobData & BaseJobData>({
      name: 'cleanup-ai-session-keys',
      handler: async () => {
        await cleanupAiSessionKeysHandler();
      },
      retry: { maxAttempts: 2 },
    });
  }

  // Microsoft calendar webhook renewal handler
  runner.registerHandler<MicrosoftWebhookRenewalJobData & BaseJobData>({
    name: 'renew-microsoft-calendar-webhooks',
    handler: async (_jobId, data) => {
      await renewMicrosoftCalendarWebhooks(data);
    },
    retry: { maxAttempts: 3 },
  });

  // Google calendar pubsub verification handler
  runner.registerHandler<GooglePubSubVerificationJobData & BaseJobData>({
    name: 'verify-google-calendar-pubsub',
    handler: async (_jobId, data) => {
      await verifyGoogleCalendarProvisioning(data);
    },
    retry: { maxAttempts: 3 },
  });

  logger.info('All job handlers registered');
}

/**
 * Get the current job runner instance
 *
 * @returns The job runner instance or null if not initialized
 */
export function getJobRunnerInstance(): IJobRunner | null {
  return JobRunnerFactory.getInstance().getJobRunner();
}

/**
 * Stop the job runner gracefully
 */
export async function stopJobRunner(): Promise<void> {
  const runner = getJobRunnerInstance();
  if (runner) {
    await runner.stop();
    logger.info('Job runner stopped');
  }
}
