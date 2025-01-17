// server/src/lib/models/billingPlan.ts
import { IBillingPlan } from '@/interfaces';
import { createTenantKnex } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

const BillingPlan = {
  isInUse: async (planId: string): Promise<boolean> => {
    const {knex: db} = await createTenantKnex();
    const result = await db('company_billing_plans')
      .where({ plan_id: planId })
      .count('company_billing_plan_id as count')
      .first() as { count: string };
    return parseInt(result?.count || '0', 10) > 0;
  },

  delete: async (planId: string): Promise<void> => {
    const {knex: db} = await createTenantKnex();
    const isUsed = await BillingPlan.isInUse(planId);
    if (isUsed) {
      throw new Error('Cannot delete plan that is in use by companies');
    }
    await db('billing_plans')
      .where({ plan_id: planId })
      .delete();
  },

  getAll: async (): Promise<IBillingPlan[]> => {
    const {knex: db} = await createTenantKnex();
    return await db<IBillingPlan>('billing_plans').select('*');
  },

  create: async (plan: Omit<IBillingPlan, 'plan_id'>): Promise<IBillingPlan> => {
    const {knex: db} = await createTenantKnex();
    const planWithId = {
      ...plan,
      plan_id: uuidv4(),
    };
    const [createdPlan] = await db<IBillingPlan>('billing_plans').insert(planWithId).returning('*');
    return createdPlan;
  },

  update: async (planId: string, updateData: Partial<IBillingPlan>): Promise<IBillingPlan> => {
    const {knex: db} = await createTenantKnex();
    const [updatedPlan] = await db<IBillingPlan>('billing_plans')
      .where({ plan_id: planId })
      .update(updateData)
      .returning('*');
    return updatedPlan;
  },
};

export default BillingPlan;
