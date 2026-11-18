import type { IClientContract } from '@alga-psa/types';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import {
  createClientContractAssignment,
  deriveClientContractStatus,
  getTenantLocalToday,
  updateClientContractAssignment,
} from '@alga-psa/shared/billingClients';
import { normalizeClientContract } from '@alga-psa/shared/billingClients/clientContracts';
import { normalizeLiveRecurringStorage } from '@alga-psa/shared/billingClients/recurrenceStorageModel';

export { normalizeClientContract };

const RENEWAL_DEFAULT_SELECTIONS = [
  'dbs.default_renewal_mode as tenant_default_renewal_mode',
  'dbs.default_notice_period_days as tenant_default_notice_period_days',
];

const validateContractOwnershipForClient = (params: {
  contract: {
    contract_id?: string;
    is_template?: boolean | null;
    owner_client_id?: string | null;
  } | undefined;
  contractId: string;
  clientId: string;
}): void => {
  const contract = params.contract;
  if (!contract) {
    throw new Error(`Contract ${params.contractId} not found or inactive`);
  }

  if (contract.is_template === true) {
    return;
  }

  const ownerClientId =
    typeof contract.owner_client_id === 'string' && contract.owner_client_id.trim().length > 0
      ? contract.owner_client_id.trim()
      : null;

  if (!ownerClientId) {
    throw new Error(`Contract ${params.contractId} must have an owning client before it can be assigned`);
  }

  if (ownerClientId !== params.clientId) {
    throw new Error(
      `Contract ${params.contractId} belongs to a different client and cannot be assigned to client ${params.clientId}`
    );
  }
};

const withRenewalDefaultsJoin = (
  query: Knex.QueryBuilder,
  facade: ReturnType<typeof tenantDb>
): Knex.QueryBuilder => {
  return facade.tenantJoin(query, 'default_billing_settings as dbs', 'cc.tenant', 'dbs.tenant', { type: 'left' });
};

const dedupeClientContractsByRenewalCycle = (rows: IClientContract[]): IClientContract[] => {
  const deduped = new Map<string, IClientContract>();

  for (const row of rows) {
    const cycleKey = row.renewal_cycle_key;
    if (!cycleKey) {
      deduped.set(`${row.tenant}:${row.client_contract_id}`, row);
      continue;
    }

    const dedupeKey = `${row.tenant}:${row.client_contract_id}:${cycleKey}`;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, row);
    }
  }

  return [...deduped.values()];
};

/**
 * Data access helpers for client contract assignments.
 */
