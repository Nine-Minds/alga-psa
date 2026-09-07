import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { assertCoManagedOperationalWrite, getCoManagedOperationalState } from '@alga-psa/licensing';
import { admitCoManagedNativeTaskCommentAccess, CoManagedSharedWorkError, isCoManagedUuid, projectTaskAudienceSql,
  type CoManagedNativeTaskCommentAccess } from '@alga-psa/co-managed';
import { hasCoManagedConversationOwnership } from '@alga-psa/co-managed/nativeConversationEvents';

interface TaskCommentAccess {
  trx: Knex.Transaction;
  collaboration: CoManagedNativeTaskCommentAccess | null;
}
/** One retained transaction covers comment bodies, counts, and reaction batches.
 * API impersonation context is never accepted as a co-managed browser session. */
export async function withTaskCommentAccess<T>(db: Knex, user: any, tenant: string,
  input: { taskIds: string[] } | { commentIds: string[] }, action: 'read' | 'update', work: (access: TaskCommentAccess) => Promise<T>): Promise<T> {
  const values = 'taskIds' in input ? input.taskIds : input.commentIds;
  if (!Array.isArray(values) || values.length > 1000 || !values.every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const ids = [...new Set(values.map(id => id.toLowerCase()))].sort(), byTask = 'taskIds' in input;
  return withTransaction(db, async trx => {
    if (action === 'update') await assertCoManagedOperationalWrite(trx, tenant); else await getCoManagedOperationalState(trx, tenant);
    const owner = tenantDb(trx, tenant);
    if (user.user_type !== 'internal' || !await owner.table('users').where({ user_id: user.user_id, user_type: 'internal', is_inactive: false }).forShare().first('user_id')) throw new Error('Only internal users can comment on tasks');
    let collaboration: CoManagedNativeTaskCommentAccess | null = null;
    if (await hasCoManagedConversationOwnership(trx, tenant)) {
      // LEVERAGE: pattern co-managed-browser-identity — browser adapters reject overrides and bind the tracked home session.
      const session = await getSession();
      if (getApiKeyUserOverride() || !session?.session_id || session.user?.tenant !== tenant || session.user?.id !== user.user_id || session.user?.user_type !== 'internal') throw new CoManagedSharedWorkError();
      const comments = byTask ? [] : await owner.table('project_task_comments').whereIn('task_comment_id', ids).select('task_comment_id', 'task_id');
      if (!byTask && comments.length !== ids.length) throw new CoManagedSharedWorkError();
      collaboration = await admitCoManagedNativeTaskCommentAccess(trx, { kind: 'session', tenant, userId: user.user_id, sessionId: session.session_id }, byTask ? ids : comments.map(row => row.task_id), action);
      if (!byTask) {
        const confirmed = owner.table('project_task_comments').whereIn('task_comment_id', ids).orderBy('task_comment_id');
        if (action === 'update') confirmed.forUpdate(); else confirmed.forShare();
        const rows = await confirmed.select('task_comment_id', 'task_id');
        if (rows.length !== ids.length || rows.some(row => comments.find(comment => comment.task_comment_id === row.task_comment_id)?.task_id !== row.task_id)) throw new CoManagedSharedWorkError();
      }
    } else if (!await hasPermission(user, 'project_task', action)) throw new Error('Permission denied: cannot access task comments');
    const result = await work({ trx, collaboration });
    await collaboration?.assertCurrent();
    return result;
  });
}

/** Legacy composers describe internal notes. Explicitly shared contributions
 * require the qualified conversation surface and its explicit audience,
 * revision, author and delivery contract. */
export async function assertNativeTaskNote(trx: Knex.Transaction, tenant: string, comment: any,
  collaboration: CoManagedNativeTaskCommentAccess | null, options: { ownUserId?: string; reply?: boolean; expectedRevision?: number } = {}) {
  if (!collaboration) return;
  const owner = tenantDb(trx, tenant);
  const thread = await owner.table('comment_threads as thread').where({ thread_id: comment.thread_id, project_task_id: comment.task_id }).whereNull('ticket_id')
    .forUpdate().select('thread.*', { audience: projectTaskAudienceSql(trx, 'thread') }).first();
  if (!thread || thread.audience !== 'organization_private' || comment.actor_reference_id || (options.ownUserId && comment.user_id !== options.ownUserId)) throw new CoManagedSharedWorkError();
  const root = await owner.table('project_task_comments').where({ task_comment_id: thread.root_comment_id, task_id: comment.task_id, thread_id: thread.thread_id }).forShare().first('deleted_at');
  if (!root || (options.reply && (root.deleted_at || comment.deleted_at))) throw new CoManagedSharedWorkError();
  if (options.ownUserId && (!Number.isInteger(options.expectedRevision) || options.expectedRevision !== comment.collaboration_revision || collaboration.hidden(comment.task_id, ['revision', 'collaboration_revision']))) throw new CoManagedSharedWorkError();
}
