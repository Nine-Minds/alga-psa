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
import {
  deriveClientContractStatus,
  checkAndReactivateExpiredContract as checkAndReactivateExpiredContractShared,
} from '@alga-psa/shared/billingClients';

const normalizeOwnerClientId = (value: unknown): string | null => (
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
);

const assertNonTemplateContractOwner = (
  contract: Partial<IContract>,
  operation: 'create' | 'update'
): void => {
  const isTemplate = contract.is_template === true;
  if (isTemplate) {
    return;
  }

  if (contract.owner_client_id === undefined && operation === 'update') {
    return;
  }

  const ownerClientId = normalizeOwnerClientId(contract.owner_client_id);
  if (!ownerClientId) {
    throw new Error('Non-template contracts require an owning client');
  }
};

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
          // Child tables reference contract_line_service_configuration via (tenant, config_id).
          // Citus disallows cascading actions on distributed foreign keys; handle deletes explicitly.
          await knexOrTrx('contract_line_service_rate_tiers')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await knexOrTrx('contract_line_service_fixed_config')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await knexOrTrx('contract_line_service_bucket_config')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await knexOrTrx('contract_line_service_hourly_config')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await knexOrTrx('contract_line_service_hourly_configs')
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
        throw new Error(`Contract ${contractId} not found`);
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
      const rows = await knexOrTrx('client_contracts as cc')
        .join('contracts as co', function () {
          this.on('co.contract_id', '=', 'cc.contract_id').andOn('co.tenant', '=', 'cc.tenant');
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
        .leftJoin('clients as owner', function () {
          this.on('co.owner_client_id', '=', 'owner.client_id').andOn('co.tenant', '=', 'owner.tenant');
        })
        .where({ 'cc.tenant': tenant })
        .andWhere((builder) =>
          builder.whereNull('co.is_template').orWhere('co.is_template', false)
        )
        .whereNotNull('co.owner_client_id')
        .select(
          'co.*',
          'co.status as contract_header_status',
          'cc.client_contract_id',
          'cc.is_active as assignment_is_active',
          'cc.template_contract_id',
          'c.client_id',
          'c.client_name',
          'owner.client_name as owner_client_name',
          'cc.start_date',
          'cc.end_date',
          'template.template_name as template_contract_name'
        )
        .orderBy('cc.created_at', 'desc');

      return rows.map((row: any) => {
        const assignmentStatus = deriveClientContractStatus({
          isActive: Boolean(row.assignment_is_active),
          startDate: row.start_date,
          endDate: row.end_date,
        });

        return {
          ...row,
          status: assignmentStatus,
          assignment_status: assignmentStatus,
          contract_header_status: row.contract_header_status ?? row.status,
        };
      });
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

    assertNonTemplateContractOwner(contract, 'create');

    const timestamp = new Date().toISOString();
    const payload = {
      ...contract,
      owner_client_id: normalizeOwnerClientId(contract.owner_client_id),
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
      assertNonTemplateContractOwner(updateData, 'update');

      const sanitized: Partial<IContract> = {
        ...updateData,
        owner_client_id: updateData.owner_client_id === undefined
          ? undefined
          : normalizeOwnerClientId(updateData.owner_client_id),
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
        throw new Error(`Contract ${contractId} not found`);
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
      await checkAndReactivateExpiredContractShared(knexOrTrx, tenant, contractId);
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
