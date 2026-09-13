import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { retainCoManagedSharedConversationBeforeReduction } from './conversationParticipationEvidence';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

/** Native writers call this after their lifecycle/resource admission, before
 * moving a ticket, task or phase out of its current sharing scope. Retain the
 * source transaction: the move and historical capture must commit together.
 * This is retention of company evidence, not authority to act as an MSP user. */
export async function retainCoManagedConversationBeforeSourceChange(trx: Knex.Transaction, tenant: string,
  kind: 'ticket' | 'project_task' | 'project_phase', id: string): Promise<void> {
  if (!trx.isTransaction || ![tenant, id].every(isCoManagedUuid) || !['ticket', 'project_task', 'project_phase'].includes(kind)) throw new CoManagedSharedWorkError();
  const owner = tenantDb(trx, tenant);
  const relationship = await owner.table('co_management_relationships').where('state', 'active').whereNull('ended_at').forShare().first('relationship_id');
  if (!relationship) return;
  const operationId = randomUUID();
  const tasks = kind === 'project_phase' ? await owner.table('project_tasks').where('phase_id', id).orderBy('task_id').select('task_id') : [{ task_id: id }];
  for (const task of tasks) await retainCoManagedSharedConversationBeforeReduction(trx,
    { tenant, relationshipId: relationship.relationship_id, kind: kind === 'ticket' ? 'ticket' : 'project_task', id: task.task_id }, operationId);
}
