import type { Knex } from 'knex';
import { isCapabilityServed } from '@alga-psa/core/capability';
import { liveSeatArrangement, tenantDb } from '@alga-psa/db';
import { resolveCommentAudienceForRead } from '@alga-psa/shared/lib/commentAudience';
import type { IComment } from '@alga-psa/types';

/**
 * Stamps each comment with the read-time `audience` of its thread (`resolveCommentAudienceForRead`,
 * the one read-side resolver), so the ticket screen can label it.
 *
 * One statement over the comments' threads. Callers run it only for a ticket of a client with a live
 * seat arrangement, so every other ticket's comment read is exactly what it was.
 */
export async function attachThreadAudiences<C extends Pick<IComment, 'thread_id'>>(
  trx: Knex | Knex.Transaction,
  tenant: string,
  comments: C[],
): Promise<Array<C & { audience?: IComment['audience'] }>> {
  const threadIds = Array.from(new Set(comments.map((comment) => comment.thread_id).filter((id): id is string => Boolean(id))));
  if (threadIds.length === 0) return comments;
  const threads: Array<{ thread_id: string; is_internal: boolean; collaboration_audience: unknown }> =
    await tenantDb(trx, tenant).table('comment_threads').whereIn('thread_id', threadIds)
      .select('thread_id', 'is_internal', 'collaboration_audience');
  const byId = new Map(threads.map((thread) => [thread.thread_id, thread]));
  return comments.map((comment) => {
    const thread = comment.thread_id ? byId.get(comment.thread_id) : undefined;
    const row = comment as C & { is_internal?: unknown };
    return thread
      ? { ...comment, audience: resolveCommentAudienceForRead({
          collaboration_audience: thread.collaboration_audience,
          is_internal: thread.is_internal,
          comment_is_internal: row.is_internal,
        }) }
      : comment;
  });
}

/**
 * `attachThreadAudiences` for a refresh path that does not already hold the ticket's seat context:
 * a no-op, at no statement, while the `co-managed-seat` capability does not serve the tenant, and
 * for a ticket whose client has no live arrangement.
 */
export async function attachThreadAudiencesOnSeatTicket<C extends Pick<IComment, 'thread_id'>>(
  trx: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string,
  comments: C[],
): Promise<Array<C & { audience?: IComment['audience'] }>> {
  if (!(await isCapabilityServed('co-managed-seat', tenant))) return comments;
  const sponsor = tenantDb(trx, tenant);
  const ticket = await sponsor.table('tickets').where('ticket_id', ticketId).first('client_id');
  return (await liveSeatArrangement(sponsor, ticket?.client_id ?? null))
    ? attachThreadAudiences(trx, tenant, comments)
    : comments;
}
