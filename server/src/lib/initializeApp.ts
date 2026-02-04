import { isEnterprise } from './features';
import { initializeEventBus, cleanupEventBus } from './eventBus/initialize';
import { initializeScheduledJobs } from './jobs/initializeScheduledJobs';
import { logger } from '@alga-psa/core';
import { initializeServerWorkflows } from '@alga-psa/shared/workflow/init/serverInit';
import { registerAccountingExportWorkflowActions } from './workflow/registerAccountingExportActions';
import { syncStandardTemplates } from './startupTasks';
import { validateEnv } from 'server/src/config/envConfig';
import { validateRequiredConfiguration, validateDatabaseConnectivity, validateSecretUniqueness } from 'server/src/config/criticalEnvValidation';
import { config } from 'dotenv';
import User from 'server/src/lib/models/user';
import { hashPassword, generateSecurePassword } from 'server/src/utils/encryption/encryption';
import { JobScheduler, IJobScheduler } from 'server/src/lib/jobs/jobScheduler';
import { JobService } from 'server/src/services/job.service';
import { InvoiceZipJobHandler } from 'server/src/lib/jobs/handlers/invoiceZipHandler';
import type { InvoiceZipJobData } from 'server/src/lib/jobs/handlers/invoiceZipHandler';
import { initializeJobRunner, stopJobRunner } from 'server/src/lib/jobs/initializeJobRunner';
import { createClientContractLineCycles } from 'server/src/lib/billing/createBillingCycles';
import { getConnection } from 'server/src/lib/db/db';
import { runWithTenant } from 'server/src/lib/db';
import { createNextTimePeriod } from '@alga-psa/scheduling/actions/timePeriodsActions';
import { TimePeriodSettings } from './models/timePeriodSettings';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { initializeScheduler } from 'server/src/lib/jobs';
import { CompositeSecretProvider } from '@alga-psa/core/secrets';
import { FileSystemSecretProvider } from '@alga-psa/core/secrets';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import type { ISecretProvider } from '@alga-psa/core';
import { EnvSecretProvider } from '@alga-psa/core/secrets';
import { validateEmailConfiguration, logEmailConfigWarnings } from './validation/emailConfigValidation';
import { Temporal } from '@js-temporal/polyfill';
import { JobStatus } from 'server/src/types/job';
import { initializeNotificationAccumulator, shutdownNotificationAccumulator } from './eventBus/subscribers/ticketEmailSubscriber';
import { DelayedEmailQueue, TenantEmailService, TokenBucketRateLimiter, BucketConfig } from '@alga-psa/email';
import { getRedisClient } from '../config/redisConfig';
import { registerEnterpriseStorageProviders } from './storage/registerEnterpriseStorageProviders';

let isFunctionExecuted = false;

