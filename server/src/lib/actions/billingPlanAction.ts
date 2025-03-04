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
        // Remove tenant field if present in updateData to prevent override
        const { tenant: _, ...safeUpdateData } = updateData;
        const plan = await BillingPlan.update(planId, safeUpdateData);
        return plan;
    } catch (error) {
        console.error('Error updating billing plan:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to update billing plan in tenant ${tenant}: ${error}`);
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
