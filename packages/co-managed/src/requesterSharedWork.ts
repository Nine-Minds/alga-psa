import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * The ONE answer to "is this task shared work a requester may hold a thread on?". Both the server
 * (`withRequesterTaskAccess`) and the portal data path (`getRequesterSharedTaskIdsAction`) use it, so the
 * button, the deep link and the actions can never disagree.
 *
 * A task is shared work when its project lives in
 *   1. a co_managed customer workspace (every task there is the sponsor's shared work), or
 *   2. a workspace whose live relationship has an ACTIVE `co_managed_project_task_references` row for the
 *      task (the sponsor's recorded participation; the row lives in the sponsor's tenant).
 * A sponsor's own native, non-shared project is neither, so it is refused like any unauthorized target.
 * The caller has already proved the tasks belong to the project in `tenant` and holds the transaction.
 */
export async function requesterSharedTaskIds(trx: Knex.Transaction, tenant: string, productCode: string, taskIds: readonly string[]): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();
  if (productCode === 'co_managed') return new Set(taskIds);
  const relationship = await tenantDb(trx, tenant).table('co_management_relationships')
    .where({ state: 'active' }).whereNull('ended_at').forShare().first('relationship_id', 'sponsor_tenant');
  if (!relationship) return new Set();
  const rows = await tenantDb(trx, relationship.sponsor_tenant).table('co_managed_project_task_references')
    .where({ customer_tenant: tenant, relationship_id: relationship.relationship_id, active: true })
    .whereIn('task_id', taskIds as string[]).forShare().select('task_id') as Array<{ task_id: string }>;
  return new Set(rows.map(row => row.task_id));
}

export async function isRequesterTaskSharedWork(trx: Knex.Transaction, tenant: string, productCode: string, taskId: string): Promise<boolean> {
  return (await requesterSharedTaskIds(trx, tenant, productCode, [taskId])).has(taskId);
}