export async function initializeApp() {
  // Prevent multiple executions
  if (isFunctionExecuted) {
    return;
  }
  isFunctionExecuted = true;

  try {
    // Load environment configuration
    config();

    // Validate secret uniqueness first (must succeed)
    try {
      await validateSecretUniqueness();
      logger.info('Secret uniqueness validation passed');
    } catch (error) {
      logger.error('Secret uniqueness validation failed:', error);
      throw error; // Cannot continue with conflicting secrets
    }

    // Validate critical configuration (must succeed)
    try {
      await validateRequiredConfiguration();
      logger.info('Critical configuration validation passed');
    } catch (error) {
      logger.error('Critical configuration validation failed:', error);
      throw error; // Cannot continue without critical configuration
    }

    let secretProvider: ISecretProvider = await getSecretProviderInstance();
    let nextAuthSecret: string | undefined =
      (await secretProvider.getAppSecret('NEXTAUTH_SECRET')) ??
      (await secretProvider.getAppSecret('nextauth_secret'));
    process.env.NEXTAUTH_SECRET = nextAuthSecret || process.env.NEXTAUTH_SECRET;

    // Validate database connectivity (critical - must succeed)
    try {
      await validateDatabaseConnectivity();
      logger.info('Database connectivity validation passed');
    } catch (error) {
      logger.error('Database connectivity validation failed:', error);
      throw error; // Cannot continue without database
    }

    // Run general environment validation
    validateEnv();

    // Validate email configuration (non-critical but important)
    try {
      const emailValidation = validateEmailConfiguration();
      if (emailValidation.warnings.length > 0) {
        logEmailConfigWarnings(emailValidation.warnings);
      } else if (process.env.EMAIL_ENABLE === 'true') {
        logger.info('Email configuration validation passed');
      }
    } catch (error) {
      logger.error('Failed to validate email configuration:', error);
      // Continue startup - email validation is not critical
    }

    // Initialize event bus (critical - must succeed)
    try {
      await initializeEventBus();
      logger.info('Event bus initialized');
    } catch (error) {
      logger.error('Failed to initialize event bus:', error);
      throw error; // Critical failure - cannot continue without event bus
    }

    // Initialize notification accumulator for batching ticket update emails
    // This is non-critical - if it fails, the system falls back to immediate sending
    try {
      await initializeNotificationAccumulator({
        accumulationWindowMs: parseInt(process.env.NOTIFICATION_ACCUMULATION_WINDOW_MS || '10000', 10),
        flushIntervalMs: parseInt(process.env.NOTIFICATION_FLUSH_INTERVAL_MS || '5000', 10)
      });
      logger.info('Notification accumulator initialized');
    } catch (error) {
      logger.error('Failed to initialize notification accumulator:', error);
      // Continue startup - accumulator failure is not critical (falls back to immediate sending)
    }

    // Initialize token bucket rate limiter for email rate limiting
    // This is non-critical - if it fails, the system falls back to database-based rate limiting
    try {
      await TokenBucketRateLimiter.getInstance().initialize(
        getRedisClient,
        async (tenantId: string): Promise<BucketConfig> => {
          // Get rate limit from notification_settings for this tenant
          try {
            const knex = await getConnection(tenantId);
            const settings = await knex('notification_settings')
              .where({ tenant: tenantId })
              .first();

            const ratePerMinute = settings?.rate_limit_per_minute ?? 60;

            // Convert rate per minute to token bucket config:
            // maxTokens = rate limit (allows burst up to this amount)
            // refillRate = rate per minute / 60 (tokens per second)
            return {
              maxTokens: ratePerMinute,
              refillRate: ratePerMinute / 60
            };
          } catch (error) {
            logger.warn(`Failed to get rate limit settings for tenant ${tenantId}, using defaults`);
            return { maxTokens: 60, refillRate: 1 };
          }
        }
      );
      logger.info('Token bucket rate limiter initialized');
    } catch (error) {
      logger.error('Failed to initialize token bucket rate limiter:', error);
      // Continue startup - falls back to database-based rate limiting
    }

    // Initialize delayed email queue for rate-limited email retry
    // This is non-critical - if it fails, rate-limited emails will be dropped instead of queued
    try {
      await DelayedEmailQueue.getInstance().initialize(
        getRedisClient,
        async (tenantId: string, params) => {
          const service = TenantEmailService.getInstance(tenantId);
          await service.sendEmail(params);
        }
      );
      logger.info('Delayed email queue initialized');
    } catch (error) {
      logger.error('Failed to initialize delayed email queue:', error);
      // Continue startup - queue failure is not critical (rate-limited emails will be dropped)
    }

    // Initialize storage service
    const storageService = new StorageService();

    // Log configuration (non-critical)
    try {
      logConfiguration();
    } catch (error) {
      logger.error('Failed to log configuration:', error);
      // Continue startup - logging configuration is not critical
    }

    // Initialize job scheduler and register core jobs (important but not critical)
    try {
      await initializeJobScheduler(storageService);
    } catch (error) {
      logger.error('Failed to initialize job scheduler:', error);
      // Continue startup - job scheduler failure is not critical for basic functionality
    }

    // Initialize scheduled jobs
    try {
      await initializeScheduledJobs();
      logger.info('Scheduled jobs initialized');
    } catch (error) {
      logger.error('Failed to initialize scheduled jobs:', error);
      // Continue startup - scheduled jobs are not critical for basic functionality
    }

    // Initialize workflow system
    try {
      await initializeServerWorkflows();
      // Register accounting export workflow actions
      await registerAccountingExportWorkflowActions();

      // Register invoice-specific workflow actions
      const { registerInvoiceActions } = await import('@alga-psa/billing/actions/invoiceWorkflowRegistration');
      registerInvoiceActions();

      logger.info('Workflow system initialized');
    } catch (error) {
      logger.error('Failed to initialize workflow system:', error);
      // Continue startup - workflow system is not critical for basic functionality
    }

    // Sync standard invoice templates
    try {
      await syncStandardTemplates();
      logger.info('Standard invoice templates synced');
    } catch (error) {
      logger.error('Failed to sync standard invoice templates:', error);
      // Continue startup - template sync is not critical for basic functionality
    }

    // Register cleanup handlers
    try {
      process.on('SIGTERM', async () => {
        await shutdownNotificationAccumulator();
        await TokenBucketRateLimiter.getInstance().shutdown();
        await DelayedEmailQueue.getInstance().shutdown();
        await stopJobRunner();
        await cleanupEventBus();
        process.exit(0);
      });

      process.on('SIGINT', async () => {
        await shutdownNotificationAccumulator();
        await TokenBucketRateLimiter.getInstance().shutdown();
        await DelayedEmailQueue.getInstance().shutdown();
        await stopJobRunner();
        await cleanupEventBus();
        process.exit(0);
      });
      logger.info('Cleanup handlers registered');
    } catch (error) {
      logger.error('Failed to register cleanup handlers:', error);
      // Continue startup - cleanup handlers are nice to have but not critical
    }

    // Initialize enterprise features
    if (isEnterprise) {

      // Register EE implementations for the auth package's SSO registry
      // (NextAuth provider callbacks call into @alga-psa/auth's registry; EE must register the real implementations)
      try {
        const { registerSSOProvider } = await import('@alga-psa/auth/lib/sso/registry');
        const { loadEnterpriseSsoProviderRegistryImpl } = await import(
          '@alga-psa/auth/lib/sso/enterpriseRegistryEntry'
        );

        const impl = await loadEnterpriseSsoProviderRegistryImpl();
        if (impl) {
          registerSSOProvider(impl);
          logger.info('Registered Enterprise SSO provider implementations');
        } else {
          logger.info('Enterprise SSO provider implementations not available');
        }

      } catch (error) {
        logger.error('Failed to register Enterprise SSO provider implementations:', error);
      }

      // Initialize extensions
       try {
         const { initializeExtensions } = await import('@alga-psa/product-extension-initialization');
         await initializeExtensions();
         logger.info('Extension system initialized');
      } catch (error) {
         logger.error('Failed to initialize extensions:', error);
         // Continue startup even if extensions fail to load
      }

      // Register enterprise storage providers for runtime factory
       try {
         await registerEnterpriseStorageProviders();
       } catch (error) {
         logger.warn('S3StorageProvider not available; continuing without S3 provider');
       }
    }

    // Development environment setup (non-critical)
    try {
      await setupDevelopmentEnvironment();
    } catch (error) {
      logger.error('Failed to setup development environment:', error);
      // Continue startup - development setup is not critical
    }

    return null;
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    throw error;
  }
}

