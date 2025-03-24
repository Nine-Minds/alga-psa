// server/src/lib/actions/planBundleActions.ts
'use server'

import PlanBundle from 'server/src/lib/models/planBundle';
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { getServerSession } from "next-auth/next";
import { options } from "../../app/api/auth/[...nextauth]/options";

/**
 * Get all plan bundles
 */
export async function getPlanBundles(): Promise<IPlanBundle[]> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const bundles = await PlanBundle.getAll();
    return bundles;
  } catch (error) {
    console.error('Error fetching plan bundles:', error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch plan bundles: ${error}`);
  }
}

/**
 * Get a specific plan bundle by ID
 */
export async function getPlanBundleById(bundleId: string): Promise<IPlanBundle | null> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const bundle = await PlanBundle.getById(bundleId);
    return bundle;
  } catch (error) {
    console.error(`Error fetching plan bundle ${bundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch plan bundle: ${error}`);
  }
}

/**
 * Create a new plan bundle
 */
export async function createPlanBundle(
  bundleData: Omit<IPlanBundle, 'bundle_id' | 'tenant' | 'created_at' | 'updated_at'>
): Promise<IPlanBundle> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    // Remove tenant field if present in bundleData to prevent override
    const { tenant: _, ...safeBundleData } = bundleData as any;
    const bundle = await PlanBundle.create(safeBundleData);
    return bundle;
  } catch (error) {
    console.error('Error creating plan bundle:', error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to create plan bundle in tenant ${tenant}: ${error}`);
  }
}

/**
 * Update an existing plan bundle
 */
export async function updatePlanBundle(
  bundleId: string,
  updateData: Partial<IPlanBundle>
): Promise<IPlanBundle> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    // Remove tenant field if present in updateData to prevent override
    const { tenant: _, ...safeUpdateData } = updateData as any;
    const bundle = await PlanBundle.update(bundleId, safeUpdateData);
    return bundle;
  } catch (error) {
    console.error('Error updating plan bundle:', error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to update plan bundle in tenant ${tenant}: ${error}`);
  }
}

/**
 * Delete a plan bundle
 */
export async function deletePlanBundle(bundleId: string): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    // Check if bundle is in use before attempting to delete
    const isInUse = await PlanBundle.isInUse(bundleId);
    if (isInUse) {
      throw new Error(`Cannot delete bundle that is currently in use by companies in tenant ${tenant}`);
    }

    await PlanBundle.delete(bundleId);
  } catch (error) {
    console.error('Error deleting plan bundle:', error);
    if (error instanceof Error) {
      if (error.message.includes('in use')) {
        throw new Error(`Cannot delete bundle that is currently in use by companies in tenant ${tenant}`);
      }
      throw error; // Preserve other specific error messages
    }
    throw new Error(`Failed to delete plan bundle in tenant ${tenant}: ${error}`);
  }
}

/**
 * Get all billing plans in a bundle
 */
export async function getBundlePlans(bundleId: string): Promise<any[]> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const plans = await PlanBundle.getBundlePlans(bundleId);
    return plans;
  } catch (error) {
    console.error(`Error fetching plans for bundle ${bundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch plans for bundle: ${error}`);
  }
}