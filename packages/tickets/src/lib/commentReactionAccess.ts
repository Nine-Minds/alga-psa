import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isMspPrincipalUserType } from '@alga-psa/types';
import { authorizeTicketRecordAccessConcealed } from './ticketRecordAuthorization';
import { commentVisibleToClient, type CommentThreadVisibility } from './commentVisibility';

type Conn = Knex | Knex.Transaction;

export interface ReactionTarget {
  comment_id: string;
  ticket_id: string;
}

export interface ReactionTargetResolution {
  /** commentId -> owning ticket, for comments the caller may see. */
  authorized: Map<string, ReactionTarget>;
  /**
   * Requested IDs that are missing OR not visible. Deliberately one bucket: callers
   * cannot (and must not) distinguish "does not exist" from "hidden".
   */
  denied: Set<string>;
}

/**
 * Single authorized resolver for comment-reaction actions.
 *
 * - One tenant-scoped `comments` query for all (deduplicated) IDs, plus at most one
 *   `comment_threads` query (only needed for non-MSP principals).
 * - The ticket authorizer runs once per distinct `ticket_id`, never once per comment; a
 *   ticket denial (or error, including a missing ticket) denies every comment on it.
 *   `action` is 'update' for reaction writes and 'read' for reaction reads.
 * - Non-MSP principals additionally pass `commentVisibleToClient` (internal flag,
 *   internal thread, publish_state, deleted_at). MSP principals rely on ticket access.
 * - Comments with no `ticket_id` FAIL CLOSED for everyone. A comment's only owning record
 *   is its ticket; with none there is nothing to authorize against, so we deny rather
 *   than guess.
 * - Authorizer failures never propagate: they land in `denied`, so the caller decides
 *   how to present the (identical) denial.
 */
export async function resolveReactionTargets(
  trx: Conn,
  tenant: string,
  user: { user_type?: string | null } & Record<string, any>,
  commentIds: string[],
  action: 'read' | 'update',
): Promise<ReactionTargetResolution> {
  const ids = [...new Set(commentIds)];
  const authorized = new Map<string, ReactionTarget>();
  const denied = new Set<string>(ids);
  if (ids.length === 0) return { authorized, denied };

  const rows: Array<{
    comment_id: string;
    ticket_id: string | null;
    thread_id: string | null;
    is_internal: boolean | null;
    publish_state: 'published' | 'scheduled' | 'canceled' | null;
    deleted_at: string | null;
  }> = await tenantDb(trx, tenant).table('comments')
    .whereIn('comment_id', ids)
    .select('comment_id', 'ticket_id', 'thread_id', 'is_internal', 'publish_state', 'deleted_at');

  const isMsp = isMspPrincipalUserType(user?.user_type);

  const threads = new Map<string, CommentThreadVisibility>();
  if (!isMsp) {
    const threadIds = [...new Set(rows.map((r) => r.thread_id).filter((t): t is string => !!t))];
    if (threadIds.length > 0) {
      const threadRows: Array<{ thread_id: string; is_internal: boolean | null }> =
        await tenantDb(trx, tenant).table('comment_threads')
          .whereIn('thread_id', threadIds)
          .select('thread_id', 'is_internal');
      for (const t of threadRows) threads.set(t.thread_id, { is_internal: t.is_internal });
    }
  }

  // Comment-level visibility first (cheap, no SQL), then one ticket check per ticket.
  const candidates = rows.filter((row) => {
    if (!row.ticket_id) return false;
    if (isMsp) return true;
    return commentVisibleToClient(
      { is_internal: row.is_internal ?? undefined, publish_state: row.publish_state ?? undefined, deleted_at: row.deleted_at },
      row.thread_id ? threads.get(row.thread_id) : undefined,
    );
  });

  const ticketAllowed = new Map<string, boolean>();
  for (const ticketId of new Set(candidates.map((r) => r.ticket_id as string))) {
    try {
      await authorizeTicketRecordAccessConcealed({ trx, tenant, user: user as any, ticketId, action });
      ticketAllowed.set(ticketId, true);
    } catch {
      ticketAllowed.set(ticketId, false);
    }
  }

  for (const row of candidates) {
    if (ticketAllowed.get(row.ticket_id as string)) {
      authorized.set(row.comment_id, { comment_id: row.comment_id, ticket_id: row.ticket_id as string });
      denied.delete(row.comment_id);
    }
  }
  return { authorized, denied };
}