// Helper function to log configuration
function logConfiguration() {
  logger.info('Starting application with the following configuration:');

  // App Configuration
  logger.info('Application Configuration:', {
    VERSION: process.env.VERSION,
    APP_NAME: process.env.AUTH_SECRETAPP_NAME,
    HOST: process.env.HOST,
    APP_HOST: process.env.APP_HOST,
    APP_ENV: process.env.APP_ENV,
    VERIFY_EMAIL_ENABLED: process.env.VERIFY_EMAIL_ENABLED
  });

  // Database Configuration
  logger.info('Database Configuration:', {
    DB_TYPE: process.env.DB_TYPE,
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_NAME_HOCUSPOCUS: process.env.DB_NAME_HOCUSPOCUS,
    DB_USER_HOCUSPOCUS: process.env.DB_USER_HOCUSPOCUS,
    DB_NAME_SERVER: process.env.DB_NAME_SERVER,
    DB_USER_SERVER: process.env.DB_USER_SERVER,
    DB_USER_ADMIN: process.env.DB_USER_ADMIN,
    // Passwords intentionally omitted for security
  });

  // Redis Configuration
  logger.info('Redis Configuration:', {
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    // Password intentionally omitted for security
  });

  // Storage Configuration
  logger.info('Storage Configuration:', {
    STORAGE_LOCAL_BASE_PATH: process.env.STORAGE_LOCAL_BASE_PATH,
    STORAGE_LOCAL_MAX_FILE_SIZE: process.env.STORAGE_LOCAL_MAX_FILE_SIZE,
    STORAGE_LOCAL_ALLOWED_MIME_TYPES: process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES,
    STORAGE_LOCAL_RETENTION_DAYS: process.env.STORAGE_LOCAL_RETENTION_DAYS
  });

  // Email Configuration
  const emailProviderType = process.env.EMAIL_PROVIDER_TYPE ||
    (process.env.RESEND_API_KEY ? 'resend' : 'smtp');

  logger.info('Email Configuration:', {
    EMAIL_ENABLE: process.env.EMAIL_ENABLE,
    EMAIL_PROVIDER_TYPE: emailProviderType,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_HOST: process.env.EMAIL_HOST,
    EMAIL_PORT: process.env.EMAIL_PORT,
    EMAIL_USERNAME: process.env.EMAIL_USERNAME,
    // Password and API keys intentionally omitted for security
  });

  // Auth Configuration
  logger.info('Auth Configuration:', {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXTAUTH_SESSION_EXPIRES: process.env.NEXTAUTH_SESSION_EXPIRES,
    // Secrets intentionally omitted for security
  });
}

