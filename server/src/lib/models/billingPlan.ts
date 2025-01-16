// server/src/lib/models/billingPlan.ts
import { IBillingPlan } from '@/interfaces';
import { createTenantKnex } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

const BillingPlan = {
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
