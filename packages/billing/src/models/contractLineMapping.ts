// server/src/lib/models/contractLineMapping.ts
import type { IContractLineMapping } from '@alga-psa/types';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import {
  DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
  resolveRecurringAuthoringPolicy,
} from '@alga-psa/shared/billingClients/recurringAuthoringPolicy';
import { normalizeLiveRecurringStorage } from '@alga-psa/shared/billingClients/recurrenceStorageModel';

function normalizeContractLineMapping<T extends Partial<IContractLineMapping>>(
  line: T,
): T & Pick<IContractLineMapping, 'cadence_owner' | 'billing_timing'> {
  return normalizeLiveRecurringStorage(line);
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

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
      const templateRecord = await tenantScopedTable(db, tenant, 'contract_templates')
        .where({ template_id: contractId })
        .first('template_id');

      if (templateRecord) {
        // Query contract_template_lines directly (mapping data now inlined)
        const templateLines = await tenantScopedTable(db, tenant, 'contract_template_lines')
          .where({ template_id: contractId })
          .select(
            'tenant',
            'template_id as contract_id',
            'template_line_id as contract_line_id',
            'display_order',
            'custom_rate',
            'billing_timing',
            'cadence_owner',
            'created_at'
          );

        return (templateLines as any[]).map((line: any) => normalizeContractLineMapping(line as IContractLineMapping));
      }

      // Query contract_lines directly (mapping data now inlined via contract_id column)
      const contractLines = await tenantScopedTable(db, tenant, 'contract_lines')
        .where({ contract_id: contractId })
        .select(
          'tenant',
          'contract_id',
          'contract_line_id',
          'display_order',
          'custom_rate',
          'billing_timing',
          'cadence_owner',
          'created_at'
        ) as IContractLineMapping[];

      return contractLines.map((line) => normalizeContractLineMapping(line));
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
      const result = await tenantScopedTable(db, tenant, 'contract_lines')
        .where({
          contract_id: contractId,
          contract_line_id: contractLineId,
        })
        .first();

      if (result) {
        return true;
      }

      // Check contract_template_lines directly
      const templateResult = await tenantScopedTable(db, tenant, 'contract_template_lines')
        .where({
          template_id: contractId,
          template_line_id: contractLineId,
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
      const contract = await tenantScopedTable(db, tenant, 'contracts')
        .where({
          contract_id: contractId,
        })
        .first();

      if (!contract) {
        throw new Error(`Contract ${contractId} not found`);
      }

      const contractLine = await tenantScopedTable(db, tenant, 'contract_lines')
        .where({
          contract_line_id: contractLineId,
        })
        .first();

      if (!contractLine) {
        throw new Error(`Contract line ${contractLineId} not found`);
      }

      const alreadyLinked = await ContractLineMapping.isContractLineAttached(contractId, contractLineId);
      if (alreadyLinked) {
        throw new Error(`Contract line ${contractLineId} is already linked to contract ${contractId}`);
      }

      if (!contractLine.cadence_owner) {
        throw new Error(
          `Contract line ${contractLineId} is missing cadence_owner and must be normalized before linking.`,
        );
      }

      // Update contract_lines directly to link it to the contract
      const [updatedLine] = await tenantScopedTable(db, tenant, 'contract_lines')
        .where({
          contract_line_id: contractLineId,
        })
        .update({
          contract_id: contractId,
          custom_rate: customRate,
          cadence_owner: contractLine.cadence_owner,
          display_order: 0,
          updated_at: db.fn.now()
        })
        .returning([
          'tenant',
          'contract_id',
          'contract_line_id',
          'display_order',
          'custom_rate',
          'billing_timing',
          'cadence_owner',
          'created_at'
        ]);

      return normalizeContractLineMapping(updatedLine as IContractLineMapping);
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
      const facade = tenantDb(db, tenant);
      const invoiceItemsQuery = facade.table('invoice_items as ii');
      facade.tenantJoin(invoiceItemsQuery, 'client_contracts as cc', 'ii.client_contract_id', 'cc.client_contract_id');

      const result = await invoiceItemsQuery
        .where('cc.contract_id', contractId)
        .count('ii.item_id as count')
        .first() as { count?: string };

      const hasInvoices = Number(result?.count ?? 0) > 0;

      if (hasInvoices) {
        throw new Error(`Cannot remove contract line ${contractLineId} from contract ${contractId} as the contract has associated invoices`);
      }

      // Unlink by setting contract_id to NULL in contract_lines
      const updatedCount = await tenantScopedTable(db, tenant, 'contract_lines')
        .where({
          contract_id: contractId,
          contract_line_id: contractLineId,
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

      const existingLine = await tenantScopedTable(db, tenant, 'contract_lines')
        .where({
          contract_id: contractId,
          contract_line_id: contractLineId,
        })
        .first(['cadence_owner', 'billing_timing']);
      const recurringAuthoringPolicy = resolveRecurringAuthoringPolicy({
        cadenceOwner: dataToUpdate.cadence_owner,
        fallbackCadenceOwner: existingLine?.cadence_owner ?? DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
        billingTiming: dataToUpdate.billing_timing,
        fallbackBillingTiming: existingLine?.billing_timing,
      });

      // Try updating contract_lines directly
      const [updatedLine] = await tenantScopedTable(db, tenant, 'contract_lines')
        .where({
          contract_id: contractId,
          contract_line_id: contractLineId,
        })
        .update({
          ...dataToUpdate,
          billing_timing: recurringAuthoringPolicy.billingTiming,
          cadence_owner: recurringAuthoringPolicy.cadenceOwner,
          updated_at: db.fn.now()
        })
        .returning([
          'tenant',
          'contract_id',
          'contract_line_id',
          'display_order',
          'custom_rate',
          'billing_timing',
          'cadence_owner',
          'created_at'
        ]);

      if (updatedLine) {
        return normalizeContractLineMapping(updatedLine as IContractLineMapping);
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
      if (dataToUpdate.cadence_owner !== undefined) {
        templateUpdatePayload.cadence_owner = recurringAuthoringPolicy.cadenceOwner;
      }
      if (dataToUpdate.billing_timing !== undefined) {
        templateUpdatePayload.billing_timing = recurringAuthoringPolicy.billingTiming;
      }

      const [updatedTemplateLine] = await tenantScopedTable(db, tenant, 'contract_template_lines')
        .where({
          template_id: contractId,
          template_line_id: contractLineId,
        })
        .update(templateUpdatePayload)
        .returning([
          'tenant',
          'template_id as contract_id',
          'template_line_id as contract_line_id',
          'display_order',
          'custom_rate',
          'billing_timing',
          'cadence_owner',
          'created_at',
        ]);

      if (!updatedTemplateLine) {
        throw new Error(`Failed to update contract line ${contractLineId} for contract ${contractId}`);
      }

      return normalizeContractLineMapping(updatedTemplateLine as IContractLineMapping);
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
      const templateRecord = await tenantScopedTable(db, tenant, 'contract_templates')
        .where({ template_id: contractId })
        .first('template_id');

      if (templateRecord) {
        // Query contract_template_lines directly (mapping data now inlined)
        const facade = tenantDb(db, tenant);
        const query = facade.table('contract_template_lines as lines');
        facade.tenantJoin(query, 'contract_template_line_fixed_config as tfc', 'lines.template_line_id', 'tfc.template_line_id', { type: 'left' });

        return await query
          .where({
            'lines.template_id': contractId,
          })
          .select(
            'lines.tenant as tenant',
            'lines.template_id as contract_id',
            'lines.template_line_id as contract_line_id',
            'lines.display_order',
            'lines.custom_rate',
            'lines.cadence_owner',
            'lines.created_at',
            'lines.template_line_name as contract_line_name',
            'lines.billing_frequency',
            'lines.billing_timing',
            db.raw('false as is_custom'),
            'lines.line_type as contract_line_type',
            'lines.minimum_billable_time',
            'lines.round_up_to_nearest',
            'tfc.base_rate as default_rate',
            db.raw('NULL::uuid as location_id')
          )
          .orderBy('lines.display_order', 'asc');
      }

      // Query contract_lines directly (mapping data now inlined via contract_id column)
      // After migration 20251028120000, contract_line_fixed_config was merged into contract_lines
      return await tenantScopedTable(db, tenant, 'contract_lines as cl')
        .where({
          'cl.contract_id': contractId,
        })
        .select(
          'cl.tenant',
          'cl.contract_id',
          'cl.contract_line_id',
          'cl.display_order',
          'cl.custom_rate',
          'cl.cadence_owner',
          'cl.created_at',
          'cl.contract_line_name',
          'cl.billing_frequency',
          'cl.billing_timing',
          'cl.is_custom',
          'cl.contract_line_type',
          'cl.minimum_billable_time',
          'cl.round_up_to_nearest',
          'cl.custom_rate as default_rate',
          'cl.location_id'
        )
        .orderBy('cl.display_order', 'asc');
    } catch (error) {
      console.error(`Error fetching detailed contract line mappings for contract ${contractId}:`, error);
      throw error;
    }
  }
};

export default ContractLineMapping;
