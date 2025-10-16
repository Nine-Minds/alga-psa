import { IContract, IContractWithClient } from 'server/src/interfaces/contract.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { v4 as uuidv4 } from 'uuid';

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
        // Delete client contract assignments
        await trx('client_contracts')
          .where({ contract_id: contractId, tenant })
          .delete();

        // Delete contract line mappings
        await trx('contract_line_mappings')
          .where({ contract_id: contractId, tenant })
          .delete();

        // Delete the contract itself
        const deleted = await trx('contracts')
          .where({ contract_id: contractId, tenant })
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
      const rows = await db('contracts').where({ tenant }).select('*');
      return rows;
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
      const rows = await db('contracts as co')
        .leftJoin('client_contracts as cc', function joinClientContracts() {
          this.on('co.contract_id', '=', 'cc.contract_id')
            .andOn('co.tenant', '=', 'cc.tenant');
        })
        .leftJoin('clients as c', function joinClients() {
          this.on('cc.client_id', '=', 'c.client_id')
            .andOn('cc.tenant', '=', 'c.tenant');
        })
        .where({ 'co.tenant': tenant })
        .select(
          'co.*',
          'c.client_id',
          'c.client_name'
        )
        .orderBy('co.created_at', 'desc');

      return rows;
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
      const contract = await db('contracts')
        .where({ contract_id: contractId, tenant })
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
      return await db('contract_line_mappings as clm')
        .join('contract_lines as cl', function joinLines() {
          this.on('clm.contract_line_id', '=', 'cl.contract_line_id').andOn('clm.tenant', '=', 'cl.tenant');
        })
        .where({ 'clm.contract_id': contractId, 'clm.tenant': tenant })
        .select(
          'clm.*',
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
};

export default Contract;