// Helper function to initialize job scheduler
async function initializeJobScheduler(storageService: StorageService) {
  // Initialize the new job runner abstraction (handles all core handler registration)
  try {
    const jobRunner = await initializeJobRunner();
    logger.info(`Job runner initialized: ${jobRunner.getRunnerType()}`);
  } catch (error) {
    logger.error('Failed to initialize new job runner abstraction:', error);
    // Fall back to legacy scheduler
  }

  // Initialize legacy job scheduler for backward compatibility with custom jobs
  const jobService = await JobService.create();
  const jobScheduler: IJobScheduler = await JobScheduler.getInstance(jobService, storageService);

  // Note: Core handlers (invoice_zip, generate-invoice, etc.) are now registered
  // via initializeJobRunner() above. The legacy scheduler is kept for custom
  // app-specific jobs like billing cycles and time periods.

  // Register billing cycles job if it doesn't exist
  const existingBillingJobs = await jobScheduler.getJobs({ jobName: 'createClientContractLineCycles' });
  if (existingBillingJobs.length === 0) {
    // Register the nightly billing cycle creation job
    jobScheduler.registerJobHandler('createClientContractLineCycles', async () => {
      // Get all tenants
      const rootKnex = await getConnection(null);
      const tenants = await rootKnex('tenants').select('tenant');

      // Process each tenant
      for (const { tenant } of tenants) {
        try {
          // Get tenant-specific connection
          const tenantKnex = await getConnection(tenant);

          // Get all active clients for this tenant
          const clients = await tenantKnex('clients')
            .where({ is_inactive: false })
            .select('*');

          // Create billing cycles for each client
          for (const client of clients) {
            try {
              await createClientContractLineCycles(tenantKnex, client);
            } catch (error) {
              logger.error(`Error creating billing cycles for client ${client.client_id} in tenant ${tenant}:`, error);
            }
          }
        } catch (error) {
          logger.error(`Error processing tenant ${tenant}:`, error);
        }
      }
    });

    // Schedule the billing cycles job
    await jobScheduler.scheduleRecurringJob(
      'createClientContractLineCycles',
      '24 hours',
      { tenantId: 'system' }
    );
  }

  // Register the nightly time period creation job per tenant
  jobScheduler.registerJobHandler<{ tenantId: string }>('createNextTimePeriods', async (job) => {
    const tenantId = job.data?.tenantId;
    if (!tenantId || tenantId === 'system') {
      logger.warn('createNextTimePeriods job received unsupported tenantId', {
        jobId: job.id,
        tenantId
      });
      return;
    }

    let jobRecordId: string | null = null;

    try {
      jobRecordId = await jobService.createJob('createNextTimePeriods', {
        tenantId,
        metadata: {
          triggeredBy: 'scheduler',
          scheduleInterval: '24 hours',
          pgBossJobId: job.id
        },
        scheduledJobId: job.id
      });

      await runWithTenant(tenantId, async () => {
        await jobService.updateJobStatus(jobRecordId!, JobStatus.Processing, {
          tenantId,
          pgBossJobId: job.id,
          details: 'Starting time period creation run'
        });

        const tenantKnex = await getConnection(tenantId);
        const settings = await TimePeriodSettings.getActiveSettings(tenantKnex);

        // Skip if no time period settings are configured for this tenant
        if (!settings || settings.length === 0) {
          logger.debug(`No time period settings configured for tenant ${tenantId}, skipping time period creation`);
          await jobService.updateJobStatus(jobRecordId!, JobStatus.Completed, {
            tenantId,
            pgBossJobId: job.id,
            details: 'Skipped - no time period settings configured'
          });
          return;
        }

        const result = await createNextTimePeriod(settings);
        const details =
          result
            ? `Created new time period ${result.start_date} to ${result.end_date}`
            : 'No new time period needed';

        await jobService.updateJobStatus(jobRecordId!, JobStatus.Completed, {
          tenantId,
          pgBossJobId: job.id,
          details
        });

        logger.info(`Time period creation job completed for tenant ${tenantId}: ${details}`);
      });
    } catch (error) {
      logger.error(`Error creating next time period in tenant ${tenantId}:`, error);

      if (jobRecordId) {
        await runWithTenant(tenantId, async () =>
          jobService.updateJobStatus(jobRecordId!, JobStatus.Failed, {
            tenantId,
            pgBossJobId: job.id,
            error,
            details: 'Failed to create next time period'
          })
        );
      }

      throw error;
    } finally {
      // Always enqueue the next run so the job continues daily even after archives are cleaned
      // Use UTC to avoid DST drift issues
      try {
        const nextRunInstant = Temporal.Now.instant().add({ hours: 24 });
        const nextRun = new Date(nextRunInstant.epochMilliseconds);
        const singletonKey = `createNextTimePeriods:${tenantId}`;

        // Use scheduleRecurringJob which has singleton deduplication built-in
        // This prevents duplicate jobs from stacking up on retries
        const nextJobId = await jobScheduler.scheduleRecurringJob(
          'createNextTimePeriods',
          '24 hours',
          { tenantId }
        );

        if (nextJobId) {
          logger.debug('Queued next createNextTimePeriods job', {
            tenantId,
            jobId: nextJobId,
            nextRun: nextRun.toISOString(),
            singletonKey
          });
        } else {
          logger.debug('createNextTimePeriods job already queued (singleton active)', {
            tenantId,
            singletonKey
          });
        }
      } catch (scheduleError) {
        logger.error('Failed to enqueue next createNextTimePeriods job', { tenantId, scheduleError });
      }
    }
  });

  // Schedule the time periods job for each tenant
  const rootKnex = await getConnection(null);
  const tenants = await rootKnex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    try {
      await jobScheduler.scheduleRecurringJob(
        'createNextTimePeriods',
        '24 hours',
        { tenantId: tenant }
      );
    } catch (error) {
      logger.error(`Failed to schedule createNextTimePeriods job for tenant ${tenant}:`, error);
    }
  }
}

