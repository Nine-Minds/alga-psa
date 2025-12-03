// server/src/lib/models/contractLineMapping.ts
import { IContractLineMapping } from 'server/src/interfaces/contract.interfaces';
import { createTenantKnex } from 'server/src/lib/db';

const ContractLineMapping = {
  /**
   * Retrieve all contract line mappings for a contract.
   * After migration 20251028090000, data is stored directly in contract_lines/contract_template_lines.
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
        // Query contract_template_lines directly (mapping data now inlined)
        const templateLines = await db('contract_template_lines')
          .where({ tenant, template_id: contractId })
          .select(
            'tenant',
            'template_id as contract_id',
            'template_line_id as contract_line_id',
            'display_order',
            'custom_rate',
            'created_at'
          );

        return templateLines as IContractLineMapping[];
      }

      // Query contract_lines directly (mapping data now inlined via contract_id column)
      return await db('contract_lines')
        .where({ contract_id: contractId, tenant })
        .select(
          'tenant',
          'contract_id',
          'contract_line_id',
          'display_order',
          'custom_rate',
          'created_at'
        ) as IContractLineMapping[];
    } catch (error) {
      console.error(`Error fetching contract line mappings for contract ${contractId}:`, error);
      throw error;
    }
  },

  /**
   * Determine whether a contract line is already linked to a contract.
   * After migration 20251028090000, data is stored directly in contract_lines/contract_template_lines.
   */
  isContractLineAttached: async (contractId: string, contractLineId: string): Promise<boolean> => {
    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant context is required for checking contract line association');
    }

    try {
      // Check contract_lines directly (contract_id column indicates association)
      const result = await db('contract_lines')
        .where({
          contract_id: contractId,
          contract_line_id: contractLineId,
          tenant
        })
        .first();

      if (result) {
        return true;
      }

      // Check contract_template_lines directly
      const templateResult = await db('contract_template_lines')
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
   * After migration 20251028090000, this updates contract_lines.contract_id directly.
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

      // Update contract_lines directly to link it to the contract
      const [updatedLine] = await db('contract_lines')
        .where({
          contract_line_id: contractLineId,
          tenant
        })
        .update({
          contract_id: contractId,
          custom_rate: customRate,
          display_order: 0,
          updated_at: db.fn.now()
        })
        .returning([
          'tenant',
          'contract_id',
          'contract_line_id',
          'display_order',
          'custom_rate',
          'created_at'
        ]);

      return updatedLine as IContractLineMapping;
    } catch (error) {
      console.error(`Error adding contract line ${contractLineId} to contract ${contractId}:`, error);
      throw error;
    }
  },

  /**
   * Unlink a contract line from a contract.
   * After migration 20251028090000, this sets contract_id to NULL in contract_lines.
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

      // Unlink by setting contract_id to NULL in contract_lines
      const updatedCount = await db('contract_lines')
        .where({
          contract_id: contractId,
          contract_line_id: contractLineId,
          tenant
        })
        .update({
          contract_id: null,
          custom_rate: null,
          updated_at: db.fn.now()
        });

      if (updatedCount === 0) {
        throw new Error(`Failed to remove contract line ${contractLineId} from contract ${contractId}`);
      }
    } catch (error) {
      console.error(`Error removing contract line ${contractLineId} from contract ${contractId}:`, error);
      throw error;
    }
  },

  /**
   * Update metadata for a contract line association (e.g., custom rate).
   * After migration 20251028090000, this updates contract_lines/contract_template_lines directly.
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

      // Try updating contract_lines directly
      const [updatedLine] = await db('contract_lines')
        .where({
          contract_id: contractId,
          contract_line_id: contractLineId,
          tenant
        })
        .update({
          ...dataToUpdate,
          updated_at: db.fn.now()
        })
        .returning([
          'tenant',
          'contract_id',
          'contract_line_id',
          'display_order',
          'custom_rate',
          'created_at'
        ]);

      if (updatedLine) {
        return updatedLine as IContractLineMapping;
      }

      // Fall back to contract_template_lines
      const templateUpdatePayload: Record<string, unknown> = {
        updated_at: db.fn.now()
      };
      if (dataToUpdate.custom_rate !== undefined) {
        templateUpdatePayload.custom_rate = dataToUpdate.custom_rate;
      }
      if (dataToUpdate.display_order !== undefined) {
        templateUpdatePayload.display_order = dataToUpdate.display_order;
      }

      const [updatedTemplateLine] = await db('contract_template_lines')
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

      if (!updatedTemplateLine) {
        throw new Error(`Failed to update contract line ${contractLineId} for contract ${contractId}`);
      }

      return updatedTemplateLine as IContractLineMapping;
    } catch (error) {
      console.error(`Error updating contract line ${contractLineId} for contract ${contractId}:`, error);
      throw error;
    }
  },

  /**
   * Retrieve contract line associations with metadata for a contract.
   * After migration 20251028090000, data is stored directly in contract_lines/contract_template_lines.
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
        // Query contract_template_lines directly (mapping data now inlined)
        return await db('contract_template_lines as lines')
          .leftJoin('contract_template_line_fixed_config as tfc', function joinTemplateFixedConfig() {
            this.on('lines.template_line_id', '=', 'tfc.template_line_id')
              .andOn('lines.tenant', '=', 'tfc.tenant');
          })
          .where({
            'lines.template_id': contractId,
            'lines.tenant': tenant,
          })
          .select(
            'lines.tenant as tenant',
            'lines.template_id as contract_id',
            'lines.template_line_id as contract_line_id',
            'lines.display_order',
            'lines.custom_rate',
            'lines.created_at',
            'lines.template_line_name as contract_line_name',
            'lines.billing_frequency',
            db.raw('false as is_custom'),
            'lines.line_type as contract_line_type',
            'lines.minimum_billable_time',
            'lines.round_up_to_nearest',
            'tfc.base_rate as default_rate'
          )
          .orderBy('lines.display_order', 'asc');
      }

      // Query contract_lines directly (mapping data now inlined via contract_id column)
      // After migration 20251028120000, contract_line_fixed_config was merged into contract_lines
      return await db('contract_lines as cl')
        .where({
          'cl.contract_id': contractId,
          'cl.tenant': tenant
        })
        .select(
          'cl.tenant',
          'cl.contract_id',
          'cl.contract_line_id',
          'cl.display_order',
          'cl.custom_rate',
          'cl.created_at',
          'cl.contract_line_name',
          'cl.billing_frequency',
          'cl.is_custom',
          'cl.contract_line_type',
          'cl.minimum_billable_time',
          'cl.round_up_to_nearest',
          'cl.custom_rate as default_rate'
        )
        .orderBy('cl.display_order', 'asc');
    } catch (error) {
      console.error(`Error fetching detailed contract line mappings for contract ${contractId}:`, error);
      throw error;
    }
  }
};

export default ContractLineMapping;
