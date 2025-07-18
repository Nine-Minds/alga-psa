// server/src/lib/actions/billingPlanActions.ts
'use server'
import BillingPlan from 'server/src/lib/models/billingPlan';
import { IBillingPlan, IBillingPlanFixedConfig } from 'server/src/interfaces/billing.interfaces'; // Added IBillingPlanFixedConfig
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex'; // Import Knex type
import { PlanServiceConfigurationService } from 'server/src/lib/services/planServiceConfigurationService';
import { IPlanServiceFixedConfig } from 'server/src/interfaces/planServiceConfiguration.interfaces'; // This might be removable if not used elsewhere after refactor
import BillingPlanFixedConfig from 'server/src/lib/models/billingPlanFixedConfig'; // Added import for new model
import { withTransaction } from '../../../../shared/db';
import { getCurrentUser } from './user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { analytics } from '../analytics/posthog';
import { AnalyticsEvents } from '../analytics/events';

export async function getBillingPlans(): Promise<IBillingPlan[]> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'read', trx)) {
                throw new Error('Permission denied: Cannot read billing plans');
            }

            const plans = await BillingPlan.getAll(trx);
            return plans;
        });
    } catch (error) {
        console.error('Error fetching billing plans:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to fetch company billing plans: ${error}`);
    }
}

// New function to get a single billing plan by ID
export async function getBillingPlanById(planId: string): Promise<IBillingPlan | null> {
    let tenant_copy: string = '';
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }
        tenant_copy = tenant;

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'read', trx)) {
                throw new Error('Permission denied: Cannot read billing plans');
            }

            // Assuming the BillingPlan model has a method like findById
            // This might need adjustment based on the actual model implementation
            // It should ideally fetch the base plan and potentially join/fetch config details
            const plan = await BillingPlan.findById(trx, planId);
            return plan; // The model method should return the plan with necessary fields
        });
    } catch (error) {
        console.error(`Error fetching billing plan with ID ${planId}:`, error);
        if (error instanceof Error) {
            // Handle specific errors like 'not found' if the model throws them
            if (error.message.includes('not found')) { // Example check
                return null;
            }
            throw error;
        }
        throw new Error(`Failed to fetch billing plan ${planId} in tenant ${tenant_copy}: ${error}`);
    }
}

export async function createBillingPlan(
    planData: Omit<IBillingPlan, 'plan_id'>
): Promise<IBillingPlan> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'create', trx)) {
                throw new Error('Permission denied: Cannot create billing plans');
            }

            // Remove tenant field if present in planData to prevent override
            const { tenant: _, ...safePlanData } = planData;
            const plan = await BillingPlan.create(trx, safePlanData);

            // Track analytics
            analytics.capture(AnalyticsEvents.BILLING_RULE_CREATED, {
                plan_id: plan.plan_id,
                plan_name: plan.plan_name,
                plan_type: plan.plan_type,
                hourly_rate: plan.hourly_rate,
                minimum_billable_time: plan.minimum_billable_time,
                is_sla_plan: (plan as any).is_sla_plan || false
            }, currentUser.user_id);

            return plan;
        });
    } catch (error) {
        console.error('Error creating billing plan:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to create billing plan: ${error}`);
    }
}

export async function updateBillingPlan(
    planId: string,
    updateData: Partial<IBillingPlan>
): Promise<IBillingPlan> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'update', trx)) {
                throw new Error('Permission denied: Cannot update billing plans');
            }

            // Fetch the existing plan to check its type
            const existingPlan = await BillingPlan.findById(trx, planId);
            if (!existingPlan) {
                // Handle case where plan is not found before update attempt
                throw new Error(`Billing plan with ID ${planId} not found.`);
            }

            // Remove tenant field if present in updateData to prevent override
            // Use Object.assign to create a mutable copy if needed, or rely on delete below
            const { tenant: _, ...safeUpdateData } = updateData;

            // If the plan is hourly, remove the per-service fields from the update data
            if (existingPlan.plan_type === 'Hourly') {
                delete safeUpdateData.hourly_rate;
                delete safeUpdateData.minimum_billable_time;
                delete safeUpdateData.round_up_to_nearest;
                // Optional: Log that fields were removed for debugging
                // console.log(`Hourly plan update: Removed per-service fields for plan ${planId}`);
            }

            // Proceed with the update using the potentially modified data
            // Ensure BillingPlan.update handles empty updateData gracefully if all fields were removed
            const plan = await BillingPlan.update(trx, planId, safeUpdateData);

            // Track analytics
            analytics.capture(AnalyticsEvents.BILLING_RULE_UPDATED, {
                plan_id: plan.plan_id,
                plan_name: plan.plan_name,
                plan_type: plan.plan_type,
                updated_fields: Object.keys(safeUpdateData)
            }, currentUser.user_id);

            return plan;
        });
    } catch (error) {
        console.error('Error updating billing plan:', error);
        if (error instanceof Error) {
            // Re-throw specific errors like 'not found' if they weren't caught above
            if (error.message.includes('not found')) {
                 throw new Error(`Billing plan with ID ${planId} not found during update.`);
            }
            throw error; // Preserve other specific error messages
        }
        throw new Error(`Failed to update billing plan ${planId}: ${error}`);
    }
}

