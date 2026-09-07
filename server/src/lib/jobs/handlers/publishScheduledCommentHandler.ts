import logger from '@alga-psa/core/logger';
import { getConnection } from 'server/src/lib/db/db';
import { tenantDb } from '@alga-psa/db';
import { getJobRunner } from '../JobRunnerFactory';
import { publishScheduledComment,
  PUBLISH_SCHEDULED_COMMENT_JOB, type PublishScheduledCommentJobData } from '@alga-psa/jobs/handlers/publishScheduledComment';
export { PUBLISH_SCHEDULED_COMMENT_JOB, type PublishScheduledCommentJobData };
export async function publishScheduledCommentHandler(data: PublishScheduledCommentJobData): Promise<void> {
  return publishScheduledComment(await getConnection(data.tenantId), data);
}

/** Re-arms persisted future schedules and immediately catches up overdue rows. */
export async function reconcileScheduledCommentPublications(): Promise<void> {
  const root = await getConnection(null);
  const rows = await root('comments').where({ publish_state: 'scheduled' })
    .select('tenant', 'comment_id', 'ticket_id', 'scheduled_publish_at');
  const runner = await getJobRunner();
  for (const row of rows) {
    try {
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
    } catch {
      logger.warn('Scheduled comment remains pending for recovery', { tenantId: row.tenant, commentId: row.comment_id });
    }
  }
  const pending = await root('comments').where({ publish_state: 'published' }).whereNotNull('scheduled_publish_event_id')
    .where(query => query.whereNull('scheduled_publish_dispatched_at')
      .orWhere(response => response.whereNotNull('scheduled_response_event_id').whereNull('scheduled_response_dispatched_at')))
    .select('tenant', 'comment_id', 'ticket_id');
  for (const row of pending) {
    try { await publishScheduledCommentHandler({ tenantId: row.tenant, ticketId: row.ticket_id, commentId: row.comment_id }); }
    catch { logger.warn('Scheduled comment delivery remains pending for recovery', { tenantId: row.tenant, commentId: row.comment_id }); }
  }
}
