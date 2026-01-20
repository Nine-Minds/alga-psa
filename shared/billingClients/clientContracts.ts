import type { Knex } from 'knex';
import type { IClientContract } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import type { ClientContractAssignmentCreateInput } from './types';

const normalizeClientContract = (row: any): IClientContract => {
  if (!row) return row;
  if (row.contract_billing_frequency !== undefined && row.billing_frequency === undefined) {
    row.billing_frequency = row.contract_billing_frequency;
  }
  return row as IClientContract;
};

export async function getClientContracts(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<IClientContract[]> {
  const rows = await knexOrTrx('client_contracts as cc')
    .leftJoin('contracts as c', function joinContracts() {
      this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
    })
    .where({ 'cc.client_id': clientId, 'cc.tenant': tenant, 'cc.is_active': true })
    .orderBy('cc.start_date', 'desc')
    .select('cc.*', 'c.billing_frequency as contract_billing_frequency');

  return rows.map(normalizeClientContract);
}

export async function getActiveClientContractsByClientIds(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientIds: string[]
): Promise<IClientContract[]> {
  if (clientIds.length === 0) return [];

  const rows = await knexOrTrx('client_contracts as cc')
    .leftJoin('contracts as c', function joinContracts() {
      this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
    })
    .whereIn('cc.client_id', clientIds)
    .andWhere({ 'cc.tenant': tenant, 'cc.is_active': true })
    .orderBy([
      { column: 'cc.client_id', order: 'asc' },
      { column: 'cc.start_date', order: 'desc' },
    ])
    .select('cc.*', 'c.billing_frequency as contract_billing_frequency');

  return rows.map(normalizeClientContract);
}

export async function getClientContractById(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientContractId: string
): Promise<IClientContract | null> {
  const row = await knexOrTrx('client_contracts as cc')
    .leftJoin('contracts as c', function joinContracts() {
      this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
    })
    .where({ 'cc.client_contract_id': clientContractId, 'cc.tenant': tenant })
    .select('cc.*', 'c.billing_frequency as contract_billing_frequency')
    .first();

  return row ? normalizeClientContract(row) : null;
}

export async function getDetailedClientContract(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientContractId: string
): Promise<any | null> {
  const clientContract = await knexOrTrx('client_contracts as cc')
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

  if (!clientContract) return null;

  const normalized = normalizeClientContract(clientContract);

  const contractLines = await knexOrTrx('contract_lines')
    .where({ contract_id: (normalized as any).contract_id, tenant })
    .select('contract_line_name');

  return {
    ...normalized,
    contract_line_names: contractLines.map((line) => line.contract_line_name),
    contract_line_count: contractLines.length,
  };
}

export async function createClientContractAssignment(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  input: ClientContractAssignmentCreateInput
): Promise<IClientContract> {
  const clientExists = await knexOrTrx('clients').where({ client_id: input.client_id, tenant }).first();
  if (!clientExists) {
    throw new Error(`Client ${input.client_id} not found or belongs to a different tenant`);
  }

  const contractExists = await knexOrTrx('contracts')
    .where({ contract_id: input.contract_id, tenant, is_active: true })
    .first();
  if (!contractExists) {
    throw new Error(`Contract ${input.contract_id} not found, inactive, or belongs to a different tenant`);
  }

  if (input.is_active) {
    const overlapping = await knexOrTrx('client_contracts')
      .where({ client_id: input.client_id, tenant, is_active: true })
      .where(function overlap() {
        this.where(function overlapsExistingEnd() {
          this.where('end_date', '>', input.start_date).orWhereNull('end_date');
        }).where(function overlapsExistingStart() {
          if (input.end_date) {
            this.where('start_date', '<', input.end_date);
          } else {
            this.whereRaw('1 = 1');
          }
        });
      })
      .first();

    if (overlapping) {
      throw new Error(`Client ${input.client_id} already has an active contract overlapping the specified range`);
    }
  }

  const timestamp = new Date().toISOString();
  const insertPayload: Record<string, unknown> = {
    client_contract_id: uuidv4(),
    client_id: input.client_id,
    contract_id: input.contract_id,
    template_contract_id: null,
    start_date: input.start_date,
    end_date: input.end_date,
    is_active: input.is_active,
    tenant,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const hasPoRequired = await (knexOrTrx as any).schema?.hasColumn?.('client_contracts', 'po_required');
  const hasPoNumber = await (knexOrTrx as any).schema?.hasColumn?.('client_contracts', 'po_number');
  const hasPoAmount = await (knexOrTrx as any).schema?.hasColumn?.('client_contracts', 'po_amount');

  if (hasPoRequired) insertPayload.po_required = Boolean(input.po_required);
  if (hasPoNumber) insertPayload.po_number = input.po_number ?? null;
  if (hasPoAmount) insertPayload.po_amount = input.po_amount ?? null;

  const [created] = await knexOrTrx<IClientContract>('client_contracts').insert(insertPayload).returning('*');
  return normalizeClientContract(created);
}

export async function updateClientContractAssignment(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientContractId: string,
  updateData: Partial<IClientContract>
): Promise<IClientContract> {
  const existing = await getClientContractById(knexOrTrx, tenant, clientContractId);
  if (!existing) {
    throw new Error(`Client contract ${clientContractId} not found`);
  }

  const sanitized: Partial<IClientContract> = {
    ...updateData,
    tenant: undefined as any,
    client_contract_id: undefined as any,
    client_id: undefined as any,
    contract_id: undefined as any,
    created_at: undefined as any,
    updated_at: new Date().toISOString() as any,
  };

  if (updateData.start_date !== undefined && updateData.start_date !== existing.start_date) {
    const contract = await knexOrTrx('contracts')
      .where({ contract_id: existing.contract_id, tenant })
      .first();

    if (contract && contract.is_active) {
      throw new Error('Start date cannot be changed for active contracts. Set the contract to draft first.');
    }
  }

  const effectiveStart = updateData.start_date ?? existing.start_date;
  const effectiveEnd = updateData.end_date !== undefined ? updateData.end_date : existing.end_date;

  if (effectiveStart) {
    const overlapping = await knexOrTrx('client_contracts')
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

  const [updated] = await knexOrTrx<IClientContract>('client_contracts')
    .where({ tenant, client_contract_id: clientContractId })
    .update(sanitized as any)
    .returning('*');

  if (!updated) {
    throw new Error(`Client contract ${clientContractId} not found`);
  }

  return normalizeClientContract(updated);
}
