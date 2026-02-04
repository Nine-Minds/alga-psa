import { Job } from 'pg-boss';
import logger from '@alga-psa/core/logger';
import { JobHandlerRegistry } from './jobHandlerRegistry';
import { BaseJobData } from './interfaces';
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
  orphanedTagCleanupHandler,
  OrphanedTagCleanupJobData,
} from './handlers/orphanedTagCleanupHandler';
import {
  renewMicrosoftCalendarWebhooks,
  verifyGoogleCalendarProvisioning,
  MicrosoftWebhookRenewalJobData,
  GooglePubSubVerificationJobData,
} from './handlers/calendarWebhookMaintenanceHandler';
import {
  renewGoogleGmailWatchSubscriptions,
  GoogleGmailWatchRenewalJobData,
} from './handlers/googleGmailWatchRenewalHandler';
import {
  extensionScheduledInvocationHandler,
  ExtensionScheduledInvocationJobData,
} from './handlers/extensionScheduledInvocationHandler';

/**
 * Options for registering handlers
 */
export interface RegisterHandlersOptions {
  /** Job service instance (required for some handlers) */
  jobService?: JobService;
  /** Storage service instance (required for some handlers) */
  storageService?: StorageService;
  /** Whether to include enterprise-only handlers */
  includeEnterprise?: boolean;
  /** Force re-registration of already registered handlers */
  force?: boolean;
}

/**
 * Register all standard job handlers with the JobHandlerRegistry
 *
 * This function should be called at application/worker startup to populate
 * the registry with all available job handlers. It can be used by:
 * - The main Next.js server during initialization
 * - The Temporal worker during startup
 *
 * @param options Configuration options
 */
