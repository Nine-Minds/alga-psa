import { isEnterprise } from './features';
import { parsePolicy } from './auth/ee';
import { initializeEventBus, cleanupEventBus } from './eventBus/initialize';
import { initializeScheduledJobs } from './jobs/initializeScheduledJobs';
import logger from '@shared/core/logger';
import { initializeServerWorkflows } from '@shared/workflow/init/serverInit';
import { syncStandardTemplates } from './startupTasks';
import { validateEnv } from 'server/src/config/envConfig';
import { validateCriticalConfiguration, validateDatabaseConnectivity } from 'server/src/config/criticalEnvValidation';
import { config } from 'dotenv';
import User from 'server/src/lib/models/user';
import { hashPassword } from 'server/src/utils/encryption/encryption';
import crypto from 'crypto';
import { JobScheduler, IJobScheduler } from 'server/src/lib/jobs/jobScheduler';
import { JobService } from 'server/src/services/job.service';
import { InvoiceZipJobHandler } from 'server/src/lib/jobs/handlers/invoiceZipHandler';
import type { InvoiceZipJobData } from 'server/src/lib/jobs/handlers/invoiceZipHandler';
import { createCompanyBillingCycles } from 'server/src/lib/billing/createBillingCycles';
import { getConnection } from 'server/src/lib/db/db';
import { createNextTimePeriod } from './actions/timePeriodsActions';
import { TimePeriodSettings } from './models/timePeriodSettings';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { initializeScheduler } from 'server/src/lib/jobs';

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
    
    // Validate critical configuration first (must succeed)
    try {
      await validateCriticalConfiguration();
      logger.info('Critical configuration validation passed');
    } catch (error) {
      logger.error('Critical configuration validation failed:', error);
      throw error; // Cannot continue without critical configuration
    }
    
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

    // Initialize event bus (critical - must succeed)
    try {
      await initializeEventBus();
      logger.info('Event bus initialized');
    } catch (error) {
      logger.error('Failed to initialize event bus:', error);
      throw error; // Critical failure - cannot continue without event bus
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
        await cleanupEventBus();
        process.exit(0);
      });

      process.on('SIGINT', async () => {
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
      // Initialize extensions
      try {
        const { initializeExtensions } = await import('../../../ee/server/src/lib/extensions/initialize');
        await initializeExtensions();
        logger.info('Extension system initialized');
      } catch (error) {
        logger.error('Failed to initialize extensions:', error);
        // Continue startup even if extensions fail to load
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
  logger.info('Email Configuration:', {
    EMAIL_ENABLE: process.env.EMAIL_ENABLE,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_HOST: process.env.EMAIL_HOST,
    EMAIL_PORT: process.env.EMAIL_PORT,
    EMAIL_USERNAME: process.env.EMAIL_USERNAME,
    // Password intentionally omitted for security
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
  // Initialize job scheduler and register jobs
  const jobService = await JobService.create();
  const jobScheduler: IJobScheduler = await JobScheduler.getInstance(jobService, storageService);
  
  // Register invoice zip handler once during initialization
  const invoiceZipHandler = new InvoiceZipJobHandler(jobService, storageService);
  jobScheduler.registerGenericJobHandler<InvoiceZipJobData>(
    'invoice_zip',
    (jobId, data: InvoiceZipJobData) =>
      invoiceZipHandler.handleInvoiceZipJob(jobId, data)
  );
  logger.info('Registered invoice zip job handler');

  // Initialize job handlers with storage service
  await initializeScheduler(storageService);

  // Register billing cycles job if it doesn't exist
  const existingBillingJobs = await jobScheduler.getJobs({ jobName: 'createCompanyBillingCycles' });
  if (existingBillingJobs.length === 0) {
    // Register the nightly billing cycle creation job
    jobScheduler.registerJobHandler('createCompanyBillingCycles', async () => {
      // Get all tenants
      const rootKnex = await getConnection(null);
      const tenants = await rootKnex('tenants').select('tenant');

      // Process each tenant
      for (const { tenant } of tenants) {
        try {
          // Get tenant-specific connection
          const tenantKnex = await getConnection(tenant);

          // Get all active companies for this tenant
          const companies = await tenantKnex('companies')
            .where({ is_inactive: false })
            .select('*');

          // Create billing cycles for each company
          for (const company of companies) {
            try {
              await createCompanyBillingCycles(tenantKnex, company);
            } catch (error) {
              logger.error(`Error creating billing cycles for company ${company.company_id} in tenant ${tenant}:`, error);
            }
          }
        } catch (error) {
          logger.error(`Error processing tenant ${tenant}:`, error);
        }
      }
    });

    // Schedule the billing cycles job
    await jobScheduler.scheduleRecurringJob(
      'createCompanyBillingCycles',
      '24 hours',
      { tenantId: 'system' }
    );
  }

  // Register time period creation job if it doesn't exist
  const existingTimePeriodJobs = await jobScheduler.getJobs({ jobName: 'createNextTimePeriods' });
  if (existingTimePeriodJobs.length === 0) {
    // Register the nightly time period creation job
    jobScheduler.registerJobHandler('createNextTimePeriods', async () => {
      // Get all tenants
      const rootKnex = await getConnection(null);
      const tenants = await rootKnex('tenants').select('tenant');

      // Process each tenant
      for (const { tenant } of tenants) {
        try {
          // Get tenant-specific connection
          const tenantKnex = await getConnection(tenant);

          // Get active time period settings for this tenant
          const settings = await TimePeriodSettings.getActiveSettings(tenantKnex);

          // Create next time period using all active settings
          try {
            const result = await createNextTimePeriod(tenantKnex, settings);
            if (result) {
              logger.info(`Created new time period for tenant ${tenant}: ${result.start_date} to ${result.end_date}`);
            }
          } catch (error) {
            logger.error(`Error creating next time period in tenant ${tenant}:`, error);
          }
        } catch (error) {
          logger.error(`Error processing tenant ${tenant} for time periods:`, error);
        }
      }
    });

    // Schedule the time periods job
    await jobScheduler.scheduleRecurringJob(
      'createNextTimePeriods',
      '24 hours',
      { tenantId: 'system' }
    );
  }
}

// Helper function to setup development environment
async function setupDevelopmentEnvironment() {
  const generateSecurePassword = () => {
    const length = 16;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    return Array.from(
      { length },
      () => chars[crypto.randomInt(chars.length)]
    ).join('');
  };

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
