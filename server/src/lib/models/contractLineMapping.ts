// server/src/lib/models/contractLineMapping.ts
import { IContractLineMapping } from 'server/src/interfaces/contract.interfaces';
import { createTenantKnex } from 'server/src/lib/db';

const ContractLineMapping = {
  /**
   * Retrieve all contract line mappings for a contract.
   */
  getByContractId: async (contractId: string): Promise<IContractLineMapping[]> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contract line mappings');
    }

    try {
      const templateRecord = await db('contract_templates')
        .where({ tenant, template_id: contractId })
        .first('template_id');

      if (templateRecord) {
        const templateMappings = await db('contract_template_line_mappings')
          .where({ tenant, template_id: contractId })
          .select(
            'tenant',
            'template_id as contract_id',
            'template_line_id as contract_line_id',
            'display_order',
            'custom_rate',
            'created_at'
          );

        return templateMappings as IContractLineMapping[];
      }

      return await db<IContractLineMapping>('contract_line_mappings')
        .where({ contract_id: contractId, tenant })
        .select('*');
    } catch (error) {
      console.error(`Error fetching contract line mappings for contract ${contractId}:`, error);
      throw error;
    }
  },

  /**
   * Determine whether a contract line is already linked to a contract.
   */
  isContractLineAttached: async (contractId: string, contractLineId: string): Promise<boolean> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for checking contract line association');
    }

    try {
      const result = await db('contract_line_mappings')
        .where({
          contract_id: contractId,
          contract_line_id: contractLineId,
          tenant
        })
        .first();
      
      if (result) {
        return true;
      }

      const templateResult = await db('contract_template_line_mappings')
        .where({
          template_id: contractId,
          template_line_id: contractLineId,
          tenant,
        })
        .first();

      return !!templateResult;
    } catch (error) {
      console.error(`Error checking if contract line ${contractLineId} is associated with contract ${contractId}:`, error);
      throw error;
    }
  },

  /**
   * Link a contract line to a contract.
   */
  addContractLine: async (contractId: string, contractLineId: string, customRate?: number): Promise<IContractLineMapping> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for adding contract line');
    }

    try {
      const contract = await db('contracts')
        .where({ 
          contract_id: contractId,
          tenant 
        })
        .first();

      if (!contract) {
        throw new Error(`Contract ${contractId} not found or belongs to a different tenant`);
      }

      const contractLine = await db('contract_lines')
        .where({ 
          contract_line_id: contractLineId,
          tenant 
        })
        .first();

      if (!contractLine) {
        throw new Error(`Contract line ${contractLineId} not found or belongs to a different tenant`);
      }

      const alreadyLinked = await ContractLineMapping.isContractLineAttached(contractId, contractLineId);
      if (alreadyLinked) {
        throw new Error(`Contract line ${contractLineId} is already linked to contract ${contractId}`);
      }

      const now = new Date().toISOString();
      const mapping = {
        contract_id: contractId,
        contract_line_id: contractLineId,
        display_order: 0,
        custom_rate: customRate,
        tenant,
        created_at: now
      };

      const [createdMapping] = await db<IContractLineMapping>('contract_line_mappings')
        .insert(mapping)
        .returning('*');

      return createdMapping;
    } catch (error) {
      console.error(`Error adding contract line ${contractLineId} to contract ${contractId}:`, error);
      throw error;
    }
  },

  /**
   * Unlink a contract line from a contract.
   */
  removeContractLine: async (contractId: string, contractLineId: string): Promise<void> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for removing contract line link');
    }

    try {
      const isLinked = await ContractLineMapping.isContractLineAttached(contractId, contractLineId);
      if (!isLinked) {
        throw new Error(`Contract line ${contractLineId} is not linked to contract ${contractId}`);
      }

      // Check if any invoice items exist that reference client_contracts for this specific contract
      // This ensures we only prevent removal if invoices were actually generated from THIS contract
      const result = await db('invoice_items as ii')
        .join('client_contracts as cc', function() {
          this.on('ii.client_contract_id', '=', 'cc.client_contract_id')
              .andOn('ii.tenant', '=', 'cc.tenant');
        })
        .where({
          'cc.contract_id': contractId,
          'cc.tenant': tenant
        })
        .count('ii.item_id as count')
        .first() as { count?: string };

      const hasInvoices = Number(result?.count ?? 0) > 0;

      if (hasInvoices) {
        throw new Error(`Cannot remove contract line ${contractLineId} from contract ${contractId} as the contract has associated invoices`);
      }

      const deletedCount = await db('contract_line_mappings')
        .where({
          contract_id: contractId,
          contract_line_id: contractLineId,
          tenant
        })
        .delete();

      if (deletedCount === 0) {
        throw new Error(`Failed to remove contract line ${contractLineId} from contract ${contractId}`);
      }
    } catch (error) {
      console.error(`Error removing contract line ${contractLineId} from contract ${contractId}:`, error);
      throw error;
    }
  },

  /**
   * Update metadata for a contract line association (e.g., custom rate).
   */
  updateContractLineAssociation: async (
    contractId: string, 
    contractLineId: string, 
    updateData: Partial<IContractLineMapping>
  ): Promise<IContractLineMapping> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating contract line association');
    }

    try {
      const isLinked = await ContractLineMapping.isContractLineAttached(contractId, contractLineId);
      if (!isLinked) {
        throw new Error(`Contract line ${contractLineId} is not linked to contract ${contractId}`);
      }

      const {
        tenant: _,
        contract_id,
        contract_line_id,
        created_at,
        ...dataToUpdate
      } = updateData;

      const [updatedMapping] = await db<IContractLineMapping>('contract_line_mappings')
        .where({
          contract_id: contractId,
          contract_line_id: contractLineId,
          tenant
        })
        .update(dataToUpdate)
        .returning('*');

      if (updatedMapping) {
        return updatedMapping;
      }

      const templateUpdatePayload: Record<string, unknown> = {};
      if (dataToUpdate.custom_rate !== undefined) {
        templateUpdatePayload.custom_rate = dataToUpdate.custom_rate;
      }
      if (dataToUpdate.display_order !== undefined) {
        templateUpdatePayload.display_order = dataToUpdate.display_order;
      }

      const [updatedTemplateMapping] = await db('contract_template_line_mappings')
        .where({
          template_id: contractId,
          template_line_id: contractLineId,
          tenant,
        })
        .update(templateUpdatePayload)
        .returning([
          'tenant',
          'template_id as contract_id',
          'template_line_id as contract_line_id',
          'display_order',
          'custom_rate',
          'created_at',
        ]);

      if (!updatedTemplateMapping) {
        throw new Error(`Failed to update contract line ${contractLineId} for contract ${contractId}`);
      }

      return updatedTemplateMapping as IContractLineMapping;
    } catch (error) {
      console.error(`Error updating contract line ${contractLineId} for contract ${contractId}:`, error);
      throw error;
    }
  },

  /**
   * Retrieve contract line associations with metadata for a contract.
   */
  getDetailedContractLines: async (contractId: string): Promise<any[]> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching detailed contract line mappings');
    }

    try {
      const templateRecord = await db('contract_templates')
        .where({ tenant, template_id: contractId })
        .first('template_id');

      if (templateRecord) {
        return await db('contract_template_line_mappings as map')
          .join('contract_template_lines as lines', function joinTemplateLines() {
            this.on('map.template_line_id', '=', 'lines.template_line_id')
              .andOn('map.tenant', '=', 'lines.tenant');
          })
          .leftJoin('contract_lines as base', function joinBaseLines() {
            this.on('lines.template_line_id', '=', 'base.contract_line_id')
              .andOn('lines.tenant', '=', 'base.tenant');
          })
          .where({
            'map.template_id': contractId,
            'map.tenant': tenant,
          })
          .select(
            'map.tenant as tenant',
            'map.template_id as contract_id',
            'map.template_line_id as contract_line_id',
            'map.display_order',
            'map.custom_rate',
            'map.created_at',
            'lines.template_line_name as contract_line_name',
            'lines.billing_frequency',
            db.raw('COALESCE(base.is_custom, false) as is_custom'),
            'lines.line_type as contract_line_type',
            'lines.minimum_billable_time',
            'lines.round_up_to_nearest'
          )
          .orderBy('map.display_order', 'asc');
      }

      return await db('contract_line_mappings as clm')
        .join('contract_lines as cl', function() {
          this.on('clm.contract_line_id', '=', 'cl.contract_line_id')
              .andOn('clm.tenant', '=', 'cl.tenant');
        })
        .where({
          'clm.contract_id': contractId,
          'clm.tenant': tenant
        })
        .select(
          'clm.*',
          'cl.contract_line_name',
          'cl.billing_frequency',
          'cl.is_custom',
          'cl.contract_line_type'
        );
    } catch (error) {
      console.error(`Error fetching detailed contract line mappings for contract ${contractId}:`, error);
      throw error;
    }
  }
};

export default ContractLineMapping;
