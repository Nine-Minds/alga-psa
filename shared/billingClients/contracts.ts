import type { Knex } from 'knex';

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
      'c.status': 'active',
    });

  query = query.andWhere((builder) => builder.whereNull('c.is_template').orWhere('c.is_template', false));

  if (excludeContractId) {
    query = query.andWhere('c.contract_id', '!=', excludeContractId);
  }

  const result = (await query.count('cc.client_contract_id as count').first()) as { count?: string };
  return Number(result?.count ?? 0) > 0;
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

