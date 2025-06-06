// server/src/lib/models/billingPlan.ts
import { Knex } from 'knex';
import { IBillingPlan } from 'server/src/interfaces';
import { getCurrentTenantId } from 'server/src/lib/db';
import { v4 as uuidv4 } from 'uuid';

const BillingPlan = {
  isInUse: async (knexOrTrx: Knex | Knex.Transaction, planId: string): Promise<boolean> => {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for checking billing plan usage');
    }

    try {
      const result = await knexOrTrx('company_billing_plans')
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

  hasAssociatedServices: async (knexOrTrx: Knex | Knex.Transaction, planId: string): Promise<boolean> => {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for checking billing plan services');
    }

    try {
      const result = await knexOrTrx('plan_services')
        .where({
          plan_id: planId,
          tenant
        })
        .count('service_id as count')
        .first() as { count: string };
      
      return parseInt(result?.count || '0', 10) > 0;
    } catch (error) {
      console.error(`Error checking billing plan ${planId} services:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, planId: string): Promise<void> => {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for deleting billing plan');
    }

    try {
      const isUsed = await BillingPlan.isInUse(knexOrTrx, planId);
      if (isUsed) {
        throw new Error('Cannot delete plan that is in use by companies');
      }

      const deletedCount = await knexOrTrx('billing_plans')
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

  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<IBillingPlan[]> => {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching billing plans');
    }

    try {
      const plans = await knexOrTrx<IBillingPlan>('billing_plans')
        .where({ tenant })
        .select('*');

      console.log(`Retrieved ${plans.length} billing plans for tenant ${tenant}`);
      return plans;
    } catch (error) {
      console.error('Error fetching billing plans:', error);
      throw error;
    }
  },

  create: async (knexOrTrx: Knex | Knex.Transaction, plan: Omit<IBillingPlan, 'plan_id'>): Promise<IBillingPlan> => {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('No tenant found');
    }
    const planWithId = {
      ...plan,
      plan_id: uuidv4(),
      tenant
    };
    const [createdPlan] = await knexOrTrx<IBillingPlan>('billing_plans').insert(planWithId).returning('*');
    return createdPlan;
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, planId: string, updateData: Partial<IBillingPlan>): Promise<IBillingPlan> => {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating billing plan');
    }

    try {
      // Remove tenant from update data to prevent modification
      const { tenant: _, ...dataToUpdate } = updateData;

      const [updatedPlan] = await knexOrTrx<IBillingPlan>('billing_plans')
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

  findById: async (knexOrTrx: Knex | Knex.Transaction, planId: string): Promise<IBillingPlan | null> => {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching a billing plan');
    }

    try {
      // Assume config fields are columns on billing_plans table
      const plan = await knexOrTrx<IBillingPlan>('billing_plans')
        .where({
          plan_id: planId,
          tenant: tenant
        })
        .first(); // Use .first() to get a single object or undefined

      if (!plan) {
        console.warn(`Billing plan ${planId} not found for tenant ${tenant}`);
        return null;
      }

      console.log(`Retrieved billing plan ${planId} for tenant ${tenant}`);
      return plan;
    } catch (error) {
      console.error(`Error fetching billing plan ${planId}:`, error);
      throw error;
    }
  },
};

export default BillingPlan;
