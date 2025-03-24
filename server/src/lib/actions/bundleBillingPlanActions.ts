// server/src/lib/actions/bundleBillingPlanActions.ts
'use server'

import BundleBillingPlan from 'server/src/lib/models/bundleBillingPlan';
import { IBundleBillingPlan } from 'server/src/interfaces/planBundle.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { getServerSession } from "next-auth/next";
import { options } from "../../app/api/auth/[...nextauth]/options";

/**
 * Get all billing plans in a bundle
 */
export async function getBundleBillingPlans(bundleId: string): Promise<IBundleBillingPlan[]> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const bundlePlans = await BundleBillingPlan.getByBundleId(bundleId);
    return bundlePlans;
  } catch (error) {
    console.error(`Error fetching billing plans for bundle ${bundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch billing plans for bundle: ${error}`);
  }
}

/**
 * Get detailed information about plans in a bundle
 */
export async function getDetailedBundlePlans(bundleId: string): Promise<any[]> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const bundlePlans = await BundleBillingPlan.getDetailedBundlePlans(bundleId);
    return bundlePlans;
  } catch (error) {
    console.error(`Error fetching detailed plans for bundle ${bundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch detailed plans for bundle: ${error}`);
  }
}

/**
 * Add a billing plan to a bundle
 */
export async function addPlanToBundle(
  bundleId: string, 
  planId: string, 
  customRate?: number
): Promise<IBundleBillingPlan> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const bundlePlan = await BundleBillingPlan.addPlanToBundle(bundleId, planId, customRate);
    return bundlePlan;
  } catch (error) {
    console.error(`Error adding plan ${planId} to bundle ${bundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to add plan to bundle: ${error}`);
  }
}

/**
 * Remove a billing plan from a bundle
 */
export async function removePlanFromBundle(bundleId: string, planId: string): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    await BundleBillingPlan.removePlanFromBundle(bundleId, planId);
  } catch (error) {
    console.error(`Error removing plan ${planId} from bundle ${bundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to remove plan from bundle: ${error}`);
  }
}

/**
 * Update a plan in a bundle (e.g., change custom rate)
 */
export async function updatePlanInBundle(
  bundleId: string, 
  planId: string, 
  updateData: Partial<IBundleBillingPlan>
): Promise<IBundleBillingPlan> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    // Remove tenant field if present in updateData to prevent override
    const { tenant: _, ...safeUpdateData } = updateData as any;
    const updatedBundlePlan = await BundleBillingPlan.updatePlanInBundle(bundleId, planId, safeUpdateData);
    return updatedBundlePlan;
  } catch (error) {
    console.error(`Error updating plan ${planId} in bundle ${bundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to update plan in bundle: ${error}`);
  }
}

/**
 * Check if a plan is already in a bundle
 */
export async function isPlanInBundle(bundleId: string, planId: string): Promise<boolean> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const isInBundle = await BundleBillingPlan.isPlanInBundle(bundleId, planId);
    return isInBundle;
  } catch (error) {
    console.error(`Error checking if plan ${planId} is in bundle ${bundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to check if plan is in bundle: ${error}`);
  }
}