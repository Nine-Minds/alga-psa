import User from '@/lib/models/user';
import { hashPassword } from '@/utils/encryption/encryption';
import logger from '@/utils/logger';
import crypto from 'crypto';
import { JobScheduler, IJobScheduler } from '@/lib/jobs/jobScheduler';
import { JobService } from '@/services/job.service';
import { InvoiceZipJobHandler } from '@/lib/jobs/handlers/invoiceZipHandler';
import type { InvoiceZipJobData } from '@/lib/jobs/handlers/invoiceZipHandler';
import { createCompanyBillingCycles } from '@/lib/billing/createBillingCycles';
import { getConnection } from '@/lib/db/db';
import { createNextTimePeriod } from './timePeriodsActions';
import { TimePeriodSettings } from '../models/timePeriodSettings';
import { validateEnv } from '@/config/envConfig';
import { initializeEventBus } from '../eventBus/initialize';
import { StorageService } from '@/lib/storage/StorageService';
import { initializeScheduler } from '@/lib/jobs';
// import { configDotenv } from 'dotenv';
import { config } from 'dotenv';

let isFunctionExecuted = false;

export async function initializeApp() {
    config();

    if (isFunctionExecuted) {
        return;
    }
    isFunctionExecuted = true;
    validateEnv();

    // Initialize event bus first
    try {
        await initializeEventBus();
        logger.info('Event bus initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize event bus:', error);
        throw error;
    }

    // Initialize storage service
    const storageService = new StorageService();

    // Log environment configuration on startup
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

    // Logging Configuration
    logger.info('Logging Configuration:', {
        LOG_LEVEL: process.env.NEXTAUTH_SECRETLOG_LEVEL,
        LOG_IS_FORMAT_JSON: process.env.LOG_IS_FORMAT_JSON,
        LOG_IS_FULL_DETAILS: process.env.LOG_IS_FULL_DETAILS,
        LOG_ENABLE_FILE_LOGGING: process.env.LOG_ENABLE_FILE_LOGGING,
        LOG_DIR_PATH: process.env.LOG_DIR_PATH,
        LOG_ENABLE_EXTERNAL_LOGGING: process.env.LOG_ENABLE_EXTERNAL_LOGGING,
        LOG_EXTERNAL_HTTP_HOST: process.env.LOG_EXTERNAL_HTTP_HOST,
        LOG_EXTERNAL_HTTP_PORT: process.env.LOG_EXTERNAL_HTTP_PORT,
        LOG_EXTERNAL_HTTP_PATH: process.env.LOG_EXTERNAL_HTTP_PATH,
        LOG_EXTERNAL_THTTP_LEVEL: process.env.LOG_EXTERNAL_THTTP_LEVEL
    });

    // Hocuspocus Configuration
    logger.info('Hocuspocus Configuration:', {
        HOCUSPOCUS_PORT: process.env.HOCUSPOCUS_PORT
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

    try {
        // Initialize job scheduler and register jobs
        const rootKnex = await getConnection(null);
        const jobService = await JobService.create();
        const storageService = new StorageService();
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
                        const settings = await TimePeriodSettings.getActiveSettings();

                        // Create next time period using all active settings
                        try {
                            const result = await createNextTimePeriod(settings);
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
    } catch (error) {
        logger.error('Error initializing job scheduler:', error);
        logger.error('Job scheduler initialization failed. Please check the logs for more information.');
    }

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
            logger.error('Error initializing app:', error);
        }
    }

    if (glinda) {
        logger.info('*************************************************************');
        logger.info(`********                                             ********`);
        logger.info(`******** User Email is -> [ ${glinda.email} ]  ********`);
        logger.info(`********                                             ********`);
        logger.info(`********       Password is -> [ ${newPassword} ]   ********`);
        logger.info(`********                                             ********`);
        logger.info('*************************************************************');
    }
}
