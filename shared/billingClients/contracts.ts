import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export async function checkAndReactivateExpiredContract(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  contractId: string
): Promise<void> {
  const db = tenantDb(knexOrTrx, tenant);
  const contract = await db.table('contracts').where({ contract_id: contractId }).first();
  if (!contract) return;
  if (contract.is_template === true) return;
  if (contract.status !== 'expired') return;

  const assignments = await db.table('client_contracts')
    .where({ contract_id: contractId })
    .select('end_date', 'client_id');

  if (assignments.length === 0) return;

  const now = new Date();
  const hasOngoingOrFutureAssignment = assignments.some((a) => {
    if (!a.end_date) return true;
    return new Date(a.end_date) > now;
  });

  if (!hasOngoingOrFutureAssignment) return;

  await db.table('contracts')
    .where({ contract_id: contractId })
    .update({ status: 'active', updated_at: new Date().toISOString() });
}
