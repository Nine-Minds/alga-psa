import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { projectTaskAudienceSql } from './projectTaskAudience';
import { isCoManagedUuid, CoManagedSharedWorkError } from './sharedWorkIdentity';
import { enqueueCoManagedConversationEvent } from './conversationEventOutbox';
import { coManagedTaskCommentEventTypes } from './projectTaskEventSource';

/** Called only inside the admitted canonical mutation. This records source
 * ownership, never a new authorization or a foreign organization-private event. */
export async function retainCoManagedTaskCommentEvent(trx: Knex.Transaction,
  input: { tenant: string; eventId: string; taskId: string; commentId: string; kind: 'create' | 'edit' | 'delete' }) {
  input = { ...input };
  if (!trx.isTransaction || ![input.tenant, input.eventId, input.taskId, input.commentId].every(isCoManagedUuid) || !['create', 'edit', 'delete'].includes(input.kind)) throw new CoManagedSharedWorkError();
  const owner = tenantDb(trx, input.tenant), query = owner.table('project_task_comments as c').where({ 'c.task_id': input.taskId, 'c.task_comment_id': input.commentId });
  owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.project_task_id', '=', 'c.task_id').andOnNull('t.ticket_id') });
  owner.tenantJoin(query, 'project_task_comments as root', 't.root_comment_id', 'root.task_comment_id', { on: join => join.andOn('root.task_id', '=', 'c.task_id').andOn('root.thread_id', '=', 'c.thread_id') });
  const source = await query.forShare('c', 't', 'root').select('c.thread_id', 'c.deleted_at', 'c.collaboration_revision', { audience: projectTaskAudienceSql(trx, 't') }).first();
  if (!source || Boolean(source.deleted_at) !== (input.kind === 'delete')) throw new CoManagedSharedWorkError();
  const eventType = coManagedTaskCommentEventTypes[input.kind === 'create' ? 0 : input.kind === 'edit' ? 1 : 2];
  await enqueueCoManagedConversationEvent(trx, { tenant: input.tenant, eventId: input.eventId, resource: { kind: 'project_task', id: input.taskId }, commentId: input.commentId,
    threadId: source.thread_id, audience: source.audience, publication: { kind: 'event', eventType, payload: { tenantId: input.tenant, taskId: input.taskId, taskCommentId: input.commentId,
      collaboration: { kind: 'project_task_comment', threadId: source.thread_id, audience: source.audience, revision: source.collaboration_revision } } } });
}
