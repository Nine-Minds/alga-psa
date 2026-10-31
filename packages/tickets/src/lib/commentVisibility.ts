import { isMspPrincipalUserType, type IComment } from '@alga-psa/types';
import { stripCommentBccFromMetadata } from '@shared/lib/tickets/commentEmailRecipientsCore';

/**
 * Comment visibility projection for non-MSP principals.
 *
 * The rules mirror the client-portal ticket loader (client-tickets.ts): a
 * comment is client-visible only when it is not internal, is not in an
 * internal thread, and is `published`. Soft-deleted comments are also hidden.
 * Anything that is not an MSP principal is treated as a client (fail closed).
 */

export interface CommentThreadVisibility {
  is_internal?: boolean | null;
}

/** Row columns that are scheduling/attribution bookkeeping, never shown to clients. */
export const CLIENT_REDACTED_COMMENT_FIELDS = [
  'schedule_job_id',
  'scheduled_publish_event_id',
  'scheduled_publish_dispatched_at',
  'scheduled_response_event_id',
  'scheduled_previous_response_state',
  'scheduled_response_dispatched_at',
] as const;

/** Top-level `metadata` keys that carry internal data (inbound-email provenance). */
export const CLIENT_REDACTED_METADATA_KEYS = ['email'] as const;

export function commentVisibleToClient(
  comment: Pick<IComment, 'is_internal' | 'publish_state' | 'deleted_at'>,
  thread?: CommentThreadVisibility | null,
): boolean {
  if (comment.is_internal) return false;
  if (thread?.is_internal) return false;
  if (comment.publish_state !== 'published') return false;
  if (comment.deleted_at) return false;
  return true;
}

function redactCommentForClient<T extends IComment>(comment: T): T {
  const redacted: Record<string, unknown> = { ...(comment as unknown as Record<string, unknown>) };
  for (const field of CLIENT_REDACTED_COMMENT_FIELDS) {
    delete redacted[field];
  }

  // Strip Bcc first (handles jsonb strings), then drop internal-only keys.
  const metadata = stripCommentBccFromMetadata(comment.metadata) as unknown;
  if (metadata && typeof metadata === 'object') {
    const cleaned: Record<string, unknown> = { ...(metadata as Record<string, unknown>) };
    for (const key of CLIENT_REDACTED_METADATA_KEYS) {
      delete cleaned[key];
    }
    redacted.metadata = cleaned;
  } else if (typeof metadata === 'string') {
    // Unparseable jsonb text: never pass it through.
    redacted.metadata = null;
  }
  return redacted as unknown as T;
}

/**
 * MSP principals receive rows unchanged. Client principals receive only
 * client-visible comments, with sensitive metadata redacted.
 * `threads` maps thread_id -> thread visibility (comment_threads.is_internal).
 */
export function projectCommentsForPrincipal<T extends IComment>(
  user: { user_type?: string | null },
  comments: T[],
  threads?: ReadonlyMap<string, CommentThreadVisibility>,
): T[] {
  if (isMspPrincipalUserType(user?.user_type)) {
    return comments;
  }
  return comments
    .filter((comment) =>
      commentVisibleToClient(comment, comment.thread_id ? threads?.get(comment.thread_id) : undefined),
    )
    .map(redactCommentForClient);
}
