/**
 * Co-managed layer over the native task-comment service (L4c).
 *
 * Inactive unless the workspace is a co-managed customer AND the `co-managed` capability is served:
 * `resolveTaskCommentCollaboration` returns null before issuing a statement for every other tenant, so the
 * native path is exactly what it was. When active, native comments are organization-private conversation
 * notes: replies stay in an organization-private thread, edits and deletes are revision-checked, and a
 * delete leaves a tombstone so replies keep their parent.
 *
 * The admission it relies on (`admitCoManagedNativeTaskCommentAccess`) is keyset-bounded and has no id-count
 * cap; nothing here introduces one (T0 §4 #18).
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { serves } from '@alga-psa/core/capability';
import { getApiKeyUserOverride, getSession } from '@alga-psa/auth';
import {
  taskCommentFieldPolicy,
  type TaskCommentFieldPolicy,
} from '@alga-psa/types';
import type { CoManagedNativeTaskCommentAccess } from '@alga-psa/co-managed';
import { projectTaskAudience } from '@alga-psa/co-managed/projectTaskAudience';

export type TaskCommentCollaboration = CoManagedNativeTaskCommentAccess;

/** A co-managed fault is indistinguishable from a missing record, so ids cannot be probed. */
export const COLLABORATION_DENIED = 'Comment not found';

/** True only for an active co-managed customer workspace; costs no statement for any other tenant. */
export async function collaborationActive(db: Knex, tenant: string): Promise<boolean> {
  if (!(await serves('co-managed', tenant)).served) return false;
  const { isCoManagedWorkspace } = await import('@alga-psa/co-managed/coManagedWorkspace');
  return isCoManagedWorkspace(db, tenant);
}

/**
 * Returns the admitted collaboration context, or null when the workspace is not an active co-managed
 * customer. Throws (as not-found) for a co-managed workspace caller that has no tracked internal session:
 * API-key and impersonation contexts are never accepted as a browser session.
 */
export async function resolveTaskCommentCollaboration(
  db: Knex,
  trx: Knex.Transaction,
  tenant: string,
  user: { user_id: string; user_type?: string },
  taskIds: readonly string[],
  action: 'read' | 'update',
): Promise<TaskCommentCollaboration | null> {
  if (!(await collaborationActive(db, tenant))) return null;
  const session = await getSession();
  if (getApiKeyUserOverride() || !session?.session_id || session.user?.tenant !== tenant || session.user?.id !== user.user_id
    || session.user?.user_type !== 'internal') {
    throw new Error(COLLABORATION_DENIED);
  }
  const { admitCoManagedNativeTaskCommentAccess } = await import('@alga-psa/co-managed/nativeTaskCommentAccess');
  try {
    return await admitCoManagedNativeTaskCommentAccess(
      trx, { kind: 'session', tenant, userId: user.user_id, sessionId: session.session_id }, { taskIds }, action);
  } catch {
    throw new Error(COLLABORATION_DENIED);
  }
}

/** The single policy every emitting surface hands to `redactTaskComment`. */
export function collaborationFieldPolicy(collaboration: TaskCommentCollaboration, taskId: string): TaskCommentFieldPolicy {
  return taskCommentFieldPolicy(fields => collaboration.hidden(taskId, fields));
}

/**
 * Native composers describe organization-private notes. Anything else (a requester or shared-IT thread, a
 * collaborator- or contact-authored row, a stale revision) requires the qualified conversation surface.
 */
export async function assertNativeTaskNote(
  trx: Knex.Transaction,
  tenant: string,
  comment: { task_id: string; thread_id: string | null; user_id?: string | null; actor_reference_id?: string | null;
    author_kind?: string | null; deleted_at?: string | Date | null; collaboration_revision?: number | null },
  collaboration: TaskCommentCollaboration | null | undefined,
  options: { ownUserId?: string; reply?: boolean; expectedRevision?: number } = {},
): Promise<void> {
  if (!collaboration) return;
  const deny = (): never => { throw new Error(COLLABORATION_DENIED); };
  if (!comment.thread_id || comment.actor_reference_id || (comment.author_kind && comment.author_kind !== 'user')) deny();
  const owner = tenantDb(trx, tenant);
  const thread = await owner.table('comment_threads as thread')
    .where({ 'thread.thread_id': comment.thread_id, 'thread.project_task_id': comment.task_id }).whereNull('thread.ticket_id')
    .forUpdate().first('thread.thread_id', 'thread.root_comment_id', 'thread.collaboration_audience', 'thread.is_internal');
  if (!thread || projectTaskAudience(thread) !== 'organization_private') deny();
  if (options.ownUserId && comment.user_id !== options.ownUserId) deny();
  const root = await owner.table('project_task_comments')
    .where({ task_comment_id: thread.root_comment_id, task_id: comment.task_id, thread_id: thread.thread_id }).forShare().first('deleted_at');
  if (!root || (options.reply && (root.deleted_at || comment.deleted_at))) deny();
  if (options.ownUserId) {
    if (comment.deleted_at) deny();
    if (!Number.isInteger(options.expectedRevision) || options.expectedRevision !== (comment.collaboration_revision ?? 1)
      || collaboration.hidden(comment.task_id, ['revision'])) {
      throw new Error('Task comment was changed by someone else. Refresh and try again.');
    }
  }
}
