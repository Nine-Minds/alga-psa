// server/src/lib/actions/billingPlanActions.ts
'use server'

import BillingPlan from 'server/src/lib/models/billingPlan';
import { IBillingPlan } from 'server/src/interfaces/billing.interfaces';
import { createTenantKnex } from 'server/src/lib/db';

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
        // Check if plan is in use before attempting to delete
        const isInUse = await BillingPlan.isInUse(planId);
        if (isInUse) {
            throw new Error(`Cannot delete plan that is currently in use by companies in tenant ${tenant}`);
        }

        await BillingPlan.delete(planId);
    } catch (error) {
        console.error('Error deleting billing plan:', error);
        if (error instanceof Error) {
            if (error.message.includes('in use')) {
                throw new Error(`Cannot delete plan that is currently in use by companies in tenant ${tenant}`);
            }
            throw error; // Preserve other specific error messages
        }
        throw new Error(`Failed to delete billing plan in tenant ${tenant}: ${error}`);
    }
}
