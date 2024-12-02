import User from '@/lib/models/user';
import { hashPassword } from '@/utils/encryption/encryption';
import logger from '@/utils/logger';
import { JobScheduler } from '@/lib/jobs/jobScheduler';
import { createCompanyBillingCycles } from '@/lib/billing/createBillingCycles';
import { getConnection } from '@/lib/db/db';

let isFunctionExecuted = false;

export async function initializeApp() {
    if (isFunctionExecuted) {
        return;
    }
    isFunctionExecuted = true;

    // Initialize job scheduler and register billing cycle creation job
    const jobScheduler = await JobScheduler.getInstance();
    
    // Check if job handler already exists
    const existingJobs = await jobScheduler.getJobs({ jobName: 'createCompanyBillingCycles' });
    if (existingJobs.length === 0) {
        // Register the nightly billing cycle creation job if it doesn't exist
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

        // Schedule the job to run every 24 hours
        await jobScheduler.scheduleRecurringJob(
            'createCompanyBillingCycles',
            '24 hours', // pg-boss interval instead of cron expression
            {} // No need for tenantId since we handle all tenants in the job
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