export async function deleteBillingPlan(planId: string): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(); // Capture knex instance here
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'delete', trx)) {
                throw new Error('Permission denied: Cannot delete billing plans');
            }

            // Check if plan is in use by companies before attempting to delete
            const isInUse = await BillingPlan.isInUse(trx, planId); // This check might be redundant now, but keep for clarity or remove if desired
            if (isInUse) {
                 // This specific error might be superseded by the detailed one below if the FK constraint is hit
                 // Consider if this pre-check is still necessary or if relying on the DB error is sufficient
                // throw new Error(`Cannot delete plan that is currently in use by companies in tenant ${tenant}`);
            }

            // Check if plan has associated services before attempting to delete
            const hasServices = await BillingPlan.hasAssociatedServices(trx, planId);
            if (hasServices) {
                throw new Error(`Cannot delete plan that has associated services. Please remove all services from this plan before deleting.`);
            }

            await BillingPlan.delete(trx, planId);
        });
    } catch (error) {
        console.error('Error deleting billing plan:', error);
        if (error instanceof Error) {
            // Check for specific PostgreSQL foreign key violation error code (23503)
            // This indicates the plan is likely referenced by another table (e.g., company_billing_plans)
            // We cast to 'any' to access potential driver-specific properties like 'code'
            if ((error as any).code === '23503') {
                 // Fetch company IDs associated with the plan
                 const { knex: queryKnex, tenant: queryTenant } = await createTenantKnex();
                 const companyPlanLinks = await withTransaction(queryKnex, async (trx: Knex.Transaction) => {
                     return await trx('company_billing_plans')
                         .select('company_id')
                         .where({ plan_id: planId, tenant: queryTenant });
                 });

                 const companyIds = companyPlanLinks.map(link => link.company_id);

                 let companyNames: string[] = [];
                 if (companyIds.length > 0) {
                     const companies = await withTransaction(queryKnex, async (trx: Knex.Transaction) => {
                         return await trx('companies')
                             .select('company_name')
                             .whereIn('company_id', companyIds)
                             .andWhere({ tenant: queryTenant });
                     });
                     companyNames = companies.map(c => c.company_name);
                 }

                 let errorMessage = "Cannot delete billing plan: It is currently assigned to one or more companies.";
                 if (companyNames.length > 0) {
                     // Truncate if too many names
                     const displayLimit = 5;
                     const displayNames = companyNames.length > displayLimit
                         ? companyNames.slice(0, displayLimit).join(', ') + ` and ${companyNames.length - displayLimit} more`
                         : companyNames.join(', ');
                     errorMessage = `Cannot delete billing plan: It is assigned to the following companies: ${displayNames}.`;
                 }
                 throw new Error(errorMessage);
            }

            // Preserve the user-friendly error from the hasAssociatedServices pre-check
            if (error.message.includes('associated services')) {
                throw error;
            }

            // Preserve other specific error messages (including the one from the 'isInUse' pre-check)
            throw error;
        }
        // Fallback for non-Error objects
        throw new Error(`Failed to delete billing plan: ${error}`);
    }
}

/**
 * Gets the combined fixed plan configuration (plan-level and service-level)
 * Fetches proration/alignment from billing_plan_fixed_config and base_rate from plan_service_fixed_config.
 */
export async function getCombinedFixedPlanConfiguration(
    planId: string,
    serviceId: string
): Promise<{
    base_rate?: number | null;
    enable_proration: boolean;
    billing_cycle_alignment: 'start' | 'end' | 'prorated';
    config_id?: string; // Service-specific config ID
} | null> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(); // Get knex instance
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'read', trx)) {
                throw new Error('Permission denied: Cannot read billing plan configurations');
            }

            // --- Fetch Plan-Level Config (Base Rate, Proration, Alignment) ---
            // Use the existing getBillingPlanFixedConfig action which should now return base_rate
            const planConfig = await getBillingPlanFixedConfig(planId);

            // Default values if plan-level config doesn't exist
            const plan_base_rate = planConfig?.base_rate ?? null; // Get base_rate from plan config
            const enable_proration = planConfig?.enable_proration ?? false;
            const billing_cycle_alignment = planConfig?.billing_cycle_alignment ?? 'start';

            // --- Fetch Service-Level Config ID (Optional, if needed elsewhere) ---
            // We no longer need service-level config to get the base rate for the combined view.
            // We might still need the config_id if the caller uses it.
            const configService = new PlanServiceConfigurationService(trx, tenant);
            const serviceBaseConfig = await configService.getConfigurationForService(planId, serviceId);
            const config_id: string | undefined = serviceBaseConfig?.config_id;

            // Base rate now comes from planConfig fetched above
            const base_rate = plan_base_rate;

            // --- Combine Results ---
            // Return null only if BOTH plan and service config are missing? Or just if service config is missing?
            // Current logic: returns combined data even if service config (base_rate) is missing.
            // If serviceBaseConfig is required, uncomment the check below:
            // if (!serviceBaseConfig) {
            //     return null;
            // }

            return {
                base_rate: base_rate,
                enable_proration: enable_proration,
                billing_cycle_alignment: billing_cycle_alignment,
                config_id: config_id
            };
        });

    } catch (error) {
        console.error('Error fetching combined fixed plan configuration:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to fetch combined fixed plan configuration for plan ${planId}, service ${serviceId}: ${error}`);
    }
}

