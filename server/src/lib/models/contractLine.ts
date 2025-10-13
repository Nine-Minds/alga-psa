// server/src/lib/models/contractLine.ts
import { Knex } from 'knex';
import { IContractLine } from 'server/src/interfaces';
import { getCurrentTenantId } from 'server/src/lib/db';
import { v4 as uuidv4 } from 'uuid';

const ContractLine = {
  isInUse: async (knexOrTrx: Knex | Knex.Transaction, planId: string): Promise<boolean> => {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for checking billing plan usage');
    }

    try {
      const result = await knexOrTrx('client_contract_lines')
        .where({
          contract_line_id: planId,
          tenant
        })
        .count('client_contract_line_id as count')
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
          contract_line_id: planId,
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
      const isUsed = await ContractLine.isInUse(knexOrTrx, planId);
      if (isUsed) {
        throw new Error('Cannot delete plan that is in use by clients');
      }

      const deletedCount = await knexOrTrx('contract_lines')
        .where({
          contract_line_id: planId,
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

  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<IContractLine[]> => {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching billing plans');
    }

    try {
      const plans = await knexOrTrx<IContractLine>('contract_lines')
        .where({ tenant })
        .select('*');

      console.log(`Retrieved ${plans.length} billing plans for tenant ${tenant}`);
      return plans;
    } catch (error) {
      console.error('Error fetching billing plans:', error);
      throw error;
    }
  },

  create: async (knexOrTrx: Knex | Knex.Transaction, plan: Omit<IContractLine, 'contract_line_id'>): Promise<IContractLine> => {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('No tenant found');
    }
    const planWithId = {
      ...plan,
      contract_line_id: uuidv4(),
      tenant
    };
    const [createdPlan] = await knexOrTrx<IContractLine>('contract_lines').insert(planWithId).returning('*');
    return createdPlan;
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, planId: string, updateData: Partial<IContractLine>): Promise<IContractLine> => {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating billing plan');
    }

    try {
      // Remove tenant from update data to prevent modification
      const { tenant: _, ...dataToUpdate } = updateData;

      const [updatedPlan] = await knexOrTrx<IContractLine>('contract_lines')
        .where({
          contract_line_id: planId,
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

  findById: async (knexOrTrx: Knex | Knex.Transaction, planId: string): Promise<IContractLine | null> => {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching a billing plan');
    }

    try {
      // Assume config fields are columns on contract_lines table
      const plan = await knexOrTrx<IContractLine>('contract_lines')
        .where({
          contract_line_id: planId,
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

export default ContractLine;
