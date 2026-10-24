import type { Knex } from 'knex';
import { tenantDb, registerAfterCommit } from '@alga-psa/db';
import { scheduleJobAt, cancelScheduledJob } from '@alga-psa/core';

export interface ScheduledCommentQueueSource { commentId: string; ticketId: string; at: Date; timeZone: string; previousJobId?: string | null }
/** Canonical state survives queue failures. A stale enqueue cannot replace the
 * job reference belonging to a concurrent reschedule or canceled comment. */
export async function enqueueScheduledComment(db: Knex, tenant: string, source: ScheduledCommentQueueSource) {
  const current = () => tenantDb(db, tenant).table('comments').where({ comment_id: source.commentId, ticket_id: source.ticketId,
    publish_state: 'scheduled', scheduled_publish_at: source.at.toISOString() }).whereNull('deleted_at');
  if (!await current().first('comment_id')) return;
  const scheduled = await scheduleJobAt('publish-scheduled-comment',
    { tenantId: tenant, ticketId: source.ticketId, commentId: source.commentId }, source.at,
    { singletonKey: `publish-comment:${source.commentId}:${source.at.toISOString()}`, metadata: { scheduledPublishTz: source.timeZone } });
  if (!await current().update({ schedule_job_id: scheduled.jobId })) await cancelScheduledJob(scheduled.jobId, tenant);
}
export function scheduleCommentAfterCommit(trx: Knex.Transaction, db: Knex, tenant: string, source: ScheduledCommentQueueSource) {
  if (source.previousJobId) registerAfterCommit(trx, async () => { await cancelScheduledJob(source.previousJobId!, tenant); }, `cancel previous comment schedule ${source.commentId}`);
  registerAfterCommit(trx, () => enqueueScheduledComment(db, tenant, source), `schedule comment publication ${source.commentId}`);
}
