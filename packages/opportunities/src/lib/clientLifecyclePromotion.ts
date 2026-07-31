import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { publishOpportunityEventAfterCommit } from './opportunityEvents';

export async function promoteProspectClientAfterWin(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  changedAt: string,
): Promise<boolean> {
  const db = tenantDb(trx, tenant);
  const client = await db.table('clients')
    .where({ client_id: clientId })
    .forUpdate()
    .select('lifecycle_status')
    .first<{ lifecycle_status?: string | null }>();

  if (!client) throw new Error('Client not found');
  if (client.lifecycle_status !== 'prospect') return false;

  await db.table('clients')
    .where({ client_id: clientId })
    .update({ lifecycle_status: 'active', updated_at: changedAt });
  publishOpportunityEventAfterCommit(trx, tenant, 'CLIENT_STATUS_CHANGED', {
    clientId,
    previousStatus: 'prospect',
    newStatus: 'active',
    changedAt,
  }, `client_status_changed:${clientId}:${changedAt}`);
  return true;
}
