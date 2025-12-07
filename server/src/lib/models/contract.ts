import { IContract, IContractWithClient } from 'server/src/interfaces/contract.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { withTransaction } from '@shared/db';
import { Knex as KnexType } from 'knex';

/**
 * Data access helpers for contracts.
 */
const Contract = {
  async isInUse(contractId: string): Promise<boolean> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for checking contract usage');
    }

    try {
      const result = await db('client_contracts')
        .where({ contract_id: contractId, tenant, is_active: true })
        .count('client_contract_id as count')
        .first() as { count?: string };

      return Number(result?.count ?? 0) > 0;
    } catch (error) {
      console.error(`Error checking contract ${contractId} usage:`, error);
      throw error;
    }
  },

  async hasInvoices(contractId: string): Promise<boolean> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for checking contract invoices');
    }

    try {
      // Check if any invoice items exist that reference client_contracts for this specific contract
      const result = await db('invoice_charges as ii')
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

      return Number(result?.count ?? 0) > 0;
    } catch (error) {
      console.error(`Error checking contract ${contractId} invoices:`, error);
      throw error;
    }
  },

  async hasActiveContractForClient(clientId: string, excludeContractId?: string): Promise<boolean> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for checking client active contracts');
    }

    try {
      // Check if client has any active contracts (excluding the current one if updating)
      let query = db('client_contracts as cc')
        .join('contracts as c', function joinContracts() {
          this.on('cc.contract_id', '=', 'c.contract_id')
            .andOn('cc.tenant', '=', 'c.tenant');
        })
        .where({
          'cc.client_id': clientId,
          'cc.tenant': tenant,
          'c.status': 'active'
        });
      query = query.andWhere((builder) => builder.whereNull('c.is_template').orWhere('c.is_template', false));

      if (excludeContractId) {
        query = query.andWhere('c.contract_id', '!=', excludeContractId);
      }

      const result = await query.count('cc.client_contract_id as count').first() as { count?: string };

      return Number(result?.count ?? 0) > 0;
    } catch (error) {
      console.error(`Error checking active contracts for client ${clientId}:`, error);
      throw error;
    }
  },

  async delete(contractId: string): Promise<void> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for deleting contracts');
    }

    try {
      // Check if contract has any invoices - cannot delete if invoices exist
      const hasInvoices = await Contract.hasInvoices(contractId);
      if (hasInvoices) {
        throw new Error('Cannot delete contract that has associated invoices');
      }

      await db.transaction(async (trx) => {
        // First get client_contract_ids that will be deleted
        const clientContractIds = await trx('client_contracts')
          .where({ contract_id: contractId, tenant })
          .pluck('client_contract_id');

        // Handle client_contract_lines deletion (FK constraints removed for Citus compatibility)
        if (clientContractIds.length > 0) {
          // Get client_contract_line_ids that will be deleted
          const clientContractLineIds = await trx('client_contract_lines')
            .where({ tenant })
            .whereIn('client_contract_id', clientContractIds)
            .pluck('client_contract_line_id');

          // Clear contract_line_id in time_entries before deleting client_contract_lines
          // (replaces ON DELETE SET NULL behavior)
          if (clientContractLineIds.length > 0) {
            await trx('time_entries')
              .where({ tenant })
              .whereIn('contract_line_id', clientContractLineIds)
              .update({ contract_line_id: null });
          }

          // Delete client_contract_lines
          await trx('client_contract_lines')
            .where({ tenant })
            .whereIn('client_contract_id', clientContractIds)
            .delete();
        }

        // Delete client contract assignments
        await trx('client_contracts')
          .where({ contract_id: contractId, tenant })
          .delete();

        const contractLineIds = await trx('contract_lines')
          .where({ contract_id: contractId, tenant })
          .pluck('contract_line_id');

        if (contractLineIds.length > 0) {
          const configIds = await trx('contract_line_service_configuration')
            .where({ tenant })
            .whereIn('contract_line_id', contractLineIds)
            .pluck('config_id');

          if (configIds.length > 0) {
            await trx('contract_line_service_bucket_config')
              .where({ tenant })
              .whereIn('config_id', configIds)
              .delete();

            await trx('contract_line_service_hourly_config')
              .where({ tenant })
              .whereIn('config_id', configIds)
              .delete();

            await trx('contract_line_service_usage_config')
              .where({ tenant })
              .whereIn('config_id', configIds)
              .delete();

            await trx('contract_line_service_configuration')
              .where({ tenant })
              .whereIn('config_id', configIds)
              .delete();
          }

          await trx('contract_line_service_defaults')
            .where({ tenant })
            .whereIn('contract_line_id', contractLineIds)
            .delete();

          await trx('contract_line_services')
            .where({ tenant })
            .whereIn('contract_line_id', contractLineIds)
            .delete();

          await trx('contract_lines')
            .where({ tenant })
            .whereIn('contract_line_id', contractLineIds)
            .delete();
        }

        // Delete the contract itself
        const deleted = await trx('contracts')
          .where({ contract_id: contractId, tenant })
          .andWhere((builder) => builder.whereNull('is_template').orWhere('is_template', false))
          .delete();

        if (deleted === 0) {
          throw new Error(`Contract ${contractId} not found or belongs to a different tenant`);
        }
      });
    } catch (error) {
      console.error(`Error deleting contract ${contractId}:`, error);
      throw error;
    }
  },

  async getAll(): Promise<IContract[]> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contracts');
    }

    try {
      return await withTransaction(db, async (trx) => {
        const contracts = await trx('contracts')
          .where({ tenant })
          .whereNot('is_template', true)
          .select('*');

        // Update contract statuses sequentially within the same connection
        for (const contract of contracts) {
          await Contract.checkAndUpdateExpiredStatus(contract.contract_id, { trx, tenant });
        }

        return await trx('contracts')
          .where({ tenant })
          .whereNot('is_template', true)
          .select('*');
      });
    } catch (error) {
      console.error('Error fetching contracts:', error);
      throw error;
    }
  },

  async getAllWithClients(): Promise<IContractWithClient[]> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contracts');
    }

    try {
      return await withTransaction(db, async (trx) => {
        const contractIds = await trx('contracts')
          .where({ tenant })
          .select('contract_id');

        for (const { contract_id } of contractIds) {
          await Contract.checkAndUpdateExpiredStatus(contract_id, { trx, tenant });
        }

        // Now fetch with updated statuses
        const rows = await trx('contracts as co')
          .leftJoin('client_contracts as cc', function joinClientContracts() {
            this.on('co.contract_id', '=', 'cc.contract_id')
              .andOn('co.tenant', '=', 'cc.tenant');
          })
          .leftJoin('contract_templates as template', function joinTemplateContracts() {
            this.on('cc.template_contract_id', '=', 'template.template_id')
              .andOn('cc.tenant', '=', 'template.tenant');
          })
          .leftJoin('clients as c', function joinClients() {
            this.on('cc.client_id', '=', 'c.client_id')
              .andOn('cc.tenant', '=', 'c.tenant');
          })
          .where({ 'co.tenant': tenant })
          .andWhere((builder) => builder.whereNull('co.is_template').orWhere('co.is_template', false))
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
      });
    } catch (error) {
      console.error('Error fetching contracts with clients:', error);
      throw error;
    }
  },

  async getById(contractId: string): Promise<IContract | null> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contracts');
    }

    try {
      // Check and update expired status before fetching
      await Contract.checkAndUpdateExpiredStatus(contractId);

      const contract = await db('contracts')
        .where({ contract_id: contractId, tenant })
        .andWhere((builder) => builder.whereNull('is_template').orWhere('is_template', false))
        .first();

      return contract ?? null;
    } catch (error) {
      console.error(`Error fetching contract ${contractId}:`, error);
      throw error;
    }
  },

  async create(contract: Omit<IContract, 'contract_id'>): Promise<IContract> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for creating contracts');
    }

    const timestamp = new Date().toISOString();
    const payload = {
      ...contract,
      contract_id: uuidv4(),
      tenant,
      created_at: timestamp,
      updated_at: timestamp,
    };

    try {
      const [created] = await db('contracts').insert(payload).returning('*');
      return created;
    } catch (error) {
      console.error('Error creating contract:', error);
      throw error;
    }
  },

  async update(contractId: string, updateData: Partial<IContract>): Promise<IContract> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for updating contracts');
    }

    try {
      const sanitized: Partial<IContract> = {
        ...updateData,
        tenant: undefined,
        contract_id: undefined,
        created_at: undefined,
        updated_at: new Date().toISOString(),
      };

      const [updated] = await db<IContract>('contracts')
        .where({ contract_id: contractId, tenant })
        .andWhere((builder) => builder.whereNull('is_template').orWhere('is_template', false))
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

  async getContractLines(contractId: string): Promise<any[]> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contract lines');
    }

    try {
      return await db('contract_lines as cl')
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
  async checkAndReactivateExpiredContract(contractId: string): Promise<void> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for checking contract reactivation');
    }

    try {
      // Get the contract
      const contract = await db('contracts')
        .where({ contract_id: contractId, tenant })
        .first();

      if (!contract) {
        return;
      }

      if (contract.is_template === true) {
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
      const assignments = await db('client_contracts')
        .where({ contract_id: contractId, tenant })
        .select('end_date', 'client_id');

      // If no assignments, nothing to check
      if (assignments.length === 0) {
        return;
      }

      // Check if any assignment is ongoing (no end date) or has a future end date
      const now = new Date();
      const hasOngoingOrFutureAssignment = assignments.some(a => {
        if (!a.end_date) {
          return true; // Ongoing assignment
        }
        const endDate = new Date(a.end_date);
        return endDate > now; // Future end date
      });

      // If there's at least one ongoing or future assignment, we need to reactivate
      if (hasOngoingOrFutureAssignment) {
        // Before reactivating, check if any client already has an active contract
        const clientIds = assignments.map(a => a.client_id);

        for (const clientId of clientIds) {
          const hasActiveContract = await Contract.hasActiveContractForClient(clientId, contractId);
          if (hasActiveContract) {
            throw new Error('Cannot extend contract end date because the client already has an active contract. To reactivate this contract, terminate their current active contract first.');
          }
        }

        // All clear - reactivate the contract
        await db('contracts')
          .where({ contract_id: contractId, tenant })
          .update({
            status: 'active',
            updated_at: new Date().toISOString()
          });
      }
    } catch (error) {
      console.error(`Error checking contract ${contractId} reactivation:`, error);
      // Re-throw the error so the user sees the validation message
      throw error;
    }
  },

  /**
   * Check if a contract should be expired based on its end date and update if necessary.
   * A contract is expired if ALL of its client assignments have end dates in the past.
   */
  async checkAndUpdateExpiredStatus(
    contractId: string,
    options?: { trx?: KnexType.Transaction; tenant?: string }
  ): Promise<void> {
    if (options?.trx) {
      if (!options.tenant) {
        throw new Error('Tenant context is required for checking contract expiration');
      }
      await checkAndUpdateExpiredStatusWithContext(contractId, options.trx, options.tenant);
      return;
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for checking contract expiration');
    }

    await checkAndUpdateExpiredStatusWithContext(contractId, db, tenant);
  },
};

async function checkAndUpdateExpiredStatusWithContext(
  contractId: string,
  db: KnexType | KnexType.Transaction,
  tenant: string
): Promise<void> {
  try {
    const contract = await db('contracts')
      .where({ contract_id: contractId, tenant })
      .first();

    if (!contract) {
      return;
    }

    if (contract.status !== 'active') {
      return;
    }

    const assignments = await db('client_contracts')
      .where({ contract_id: contractId, tenant })
      .select('end_date');

    if (assignments.length === 0) {
      return;
    }

    const endDates = assignments
      .map(a => a.end_date)
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
      await db('contracts')
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

export default Contract;
