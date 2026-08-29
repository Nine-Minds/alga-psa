import { randomUUID } from 'node:crypto';
import { getConnection } from 'server/src/lib/db/db';
import { tenantDb } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import type { BaseJobData } from '../interfaces';
import { getJobRunner } from '../JobRunnerFactory';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';
import { withTransaction } from '@alga-psa/db';
import { isResponseStateTrackingEnabled } from '@alga-psa/tickets/lib/responseStateSettings';

async function dispatchScheduledCommentNotification(knex: any, tenantId: string, commentId: string): Promise<void> {
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

async function dispatchScheduledResponseStateEvent(knex: any, tenantId: string, commentId: string): Promise<void> {
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

export interface PublishScheduledCommentJobData extends BaseJobData {
  tenantId: string;
  ticketId: string;
  commentId: string;
}

/**
 * The compare-and-set is intentionally the notification idempotency key. Only
 * the worker that changes scheduled -> published emits the existing event.
 */
export async function publishScheduledCommentHandler(data: PublishScheduledCommentJobData): Promise<void> {
  const knex = await getConnection(data.tenantId);
  const db = tenantDb(knex, data.tenantId);
  const updated = await withTransaction(knex, async (trx: any) => {
    const trxDb = tenantDb(trx, data.tenantId);
    const ticket = await trxDb.table('tickets').where({ ticket_id: data.ticketId }).forUpdate().first('response_state');
    const responseChanges = await isResponseStateTrackingEnabled(data.tenantId, trx)
      && ticket?.response_state !== 'awaiting_client';
    const rows = await trxDb.table('comments')
      .where({ comment_id: data.commentId, ticket_id: data.ticketId, publish_state: 'scheduled' })
      .where('scheduled_publish_at', '<=', trx.fn.now())
      .update({
        publish_state: 'published', published_at: trx.fn.now(), schedule_job_id: null,
        // Citus rejects VOLATILE functions (gen_random_uuid) in UPDATEs on
        // distributed tables; generate the ids here and pass them as params.
        scheduled_publish_event_id: trx.raw('COALESCE(scheduled_publish_event_id, ?)', [randomUUID()]),
        scheduled_response_event_id: responseChanges ? trx.raw('COALESCE(scheduled_response_event_id, ?)', [randomUUID()]) : null,
        scheduled_previous_response_state: responseChanges ? ticket?.response_state ?? null : null,
        updated_at: trx.fn.now(),
      })
      .returning(['comment_id', 'ticket_id', 'user_id', 'note', 'is_internal', 'author_type', 'thread_id', 'parent_comment_id']);
    const transitioned = rows[0];
    if (!transitioned) return rows;
    if (responseChanges) await trxDb.table('tickets').where({ ticket_id: data.ticketId }).update({ response_state: 'awaiting_client' });
    await writeTicketActivity(trx, {
      tenant: data.tenantId, ticketId: transitioned.ticket_id, eventType: 'TICKET_COMMENT_PUBLISHED',
      entityType: TICKET_ACTIVITY_ENTITY.COMMENT, entityId: transitioned.comment_id,
      actor: { actorType: TICKET_ACTIVITY_ACTOR.SYSTEM }, source: TICKET_ACTIVITY_SOURCE.SYSTEM,
      details: { published_at: new Date().toISOString(), scheduled_publish: true },
    });
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
}

/** Re-arms persisted future schedules and immediately catches up overdue rows. */
export async function reconcileScheduledCommentPublications(): Promise<void> {
  const root = await getConnection(null);
  const rows = await root('comments').where({ publish_state: 'scheduled' })
    .select('tenant', 'comment_id', 'ticket_id', 'scheduled_publish_at');
  const runner = await getJobRunner();
  for (const row of rows) {
    if (new Date(row.scheduled_publish_at).getTime() <= Date.now()) {
      await publishScheduledCommentHandler({ tenantId: row.tenant, ticketId: row.ticket_id, commentId: row.comment_id });
    } else {
      const scheduled = await runner.scheduleJobAt(
        PUBLISH_SCHEDULED_COMMENT_JOB,
        { tenantId: row.tenant, ticketId: row.ticket_id, commentId: row.comment_id },
        new Date(row.scheduled_publish_at),
        { singletonKey: `publish-comment:${row.comment_id}` },
      );
      await tenantDb(root, row.tenant).table('comments').where({ comment_id: row.comment_id, publish_state: 'scheduled' })
        .update({ schedule_job_id: scheduled.jobId });
    }
    // A previously published row can be left pending only if a process died
    // after the transition; re-drive its stable event id safely on every boot.
  }
  const pending = await root('comments').where({ publish_state: 'published' }).whereNotNull('scheduled_publish_event_id').whereNull('scheduled_publish_dispatched_at').select('tenant', 'comment_id');
  for (const row of pending) {
    await dispatchScheduledResponseStateEvent(root, row.tenant, row.comment_id);
    await dispatchScheduledCommentNotification(root, row.tenant, row.comment_id);
  }
  const pendingResponses = await root('comments').where({ publish_state: 'published' })
    .whereNotNull('scheduled_response_event_id').whereNull('scheduled_response_dispatched_at')
    .select('tenant', 'comment_id');
  for (const row of pendingResponses) await dispatchScheduledResponseStateEvent(root, row.tenant, row.comment_id);
}
