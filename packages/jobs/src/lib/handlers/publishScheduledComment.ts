import { v5 as uuidv5 } from 'uuid';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import type { Knex } from 'knex';
import { hasCoManagedConversationOwnership } from '@alga-psa/co-managed/nativeConversationEvents';
import { assertCoManagedScheduledCommentPublication } from '@alga-psa/co-managed/scheduledCommentPublication';
import { syncCoManagedTicketAwaitingClientSla, type CoManagedEventPublication } from '@alga-psa/co-managed';
import { queueCoManagedConversationEvent } from './coManagedConversationEventPublication';
import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';
import { withTransaction } from '@alga-psa/db';
import { isResponseStateTrackingEnabled } from '@alga-psa/shared/lib/tickets/responseStateSettings';

export async function dispatchScheduledCommentNotification(knex: any, tenantId: string, commentId: string): Promise<void> {
  if (await retainScheduledConversationEvents(knex, tenantId, commentId)) return;
  const db = tenantDb(knex, tenantId);
  const comment = await db.table('comments').where({ comment_id: commentId, publish_state: 'published' })
    .whereNull('scheduled_publish_dispatched_at').first();
  if (!comment) return;
  const eventId = comment.scheduled_publish_event_id;
  if (!eventId) throw new Error(`Scheduled comment ${commentId} is missing its durable event id`);
  const author = comment.user_id ? await db.table('users').select('first_name', 'last_name').where({ user_id: comment.user_id }).first() : null;
  await publishEvent({ eventType: 'TICKET_COMMENT_ADDED', payload: {
    tenantId, occurredAt: new Date().toISOString(), ticketId: comment.ticket_id, commentId: comment.comment_id, userId: comment.user_id,
    thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id ?? null, is_reply: Boolean(comment.parent_comment_id),
    comment: { id: comment.comment_id, content: comment.note, author: author ? `${author.first_name} ${author.last_name}` : 'Unknown User', isInternal: false, authorType: comment.author_type, thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id ?? null, is_reply: Boolean(comment.parent_comment_id) },
  } }, { eventId, strict: true });
  await db.table('comments').where({ comment_id: commentId, scheduled_publish_event_id: eventId }).whereNull('scheduled_publish_dispatched_at')
    .update({ scheduled_publish_dispatched_at: knex.fn.now() });
}

export async function dispatchScheduledResponseStateEvent(knex: any, tenantId: string, commentId: string): Promise<void> {
  if (await retainScheduledConversationEvents(knex, tenantId, commentId)) return;
  const db = tenantDb(knex, tenantId);
  const comment = await db.table('comments').where({ comment_id: commentId, publish_state: 'published' })
    .whereNotNull('scheduled_response_event_id').whereNull('scheduled_response_dispatched_at').first();
  if (!comment) return;
  await publishEvent({ eventType: 'TICKET_RESPONSE_STATE_CHANGED', payload: {
    tenantId, occurredAt: comment.published_at ?? new Date().toISOString(), ticketId: comment.ticket_id,
    userId: comment.user_id, previousResponseState: comment.scheduled_previous_response_state ?? null,
    newResponseState: 'awaiting_client', previousState: comment.scheduled_previous_response_state ?? null,
    newState: 'awaiting_client', trigger: 'comment',
  } }, { eventId: comment.scheduled_response_event_id, strict: true });
  await db.table('comments').where({ comment_id: commentId, scheduled_response_event_id: comment.scheduled_response_event_id })
    .whereNull('scheduled_response_dispatched_at').update({ scheduled_response_dispatched_at: knex.fn.now() });
}

export const PUBLISH_SCHEDULED_COMMENT_JOB = 'publish-scheduled-comment';

export interface PublishScheduledCommentJobData {
  tenantId: string;
  ticketId: string;
  commentId: string;
}

/**
 * The compare-and-set is intentionally the notification idempotency key. Only
 * the worker that changes scheduled -> published emits the existing event.
 */
