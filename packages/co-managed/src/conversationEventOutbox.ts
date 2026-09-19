import { retainCoManagedConversationParticipation } from './conversationParticipationEvidence';
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { commentAudienceSql, type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import { isCoManagedUuid, CoManagedSharedWorkError } from './sharedWorkIdentity';
import { coManagedTaskCommentEventTypes, validCoManagedTaskPublication, prepareCoManagedTaskCommentEvent } from './projectTaskEventSource';
import { enqueueCoManagedEventConsumers } from './conversationEventConsumerCatalog';

const TABLE = 'co_management_event_outbox';
const TYPES = ['TICKET_COMMENT_ADDED', 'TICKET_COMMENT_UPDATED', 'TICKET_COMMENT_DELETED', 'TICKET_RESPONSE_STATE_CHANGED', 'TICKET_MESSAGE_ADDED', 'TICKET_INTERNAL_NOTE_ADDED', 'TICKET_CUSTOMER_REPLIED', ...coManagedTaskCommentEventTypes] as const;
export type CoManagedConversationEventType = typeof TYPES[number];
export interface CoManagedEventPublication {
  kind: 'event' | 'workflow'; eventType: CoManagedConversationEventType; payload: Record<string, any>;
  workflowContext?: Record<string, any>; idempotencyKey?: string; channel?: 'internal-notifications';
}
export interface CoManagedEventIntent {
  tenant: string; eventId: string; ticketId: string; commentId: string; threadId: string; audience: CommentAudience; publication: CoManagedEventPublication;
}
export interface CoManagedTaskEventIntent extends Omit<CoManagedEventIntent, 'ticketId'> { resource: { kind: 'project_task'; id: string } }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
/** Admission is supplied by the mutation's retained transaction. Publication
 * records carry metadata only; ticket creation bodies load at dispatch, while
 * task changes remain metadata-only. */
export async function enqueueCoManagedConversationEvent(trx: Knex.Transaction, input: CoManagedEventIntent | CoManagedTaskEventIntent): Promise<void> {
  if (!input || typeof input !== 'object') throw new CoManagedSharedWorkError();
  const task = 'resource' in input, resourceId = task ? input.resource?.id : input.ticketId;
  if (!trx.isTransaction || ![input.tenant, input.eventId, resourceId, input.commentId, input.threadId].every(isCoManagedUuid) ||
    (task && (input.resource?.kind !== 'project_task' || 'ticketId' in input)) || task !== coManagedTaskCommentEventTypes.includes(input.publication?.eventType as any) ||
    !['requester', 'shared_it', 'organization_private'].includes(input.audience) || !TYPES.includes(input.publication?.eventType) ||
    !['event', 'workflow'].includes(input.publication.kind) ||
    (input.publication.channel !== undefined && (input.publication.kind !== 'event' || input.publication.channel !== 'internal-notifications'))) throw new CoManagedSharedWorkError();
  const publication = JSON.parse(JSON.stringify(input.publication)) as CoManagedEventPublication;
  if (publication.eventType === 'TICKET_COMMENT_ADDED') {
    if (!publication.payload.comment || publication.payload.comment.id !== input.commentId || publication.payload.commentId !== input.commentId) throw new CoManagedSharedWorkError();
    publication.payload.comment.content = '';
  }
  if (task && !validCoManagedTaskPublication(publication, { tenant: input.tenant, taskId: resourceId, commentId: input.commentId, threadId: input.threadId, audience: input.audience })) throw new CoManagedSharedWorkError();
  if (!task && (publication.payload.ticketId !== resourceId || (publication.kind === 'event' ? publication.payload.tenantId !== input.tenant : publication.workflowContext?.tenantId !== input.tenant))) throw new CoManagedSharedWorkError();
  const { tenant, eventId, commentId, threadId, audience } = input;
  // LEVERAGE: pattern transactional-event-intent — inbound email has the same durable publication state beneath its inbox-specific contract.
  const requestHash = digest({ ...(task ? { resource: { kind: 'project_task', id: resourceId } } : { ticketId: resourceId }), commentId, threadId, audience, publication });
  const owner = tenantDb(trx, tenant);
  const inserted = await owner.table(TABLE).insert({ tenant, event_id: eventId, ticket_id: task ? null : resourceId, resource_type: task ? 'project_task' : 'ticket', resource_id: resourceId, comment_id: commentId, thread_id: threadId,
    event_type: publication.eventType, audience, publication: JSON.stringify(publication), request_hash: requestHash }).onConflict(['tenant', 'event_id']).ignore().returning('event_id');
  const row = await owner.table(TABLE).where('event_id', eventId).forShare().first('request_hash');
  if (row?.request_hash !== requestHash) throw new Error('Co-managed event identity was reused with different intent');
  if (inserted.length) await retainCoManagedConversationParticipation(trx, tenant, eventId);
  await enqueueCoManagedEventConsumers(trx, tenant, eventId, publication.eventType, { channel: publication.channel });
}
/** Current audience and publication checks apply to newly-created-message
 * delivery. Metadata-only invalidations still run after removal or restriction. */
export async function prepareCoManagedConversationEvent(context: { trx: Knex.Transaction; tenant: string }, row: any): Promise<CoManagedEventPublication | null> {
  const publication = JSON.parse(JSON.stringify(row.publication)) as CoManagedEventPublication;
  const task = row.resource_type === 'project_task';
  if (row.tenant !== context.tenant || !['ticket', 'project_task'].includes(row.resource_type) || (task ? row.ticket_id !== null : row.ticket_id !== row.resource_id) || task !== coManagedTaskCommentEventTypes.includes(row.event_type) || !TYPES.includes(row.event_type) || publication.eventType !== row.event_type ||
    digest({ ...(task ? { resource: { kind: 'project_task', id: row.resource_id } } : { ticketId: row.ticket_id }), commentId: row.comment_id, threadId: row.thread_id, audience: row.audience, publication }) !== row.request_hash) throw new Error('Invalid co-managed event intent');
  if (task) return prepareCoManagedTaskCommentEvent(context.trx, context.tenant, row, publication);
  if (['TICKET_COMMENT_ADDED', 'TICKET_MESSAGE_ADDED', 'TICKET_INTERNAL_NOTE_ADDED', 'TICKET_CUSTOMER_REPLIED'].includes(row.event_type)) {
    const { trx, tenant } = context, owner = tenantDb(trx, tenant);
    const thread = await owner.table('comment_threads').where({ thread_id: row.thread_id, ticket_id: row.ticket_id }).forShare().first();
    if (!thread) return null;
    const query = owner.table('comments as c').where({ 'c.comment_id': row.comment_id, 'c.thread_id': row.thread_id, 'c.ticket_id': row.ticket_id });
    owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id');
    owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 't.ticket_id') });
    const comment = await query.where('c.publish_state', 'published').where('root.publish_state', 'published').whereNull('c.deleted_at')
      .forShare('c', 't', 'root').select('c.note', { audience: commentAudienceSql(trx, 't', 'root', 'c') }).first();
    if (!comment || comment.audience !== row.audience) return null;
    if (publication.eventType === 'TICKET_COMMENT_ADDED') publication.payload.comment.content = comment.note;
  }
  return publication;
}
/** A claimed row and any source visibility locks remain held through transport.
 * Crashes roll back the delivery mark; retries reuse the stable event ID. */
