import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export type CommentAudience = 'requester' | 'shared_it' | 'organization_private';
export class CommentAudienceError extends Error {
  constructor() { super('This comment does not have a valid audience for the requested operation.'); this.name = 'CommentAudienceError'; }
}
/** A co-managed workspace's requester-visible comment that did not name its audience. */
export class CoManagedAudienceRequiredError extends Error {
  readonly code = 'CO_MANAGED_AUDIENCE_REQUIRED' as const;
  constructor() { super('Choose who can see this comment before posting it.'); this.name = 'CoManagedAudienceRequiredError'; }
}
/** Audiences a native (non-collaboration) command may name. Shared IT needs the co-managed command's authority. */
export type NativeCommentAudience = Extract<CommentAudience, 'requester' | 'organization_private'>;
/**
 * Thread audience column for a native top-level comment. In a co-managed workspace a
 * staff comment the requester can read must say so explicitly: a missing audience fails
 * closed instead of defaulting to requester-visible. Internal notes without an audience
 * stay organization-private (the legacy rule above), so they never widen.
 */
export async function nativeThreadAudience(trx: Knex | Knex.Transaction, tenant: string,
  input: { isInternal: boolean; authorType: string; audience?: string | null }): Promise<{ collaboration_audience?: NativeCommentAudience }> {
  const named = input.audience;
  if (named != null && ((named !== 'requester' && named !== 'organization_private') || input.isInternal !== (named !== 'requester'))) {
    throw new CommentAudienceError();
  }
  if (named == null && (input.isInternal || input.authorType !== 'internal')) return {};
  const workspace = await tenantDb(trx, tenant).table('tenants').first('product_code');
  // Outside co-managed workspaces native threads keep their legacy (unlabelled) shape.
  if (workspace?.product_code !== 'co_managed') return {};
  if (named == null) throw new CoManagedAudienceRequiredError();
  return { collaboration_audience: named };
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

/** SQL facet of audience inheritance. Require both thread and root/reply flags
 * to agree before returning cross-organization visibility; inconsistent legacy
 * rows are private. Aliases are supplied by the query adapter, never a request. */
export function commentAudienceSql(db: Knex | Knex.Transaction, threadAlias: string, rootAlias: string, commentAlias = rootAlias): Knex.Raw {
  return db.raw(`CASE
    WHEN ??.is_internal IS FALSE AND ??.is_internal IS FALSE AND ??.is_internal IS FALSE
      AND (??.collaboration_audience IS NULL OR ??.collaboration_audience = 'requester') THEN 'requester'
    WHEN ??.is_internal IS TRUE AND ??.is_internal IS TRUE AND ??.is_internal IS TRUE
      AND ??.collaboration_audience = 'shared_it' THEN 'shared_it'
    ELSE 'organization_private' END`,
  [threadAlias, rootAlias, commentAlias, threadAlias, threadAlias, threadAlias, rootAlias, commentAlias, threadAlias]);
}