export async function publishScheduledComment(knex: Knex, data: PublishScheduledCommentJobData): Promise<void> {
  const coManaged = await withTransaction(knex, trx => hasCoManagedConversationOwnership(trx, data.tenantId));
  const snapshot = await tenantDb(knex, data.tenantId).table('comments').where({ comment_id: data.commentId, ticket_id: data.ticketId })
    .modify(query => { if (coManaged) query.where(retry => retry.whereNull('scheduled_publish_retry_at').orWhere('scheduled_publish_retry_at', '<=', knex.raw('clock_timestamp()'))); }).first();
  if (!snapshot) return;
  try {
    const db = tenantDb(knex, data.tenantId);
    const updated = await withTransaction(knex, async (trx: any) => {
      const trxDb = tenantDb(trx, data.tenantId);
      const pending = await trxDb.table('comments').where({ comment_id: data.commentId, ticket_id: data.ticketId, publish_state: 'scheduled' }).where('scheduled_publish_at', '<=', trx.raw('clock_timestamp()')).first();
      if (!pending) return [];
      const authority = coManaged ? await assertCoManagedScheduledCommentPublication(trx, { tenant: data.tenantId, ticketId: data.ticketId, commentId: data.commentId }) : null;
      if (coManaged && !authority) return [];
      const ticket = await trxDb.table('tickets').where({ ticket_id: data.ticketId }).forUpdate().first('response_state');
      const responseChanges = await isResponseStateTrackingEnabled(data.tenantId, trx)
        && ticket?.response_state !== 'awaiting_client';
      if (responseChanges && authority && !authority.canUpdateResponseState) throw new Error('Scheduled author cannot change ticket response state');
      const rows = await trxDb.table('comments')
        .where({ comment_id: data.commentId, ticket_id: data.ticketId, publish_state: 'scheduled' })
        .where('scheduled_publish_at', '<=', trx.fn.now())
        .update({
          publish_state: 'published', published_at: trx.fn.now(), schedule_job_id: null, scheduled_publish_retry_at: null,
          // Citus rejects VOLATILE functions (gen_random_uuid) in UPDATEs on
          // distributed tables; generate the ids here and pass them as params.
          scheduled_publish_event_id: trx.raw('COALESCE(scheduled_publish_event_id, ?)', [randomUUID()]),
          scheduled_response_event_id: responseChanges ? trx.raw('COALESCE(scheduled_response_event_id, ?)', [randomUUID()]) : null,
          scheduled_previous_response_state: responseChanges ? ticket?.response_state ?? null : null,
          updated_at: trx.fn.now(),
        })
        .returning('*');
      const transitioned = rows[0];
      if (!transitioned) return rows;
      if (responseChanges) {
        await trxDb.table('tickets').where({ ticket_id: data.ticketId }).update({ response_state: 'awaiting_client' });
        await syncCoManagedTicketAwaitingClientSla(trx, data.tenantId, data.ticketId);
      }
      await writeTicketActivity(trx, {
        tenant: data.tenantId, ticketId: transitioned.ticket_id, eventType: 'TICKET_COMMENT_PUBLISHED',
        entityType: TICKET_ACTIVITY_ENTITY.COMMENT, entityId: transitioned.comment_id,
        actor: { actorType: TICKET_ACTIVITY_ACTOR.SYSTEM }, source: TICKET_ACTIVITY_SOURCE.SYSTEM,
        details: { published_at: new Date().toISOString(), scheduled_publish: true },
      });
      if (coManaged) {
        await retainScheduledConversationEvents(trx, data.tenantId, transitioned.comment_id);
        await assertCoManagedOperationalWrite(trx, data.tenantId);
      }
      return rows;
    });
    // A prior worker may have committed the state change then died before the
    // durable event dispatch. Always load/re-drive that state on every job
    // delivery; do not make recovery depend on a process restart.
    const comment = updated[0] ?? await db.table('comments')
      .where({ comment_id: data.commentId, ticket_id: data.ticketId, publish_state: 'published' })
      .whereNotNull('scheduled_publish_event_id')
      .first(['comment_id', 'ticket_id', 'user_id', 'note', 'is_internal', 'author_type', 'thread_id', 'parent_comment_id']);
    if (!comment) return;

    await dispatchScheduledResponseStateEvent(knex, data.tenantId, comment.comment_id);
    await dispatchScheduledCommentNotification(knex, data.tenantId, comment.comment_id);
  } catch (error) {
    // Retry bookkeeping is metadata, not publication. A reschedule made while
    // this attempt rolled back must keep its new due time and clear retry state.
    if (coManaged) await tenantDb(knex, data.tenantId).table('comments')
      .where({ comment_id: data.commentId, ticket_id: data.ticketId, scheduled_publish_at: snapshot.scheduled_publish_at })
      .update({ scheduled_publish_retry_at: knex.raw("clock_timestamp() + interval '15 minutes'") });
    throw error;
  }
}


async function retainScheduledEvent(trx: Knex.Transaction, source: { tenant: string; ticketId: string; commentId: string; threadId: string },
  publication: CoManagedEventPublication, options: { eventId: string }) {
  // Schedules are requester-facing intent. Freeze that original audience even
  // when enrolling an old published row: dispatch must cancel content that has
  // since been deleted or restricted, rather than retargeting it as a new note.
  await queueCoManagedConversationEvent(trx, { ...source, ...options, audience: 'requester', publication });
}

/** The dispatch marker means ownership has moved to the conversation outbox.
 * A failed post-commit transport is recovered there, using the same event ID. */
