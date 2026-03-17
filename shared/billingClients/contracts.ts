import type { Knex } from 'knex';
import { deriveClientContractStatus } from './clientContractStatus';

export async function hasActiveContractForClient(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  excludeContractId?: string
): Promise<boolean> {
  let query = knexOrTrx('client_contracts as cc')
    .join('contracts as c', function joinContracts() {
      this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
    })
    .where({
      'cc.client_id': clientId,
      'cc.tenant': tenant,
      'cc.is_active': true,
    });

  query = query.andWhere((builder) => builder.whereNull('c.is_template').orWhere('c.is_template', false));

  if (excludeContractId) {
    query = query.andWhere('c.contract_id', '!=', excludeContractId);
  }

  const rows = await query.select('cc.start_date', 'cc.end_date');
  return rows.some((row: { start_date: string; end_date: string | null }) =>
    deriveClientContractStatus({
      isActive: true,
      startDate: row.start_date,
      endDate: row.end_date,
    }) === 'active'
  );
}

export async function getClientIdsWithActiveContracts(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  excludeContractId?: string
): Promise<string[]> {
  let query = knexOrTrx('client_contracts as cc')
    .join('contracts as c', function joinContracts() {
      this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
    })
    .where({
      'cc.tenant': tenant,
      'cc.is_active': true,
    })
    .andWhere((builder) => builder.whereNull('c.is_template').orWhere('c.is_template', false));

  if (excludeContractId) {
    query = query.andWhere('c.contract_id', '!=', excludeContractId);
  }

  const rows = await query.select('cc.client_id', 'cc.start_date', 'cc.end_date');
  return Array.from(
    new Set(
      rows
        .filter((row: { start_date: string; end_date: string | null }) =>
          deriveClientContractStatus({
            isActive: true,
            startDate: row.start_date,
            endDate: row.end_date,
          }) === 'active'
        )
        .map((row: { client_id: string }) => row.client_id)
    )
  );
}

export async function checkAndReactivateExpiredContract(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  contractId: string
): Promise<void> {
  const contract = await knexOrTrx('contracts').where({ contract_id: contractId, tenant }).first();
  if (!contract) return;
  if (contract.is_template === true) return;
  if (contract.status !== 'expired') return;

  const assignments = await knexOrTrx('client_contracts')
    .where({ contract_id: contractId, tenant })
    .select('end_date', 'client_id');

  if (assignments.length === 0) return;

  const now = new Date();
  const hasOngoingOrFutureAssignment = assignments.some((a) => {
    if (!a.end_date) return true;
    return new Date(a.end_date) > now;
  });

  if (!hasOngoingOrFutureAssignment) return;

  const clientIds = assignments.map((a) => a.client_id);
  for (const clientId of clientIds) {
    const hasActive = await hasActiveContractForClient(knexOrTrx, tenant, clientId, contractId);
    if (hasActive) {
      throw new Error(
        'Cannot extend contract end date because the client already has an active contract. To reactivate this contract, terminate their current active contract first.'
      );
    }
  }

  await knexOrTrx('contracts')
    .where({ contract_id: contractId, tenant })
    .update({ status: 'active', updated_at: new Date().toISOString() });
}
