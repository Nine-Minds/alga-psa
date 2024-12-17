import User from '@/lib/models/user';
import { hashPassword } from '@/utils/encryption/encryption';
import logger from '@/utils/logger';
import crypto from 'crypto';
import { JobScheduler } from '@/lib/jobs/jobScheduler';
import { createCompanyBillingCycles } from '@/lib/billing/createBillingCycles';
import { getConnection } from '@/lib/db/db';
import { createNextTimePeriod } from './timePeriodsActions';
import { TimePeriodSettings } from '../models/timePeriodSettings';
import env from '@/config/envConfig';

let isFunctionExecuted = false;

export async function initializeApp() {
    if (isFunctionExecuted) {
        return;
    }
    isFunctionExecuted = true;

    // Log environment configuration on startup
    logger.info('Starting application with the following configuration:');

    // App Configuration
    logger.info('Application Configuration:', {
        VERSION: env.VERSION,
        APP_NAME: env.APP_NAME,
        HOST: env.HOST,
        APP_HOST: env.APP_HOST,
        APP_ENV: env.APP_ENV,
        VERIFY_EMAIL_ENABLED: env.VERIFY_EMAIL_ENABLED
    });

    // Database Configuration
    logger.info('Database Configuration:', {
        DB_TYPE: env.DB_TYPE,
        DB_HOST: env.DB_HOST,
        DB_PORT: env.DB_PORT,
        DB_NAME_HOCUSPOCUS: env.DB_NAME_HOCUSPOCUS,
        DB_USER_HOCUSPOCUS: env.DB_USER_HOCUSPOCUS,
        DB_NAME_SERVER: env.DB_NAME_SERVER,
        DB_USER_SERVER: env.DB_USER_SERVER,
        DB_USER_ADMIN: env.DB_USER_ADMIN,
        // Passwords intentionally omitted for security
    });

    // Redis Configuration
    logger.info('Redis Configuration:', {
        REDIS_HOST: env.REDIS_HOST,
        REDIS_PORT: env.REDIS_PORT,
        // Password intentionally omitted for security
    });

    // Storage Configuration
    logger.info('Storage Configuration:', {
        STORAGE_LOCAL_BASE_PATH: env.STORAGE_LOCAL_BASE_PATH,
        STORAGE_LOCAL_MAX_FILE_SIZE: env.STORAGE_LOCAL_MAX_FILE_SIZE,
        STORAGE_LOCAL_ALLOWED_MIME_TYPES: env.STORAGE_LOCAL_ALLOWED_MIME_TYPES,
        STORAGE_LOCAL_RETENTION_DAYS: env.STORAGE_LOCAL_RETENTION_DAYS
    });

    // Logging Configuration
    logger.info('Logging Configuration:', {
        LOG_LEVEL: env.LOG_LEVEL,
        LOG_IS_FORMAT_JSON: env.LOG_IS_FORMAT_JSON,
        LOG_IS_FULL_DETAILS: env.LOG_IS_FULL_DETAILS,
        LOG_ENABLE_FILE_LOGGING: env.LOG_ENABLE_FILE_LOGGING,
        LOG_DIR_PATH: env.LOG_DIR_PATH,
        LOG_ENABLE_EXTERNAL_LOGGING: env.LOG_ENABLE_EXTERNAL_LOGGING,
        LOG_EXTERNAL_HTTP_HOST: env.LOG_EXTERNAL_HTTP_HOST,
        LOG_EXTERNAL_HTTP_PORT: env.LOG_EXTERNAL_HTTP_PORT,
        LOG_EXTERNAL_HTTP_PATH: env.LOG_EXTERNAL_HTTP_PATH,
        LOG_EXTERNAL_THTTP_LEVEL: env.LOG_EXTERNAL_THTTP_LEVEL
    });

    // Hocuspocus Configuration
    logger.info('Hocuspocus Configuration:', {
        HOCUSPOCUS_PORT: env.HOCUSPOCUS_PORT
    });

    // Email Configuration
    logger.info('Email Configuration:', {
        EMAIL_ENABLE: env.EMAIL_ENABLE,
        EMAIL_FROM: env.EMAIL_FROM,
        EMAIL_HOST: env.EMAIL_HOST,
        EMAIL_PORT: env.EMAIL_PORT,
        EMAIL_USERNAME: env.EMAIL_USERNAME,
        // Password intentionally omitted for security
    });

    // Auth Configuration
    logger.info('Auth Configuration:', {
        NEXTAUTH_URL: env.NEXTAUTH_URL,
        NEXTAUTH_SESSION_EXPIRES: env.NEXTAUTH_SESSION_EXPIRES,
        // Secrets intentionally omitted for security
    });

    try {
        // Initialize job scheduler and register jobs
        const jobScheduler = await JobScheduler.getInstance();

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
                {}
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

                        // Try to create next time period for each active setting
                        for (const setting of settings) {
                            try {
                                const result = await createNextTimePeriod(setting);
                                if (result) {
                                    logger.info(`Created new time period for tenant ${tenant}: ${result.start_date} to ${result.end_date}`);
                                }
                            } catch (error) {
                                logger.error(`Error creating next time period for setting ${setting.time_period_settings_id} in tenant ${tenant}:`, error);
                            }
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
                {}
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
        const hashedPassword = hashPassword(newPassword);
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
        logger.info(`********       Password is -> [ ${newPassword} ]          ********`);
        logger.info(`********                                             ********`);
        logger.info('*************************************************************');
    }
}