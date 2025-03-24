// server/src/lib/models/planBundle.ts
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { v4 as uuidv4 } from 'uuid';

const PlanBundle = {
  /**
   * Check if a bundle is in use by any company
   */
  isInUse: async (bundleId: string): Promise<boolean> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for checking plan bundle usage');
    }

    try {
      const result = await db('company_plan_bundles')
        .where({
          bundle_id: bundleId,
          tenant,
          is_active: true
        })
        .count('company_bundle_id as count')
        .first() as { count: string };
      
      return parseInt(result?.count || '0', 10) > 0;
    } catch (error) {
      console.error(`Error checking plan bundle ${bundleId} usage:`, error);
      throw error;
    }
  },

  /**
   * Delete a plan bundle
   */
  delete: async (bundleId: string): Promise<void> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for deleting plan bundle');
    }

    try {
      const isUsed = await PlanBundle.isInUse(bundleId);
      if (isUsed) {
        throw new Error('Cannot delete bundle that is in use by companies');
      }

      // Start a transaction to ensure all related records are deleted
      await db.transaction(async (trx) => {
        // First delete the bundle-plan associations
        await trx('bundle_billing_plans')
          .where({
            bundle_id: bundleId,
            tenant
          })
          .delete();
        
        // Then delete the bundle itself
        const deletedCount = await trx('plan_bundles')
          .where({
            bundle_id: bundleId,
            tenant
          })
          .delete();

        if (deletedCount === 0) {
          throw new Error(`Plan bundle ${bundleId} not found or belongs to different tenant`);
        }
      });
    } catch (error) {
      console.error(`Error deleting plan bundle ${bundleId}:`, error);
      throw error;
    }
  },

  /**
   * Get all plan bundles
   */
  getAll: async (): Promise<IPlanBundle[]> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching plan bundles');
    }

    try {
      const bundles = await db<IPlanBundle>('plan_bundles')
        .where({ tenant })
        .select('*');

      return bundles;
    } catch (error) {
      console.error('Error fetching plan bundles:', error);
      throw error;
    }
  },

  /**
   * Get a specific plan bundle by ID
   */
  getById: async (bundleId: string): Promise<IPlanBundle | null> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching plan bundle');
    }

    try {
      const bundle = await db<IPlanBundle>('plan_bundles')
        .where({ 
          bundle_id: bundleId,
          tenant 
        })
        .first();

      return bundle || null;
    } catch (error) {
      console.error(`Error fetching plan bundle ${bundleId}:`, error);
      throw error;
    }
  },

  /**
   * Create a new plan bundle
   */
  create: async (bundle: Omit<IPlanBundle, 'bundle_id'>): Promise<IPlanBundle> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('No tenant found');
    }

    const now = new Date().toISOString();
    const bundleWithId = {
      ...bundle,
      bundle_id: uuidv4(),
      tenant,
      created_at: now,
      updated_at: now
    };

    try {
      const [createdBundle] = await db<IPlanBundle>('plan_bundles')
        .insert(bundleWithId)
        .returning('*');

      return createdBundle;
    } catch (error) {
      console.error('Error creating plan bundle:', error);
      throw error;
    }
  },

  /**
   * Update an existing plan bundle
   */
  update: async (bundleId: string, updateData: Partial<IPlanBundle>): Promise<IPlanBundle> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating plan bundle');
    }

    try {
      // Remove tenant from update data to prevent modification
      const { tenant: _, bundle_id, created_at, ...dataToUpdate } = updateData;

      // Add updated timestamp
      const dataWithTimestamp = {
        ...dataToUpdate,
        updated_at: new Date().toISOString()
      };

      const [updatedBundle] = await db<IPlanBundle>('plan_bundles')
        .where({
          bundle_id: bundleId,
          tenant
        })
        .update(dataWithTimestamp)
        .returning('*');

      if (!updatedBundle) {
        throw new Error(`Plan bundle ${bundleId} not found or belongs to different tenant`);
      }

      return updatedBundle;
    } catch (error) {
      console.error(`Error updating plan bundle ${bundleId}:`, error);
      throw error;
    }
  },

  /**
   * Get all billing plans associated with a bundle
   */
  getBundlePlans: async (bundleId: string): Promise<any[]> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching bundle plans');
    }

    try {
      const plans = await db('bundle_billing_plans as bbp')
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
          'bp.service_category',
          'bp.plan_type'
        );

      return plans;
    } catch (error) {
      console.error(`Error fetching plans for bundle ${bundleId}:`, error);
      throw error;
    }
  }
};

export default PlanBundle;