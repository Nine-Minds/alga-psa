// server/src/lib/actions/billingPlanActions.ts
'use server'
import BillingPlan from 'server/src/lib/models/billingPlan';
import { IBillingPlan } from 'server/src/interfaces/billing.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { PlanServiceConfigurationService } from 'server/src/lib/services/planServiceConfigurationService';
import { IPlanServiceFixedConfig } from 'server/src/interfaces/planServiceConfiguration.interfaces';

export async function getBillingPlans(): Promise<IBillingPlan[]> {
    try {
        const { tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        const plans = await BillingPlan.getAll();
        return plans;
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
    const { tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error("tenant context not found");
    }

    try {
        // Assuming the BillingPlan model has a method like findById
        // This might need adjustment based on the actual model implementation
        // It should ideally fetch the base plan and potentially join/fetch config details
        const plan = await BillingPlan.findById(planId);
        return plan; // The model method should return the plan with necessary fields
    } catch (error) {
        console.error(`Error fetching billing plan with ID ${planId}:`, error);
        if (error instanceof Error) {
            // Handle specific errors like 'not found' if the model throws them
            if (error.message.includes('not found')) { // Example check
                return null;
            }
            throw error;
        }
        throw new Error(`Failed to fetch billing plan ${planId} in tenant ${tenant}: ${error}`);
    }
}

export async function createBillingPlan(
    planData: Omit<IBillingPlan, 'plan_id'>
): Promise<IBillingPlan> {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error("tenant context not found");
    }

    try {
        // Remove tenant field if present in planData to prevent override
        const { tenant: _, ...safePlanData } = planData;
        const plan = await BillingPlan.create(safePlanData);
        return plan;
    } catch (error) {
        console.error('Error creating billing plan:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to create billing plan in tenant ${tenant}: ${error}`);
    }
}

export async function updateBillingPlan(
    planId: string,
    updateData: Partial<IBillingPlan>
): Promise<IBillingPlan> {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error("tenant context not found");
    }

    try {
        // Fetch the existing plan to check its type
        const existingPlan = await BillingPlan.findById(planId);
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
        const plan = await BillingPlan.update(planId, safeUpdateData);
        return plan;
    } catch (error) {
        console.error('Error updating billing plan:', error);
        if (error instanceof Error) {
            // Re-throw specific errors like 'not found' if they weren't caught above
            if (error.message.includes('not found')) {
                 throw new Error(`Billing plan with ID ${planId} not found during update.`);
            }
            throw error; // Preserve other specific error messages
        }
        throw new Error(`Failed to update billing plan ${planId} in tenant ${tenant}: ${error}`);
    }
}

export async function deleteBillingPlan(planId: string): Promise<void> {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error("tenant context not found");
    }

    try {
        // Check if plan is in use by companies before attempting to delete
        const isInUse = await BillingPlan.isInUse(planId);
        if (isInUse) {
            throw new Error(`Cannot delete plan that is currently in use by companies in tenant ${tenant}`);
        }

        // Check if plan has associated services before attempting to delete
        const hasServices = await BillingPlan.hasAssociatedServices(planId);
        if (hasServices) {
            throw new Error(`Cannot delete plan that has associated services. Please remove all services from this plan before deleting.`);
        }

        await BillingPlan.delete(planId);
    } catch (error) {
        console.error('Error deleting billing plan:', error);
        if (error instanceof Error) {
            if (error.message.includes('in use')) {
                throw new Error(`Cannot delete plan that is currently in use by companies in tenant ${tenant}`);
            }
            if (error.message.includes('associated services')) {
                throw error; // Preserve the user-friendly error message
            }
            if (error.message.includes('foreign key constraint')) {
                throw new Error(`Cannot delete plan that has associated services. Please remove all services from this plan before deleting.`);
            }
            throw error; // Preserve other specific error messages
        }
        throw new Error(`Failed to delete billing plan in tenant ${tenant}: ${error}`);
    }
}

/**
 * Gets the fixed plan configuration for a specific plan and service
 */
