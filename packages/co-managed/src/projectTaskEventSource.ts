import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { projectTaskAudienceSql } from './projectTaskAudience';
import type { CoManagedEventPublication } from './conversationEventOutbox';

export const coManagedTaskCommentEventTypes = ['PROJECT_TASK_COMMENT_CREATED', 'PROJECT_TASK_COMMENT_UPDATED', 'PROJECT_TASK_COMMENT_DELETED'] as const;
/** Task transport carries only source identity and audience/revision metadata.
 * Consumers must resolve current content through their own authority boundary. */
export function validCoManagedTaskPublication(publication: CoManagedEventPublication, input: { tenant: string; taskId: string; commentId: string; threadId: string; audience: string }): boolean {
  if (publication?.kind !== 'event' || !coManagedTaskCommentEventTypes.includes(publication.eventType as any) ||
    Object.keys(publication).some(key => !['kind', 'eventType', 'payload'].includes(key))) return false;
  const payload = publication.payload, detail = payload?.collaboration;
  return Boolean(payload && detail && Object.keys(payload).every(key => ['tenantId', 'taskId', 'taskCommentId', 'collaboration'].includes(key)) &&
    Object.keys(detail).every(key => ['kind', 'threadId', 'audience', 'revision'].includes(key)) && detail.kind === 'project_task_comment' &&
    payload.tenantId === input.tenant && payload.taskId === input.taskId && payload.taskCommentId === input.commentId &&
    detail.threadId === input.threadId && detail.audience === input.audience && Number.isInteger(detail.revision) && detail.revision > 0 && detail.revision <= 2147483647);
}
export async function prepareCoManagedTaskCommentEvent(trx: Knex.Transaction, tenant: string, row: any, publication: CoManagedEventPublication) {
  if (!validCoManagedTaskPublication(publication, { tenant, taskId: row.resource_id, commentId: row.comment_id, threadId: row.thread_id, audience: row.audience })) throw new Error('Invalid task conversation publication');
  // Metadata-only invalidations must clear old indexes even after removal.
  if (row.event_type !== 'PROJECT_TASK_COMMENT_CREATED') return publication;
  const owner = tenantDb(trx, tenant), query = owner.table('project_task_comments as c')
    .where({ 'c.task_id': row.resource_id, 'c.task_comment_id': row.comment_id, 'c.thread_id': row.thread_id }).whereNull('c.deleted_at');
  owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.project_task_id', '=', 'c.task_id').andOnNull('t.ticket_id') });
  owner.tenantJoin(query, 'project_task_comments as root', 't.root_comment_id', 'root.task_comment_id', { on: join => join.andOn('root.task_id', '=', 'c.task_id').andOn('root.thread_id', '=', 'c.thread_id') });
  const source = await query.whereNull('root.deleted_at').forShare('c', 't', 'root').select({ audience: projectTaskAudienceSql(trx, 't') }).first();
  return source?.audience === row.audience ? publication : null;
}
