import type { Knex } from 'knex';

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

  await knexOrTrx('contracts')
    .where({ contract_id: contractId, tenant })
    .update({ status: 'active', updated_at: new Date().toISOString() });
}