export async function getFixedPlanConfiguration(
    planId: string,
    serviceId: string
): Promise<{
    base_rate?: number | null;
    enable_proration: boolean;
    billing_cycle_alignment: 'start' | 'end' | 'prorated';
    config_id?: string;
} | null> {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error("tenant context not found");
    }

    try {
        // Create configuration service
        const configService = new PlanServiceConfigurationService();
        
        // Get configuration for this plan and service
        const baseConfig = await configService.getConfigurationForService(planId, serviceId);
        
        if (!baseConfig) {
            return null;
        }
        
        // Get the detailed configuration
        const configDetails = await configService.getConfigurationWithDetails(baseConfig.config_id);
        
        if (!configDetails.typeConfig || baseConfig.configuration_type !== 'Fixed') {
            return null;
        }
        
        // Cast to the correct type
        const fixedConfig = configDetails.typeConfig as IPlanServiceFixedConfig;
        
        return {
            base_rate: fixedConfig.base_rate,
            enable_proration: fixedConfig.enable_proration,
            billing_cycle_alignment: fixedConfig.billing_cycle_alignment,
            config_id: fixedConfig.config_id
        };
    } catch (error) {
        console.error('Error fetching fixed plan configuration:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to fetch fixed plan configuration for plan ${planId} in tenant ${tenant}: ${error}`);
    }
}

/**
 * Updates a fixed plan configuration with the provided data
 * This function handles the special fields like base_rate and enable_proration
 * that are stored in the plan_service_fixed_config table
 */
export async function updateFixedPlanConfiguration(
    planId: string,
    serviceId: string,
    configData: {
        base_rate?: number | null;
        enable_proration?: boolean;
        billing_cycle_alignment?: 'start' | 'end' | 'prorated';
    }
): Promise<boolean> {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error("tenant context not found");
    }

    try {
        // Fetch the existing plan to check its type
        const existingPlan = await BillingPlan.findById(planId);
        if (!existingPlan) {
            throw new Error(`Billing plan with ID ${planId} not found.`);
        }

        // Verify this is a Fixed plan
        if (existingPlan.plan_type !== 'Fixed') {
            throw new Error(`Cannot update fixed plan configuration for non-fixed plan type: ${existingPlan.plan_type}`);
        }

        // Create configuration service
        const configService = new PlanServiceConfigurationService();
        
        // Get existing configuration for this plan and service
        let config = await configService.getConfigurationForService(planId, serviceId);
        
        if (!config) {
            // If no configuration exists, create a new one
            console.log(`Creating new fixed plan configuration for plan ${planId} and service ${serviceId}`);
            
            // Create base configuration
            const configId = await configService.createConfiguration(
                {
                    plan_id: planId,
                    service_id: serviceId,
                    configuration_type: 'Fixed',
                    tenant
                },
                {
                    base_rate: configData.base_rate,
                    enable_proration: configData.enable_proration ?? false,
                    billing_cycle_alignment: configData.billing_cycle_alignment ?? 'start'
                }
            );
            
            return !!configId;
        } else {
            // Update existing configuration
            console.log(`Updating fixed plan configuration for plan ${planId} and service ${serviceId}`);
            
            // Prepare fixed config update data
            const fixedConfigData: Partial<IPlanServiceFixedConfig> = {};
            
            if (configData.base_rate !== undefined) {
                fixedConfigData.base_rate = configData.base_rate;
            }
            
            if (configData.enable_proration !== undefined) {
                fixedConfigData.enable_proration = configData.enable_proration;
            }
            
            if (configData.billing_cycle_alignment !== undefined) {
                fixedConfigData.billing_cycle_alignment = configData.billing_cycle_alignment;
            }
            
            // Update the configuration
            return await configService.updateConfiguration(
                config.config_id,
                undefined, // No base config updates
                fixedConfigData
            );
        }
    } catch (error) {
        console.error('Error updating fixed plan configuration:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to update fixed plan configuration for plan ${planId} in tenant ${tenant}: ${error}`);
    }
}