export async function dispatchCoManagedConversationEvents(db: Knex, tenant: string, publish: (publication: CoManagedEventPublication, eventId: string) => Promise<void>,
  options: { limit?: number; eventId?: string } = {}) {
  const limit = options.limit ?? 30;
  if (db.isTransaction || !isCoManagedUuid(tenant) || !Number.isInteger(limit) || limit < 1 || limit > 500 || (options.eventId !== undefined && !isCoManagedUuid(options.eventId))) throw new Error('Invalid co-managed event dispatch');
  const result = { published: 0, cancelled: 0, failed: 0 };
  const due = await tenantDb(db, tenant).table(TABLE).where('status', 'pending').where('next_attempt_at', '<=', db.raw('clock_timestamp()'))
    .modify(query => { if (options.eventId) query.where('event_id', options.eventId); }).orderBy('next_attempt_at').orderBy('event_id').limit(limit).select('event_id');
  for (const candidate of due) {
    try {
      const outcome = await db.transaction(async trx => {
        const owner = tenantDb(trx, tenant), row = await owner.table(TABLE).where({ event_id: candidate.event_id, status: 'pending' }).where('next_attempt_at', '<=', trx.raw('clock_timestamp()'))
          .forUpdate().skipLocked().first();
        if (!row) return null;
        const publication = await prepareCoManagedConversationEvent({ trx, tenant }, row);
        if (publication) await publish(publication, row.event_id);
        const status = publication ? 'published' : 'cancelled';
        await owner.table(TABLE).where('event_id', row.event_id).update({ status, completed_at: trx.raw('now()'), error_code: null });
        return status;
      });
      if (outcome === 'published') result.published++; else if (outcome === 'cancelled') result.cancelled++;
    } catch {
      result.failed++;
      await tenantDb(db, tenant).table(TABLE).where({ event_id: candidate.event_id, status: 'pending' }).update({ attempts: db.raw('attempts + 1'), error_code: 'event_publication_failed',
        next_attempt_at: db.raw("now() + least(3600, power(2, least(attempts, 10)) * 60) * interval '1 second'") });
    }
  }
  return result;
}
