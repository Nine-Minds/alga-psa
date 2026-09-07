import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export type CommentAudience = 'requester' | 'shared_it' | 'organization_private';
export class CommentAudienceError extends Error {
  constructor() { super('This comment does not have a valid audience for the requested operation.'); this.name = 'CommentAudienceError'; }
}
/** Legacy internal notes must never become shared IT notes by inference. */
export function resolveCommentAudience(thread: { collaboration_audience?: unknown; is_internal?: unknown }): CommentAudience {
  const audience = thread.collaboration_audience;
  if (audience == null) return thread.is_internal === false ? 'requester' : 'organization_private';
  if (!['requester', 'shared_it', 'organization_private'].includes(audience as string) ||
      thread.is_internal !== (audience !== 'requester')) throw new CommentAudienceError();
  return audience as CommentAudience;
}
/** Audience is an additional restriction after resource and principal authorization. */
export function isCommentAudienceVisible(audience: CommentAudience, ownerTenant: string, actorTenant: string, requester = false): boolean {
  if (!ownerTenant || !actorTenant) return false;
  if (requester) return audience === 'requester';
  return audience === 'requester' || audience === 'shared_it' || (audience === 'organization_private' && ownerTenant === actorTenant);
}
/** Native text edits can neither rehome nor relabel an explicitly shared thread.
 * Audience changes use a separately authorized disclosure command. The thread
 * lock also serializes new replies against that command. */
export async function assertCommentThreadAudience(trx: Knex | Knex.Transaction, tenant: string, threadId: string,
  input: { ticketId?: string; isInternal?: boolean; parentCommentId?: string | null }): Promise<CommentAudience> {
  if (!trx.isTransaction) throw new Error('Comment audience checks require the owning transaction');
  const thread = await tenantDb(trx, tenant).table('comment_threads').where('thread_id', threadId).forUpdate().first();
  if (!thread || (input.ticketId !== undefined && thread.ticket_id !== input.ticketId)) throw new CommentAudienceError();
  const audience = resolveCommentAudience(thread);
  const customer = await tenantDb(trx, tenant).table('tenants').first('product_code');
  if ((thread.collaboration_audience != null || customer?.product_code === 'co_managed') && input.isInternal !== undefined && input.isInternal !== (audience !== 'requester')) throw new CommentAudienceError();
  if (input.parentCommentId) {
    const parent = await tenantDb(trx, tenant).table('comments').where({ comment_id: input.parentCommentId, thread_id: threadId }).forShare().first('deleted_at');
    if (!parent || parent.deleted_at) throw new CommentAudienceError();
  }
  return audience;
}