/**
 * Gets only the plan-level fixed configuration (proration, alignment)
 */
export async function getBillingPlanFixedConfig(planId: string): Promise<IBillingPlanFixedConfig | null> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'read', trx)) {
                throw new Error('Permission denied: Cannot read billing plan configurations');
            }

            const model = new BillingPlanFixedConfig(trx, tenant);
            const config = await model.getByPlanId(planId);
            return config;
        });
    } catch (error) {
        console.error(`Error fetching billing_plan_fixed_config for plan ${planId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to fetch billing_plan_fixed_config for plan ${planId}: ${error}`);
    }
}

/**
 * Updates the plan-level fixed configuration (proration, alignment) in billing_plan_fixed_config.
 * Uses upsert logic: creates if not exists, updates if exists.
 */
export async function updateBillingPlanFixedConfig(
    planId: string,
    configData: Partial<Omit<IBillingPlanFixedConfig, 'plan_id' | 'tenant' | 'created_at' | 'updated_at'>>
): Promise<boolean> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'update', trx)) {
                throw new Error('Permission denied: Cannot update billing plan configurations');
            }

            // Fetch the existing plan to check its type
            const existingPlan = await BillingPlan.findById(trx, planId); // Use BillingPlan model directly
            if (!existingPlan) {
                throw new Error(`Billing plan with ID ${planId} not found.`);
            }
            if (existingPlan.plan_type !== 'Fixed') {
                throw new Error(`Cannot update fixed plan configuration for non-fixed plan type: ${existingPlan.plan_type}`);
            }

            const model = new BillingPlanFixedConfig(trx, tenant);
            
            // Prepare data for upsert, ensuring plan_id and tenant are included
            // Prepare data for upsert, ensuring plan_id, tenant, and base_rate are included
            const upsertData: Omit<IBillingPlanFixedConfig, 'created_at' | 'updated_at'> & { base_rate?: number | null } = {
                plan_id: planId,
                base_rate: configData.base_rate, // Include base_rate from input
                enable_proration: configData.enable_proration ?? false, // Provide default if undefined
                billing_cycle_alignment: configData.billing_cycle_alignment ?? 'start', // Provide default if undefined
                tenant: tenant,
            };

            return await model.upsert(upsertData);
        });

    } catch (error) {
        console.error(`Error upserting billing_plan_fixed_config for plan ${planId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to upsert billing_plan_fixed_config for plan ${planId}: ${error}`);
    }
}


/**
 * Updates only the base_rate for a specific service within a fixed plan.
 * Interacts with plan_service_fixed_config.
 * Renamed from updateFixedPlanConfiguration.
 */
export async function updatePlanServiceFixedConfigRate(
    planId: string,
    serviceId: string,
    baseRate: number | null // Only accept base_rate
): Promise<boolean> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'update', trx)) {
                throw new Error('Permission denied: Cannot update billing plan configurations');
            }

            // Fetch the existing plan to check its type
            const existingPlan = await BillingPlan.findById(trx, planId); // Use BillingPlan model directly
            if (!existingPlan) {
                throw new Error(`Billing plan with ID ${planId} not found.`);
            }
            if (existingPlan.plan_type !== 'Fixed') {
                throw new Error(`Cannot update fixed service config rate for non-fixed plan type: ${existingPlan.plan_type}`);
            }

            // Create configuration service
            const configService = new PlanServiceConfigurationService(trx, tenant);
            
            // Get existing configuration for this plan and service
            let config = await configService.getConfigurationForService(planId, serviceId);
            
            if (!config) {
                // If no configuration exists, create a new one with the provided base_rate
                console.log(`Creating new fixed plan service configuration for plan ${planId}, service ${serviceId}`);
                
                const configId = await configService.createConfiguration(
                    { // Base config data
                        plan_id: planId,
                        service_id: serviceId,
                        configuration_type: 'Fixed',
                        tenant
                    },
                    { // Type config data (only base_rate now)
                        base_rate: baseRate
                    }
                    // No proration/alignment data passed here anymore
                );
                
                return !!configId;
            } else {
                // Update existing configuration's base_rate
                console.log(`Updating fixed plan service configuration base_rate for plan ${planId}, service ${serviceId}`);
                
                // Prepare fixed config update data (only base_rate)
                const fixedConfigData: Partial<IPlanServiceFixedConfig> = {
                     base_rate: baseRate
                };
                
                // Update the configuration using the service
                return await configService.updateConfiguration(
                    config.config_id,
                    undefined, // No base config updates needed
                    fixedConfigData // Only contains base_rate
                );
            }
        });
    } catch (error) {
        console.error('Error updating fixed plan service config rate:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to update fixed plan service config rate for plan ${planId}, service ${serviceId}: ${error}`);
    }
}
