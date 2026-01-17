/**
 * @alga-psa/billing - Contract Model
 *
 * Data access layer for contract entities.
 * Migrated from server/src/lib/models/contract.ts
 *
 * Key changes from original:
 * - Tenant is an explicit parameter (not from createTenantKnex)
 * - This decouples the model from Next.js runtime
 */

import type { Knex } from 'knex';
import type { IContract, IContractWithClient, IContractLine } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Contract model with tenant-explicit methods.
 * All methods require an explicit tenant parameter for multi-tenant safety.
 */
const Contract = {
  /**
   * Check if a contract is in use (has active client assignments).
   */
  isInUse: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    contractId: string
  ): Promise<boolean> => {
    if (!tenant) {
      throw new Error('Tenant context is required for checking contract usage');
    }

    try {
      const result = await knexOrTrx('client_contracts')
        .where({ contract_id: contractId, tenant, is_active: true })
        .count('client_contract_id as count')
        .first() as { count?: string };

      return Number(result?.count ?? 0) > 0;
    } catch (error) {
      console.error(`Error checking contract ${contractId} usage:`, error);
      throw error;
    }
  },

  /**
   * Check if a contract has associated invoices.
   */
  hasInvoices: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    contractId: string
  ): Promise<boolean> => {
    if (!tenant) {
      throw new Error('Tenant context is required for checking contract invoices');
    }

    try {
      const result = await knexOrTrx('invoice_charges as ii')
        .join('client_contracts as cc', function () {
          this.on('ii.client_contract_id', '=', 'cc.client_contract_id')
            .andOn('ii.tenant', '=', 'cc.tenant');
        })
        .where({
          'cc.contract_id': contractId,
          'cc.tenant': tenant
        })
        .count('ii.item_id as count')
        .first() as { count?: string };

      return Number(result?.count ?? 0) > 0;
    } catch (error) {
      console.error(`Error checking contract ${contractId} invoices:`, error);
      throw error;
    }
  },

  /**
   * Check if a client has an active contract (excluding a specific contract).
   */
  hasActiveContractForClient: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    clientId: string,
    excludeContractId?: string
  ): Promise<boolean> => {
    if (!tenant) {
      throw new Error('Tenant context is required for checking client active contracts');
    }

    try {
      let query = knexOrTrx('client_contracts as cc')
        .join('contracts as c', function () {
          this.on('cc.contract_id', '=', 'c.contract_id')
            .andOn('cc.tenant', '=', 'c.tenant');
        })
        .where({
          'cc.client_id': clientId,
          'cc.tenant': tenant,
          'c.status': 'active'
        });

      query = query.andWhere((builder) =>
        builder.whereNull('c.is_template').orWhere('c.is_template', false)
      );

      if (excludeContractId) {
        query = query.andWhere('c.contract_id', '!=', excludeContractId);
      }

      const result = (await query
        .count('cc.client_contract_id as count')
        .first()) as { count?: string };

      return Number(result?.count ?? 0) > 0;
    } catch (error) {
      console.error(`Error checking active contracts for client ${clientId}:`, error);
      throw error;
    }
  },

  /**
   * Delete a contract and all related data.
   */
  delete: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    contractId: string
  ): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required for deleting contracts');
    }

    try {
      // Check if contract has any invoices - cannot delete if invoices exist
      const hasInvoices = await Contract.hasInvoices(knexOrTrx, tenant, contractId);
      if (hasInvoices) {
        throw new Error('Cannot delete contract that has associated invoices');
      }

      // Get client_contract_ids that will be deleted
      const clientContractIds = await knexOrTrx('client_contracts')
        .where({ contract_id: contractId, tenant })
        .pluck('client_contract_id');

      // Delete client contract assignments
      await knexOrTrx('client_contracts')
        .where({ contract_id: contractId, tenant })
        .delete();

      const contractLineIds = await knexOrTrx('contract_lines')
        .where({ contract_id: contractId, tenant })
        .pluck('contract_line_id');

      if (contractLineIds.length > 0) {
        // Clear contract_line_id in time_entries before deleting contract_lines
        await knexOrTrx('time_entries')
          .where({ tenant })
          .whereIn('contract_line_id', contractLineIds)
          .update({ contract_line_id: null });

        const configIds = await knexOrTrx('contract_line_service_configuration')
          .where({ tenant })
          .whereIn('contract_line_id', contractLineIds)
          .pluck('config_id');

        if (configIds.length > 0) {
          await knexOrTrx('contract_line_service_bucket_config')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await knexOrTrx('contract_line_service_hourly_config')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await knexOrTrx('contract_line_service_usage_config')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await knexOrTrx('contract_line_service_configuration')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();
        }

        await knexOrTrx('contract_line_service_defaults')
          .where({ tenant })
          .whereIn('contract_line_id', contractLineIds)
          .delete();

        await knexOrTrx('contract_line_services')
          .where({ tenant })
          .whereIn('contract_line_id', contractLineIds)
          .delete();

        await knexOrTrx('contract_lines')
          .where({ tenant })
          .whereIn('contract_line_id', contractLineIds)
          .delete();
      }

      // Delete the contract itself
      const deleted = await knexOrTrx('contracts')
        .where({ contract_id: contractId, tenant })
        .andWhere((builder) =>
          builder.whereNull('is_template').orWhere('is_template', false)
        )
        .delete();

      if (deleted === 0) {
        throw new Error(`Contract ${contractId} not found or belongs to a different tenant`);
      }
    } catch (error) {
      console.error(`Error deleting contract ${contractId}:`, error);
      throw error;
    }
  },

  /**
   * Get all contracts for a tenant.
   */
  getAll: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IContract[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contracts');
    }

    try {
      const contracts = await knexOrTrx('contracts')
        .where({ tenant })
        .whereNot('is_template', true)
        .select('*');

      // Update contract statuses
      for (const contract of contracts) {
        await Contract.checkAndUpdateExpiredStatus(knexOrTrx, tenant, contract.contract_id);
      }

      return await knexOrTrx('contracts')
        .where({ tenant })
        .whereNot('is_template', true)
        .select('*');
    } catch (error) {
      console.error('Error fetching contracts:', error);
      throw error;
    }
  },

  /**
   * Get all contracts with client information for list views.
   */
  getAllWithClients: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IContractWithClient[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contracts');
    }

    try {
      const contractIds = await knexOrTrx('contracts')
        .where({ tenant })
        .select('contract_id');

      for (const { contract_id } of contractIds) {
        await Contract.checkAndUpdateExpiredStatus(knexOrTrx, tenant, contract_id);
      }

      // Now fetch with updated statuses
      const rows = await knexOrTrx('contracts as co')
        .leftJoin('client_contracts as cc', function () {
          this.on('co.contract_id', '=', 'cc.contract_id').andOn(
            'co.tenant',
            '=',
            'cc.tenant'
          );
        })
        .leftJoin('contract_templates as template', function () {
          this.on('cc.template_contract_id', '=', 'template.template_id').andOn(
            'cc.tenant',
            '=',
            'template.tenant'
          );
        })
        .leftJoin('clients as c', function () {
          this.on('cc.client_id', '=', 'c.client_id').andOn('cc.tenant', '=', 'c.tenant');
        })
        .where({ 'co.tenant': tenant })
        .andWhere((builder) =>
          builder.whereNull('co.is_template').orWhere('co.is_template', false)
        )
        .select(
          'co.*',
          'cc.client_contract_id',
          'cc.template_contract_id',
          'c.client_id',
          'c.client_name',
          'cc.start_date',
          'cc.end_date',
          'template.template_name as template_contract_name'
        )
        .orderBy('co.created_at', 'desc');

      return rows;
    } catch (error) {
      console.error('Error fetching contracts with clients:', error);
      throw error;
    }
  },

  /**
   * Get a contract by ID.
   */
  getById: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    contractId: string
  ): Promise<IContract | null> => {
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contracts');
    }

    try {
      // Check and update expired status before fetching
      await Contract.checkAndUpdateExpiredStatus(knexOrTrx, tenant, contractId);

      const contract = await knexOrTrx('contracts')
        .where({ contract_id: contractId, tenant })
        .andWhere((builder) =>
          builder.whereNull('is_template').orWhere('is_template', false)
        )
        .first();

      return contract ?? null;
    } catch (error) {
      console.error(`Error fetching contract ${contractId}:`, error);
      throw error;
    }
  },

  /**
   * Create a new contract.
   */
  create: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    contract: Omit<IContract, 'contract_id'>
  ): Promise<IContract> => {
    if (!tenant) {
      throw new Error('Tenant context is required for creating contracts');
    }

    const timestamp = new Date().toISOString();
    const payload = {
      ...contract,
      contract_id: uuidv4(),
      tenant,
      created_at: timestamp,
      updated_at: timestamp
    };

    try {
      const [created] = await knexOrTrx('contracts').insert(payload).returning('*');
      return created;
    } catch (error) {
      console.error('Error creating contract:', error);
      throw error;
    }
  },

  /**
   * Update a contract.
   */
  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    contractId: string,
    updateData: Partial<IContract>
  ): Promise<IContract> => {
    if (!tenant) {
      throw new Error('Tenant context is required for updating contracts');
    }

    try {
      const sanitized: Partial<IContract> = {
        ...updateData,
        tenant: undefined,
        contract_id: undefined,
        created_at: undefined,
        updated_at: new Date().toISOString()
      };

      const [updated] = await knexOrTrx<IContract>('contracts')
        .where({ contract_id: contractId, tenant })
        .andWhere((builder) =>
          builder.whereNull('is_template').orWhere('is_template', false)
        )
        .update(sanitized)
        .returning('*');

      if (!updated) {
        throw new Error(`Contract ${contractId} not found or belongs to a different tenant`);
      }

      return updated;
    } catch (error) {
      console.error(`Error updating contract ${contractId}:`, error);
      throw error;
    }
  },

  /**
   * Get contract lines for a contract.
   */
  getContractLines: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    contractId: string
  ): Promise<IContractLine[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contract lines');
    }

    try {
      return await knexOrTrx('contract_lines as cl')
        .where({ 'cl.contract_id': contractId, 'cl.tenant': tenant })
        .select(
          'cl.tenant',
          'cl.contract_id',
          'cl.contract_line_id',
          'cl.display_order',
          'cl.custom_rate',
          'cl.billing_timing',
          'cl.created_at',
          'cl.updated_at',
          'cl.contract_line_name',
          'cl.billing_frequency',
          'cl.contract_line_type',
          'cl.description',
          'cl.service_category'
        );
    } catch (error) {
      console.error(`Error fetching contract lines for contract ${contractId}:`, error);
      throw error;
    }
  },

  /**
   * Check if an expired contract should be reactivated based on its end dates.
   * If an expired contract has end dates extended to the future, reactivate it.
   */
  checkAndReactivateExpiredContract: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    contractId: string
  ): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required for checking contract reactivation');
    }

    try {
      // Get the contract
      const contract = await knexOrTrx('contracts')
        .where({ contract_id: contractId, tenant })
        .first();

      if (!contract) {
        return;
      }

      if (contract.is_template === true) {
        return;
      }

      // Only check expired contracts
      if (contract.status !== 'expired') {
        return;
      }

      // Get all client assignments for this contract
      const assignments = await knexOrTrx('client_contracts')
        .where({ contract_id: contractId, tenant })
        .select('end_date', 'client_id');

      // If no assignments, nothing to check
      if (assignments.length === 0) {
        return;
      }

      // Check if any assignment is ongoing (no end date) or has a future end date
      const now = new Date();
      const hasOngoingOrFutureAssignment = assignments.some((a) => {
        if (!a.end_date) {
          return true; // Ongoing assignment
        }
        const endDate = new Date(a.end_date);
        return endDate > now; // Future end date
      });

      // If there's at least one ongoing or future assignment, we need to reactivate
      if (hasOngoingOrFutureAssignment) {
        // Before reactivating, check if any client already has an active contract
        const clientIds = assignments.map((a) => a.client_id);

        for (const clientId of clientIds) {
          const hasActiveContract = await Contract.hasActiveContractForClient(
            knexOrTrx,
            tenant,
            clientId,
            contractId
          );
          if (hasActiveContract) {
            throw new Error(
              'Cannot extend contract end date because the client already has an active contract. To reactivate this contract, terminate their current active contract first.'
            );
          }
        }

        // All clear - reactivate the contract
        await knexOrTrx('contracts')
          .where({ contract_id: contractId, tenant })
          .update({
            status: 'active',
            updated_at: new Date().toISOString()
          });
      }
    } catch (error) {
      console.error(`Error checking contract ${contractId} reactivation:`, error);
      throw error;
    }
  },

  /**
   * Check if a contract should be expired based on its end date and update if necessary.
   * A contract is expired if ALL of its client assignments have end dates in the past.
   */
  checkAndUpdateExpiredStatus: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    contractId: string
  ): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required for checking contract expiration');
    }

    try {
      const contract = await knexOrTrx('contracts')
        .where({ contract_id: contractId, tenant })
        .first();

      if (!contract) {
        return;
      }

      if (contract.status !== 'active') {
        return;
      }

      const assignments = await knexOrTrx('client_contracts')
        .where({ contract_id: contractId, tenant })
        .select('end_date');

      if (assignments.length === 0) {
        return;
      }

      const endDates = assignments
        .map((a) => a.end_date)
        .filter((date): date is string => date !== null && date !== undefined);

      if (endDates.length === 0) {
        return;
      }

      if (endDates.length < assignments.length) {
        return;
      }

      const latestEndDate = endDates.sort().reverse()[0];
      const now = new Date();
      const latestEndDateObj = new Date(latestEndDate);

      if (latestEndDateObj < now) {
        await knexOrTrx('contracts')
          .where({ contract_id: contractId, tenant })
          .update({
            status: 'expired',
            updated_at: new Date().toISOString()
          });
      }
    } catch (error) {
      console.error(`Error checking contract ${contractId} expiration:`, error);
      // Don't throw - this is a background check, don't fail the main operation
    }
  }
};

export default Contract;