// Helper function to setup development environment
async function setupDevelopmentEnvironment() {
  let newPassword;
  const glinda = await User.findUserByEmail("glinda@emeraldcity.oz");
  if (glinda) {
    newPassword = generateSecurePassword();
    const hashedPassword = await hashPassword(newPassword);
    await User.updatePassword(glinda.email, hashedPassword);
  } else {
    logger.info('Glinda not found. Skipping password update.');
  }

  if (process.env.NODE_ENV === 'development') {
    try {
      logger.info(`
:::::::::  :::::::::: :::     ::: :::::::::: :::        ::::::::  :::::::::  ::::    ::::  :::::::::: ::::    ::: :::::::::::      ::::    ::::   ::::::::  :::::::::  ::::::::::
:+:    :+: :+:        :+:     :+: :+:        :+:       :+:    :+: :+:    :+: +:+:+: :+:+:+ :+:        :+:+:   :+:     :+:          +:+:+: :+:+:+ :+:    :+: :+:    :+: :+:
+:+    +:+ +:+        +:+     +:+ +:+        +:+       +:+    +:+ +:+    +:+ +:+ +:+:+ +:+ +:+        :+:+:+  +:+     +:+          +:+ +:+:+ +:+ +:+    +:+ +:+    +:+ :+:
+#+    +:+ +#++:++#   +#+     +:+ +#++:++#   +#+       +#+    +:+ +#++:++#+  +#+  +:+  +#+ +#++:++#   +#+ +:+ +#+     +#+          +#+  +:+  +#+ +#+    +:+ +#+    +:+ +#++:++#
+#+    +#+ +#+         +#+   +#+  +#+        +#+       +#+    +#+ +#+        +#+       +#+ +#+        +#+  +#+#+#     +#+          +#+       +#+ +#+    +#+ +#+    +#+ +#+
#+#    #+# #+#          #+#+#+#   #+#        #+#       #+#    #+# #+#        #+#       #+# #+#        #+#   #+#+#     #+#          #+#       #+# #+#    #+# #+#    #+# #+#
#########  ##########     ###     ########## ########## ########  ###        ###       ### ########## ###    ####     ###          ###       ###  ########  #########  ##########
      `);
    } catch (error) {
      logger.error('Error displaying development banner:', error);
    }
  }

  if (glinda && newPassword) {
    logger.info('*************************************************************');
    logger.info(`********                                             ********`);
    logger.info(`******** User Email is -> [ ${glinda.email} ]  ********`);
    logger.info(`********                                             ********`);
    logger.info(`********       Password is -> [ ${newPassword} ]   ********`);
    logger.info(`********                                             ********`);
    logger.info('*************************************************************');
  }
}