const ClientContract = {
  async getByClientId(clientId: string, tenantId: string): Promise<IClientContract[]> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contracts');
    }

    try {
      const facade = tenantDb(db, tenant);
      const baseQuery = facade.table('client_contracts as cc')
        .where({ 'cc.client_id': clientId })
        .orderBy('cc.start_date', 'desc');
      facade.tenantJoin(baseQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id', { type: 'left' });

      const rows = await withRenewalDefaultsJoin(baseQuery, facade).select([
        'cc.*',
        'c.billing_frequency as contract_billing_frequency',
        'c.status as contract_status',
        ...RENEWAL_DEFAULT_SELECTIONS,
      ]);

      const today = await getTenantLocalToday(db, tenant);
      return dedupeClientContractsByRenewalCycle(rows.map((row: any) => normalizeClientContract(row, { today })));
    } catch (error) {
      console.error(`Error fetching contracts for client ${clientId}:`, error);
      throw error;
    }
  },

  async getActiveByClientIds(clientIds: string[], tenantId: string): Promise<IClientContract[]> {
    if (clientIds.length === 0) {
      return [];
    }

    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contracts');
    }

    try {
      const facade = tenantDb(db, tenant);
      const baseQuery = facade.table('client_contracts as cc')
        .whereIn('cc.client_id', clientIds)
        .andWhere({ 'cc.is_active': true })
        .orderBy([
          { column: 'cc.client_id', order: 'asc' },
          { column: 'cc.start_date', order: 'desc' }
        ]);
      facade.tenantJoin(baseQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id', { type: 'left' });

      const rows = await withRenewalDefaultsJoin(baseQuery, facade).select([
        'cc.*',
        'c.billing_frequency as contract_billing_frequency',
        'c.status as contract_status',
        ...RENEWAL_DEFAULT_SELECTIONS,
      ]);

      const today = await getTenantLocalToday(db, tenant);
      return dedupeClientContractsByRenewalCycle(rows.map((row: any) => normalizeClientContract(row, { today })));
    } catch (error) {
      console.error('Error fetching contracts for clients:', error);
      throw error;
    }
  },

  async getById(clientContractId: string, tenantId: string): Promise<IClientContract | null> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contracts');
    }

    try {
      const facade = tenantDb(db, tenant);
      const baseQuery = facade.table('client_contracts as cc')
        .where({ 'cc.client_contract_id': clientContractId });
      facade.tenantJoin(baseQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id', { type: 'left' });

      const row = await withRenewalDefaultsJoin(baseQuery, facade)
        .select([
          'cc.*',
          'c.billing_frequency as contract_billing_frequency',
          'c.status as contract_status',
          ...RENEWAL_DEFAULT_SELECTIONS,
        ])
        .first();

      return row ? normalizeClientContract(row, { today: await getTenantLocalToday(db, tenant) }) : null;
    } catch (error) {
      console.error(`Error fetching client contract ${clientContractId}:`, error);
      throw error;
    }
  },

  async getDetailedClientContract(clientContractId: string, tenantId: string): Promise<any | null> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contracts');
    }

    try {
      const facade = tenantDb(db, tenant);
      const baseQuery = facade.table('client_contracts as cc')
        .where({ 'cc.client_contract_id': clientContractId });
      facade.tenantJoin(baseQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id');

      const clientContract = await withRenewalDefaultsJoin(baseQuery, facade).select(
        [
          'cc.*',
          'c.contract_name',
          'c.contract_description',
          'c.billing_frequency as contract_billing_frequency',
          'c.status as contract_status',
          ...RENEWAL_DEFAULT_SELECTIONS,
        ]
      )
        .first();

      if (!clientContract) {
        return null;
      }

      const normalized = normalizeClientContract(clientContract, {
        today: await getTenantLocalToday(db, tenant),
      }) as any;

      const assignmentContractLinesQuery = facade.table('client_contracts as cc')
        .where({
          'cc.client_contract_id': clientContractId,
          'cl.is_active': true,
        })
        .distinct('cl.contract_line_id', 'cl.contract_line_name')
        .select('cl.contract_line_name');
      facade.tenantJoin(assignmentContractLinesQuery, 'contract_lines as cl', 'cc.contract_id', 'cl.contract_id');
      const assignmentContractLines = (await assignmentContractLinesQuery) as unknown as Array<{ contract_line_name: string }>;

      normalized.contract_line_names = assignmentContractLines.map((line) => line.contract_line_name);
      normalized.contract_line_count = assignmentContractLines.length;

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
    endDate: string | null = null,
    renewalSettings: Pick<
      IClientContract,
      'renewal_mode' | 'notice_period_days' | 'renewal_term_months' | 'use_tenant_renewal_defaults'
    > | undefined,
    tenantId: string
  ): Promise<IClientContract> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for assigning contracts');
    }

    try {
      const facade = tenantDb(db, tenant);
      const clientExists = await facade.table('clients')
        .where({ client_id: clientId })
        .first();

      if (!clientExists) {
        throw new Error(`Client ${clientId} not found`);
      }

      const contractExists = await facade.table('contracts')
        .where({ contract_id: contractId, is_active: true })
        .first();

      validateContractOwnershipForClient({
        contract: contractExists,
        contractId,
        clientId,
      });

      return await createClientContractAssignment(db, tenant, {
        client_id: clientId,
        contract_id: contractId,
        template_contract_id: null,
        start_date: startDate,
        end_date: endDate,
        is_active: true,
        use_tenant_renewal_defaults: renewalSettings?.use_tenant_renewal_defaults,
        renewal_mode:
          renewalSettings?.renewal_mode === 'none' ||
          renewalSettings?.renewal_mode === 'manual' ||
          renewalSettings?.renewal_mode === 'auto'
            ? renewalSettings.renewal_mode
            : undefined,
        notice_period_days:
          typeof renewalSettings?.notice_period_days === 'number' &&
          Number.isFinite(renewalSettings.notice_period_days) &&
          renewalSettings.notice_period_days >= 0
            ? Math.floor(renewalSettings.notice_period_days)
            : undefined,
        renewal_term_months:
          typeof renewalSettings?.renewal_term_months === 'number' &&
          Number.isFinite(renewalSettings.renewal_term_months) &&
          renewalSettings.renewal_term_months > 0
            ? Math.floor(renewalSettings.renewal_term_months)
            : undefined,
      });
    } catch (error) {
      console.error(`Error assigning contract ${contractId} to client ${clientId}:`, error);
      throw error;
    }
  },

  async updateClientContract(
    clientContractId: string,
    updateData: Partial<IClientContract>,
    tenantId: string
  ): Promise<IClientContract> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for updating client contracts');
    }

    try {
      const existing = await ClientContract.getById(clientContractId, tenantId);
      if (!existing) {
        throw new Error(`Client contract ${clientContractId} not found`);
      }

      const sanitized: Partial<IClientContract> = {
        ...updateData,
        tenant: undefined,
        client_contract_id: undefined,
        client_id: undefined,
        created_at: undefined,
        updated_at: new Date().toISOString(),
      };

      if (updateData.contract_id && updateData.contract_id !== existing.contract_id) {
        const nextContract = await tenantDb(db, tenant).table('contracts')
          .where({ contract_id: updateData.contract_id })
          .first();

        validateContractOwnershipForClient({
          contract: nextContract,
          contractId: updateData.contract_id,
          clientId: existing.client_id,
        });

        throw new Error('Changing the contract header for an existing assignment is not supported');
      }

      sanitized.contract_id = undefined;

      if (updateData.start_date !== undefined && updateData.start_date !== existing.start_date) {
        const contract = await tenantDb(db, tenant).table('contracts')
          .where({ contract_id: existing.contract_id })
          .first();

        if (contract && contract.is_active) {
          throw new Error('Start date cannot be changed for active contracts. Set the contract to draft first.');
        }
      }

      return await updateClientContractAssignment(db, tenant, clientContractId, sanitized);
    } catch (error) {
      console.error(`Error updating client contract ${clientContractId}:`, error);
      throw error;
    }
  },

  async deactivateClientContract(clientContractId: string, tenantId: string): Promise<void> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for deactivating client contracts');
    }

    try {
      await tenantDb(db, tenant).table('client_contracts')
        .where({ client_contract_id: clientContractId })
        .update({ is_active: false, updated_at: new Date().toISOString() });
    } catch (error) {
      console.error(`Error deactivating client contract ${clientContractId}:`, error);
      throw error;
    }
  },

  async getContractLines(clientContractId: string, tenantId: string): Promise<any[]> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contract lines');
    }

    try {
      const clientContract = await tenantDb(db, tenant).table('client_contracts')
        .where({ client_contract_id: clientContractId })
        .first();

      if (!clientContract) {
        throw new Error(`Client contract ${clientContractId} not found`);
      }

      const contractLines = await tenantDb(db, tenant).table('contract_lines')
        .where({ contract_id: clientContract.contract_id })
        .select('*');

      return contractLines.map((line) => normalizeLiveRecurringStorage(line));
    } catch (error) {
      console.error(`Error fetching contract lines for client contract ${clientContractId}:`, error);
      throw error;
    }
  },
};

export default ClientContract;
