import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { commentAudienceSql, type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import { isCoManagedUuid, CoManagedSharedWorkError } from './sharedWorkIdentity';

const TABLE = 'co_management_event_outbox';
const TYPES = ['TICKET_COMMENT_ADDED', 'TICKET_COMMENT_UPDATED', 'TICKET_COMMENT_DELETED', 'TICKET_RESPONSE_STATE_CHANGED', 'TICKET_MESSAGE_ADDED', 'TICKET_INTERNAL_NOTE_ADDED', 'TICKET_CUSTOMER_REPLIED'] as const;
export type CoManagedConversationEventType = typeof TYPES[number];
export interface CoManagedEventPublication {
  kind: 'event' | 'workflow'; eventType: CoManagedConversationEventType; payload: Record<string, any>;
  workflowContext?: Record<string, any>; idempotencyKey?: string;
}
export interface CoManagedEventIntent {
  tenant: string; eventId: string; ticketId: string; commentId: string; threadId: string; audience: CommentAudience; publication: CoManagedEventPublication;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
/** Admission is supplied by the mutation's retained transaction. Publication
 * records carry metadata only; a created comment body is loaded at dispatch. */
export async function enqueueCoManagedConversationEvent(trx: Knex.Transaction, input: CoManagedEventIntent): Promise<void> {
  if (!trx.isTransaction || ![input.tenant, input.eventId, input.ticketId, input.commentId, input.threadId].every(isCoManagedUuid) ||
    !['requester', 'shared_it', 'organization_private'].includes(input.audience) || !TYPES.includes(input.publication?.eventType) ||
    !['event', 'workflow'].includes(input.publication.kind)) throw new CoManagedSharedWorkError();
  const publication = JSON.parse(JSON.stringify(input.publication)) as CoManagedEventPublication;
  if (publication.eventType === 'TICKET_COMMENT_ADDED') {
    if (!publication.payload.comment || publication.payload.comment.id !== input.commentId || publication.payload.commentId !== input.commentId) throw new CoManagedSharedWorkError();
    publication.payload.comment.content = '';
  }
  if (publication.payload.ticketId !== input.ticketId || (publication.kind === 'event' ? publication.payload.tenantId !== input.tenant : publication.workflowContext?.tenantId !== input.tenant)) throw new CoManagedSharedWorkError();
  // LEVERAGE: pattern transactional-event-intent — inbound email has the same durable publication state beneath its inbox-specific contract.
  const requestHash = digest({ ticketId: input.ticketId, commentId: input.commentId, threadId: input.threadId, audience: input.audience, publication });
  const owner = tenantDb(trx, input.tenant);
  await owner.table(TABLE).insert({ tenant: input.tenant, event_id: input.eventId, ticket_id: input.ticketId, comment_id: input.commentId, thread_id: input.threadId,
    event_type: publication.eventType, audience: input.audience, publication: JSON.stringify(publication), request_hash: requestHash }).onConflict(['tenant', 'event_id']).ignore();
  const row = await owner.table(TABLE).where('event_id', input.eventId).forShare().first('request_hash');
  if (row?.request_hash !== requestHash) throw new Error('Co-managed event identity was reused with different intent');
}
/** Current audience and publication checks apply to newly-created-message
 * delivery. Metadata-only invalidations still run after removal or restriction. */
async function prepare(context: { trx: Knex.Transaction; tenant: string }, row: any): Promise<CoManagedEventPublication | null> {
  const publication = JSON.parse(JSON.stringify(row.publication)) as CoManagedEventPublication;
  if (!TYPES.includes(row.event_type) || publication.eventType !== row.event_type ||
    digest({ ticketId: row.ticket_id, commentId: row.comment_id, threadId: row.thread_id, audience: row.audience, publication }) !== row.request_hash) throw new Error('Invalid co-managed event intent');
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
        const publication = await prepare({ trx, tenant }, row);
        if (publication) await publish(publication, row.event_id);
        const status = publication ? 'published' : 'cancelled';
        await owner.table(TABLE).where('event_id', row.event_id).update({ status, completed_at: trx.raw('clock_timestamp()'), error_code: null });
        return status;
      });
      if (outcome === 'published') result.published++; else if (outcome === 'cancelled') result.cancelled++;
    } catch {
      result.failed++;
      await tenantDb(db, tenant).table(TABLE).where({ event_id: candidate.event_id, status: 'pending' }).update({ attempts: db.raw('attempts + 1'), error_code: 'event_publication_failed',
        next_attempt_at: db.raw("clock_timestamp() + least(3600, power(2, least(attempts, 10)) * 60) * interval '1 second'") });
    }
  }
  return result;
}
