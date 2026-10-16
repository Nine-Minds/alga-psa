import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** Internal routing after source admission. Every key belongs to the time owner,
 * including the local reference used for customer-owned shared work. */
export async function getTimeEntryWorkBillingContext(trx: Knex.Transaction, tenant: string, workItemId: string, workItemType: string) {
  if (!trx.isTransaction) throw new Error('Time work billing requires its owning transaction');
  const owner = tenantDb(trx, tenant);
  let row: { client_id: string | null; billing_profile_id?: string | null } | undefined;
  if (workItemType === 'co_managed') {
    row = await owner.table('co_managed_time_work_references').where('reference_id', workItemId).forShare().first('client_id', 'billing_profile_id');
  } else if (workItemType === 'ticket') {
    row = await owner.table('tickets').where('ticket_id', workItemId).forShare().first('client_id', 'billing_profile_id');
  } else if (workItemType === 'project_task') {
    const query = owner.table('project_tasks');
    owner.tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
    owner.tenantJoin(query, 'projects', 'project_phases.project_id', 'projects.project_id');
    row = await query.where('project_tasks.task_id', workItemId).forShare().first('projects.client_id', 'projects.billing_profile_id');
  } else if (workItemType === 'interaction') {
    row = await owner.table('interactions').where('interaction_id', workItemId).forShare().first('client_id');
  }
  return row?.client_id ? { clientId: row.client_id, billingProfileId: row.billing_profile_id ?? null } : null;
}
