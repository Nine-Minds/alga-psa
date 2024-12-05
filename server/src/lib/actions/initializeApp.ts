import User from '@/lib/models/user';
import { hashPassword } from '@/utils/encryption/encryption';
import logger from '@/utils/logger';
import { JobScheduler } from '@/lib/jobs/jobScheduler';
import { createCompanyBillingCycles } from '@/lib/billing/createBillingCycles';
import { getConnection } from '@/lib/db/db';
import { createNextTimePeriod } from './timePeriodsActions';
import { TimePeriodSettings } from '../models/timePeriodSettings';

let isFunctionExecuted = false;

export async function initializeApp() {
    if (isFunctionExecuted) {
        return;
    }
    isFunctionExecuted = true;

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

    // Register time periods job if it doesn't exist
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

    if (process.env.NODE_ENV === 'development') {
        try {
            const firstUser = await User.findOldestUser();
            if (firstUser) {
                const newPassword = 'Abcd1234!';
                const hashedPassword = hashPassword(newPassword);
                await User.updatePassword(firstUser.email, hashedPassword);
                logger.info(`
                    
                

    :::::::::  :::::::::: :::     ::: :::::::::: :::        ::::::::  :::::::::  ::::    ::::  :::::::::: ::::    ::: :::::::::::      ::::    ::::   ::::::::  :::::::::  ::::::::::
    :+:    :+: :+:        :+:     :+: :+:        :+:       :+:    :+: :+:    :+: +:+:+: :+:+:+ :+:        :+:+:   :+:     :+:          +:+:+: :+:+:+ :+:    :+: :+:    :+: :+:
    +:+    +:+ +:+        +:+     +:+ +:+        +:+       +:+    +:+ +:+    +:+ +:+ +:+:+ +:+ +:+        :+:+:+  +:+     +:+          +:+ +:+:+ +:+ +:+    +:+ +:+    +:+ :+:
    +#+    +:+ +#++:++#   +#+     +:+ +#++:++#   +#+       +#+    +:+ +#++:++#+  +#+  +:+  +#+ +#++:++#   +#+ +:+ +#+     +#+          +#+  +:+  +#+ +#+    +:+ +#+    +:+ +#++:++#
    +#+    +#+ +#+         +#+   +#+  +#+        +#+       +#+    +#+ +#+        +#+       +#+ +#+        +#+  +#+#+#     +#+          +#+       +#+ +#+    +#+ +#+    +#+ +#+
    #+#    #+# #+#          #+#+#+#   #+#        #+#       #+#    #+# #+#        #+#       #+# #+#        #+#   #+#+#     #+#          #+#       #+# #+#    #+# #+#    #+# #+#
    #########  ##########     ###     ########## ########## ########  ###        ###       ### ########## ###    ####     ###          ###       ###  ########  #########  ##########


            `);
                logger.info('*************************************************************');
                logger.info(`********                                             ********`);
                logger.info(`******** User Email is -> [ ${firstUser.email} ]  ********`);
                logger.info(`********                                             ********`);
                logger.info(`********       Password is -> [ ${newPassword} ]          ********`);
                logger.info(`********                                             ********`);
                logger.info('*************************************************************');

            } else {
                logger.info('No users found. Skipping password update.');
            }
        } catch (error) {
            logger.error('Error initializing app:', error);
        }
    }
}
