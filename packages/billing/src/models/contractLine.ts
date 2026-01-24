// server/src/lib/models/contractLine.ts
import { Knex } from 'knex';
import type { IContractLine } from '@alga-psa/types';
import { requireTenantId } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';

const ContractLine = {
  isInUse: async (knexOrTrx: Knex | Knex.Transaction, planId: string): Promise<boolean> => {
    const tenant = await requireTenantId(knexOrTrx);

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
      console.error(`Error checking contract line ${planId} usage:`, error);
      throw error;
    }
  },

  hasAssociatedServices: async (knexOrTrx: Knex | Knex.Transaction, planId: string): Promise<boolean> => {
    const tenant = await requireTenantId(knexOrTrx);

    try {
      const result = await knexOrTrx('contract_line_services')
        .where({
          contract_line_id: planId,
          tenant
        })
        .count('service_id as count')
        .first() as { count: string };

      return parseInt(result?.count || '0', 10) > 0;
    } catch (error) {
      console.error(`Error checking contract line ${planId} services:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, planId: string): Promise<void> => {
    const tenant = await requireTenantId(knexOrTrx);

    try {
      const isUsed = await ContractLine.isInUse(knexOrTrx, planId);
      if (isUsed) {
        throw new Error('Cannot delete contract line that is in use by clients');
      }

      const deletedCount = await knexOrTrx('contract_lines')
        .where({
          contract_line_id: planId,
          tenant
        })
        .delete();

      if (deletedCount === 0) {
        throw new Error(`Contract line ${planId} not found or belongs to different tenant`);
      }
    } catch (error) {
      console.error(`Error deleting contract line ${planId}:`, error);
      throw error;
    }
  },

  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<IContractLine[]> => {
    const tenant = await requireTenantId(knexOrTrx);

    try {
      const plans = await knexOrTrx<IContractLine>('contract_lines')
        .where({ tenant })
        .select('*');

      console.log(`Retrieved ${plans.length} contract lines for tenant ${tenant}`);
      return plans;
    } catch (error) {
      console.error('Error fetching contract lines:', error);
      throw error;
    }
  },

  create: async (knexOrTrx: Knex | Knex.Transaction, plan: Omit<IContractLine, 'contract_line_id'>): Promise<IContractLine> => {
    const tenant = await requireTenantId(knexOrTrx);

    const {
      hourly_rate,
      enable_overtime,
      overtime_rate,
      overtime_threshold,
      enable_after_hours_rate,
      after_hours_multiplier,
      billing_timing,
      ...contractLineCore
    } = plan;

    const planWithId = {
      ...contractLineCore,
      contract_line_id: uuidv4(),
      tenant
    };
    const [createdPlan] = await knexOrTrx<IContractLine>('contract_lines').insert(planWithId).returning('*');
    return createdPlan;
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, planId: string, updateData: Partial<IContractLine>): Promise<IContractLine> => {
    const tenant = await requireTenantId(knexOrTrx);

    try {
      // Remove tenant from update data to prevent modification
      const { tenant: _, ...dataToUpdate } = updateData;

      const { billing_timing, ...rest } = dataToUpdate;

      const [updatedPlan] = await knexOrTrx<IContractLine>('contract_lines')
        .where({
          contract_line_id: planId,
          tenant
        })
        .update(rest)
        .returning('*');

      if (!updatedPlan) {
        throw new Error(`Contract line ${planId} not found or belongs to different tenant`);
      }

      return updatedPlan;
    } catch (error) {
      console.error(`Error updating contract line ${planId}:`, error);
      throw error;
    }
  },

  findById: async (knexOrTrx: Knex | Knex.Transaction, planId: string): Promise<IContractLine | null> => {
    const tenant = await requireTenantId(knexOrTrx);

    try {
      // Assume config fields are columns on contract_lines table
      const plan = await knexOrTrx<IContractLine>('contract_lines')
        .where({
          contract_line_id: planId,
          tenant: tenant
        })
        .first(); // Use .first() to get a single object or undefined

      if (!plan) {
        console.warn(`Contract line ${planId} not found for tenant ${tenant}`);
        return null;
      }

      console.log(`Retrieved contract line ${planId} for tenant ${tenant}`);
      return plan;
    } catch (error) {
      console.error(`Error fetching contract line ${planId}:`, error);
      throw error;
    }
  },
};

export default ContractLine;