async function retainScheduledConversationEvents(db: Knex | Knex.Transaction, tenant: string, commentId: string): Promise<boolean> {
  return withTransaction(db, async trx => {
    if (!await hasCoManagedConversationOwnership(trx, tenant)) return false;
    const owner = tenantDb(trx, tenant);
    const comment = await owner.table('comments').where({ comment_id: commentId, publish_state: 'published' }).forUpdate().first();
    if (!comment) return true;
    const source = { tenant, ticketId: comment.ticket_id, commentId, threadId: comment.thread_id };
    if (comment.scheduled_response_event_id && !comment.scheduled_response_dispatched_at) {
      await retainScheduledEvent(trx, source, { kind: 'event', eventType: 'TICKET_RESPONSE_STATE_CHANGED', payload: {
        tenantId: tenant, ticketId: comment.ticket_id, userId: comment.user_id, occurredAt: comment.published_at,
        previousResponseState: comment.scheduled_previous_response_state ?? null, newResponseState: 'awaiting_client',
        previousState: comment.scheduled_previous_response_state ?? null, newState: 'awaiting_client', trigger: 'comment',
      } }, { eventId: comment.scheduled_response_event_id });
      await owner.table('comments').where('comment_id', commentId).update({ scheduled_response_dispatched_at: trx.raw('clock_timestamp()') });
    }
    if (comment.scheduled_publish_event_id && !comment.scheduled_publish_dispatched_at) {
      const author = comment.user_id ? await owner.table('users').where('user_id', comment.user_id).first('first_name', 'last_name') : null;
      await retainScheduledEvent(trx, source, { kind: 'event', eventType: 'TICKET_COMMENT_ADDED', payload: {
        tenantId: tenant, ticketId: comment.ticket_id, commentId, userId: comment.user_id, occurredAt: comment.published_at,
        thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id ?? null, is_reply: Boolean(comment.parent_comment_id),
        comment: { id: commentId, content: '', author: author ? `${author.first_name} ${author.last_name}` : 'Unknown User',
          isInternal: false, authorType: comment.author_type, audience: 'requester', thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id ?? null, is_reply: Boolean(comment.parent_comment_id) },
      } }, { eventId: comment.scheduled_publish_event_id });
      await retainScheduledEvent(trx, source, { kind: 'workflow', eventType: 'TICKET_MESSAGE_ADDED',
        payload: { ticketId: comment.ticket_id, messageId: commentId, audience: 'requester', visibility: 'public', authorType: 'user', authorId: comment.user_id,
          channel: 'ui', createdAt: new Date(comment.published_at).toISOString() },
        workflowContext: { tenantId: tenant, occurredAt: new Date(comment.published_at).toISOString(), correlationId: commentId,
          actor: { actorType: 'USER', actorUserId: comment.user_id } },
      }, { eventId: uuidv5(`${tenant}:TICKET_MESSAGE_ADDED`, comment.scheduled_publish_event_id) });
      await owner.table('comments').where('comment_id', commentId).update({ scheduled_publish_dispatched_at: trx.raw('clock_timestamp()') });
    }
    await owner.table('comments').where('comment_id', commentId).update({ scheduled_publish_retry_at: null });
    return true;
  });
}

/** Maintenance also covers schedules whose finite queue retries were exhausted.
 * Per-comment failures defer just that source; the rest of the batch progresses. */
export async function recoverCoManagedScheduledComments(db: Knex, tenant: string, limit = 30) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid scheduled recovery limit');
  if (!await withTransaction(db, trx => hasCoManagedConversationOwnership(trx, tenant))) return { processed: 0, failed: 0 };
  const rows = await tenantDb(db, tenant).table('comments')
    .where(query => query.whereNull('scheduled_publish_retry_at').orWhere('scheduled_publish_retry_at', '<=', db.raw('clock_timestamp()')))
    .where(query => query.where(pending => pending.where('publish_state', 'scheduled').where('scheduled_publish_at', '<=', db.raw('clock_timestamp()')))
      .orWhere(published => published.where('publish_state', 'published').whereNotNull('scheduled_publish_event_id').where(markers => markers.whereNull('scheduled_publish_dispatched_at')
        .orWhere(response => response.whereNotNull('scheduled_response_event_id').whereNull('scheduled_response_dispatched_at')))))
    .orderByRaw('scheduled_publish_retry_at NULLS FIRST').orderBy('scheduled_publish_at').orderBy('comment_id').limit(limit).select('comment_id', 'ticket_id');
  const result = { processed: 0, failed: 0 };
  for (const row of rows) {
    try { await publishScheduledComment(db, { tenantId: tenant, ticketId: row.ticket_id, commentId: row.comment_id }); result.processed++; }
    catch { result.failed++; }
  }
  return result;
}
