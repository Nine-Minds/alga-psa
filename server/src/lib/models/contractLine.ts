// server/src/lib/models/contractLine.ts
import { Knex } from 'knex';
import { IContractLine } from 'server/src/interfaces';
import { getCurrentTenantId } from 'server/src/lib/db';
import { v4 as uuidv4 } from 'uuid';

const ContractLine = {
  isInUse: async (knexOrTrx: Knex | Knex.Transaction, contractLineId: string): Promise<boolean> => {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for checking contract line usage');
    }

    try {
      const result = await knexOrTrx('client_contract_lines')
        .where({
          contract_line_id: contractLineId,
          tenant
        })
        .count('client_contract_line_id as count')
        .first() as { count: string };

      return parseInt(result?.count || '0', 10) > 0;
    } catch (error) {
      console.error(`Error checking contract line ${contractLineId} usage:`, error);
      throw error;
    }
  },

  hasAssociatedServices: async (knexOrTrx: Knex | Knex.Transaction, contractLineId: string): Promise<boolean> => {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for checking contract line services');
    }

    try {
      const result = await knexOrTrx('contract_line_services')
        .where({
          contract_line_id: contractLineId,
          tenant
        })
        .count('service_id as count')
        .first() as { count: string };

      return parseInt(result?.count || '0', 10) > 0;
    } catch (error) {
      console.error(`Error checking contract line ${contractLineId} services:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, contractLineId: string): Promise<void> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      throw new Error('Tenant context is required for deleting contract line');
    }

    try {
      const isUsed = await ContractLine.isInUse(knexOrTrx, contractLineId);
      if (isUsed) {
        throw new Error('Cannot delete contract line that is in use by clients');
      }

      const deletedCount = await knexOrTrx('contract_lines')
        .where({
          contract_line_id: contractLineId,
          tenant
        })
        .delete();

      if (deletedCount === 0) {
        throw new Error(`Contract line ${contractLineId} not found or belongs to different tenant`);
      }
    } catch (error) {
      console.error(`Error deleting contract line ${contractLineId}:`, error);
      throw error;
    }
  },

  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<IContractLine[]> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      throw new Error('Tenant context is required for fetching contract lines');
    }

    try {
      const contractLines = await knexOrTrx<IContractLine>('contract_lines')
        .where({ tenant })
        .select('*');

      console.log(`Retrieved ${contractLines.length} contract lines for tenant ${tenant}`);
      return contractLines;
    } catch (error) {
      console.error('Error fetching contract lines:', error);
      throw error;
    }
  },

  create: async (knexOrTrx: Knex | Knex.Transaction, contractLine: Omit<IContractLine, 'contract_line_id'>): Promise<IContractLine> => {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('No tenant found');
    }
    const contractLineWithId = {
      ...contractLine,
      contract_line_id: uuidv4(),
      tenant
    };
    const [createdcontractLine] = await knexOrTrx<IContractLine>('contract_lines').insert(contractLineWithId).returning('*');
    return createdcontractLine;
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, contractLineId: string, updateData: Partial<IContractLine>): Promise<IContractLine> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      throw new Error('Tenant context is required for updating contract line');
    }

    try {
      // Remove tenant from update data to prevent modification
      const { tenant: _, ...dataToUpdate } = updateData;

      const [updatedContractLine] = await knexOrTrx<IContractLine>('contract_lines')
        .where({
          contract_line_id: contractLineId,
          tenant
        })
        .update(dataToUpdate)
        .returning('*');

      if (!updatedContractLine) {
        throw new Error(`Contract line ${contractLineId} not found or belongs to different tenant`);
      }

      return updatedContractLine;
    } catch (error) {
      console.error(`Error updating contract line ${contractLineId}:`, error);
      throw error;
    }
  },

  findById: async (knexOrTrx: Knex | Knex.Transaction, contractLineId: string): Promise<IContractLine | null> => {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching a contract line');
    }

    try {
      // Assume config fields are columns on contract_lines table
      const contractLine = await knexOrTrx<IContractLine>('contract_lines')
        .where({
          contract_line_id: contractLineId,
          tenant: tenant
        })
        .first(); // Use .first() to get a single object or undefined

      if (!contractLine) {
        console.warn(`Contract line ${contractLineId} not found for tenant ${tenant}`);
        return null;
      }

      console.log(`Retrieved contract line ${contractLineId} for tenant ${tenant}`);
      return contractLine;
    } catch (error) {
      console.error(`Error fetching contract line ${contractLineId}:`, error);
      throw error;
    }
  },
};

export default ContractLine;
