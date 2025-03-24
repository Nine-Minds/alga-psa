// server/src/lib/models/bundleBillingPlan.ts
import { IBundleBillingPlan } from 'server/src/interfaces/planBundle.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { v4 as uuidv4 } from 'uuid';

const BundleBillingPlan = {
  /**
   * Get all billing plans in a bundle
   */
  getByBundleId: async (bundleId: string): Promise<IBundleBillingPlan[]> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching bundle billing plans');
    }

    try {
      const bundlePlans = await db<IBundleBillingPlan>('bundle_billing_plans')
        .where({ 
          bundle_id: bundleId,
          tenant 
        })
        .select('*');

      return bundlePlans;
    } catch (error) {
      console.error(`Error fetching billing plans for bundle ${bundleId}:`, error);
      throw error;
    }
  },

  /**
   * Check if a plan is already in a bundle
   */
  isPlanInBundle: async (bundleId: string, planId: string): Promise<boolean> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for checking plan in bundle');
    }

    try {
      const result = await db('bundle_billing_plans')
        .where({
          bundle_id: bundleId,
          plan_id: planId,
          tenant
        })
        .first();
      
      return !!result;
    } catch (error) {
      console.error(`Error checking if plan ${planId} is in bundle ${bundleId}:`, error);
      throw error;
    }
  },

  /**
   * Add a billing plan to a bundle
   */
  addPlanToBundle: async (bundleId: string, planId: string, customRate?: number): Promise<IBundleBillingPlan> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for adding plan to bundle');
    }

    try {
      // Check if the bundle exists
      const bundle = await db('plan_bundles')
        .where({ 
          bundle_id: bundleId,
          tenant 
        })
        .first();

      if (!bundle) {
        throw new Error(`Bundle ${bundleId} not found or belongs to different tenant`);
      }

      // Check if the plan exists
      const plan = await db('billing_plans')
        .where({ 
          plan_id: planId,
          tenant 
        })
        .first();

      if (!plan) {
        throw new Error(`Billing plan ${planId} not found or belongs to different tenant`);
      }

      // Check if the plan is already in the bundle
      const isAlreadyInBundle = await BundleBillingPlan.isPlanInBundle(bundleId, planId);
      if (isAlreadyInBundle) {
        throw new Error(`Billing plan ${planId} is already in bundle ${bundleId}`);
      }

      const now = new Date().toISOString();
      const bundlePlan = {
        bundle_id: bundleId,
        plan_id: planId,
        display_order: 0, // Use the default display order
        custom_rate: customRate,
        tenant,
        created_at: now
      };

      const [createdBundlePlan] = await db<IBundleBillingPlan>('bundle_billing_plans')
        .insert(bundlePlan)
        .returning('*');

      return createdBundlePlan;
    } catch (error) {
      console.error(`Error adding plan ${planId} to bundle ${bundleId}:`, error);
      throw error;
    }
  },

  /**
   * Remove a billing plan from a bundle
   */
  removePlanFromBundle: async (bundleId: string, planId: string): Promise<void> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for removing plan from bundle');
    }

    try {
      // Check if the plan is in the bundle
      const isInBundle = await BundleBillingPlan.isPlanInBundle(bundleId, planId);
      if (!isInBundle) {
        throw new Error(`Billing plan ${planId} is not in bundle ${bundleId}`);
      }

      // Check if the bundle is in use by any company
      const isInUse = await db('company_plan_bundles')
        .where({ 
          bundle_id: bundleId,
          tenant,
          is_active: true 
        })
        .first();

      if (isInUse) {
        throw new Error(`Cannot remove plan from bundle ${bundleId} as it is currently assigned to companies`);
      }

      const deletedCount = await db('bundle_billing_plans')
        .where({
          bundle_id: bundleId,
          plan_id: planId,
          tenant
        })
        .delete();

      if (deletedCount === 0) {
        throw new Error(`Failed to remove plan ${planId} from bundle ${bundleId}`);
      }
    } catch (error) {
      console.error(`Error removing plan ${planId} from bundle ${bundleId}:`, error);
      throw error;
    }
  },

  /**
   * Update a plan in a bundle (e.g., change custom rate)
   */
  updatePlanInBundle: async (
    bundleId: string, 
    planId: string, 
    updateData: Partial<IBundleBillingPlan>
  ): Promise<IBundleBillingPlan> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating plan in bundle');
    }

    try {
      // Check if the plan is in the bundle
      const isInBundle = await BundleBillingPlan.isPlanInBundle(bundleId, planId);
      if (!isInBundle) {
        throw new Error(`Billing plan ${planId} is not in bundle ${bundleId}`);
      }

      // Remove fields that shouldn't be updated
      const { tenant: _, bundle_id, plan_id, created_at, ...dataToUpdate } = updateData;

      // Add updated timestamp
      const dataWithTimestamp = {
        ...dataToUpdate,
        updated_at: new Date().toISOString()
      };

      const [updatedBundlePlan] = await db<IBundleBillingPlan>('bundle_billing_plans')
        .where({
          bundle_id: bundleId,
          plan_id: planId,
          tenant
        })
        .update(dataWithTimestamp)
        .returning('*');

      if (!updatedBundlePlan) {
        throw new Error(`Failed to update plan ${planId} in bundle ${bundleId}`);
      }

      return updatedBundlePlan;
    } catch (error) {
      console.error(`Error updating plan ${planId} in bundle ${bundleId}:`, error);
      throw error;
    }
  },

  /**
   * Get detailed information about plans in a bundle
   * Includes plan details from the billing_plans table
   */
  getDetailedBundlePlans: async (bundleId: string): Promise<any[]> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching detailed bundle plans');
    }

    try {
      const bundlePlans = await db('bundle_billing_plans as bbp')
        .join('billing_plans as bp', 'bbp.plan_id', 'bp.plan_id')
        .where({ 
          'bbp.bundle_id': bundleId,
          'bbp.tenant': tenant 
        })
        .select(
          'bbp.*',
          'bp.plan_name',
          'bp.billing_frequency',
          'bp.is_custom',
          'bp.plan_type'
        );

      return bundlePlans;
    } catch (error) {
      console.error(`Error fetching detailed plans for bundle ${bundleId}:`, error);
      throw error;
    }
  }
};

export default BundleBillingPlan;