export async function registerAllJobHandlers(
  options: RegisterHandlersOptions = {}
): Promise<void> {
  const {
    jobService,
    storageService,
    includeEnterprise = process.env.EDITION === 'enterprise',
    force = false,
  } = options;

  logger.info('Registering all job handlers', { includeEnterprise, force });

  // Create services if not provided
  const resolvedJobService = jobService ?? (await JobService.create());
  const resolvedStorageService = storageService ?? new StorageService();

  const registerOpts = { force };

  // ============================================================================
  // BILLING & INVOICE HANDLERS
  // ============================================================================

  // Generate invoice handler
  JobHandlerRegistry.register<GenerateInvoiceData & BaseJobData>(
    {
      name: 'generate-invoice',
      handler: async (_jobId, data) => {
        await generateInvoiceHandler(data);
      },
      retry: { maxAttempts: 3 },
      timeoutMs: 300000, // 5 minutes
    },
    registerOpts
  );

  // Invoice ZIP handler
  const invoiceZipHandler = new InvoiceZipJobHandler(resolvedJobService, resolvedStorageService);
  JobHandlerRegistry.register<InvoiceZipJobData & BaseJobData>(
    {
      name: 'invoice_zip',
      handler: async (jobId, data) => {
        await invoiceZipHandler.handleInvoiceZipJob(jobId, data);
      },
      retry: { maxAttempts: 3 },
      timeoutMs: 600000, // 10 minutes
    },
    registerOpts
  );

  // Invoice email handler
  JobHandlerRegistry.register<InvoiceEmailJobData & BaseJobData>(
    {
      name: 'invoice_email',
      handler: async (jobId, data) => {
        if (!data || typeof data !== 'object') {
          logger.error(`Invalid job data received for invoice_email job ${jobId}`);
          return;
        }
        await InvoiceEmailHandler.handle(jobId, data);
      },
      retry: { maxAttempts: 3 },
    },
    registerOpts
  );

  // ============================================================================
  // CREDIT HANDLERS
  // ============================================================================

  // Expired credits handler
  JobHandlerRegistry.register<ExpiredCreditsJobData & BaseJobData>(
    {
      name: 'expired-credits',
      handler: async (_jobId, data) => {
        await expiredCreditsHandler(data);
      },
      retry: { maxAttempts: 3 },
    },
    registerOpts
  );

  // Expiring credits notification handler
  JobHandlerRegistry.register<ExpiringCreditsNotificationJobData & BaseJobData>(
    {
      name: 'expiring-credits-notification',
      handler: async (_jobId, data) => {
        await expiringCreditsNotificationHandler(data);
      },
      retry: { maxAttempts: 3 },
    },
    registerOpts
  );

  // Credit reconciliation handler
  JobHandlerRegistry.register<CreditReconciliationJobData & BaseJobData>(
    {
      name: 'credit-reconciliation',
      handler: async (_jobId, data) => {
        await creditReconciliationHandler(data);
      },
      retry: { maxAttempts: 3 },
    },
    registerOpts
  );

  // ============================================================================
  // ASSET & IMPORT HANDLERS
  // ============================================================================

  // Asset import handler
  JobHandlerRegistry.register<AssetImportJobData & BaseJobData>(
    {
      name: 'asset_import',
      handler: async (jobId, data) => {
        // The asset import handler expects a Job object, so we wrap it
        await handleAssetImportJob({ id: jobId, data } as Job<AssetImportJobData>);
      },
      retry: { maxAttempts: 3 },
      timeoutMs: 600000, // 10 minutes for large imports
    },
    registerOpts
  );

  // ============================================================================
  // USAGE & RECONCILIATION HANDLERS
  // ============================================================================

  // Reconcile bucket usage handler
  JobHandlerRegistry.register<ReconcileBucketUsageJobData & BaseJobData>(
    {
      name: 'reconcile-bucket-usage',
      handler: async (jobId, data) => {
        await handleReconcileBucketUsage({ id: jobId, data } as Job<ReconcileBucketUsageJobData>);
      },
      retry: { maxAttempts: 3 },
    },
    registerOpts
  );

  // ============================================================================
  // CLEANUP HANDLERS
  // ============================================================================

  // Cleanup temporary workflow forms handler
  JobHandlerRegistry.register<{ tenantId: string } & BaseJobData>(
    {
      name: 'cleanup-temporary-workflow-forms',
      handler: async () => {
        await cleanupTemporaryFormsJob();
      },
      retry: { maxAttempts: 2 },
    },
    registerOpts
  );

  // Cleanup orphaned tag definitions handler
  JobHandlerRegistry.register<OrphanedTagCleanupJobData & BaseJobData>(
    {
      name: 'cleanup-orphaned-tags',
      handler: async (_jobId, data) => {
        await orphanedTagCleanupHandler(data);
      },
      retry: { maxAttempts: 2 },
    },
    registerOpts
  );

  // ============================================================================
  // EXTENSION SCHEDULED TASKS (EE)
  // ============================================================================

  if (includeEnterprise) {
    JobHandlerRegistry.register<ExtensionScheduledInvocationJobData & BaseJobData>(
      {
        name: 'extension-scheduled-invocation',
        handler: async (jobId, data) => {
          await extensionScheduledInvocationHandler(jobId, data as any);
        },
        retry: { maxAttempts: 3 },
        timeoutMs: 300000, // 5 minutes
      },
      registerOpts
    );
  }

  // ============================================================================
  // CALENDAR INTEGRATION HANDLERS
  // ============================================================================

  // Microsoft calendar webhook renewal handler
  JobHandlerRegistry.register<MicrosoftWebhookRenewalJobData & BaseJobData>(
    {
      name: 'renew-microsoft-calendar-webhooks',
      handler: async (_jobId, data) => {
        await renewMicrosoftCalendarWebhooks(data);
      },
      retry: { maxAttempts: 3 },
    },
    registerOpts
  );

  // Google calendar pubsub verification handler
  JobHandlerRegistry.register<GooglePubSubVerificationJobData & BaseJobData>(
    {
      name: 'verify-google-calendar-pubsub',
      handler: async (_jobId, data) => {
        await verifyGoogleCalendarProvisioning(data);
      },
      retry: { maxAttempts: 3 },
    },
    registerOpts
  );

  // Google Gmail watch renewal handler
  JobHandlerRegistry.register<GoogleGmailWatchRenewalJobData & BaseJobData>(
    {
      name: 'renew-google-gmail-watch',
      handler: async (_jobId, data) => {
        await renewGoogleGmailWatchSubscriptions(data);
      },
      retry: { maxAttempts: 3 },
    },
    registerOpts
  );

  // ============================================================================
  // ENTERPRISE-ONLY HANDLERS
  // ============================================================================

  if (includeEnterprise) {
    // Cleanup AI session keys handler (EE only)
    JobHandlerRegistry.register<CleanupAiSessionKeysJobData & BaseJobData>(
      {
        name: 'cleanup-ai-session-keys',
        handler: async () => {
          await cleanupAiSessionKeysHandler();
        },
        retry: { maxAttempts: 2 },
      },
      registerOpts
    );
  }

  // Mark registry as initialized
  JobHandlerRegistry.markInitialized();

  logger.info('All job handlers registered', {
    stats: JobHandlerRegistry.getStats(),
  });
}

/**
 * Get a list of all available job handler names
 * Useful for documentation and validation
 */
export function getAvailableJobHandlers(): string[] {
  return [
    // Billing & Invoice
    'generate-invoice',
    'invoice_zip',
    'invoice_email',
    // Credits
    'expired-credits',
    'expiring-credits-notification',
    'credit-reconciliation',
    // Assets & Import
    'asset_import',
    // Usage & Reconciliation
    'reconcile-bucket-usage',
    // Cleanup
    'cleanup-temporary-workflow-forms',
    'cleanup-orphaned-tags',
    // Calendar
    'renew-microsoft-calendar-webhooks',
    'verify-google-calendar-pubsub',
    'renew-google-gmail-watch',
    // Enterprise-only
    ...(process.env.EDITION === 'enterprise' ? ['cleanup-ai-session-keys'] : []),
  ];
}
