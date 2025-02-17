// server/src/lib/models/billingPlan.ts
import { IBillingPlan } from '@/interfaces';
import { createTenantKnex } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

const BillingPlan = {
  isInUse: async (planId: string): Promise<boolean> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for checking billing plan usage');
    }

    try {
      const result = await db('company_billing_plans')
        .where({
          plan_id: planId,
          tenant
        })
        .count('company_billing_plan_id as count')
        .first() as { count: string };
      
      return parseInt(result?.count || '0', 10) > 0;
    } catch (error) {
      console.error(`Error checking billing plan ${planId} usage:`, error);
      throw error;
    }
  },

  delete: async (planId: string): Promise<void> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for deleting billing plan');
    }

    try {
      const isUsed = await BillingPlan.isInUse(planId);
      if (isUsed) {
        throw new Error('Cannot delete plan that is in use by companies');
      }

      const deletedCount = await db('billing_plans')
        .where({
          plan_id: planId,
          tenant
        })
        .delete();

      if (deletedCount === 0) {
        throw new Error(`Billing plan ${planId} not found or belongs to different tenant`);
      }
    } catch (error) {
      console.error(`Error deleting billing plan ${planId}:`, error);
      throw error;
    }
  },

  getAll: async (): Promise<IBillingPlan[]> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching billing plans');
    }

    try {
      const plans = await db<IBillingPlan>('billing_plans')
        .where({ tenant })
        .select('*');

      console.log(`Retrieved ${plans.length} billing plans for tenant ${tenant}`);
      return plans;
    } catch (error) {
      console.error('Error fetching billing plans:', error);
      throw error;
    }
  },

  create: async (plan: Omit<IBillingPlan, 'plan_id'>): Promise<IBillingPlan> => {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }
    const planWithId = {
      ...plan,
      plan_id: uuidv4(),
      tenant
    };
    const [createdPlan] = await db<IBillingPlan>('billing_plans').insert(planWithId).returning('*');
    return createdPlan;
  },

  update: async (planId: string, updateData: Partial<IBillingPlan>): Promise<IBillingPlan> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating billing plan');
    }

    try {
      // Remove tenant from update data to prevent modification
      const { tenant: _, ...dataToUpdate } = updateData;

      const [updatedPlan] = await db<IBillingPlan>('billing_plans')
        .where({
          plan_id: planId,
          tenant
        })
        .update(dataToUpdate)
        .returning('*');

      if (!updatedPlan) {
        throw new Error(`Billing plan ${planId} not found or belongs to different tenant`);
      }

      return updatedPlan;
    } catch (error) {
      console.error(`Error updating billing plan ${planId}:`, error);
      throw error;
    }
  },
};

export default BillingPlan;
