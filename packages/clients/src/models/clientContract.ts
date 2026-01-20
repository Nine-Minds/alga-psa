import type { IClientContract } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';

const normalizeClientContract = (row: any): any => {
  if (!row) return row;
  if (row.contract_billing_frequency !== undefined && row.billing_frequency === undefined) {
    row.billing_frequency = row.contract_billing_frequency;
  }
  return row;
};

/**
 * Data access helpers for client contract assignments.
 */
const ClientContract = {
  async getByClientId(clientId: string): Promise<IClientContract[]> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contracts');
    }

    try {
      const rows = await db('client_contracts as cc')
        .leftJoin('contracts as c', function joinContracts() {
          this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
        })
        .where({ 'cc.client_id': clientId, 'cc.tenant': tenant, 'cc.is_active': true })
        .orderBy('cc.start_date', 'desc')
        .select('cc.*', 'c.billing_frequency as contract_billing_frequency');

      return rows.map(normalizeClientContract);
    } catch (error) {
      console.error(`Error fetching contracts for client ${clientId}:`, error);
      throw error;
    }
  },

  async getActiveByClientIds(clientIds: string[]): Promise<IClientContract[]> {
    if (clientIds.length === 0) {
      return [];
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contracts');
    }

    try {
      const rows = await db('client_contracts as cc')
        .leftJoin('contracts as c', function joinContracts() {
          this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
        })
        .whereIn('cc.client_id', clientIds)
        .andWhere({ 'cc.tenant': tenant, 'cc.is_active': true })
        .orderBy([
          { column: 'cc.client_id', order: 'asc' },
          { column: 'cc.start_date', order: 'desc' }
        ])
        .select('cc.*', 'c.billing_frequency as contract_billing_frequency');

      return rows.map(normalizeClientContract);
    } catch (error) {
      console.error('Error fetching contracts for clients:', error);
      throw error;
    }
  },

  async getById(clientContractId: string): Promise<IClientContract | null> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contracts');
    }

    try {
      const row = await db('client_contracts as cc')
        .leftJoin('contracts as c', function joinContracts() {
          this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
        })
        .where({ 'cc.client_contract_id': clientContractId, 'cc.tenant': tenant })
        .select('cc.*', 'c.billing_frequency as contract_billing_frequency')
        .first();

      return row ? normalizeClientContract(row) : null;
    } catch (error) {
      console.error(`Error fetching client contract ${clientContractId}:`, error);
      throw error;
    }
  },

  async getDetailedClientContract(clientContractId: string): Promise<any | null> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contracts');
    }

    try {
      const clientContract = await db('client_contracts as cc')
        .join('contracts as c', function joinContracts() {
          this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
        })
        .where({ 'cc.client_contract_id': clientContractId, 'cc.tenant': tenant })
        .select(
          'cc.*',
          'c.contract_name',
          'c.contract_description',
          'c.billing_frequency as contract_billing_frequency'
        )
        .first();

      if (!clientContract) {
        return null;
      }

      const normalized = normalizeClientContract(clientContract);

      const contractLines = await db('contract_lines')
        .where({ contract_id: normalized.contract_id, tenant })
        .select('contract_line_name');

      normalized.contract_line_names = contractLines.map((line) => line.contract_line_name);
      normalized.contract_line_count = contractLines.length;

      return normalized;
    } catch (error) {
      console.error(`Error fetching detailed client contract ${clientContractId}:`, error);
      throw error;
    }
  },

  async assignContractToClient(
    clientId: string,
    contractId: string,
    startDate: string,
    endDate: string | null = null
  ): Promise<IClientContract> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for assigning contracts');
    }

    try {
      const clientExists = await db('clients')
        .where({ client_id: clientId, tenant })
        .first();

      if (!clientExists) {
        throw new Error(`Client ${clientId} not found or belongs to a different tenant`);
      }

      const contractExists = await db('contracts')
        .where({ contract_id: contractId, tenant, is_active: true })
        .first();

      if (!contractExists) {
        throw new Error(`Contract ${contractId} not found, inactive, or belongs to a different tenant`);
      }

      if (startDate) {
        const overlapping = await db('client_contracts')
          .where({ client_id: clientId, tenant, is_active: true })
          .where(function overlap() {
            this.where(function overlapsExistingEnd() {
              this.where('end_date', '>', startDate).orWhereNull('end_date');
            }).where(function overlapsExistingStart() {
              if (endDate) {
                this.where('start_date', '<', endDate);
              } else {
                this.whereRaw('1 = 1');
              }
            });
          })
          .first();

        if (overlapping) {
          throw new Error(`Client ${clientId} already has an active contract overlapping the specified range`);
        }
      }

      const timestamp = new Date().toISOString();
      const insertPayload: IClientContract = {
        client_contract_id: uuidv4(),
        client_id: clientId,
        contract_id: contractId,
        template_contract_id: null,
        start_date: startDate,
        end_date: endDate,
        is_active: true,
        tenant,
        created_at: timestamp,
        updated_at: timestamp,
      };

      const [created] = await db<IClientContract>('client_contracts').insert(insertPayload).returning('*');
      return normalizeClientContract(created);
    } catch (error) {
      console.error(`Error assigning contract ${contractId} to client ${clientId}:`, error);
      throw error;
    }
  },

  async updateClientContract(
    clientContractId: string,
    updateData: Partial<IClientContract>
  ): Promise<IClientContract> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for updating client contracts');
    }

    try {
      const existing = await ClientContract.getById(clientContractId);
      if (!existing) {
        throw new Error(`Client contract ${clientContractId} not found`);
      }

      const sanitized: Partial<IClientContract> = {
        ...updateData,
        tenant: undefined,
        client_contract_id: undefined,
        client_id: undefined,
        contract_id: undefined,
        created_at: undefined,
        updated_at: new Date().toISOString(),
      };

      if (updateData.start_date !== undefined && updateData.start_date !== existing.start_date) {
        const contract = await db('contracts')
          .where({ contract_id: existing.contract_id, tenant })
          .first();

        if (contract && contract.is_active) {
          throw new Error('Start date cannot be changed for active contracts. Set the contract to draft first.');
        }
      }

      const effectiveStart = updateData.start_date ?? existing.start_date;
      const effectiveEnd = updateData.end_date !== undefined ? updateData.end_date : existing.end_date;

      if (effectiveStart) {
        const overlapping = await db('client_contracts')
          .where({ client_id: existing.client_id, tenant, is_active: true })
          .whereNot({ client_contract_id: clientContractId })
          .where(function overlap() {
            this.where(function overlapsExistingEnd() {
              this.where('end_date', '>', effectiveStart).orWhereNull('end_date');
            }).where(function overlapsExistingStart() {
              if (effectiveEnd) {
                this.where('start_date', '<', effectiveEnd);
              } else {
                this.whereRaw('1 = 1');
              }
            });
          })
          .first();

        if (overlapping) {
          throw new Error(`Client ${existing.client_id} already has an active contract overlapping the specified range`);
        }
      }

      const [updated] = await db<IClientContract>('client_contracts')
        .where({ tenant, client_contract_id: clientContractId })
        .update(sanitized)
        .returning('*');

      if (!updated) {
        throw new Error(`Client contract ${clientContractId} not found`);
      }

      return normalizeClientContract(updated);
    } catch (error) {
      console.error(`Error updating client contract ${clientContractId}:`, error);
      throw error;
    }
  },

  async deactivateClientContract(clientContractId: string): Promise<void> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for deactivating client contracts');
    }

    try {
      await db('client_contracts')
        .where({ tenant, client_contract_id: clientContractId })
        .update({ is_active: false, updated_at: new Date().toISOString() });
    } catch (error) {
      console.error(`Error deactivating client contract ${clientContractId}:`, error);
      throw error;
    }
  },

  async getContractLines(clientContractId: string): Promise<any[]> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contract lines');
    }

    try {
      const clientContract = await db('client_contracts')
        .where({ client_contract_id: clientContractId, tenant })
        .first();

      if (!clientContract) {
        throw new Error(`Client contract ${clientContractId} not found`);
      }

      const contractLines = await db('contract_lines')
        .where({ contract_id: clientContract.contract_id, tenant })
        .select('*');

      return contractLines;
    } catch (error) {
      console.error(`Error fetching contract lines for client contract ${clientContractId}:`, error);
      throw error;
    }
  },
};

export default ClientContract;

