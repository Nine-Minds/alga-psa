'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { convertBlockNoteToMarkdown } from '@alga-psa/formatting/blocknoteUtils';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import type { IProjectTaskComment, IProjectTaskCommentWithUser } from '@alga-psa/types';
import { getEntityImageUrlsBatch } from '@alga-psa/formatting/avatarUtils';
import { Knex } from 'knex';
import {
  BuiltinAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
} from '@alga-psa/authorization/kernel';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type ProjectTaskCommentActionError = ActionMessageError | ActionPermissionError;

function projectTaskCommentActionErrorFrom(error: unknown): ProjectTaskCommentActionError | null {
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes('Permission denied')) {
      return permissionError(message);
    }
    if (message === 'Only internal users can comment on tasks') {
      return actionError('Only internal users can comment on tasks.');
    }
    if (message === 'Task not found') {
      return actionError('Task not found. It may have been deleted. Please refresh and try again.');
    }
    if (message === 'Parent task comment not found') {
      return actionError('The comment you are replying to was not found. Please refresh and try again.');
    }
    if (message === 'Parent task comment must belong to the same task') {
      return actionError('Replies must stay on the same task thread. Please refresh and try again.');
    }
    if (message === 'Cannot reply to a deleted task comment') {
      return actionError('You cannot reply to a deleted comment.');
    }
    if (message === 'Comment not found') {
      return actionError('Comment not found. It may have been deleted. Please refresh and try again.');
    }
    if (message.startsWith('You can only edit') || message.startsWith('You can only delete')) {
      return actionError(message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '23502') {
    return actionError(`Missing required comment field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected task or comment no longer exists. Please refresh and try again.');
  }

  return null;
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function buildCommentAuthorizationSubject(user: { user_id: string; user_type: 'internal' | 'client' }, tenant: string) {
  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds: [],
    teamIds: [],
    managedUserIds: [],
    portfolioClientIds: [],
    clientId: null,
  };
}

async function assertOwnCommentOrInternalUser(
  trx: Knex.Transaction,
  user: { user_id: string; user_type: 'internal' | 'client' },
  tenant: string,
  taskCommentId: string,
  ownerUserId: string,
  action: 'update' | 'delete'
): Promise<void> {
  if (user.user_type === 'internal') {
    return;
  }

  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({
      relationshipRules: [{ template: 'own' }],
    }),
    rbacEvaluator: async () => true,
  });

  const decision = await kernel.authorizeResource({
    subject: buildCommentAuthorizationSubject(user, tenant),
    resource: {
      type: 'project_task_comment',
      action,
      id: taskCommentId,
    },
    record: {
      id: taskCommentId,
      ownerUserId,
    },
    requestCache: new RequestLocalAuthorizationCache(),
    knex: trx,
  });

  if (!decision.allowed) {
    const verb = action === 'update' ? 'edit' : 'delete';
    throw new Error(`You can only ${verb} your own comments`);
  }
}

/**
 * Create a new task comment
 */
export const createTaskComment = withAuth(async (
  user,
  { tenant },
  comment: Omit<IProjectTaskComment, 'taskCommentId' | 'tenant' | 'createdAt' | 'authorType' | 'markdownContent' | 'userId'> & {
    parent_comment_id?: string | null;
  }
): Promise<string | ProjectTaskCommentActionError> => {
  try {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const userId = user.user_id;

    // Verify user is internal
    const userRecord = await tenantScopedTable(trx, 'users', tenant)
      .where({ user_id: userId })
      .first();

    if (!userRecord || userRecord.user_type !== 'internal') {
      throw new Error('Only internal users can comment on tasks');
    }

    // Convert BlockNote to markdown
    const markdownContent = convertBlockNoteToMarkdown(comment.note);

    // Get project context for notifications and validate task before inserting thread/comment rows
    const taskQuery = tenantScopedTable(trx, 'project_tasks', tenant);
    tenantDb(trx, tenant).tenantJoin(taskQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
    const task = await taskQuery
      .where('project_tasks.task_id', comment.taskId)
      .select('project_phases.project_id', 'project_tasks.task_name')
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    const now = new Date().toISOString();
    const parentCommentId = comment.parentCommentId || comment.parent_comment_id || null;
    const isReply = Boolean(parentCommentId);
    let taskCommentId: string | undefined;
    let threadId: string | undefined;

    if (isReply) {
      const parent = await tenantScopedTable(trx, 'project_task_comments', tenant)
        .select('task_comment_id', 'task_id', 'thread_id', 'deleted_at')
        .where({ task_comment_id: parentCommentId })
        .first();

      if (!parent) {
        throw new Error('Parent task comment not found');
      }

      if (parent.task_id !== comment.taskId) {
        throw new Error('Parent task comment must belong to the same task');
      }

      if (parent.deleted_at) {
        throw new Error('Cannot reply to a deleted task comment');
      }

      const idsResult = await trx.raw('SELECT gen_random_uuid() AS task_comment_id');
      taskCommentId = idsResult.rows?.[0]?.task_comment_id;
      threadId = parent.thread_id;
    } else {
      const idsResult = await trx.raw('SELECT gen_random_uuid() AS task_comment_id, gen_random_uuid() AS thread_id');
      const generatedIds = idsResult.rows?.[0];
      taskCommentId = generatedIds?.task_comment_id;
      threadId = generatedIds?.thread_id;

      await tenantScopedTable(trx, 'comment_threads', tenant).insert({
        tenant,
        thread_id: threadId,
        ticket_id: null,
        project_task_id: comment.taskId,
        root_comment_id: taskCommentId,
        is_internal: false,
        reply_count: 0,
        last_activity_at: now,
        created_at: now,
        created_by: userId,
      });
    }

    if (!taskCommentId || !threadId) {
      throw new Error('Database UUID generation did not return task comment/thread identifiers.');
    }

    // Insert comment (convert camelCase to snake_case for DB)
    const [newComment] = await tenantScopedTable(trx, 'project_task_comments', tenant)
      .insert({
        task_comment_id: taskCommentId,
        task_id: comment.taskId,
        thread_id: threadId,
        parent_comment_id: parentCommentId,
        user_id: userId,
        tenant,
        author_type: 'internal',
        note: comment.note,
        markdown_content: markdownContent,
        created_at: now
      })
      .returning('*');

    if (isReply) {
      await tenantScopedTable(trx, 'comment_threads', tenant)
        .where({ thread_id: threadId })
        .update({
          reply_count: trx.raw('reply_count + 1'),
          last_activity_at: now,
        });
    }

    // Publish event (mention extraction happens in event handler)
    await publishEvent({
      eventType: 'TASK_COMMENT_ADDED',
      payload: {
        tenantId: tenant,
        taskId: comment.taskId,
        projectId: task.project_id,
        userId,
        taskCommentId: newComment.task_comment_id,
        threadId,
        parentCommentId,
        isReply,
        thread_id: threadId,
        parent_comment_id: parentCommentId,
        is_reply: isReply,
        taskName: task.task_name,
        commentContent: comment.note,  // BlockNote JSON with embedded mentions
        isUpdate: false  // Flag to indicate this is a new comment, not an update
      }
    });

    await publishEvent({
      eventType: 'PROJECT_TASK_COMMENT_CREATED',
      payload: {
        tenantId: tenant,
        taskId: comment.taskId,
        projectId: task.project_id,
        userId,
        taskCommentId: newComment.task_comment_id,
        taskName: task.task_name,
        commentContent: comment.note,
        isUpdate: false
      }
    });

    return newComment.task_comment_id;
  });
  } catch (error) {
    const expected = projectTaskCommentActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Get all comments for a task
 */
export const getTaskComments = withAuth(async (
  _user,
  { tenant },
  taskId: string
): Promise<IProjectTaskCommentWithUser[] | ProjectTaskCommentActionError> => {
  try {
  const { knex: db } = await createTenantKnex();

  const commentsQuery = tenantScopedTable(db, 'project_task_comments', tenant);
  tenantDb(db, tenant).tenantJoin(commentsQuery, 'users', 'project_task_comments.user_id', 'users.user_id', { type: 'left' });
  const comments = await commentsQuery
    .where({ 'project_task_comments.task_id': taskId })
    .select(
      'project_task_comments.*',
      'users.first_name',
      'users.last_name',
      'users.email'
    )
    .orderBy('project_task_comments.created_at', 'asc') as any[];

  // Get avatar URLs for all users
  const userIds: string[] = [
    ...new Set(
      comments
        .map((c: any) => c.user_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ];
  const avatarUrls = tenant ? await getEntityImageUrlsBatch('user', userIds, tenant) : new Map<string, string | null>();

  // Map snake_case to camelCase
  return comments.map((comment: any) => ({
    taskCommentId: comment.task_comment_id,
    taskId: comment.task_id,
    threadId: comment.thread_id,
    parentCommentId: comment.parent_comment_id,
    userId: comment.user_id,
    authorType: comment.author_type,
    note: comment.note,
    markdownContent: comment.markdown_content,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    editedAt: comment.edited_at,
    deletedAt: comment.deleted_at,
    tenant: comment.tenant,
    firstName: comment.first_name,
    lastName: comment.last_name,
    email: comment.email,
    avatarUrl: avatarUrls.get(comment.user_id) || null,
  }));
  } catch (error) {
    const expected = projectTaskCommentActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Update a task comment
 */
export const updateTaskComment = withAuth(async (
  user,
  { tenant },
  taskCommentId: string,
  updates: Partial<Pick<IProjectTaskComment, 'note'>>
): Promise<void | ProjectTaskCommentActionError> => {
  try {
  const { knex: db } = await createTenantKnex();
  const userId = user.user_id;

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const existingComment = await tenantScopedTable(trx, 'project_task_comments', tenant)
      .where({ task_comment_id: taskCommentId })
      .first();

    if (!existingComment) {
      throw new Error('Comment not found');
    }

    await assertOwnCommentOrInternalUser(trx, user, tenant, taskCommentId, existingComment.user_id, 'update');

    // Convert updated note to markdown
    const markdownContent = convertBlockNoteToMarkdown(updates.note);

    await tenantScopedTable(trx, 'project_task_comments', tenant)
      .where({ task_comment_id: taskCommentId })
      .update({
        note: updates.note,
        markdown_content: markdownContent,
        edited_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    // Get task and project context for notifications
    const taskQuery = tenantScopedTable(trx, 'project_tasks', tenant);
    tenantDb(trx, tenant).tenantJoin(taskQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
    const task = await taskQuery
      .where('project_tasks.task_id', existingComment.task_id)
      .select('project_phases.project_id', 'project_tasks.task_name')
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Publish event for smart mention notifications
    // Event handler will compare old vs new mentions and only notify NEW ones
    await publishEvent({
      eventType: 'TASK_COMMENT_UPDATED',
      payload: {
        tenantId: tenant,
        taskId: existingComment.task_id,
        projectId: task.project_id,
        userId,
        taskCommentId: taskCommentId,
        taskName: task.task_name,
        oldCommentContent: existingComment.note,  // Old BlockNote JSON
        newCommentContent: updates.note,          // New BlockNote JSON
        isUpdate: true  // Flag to indicate this is an update
      }
    });

    await publishEvent({
      eventType: 'PROJECT_TASK_COMMENT_UPDATED',
      payload: {
        tenantId: tenant,
        taskId: existingComment.task_id,
        projectId: task.project_id,
        userId,
        taskCommentId: taskCommentId,
        taskName: task.task_name,
        oldCommentContent: existingComment.note,
        newCommentContent: updates.note,
        isUpdate: true
      }
    });
  });
  } catch (error) {
    const expected = projectTaskCommentActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Delete a task comment
 */
export const deleteTaskComment = withAuth(async (
  user,
  { tenant },
  taskCommentId: string
): Promise<void | ProjectTaskCommentActionError> => {
  try {
  const { knex: db } = await createTenantKnex();
  const userId = user.user_id;

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const existingComment = await tenantScopedTable(trx, 'project_task_comments', tenant)
      .where({ task_comment_id: taskCommentId })
      .first();

    if (!existingComment) {
      throw new Error('Comment not found');
    }

    await assertOwnCommentOrInternalUser(trx, user, tenant, taskCommentId, existingComment.user_id, 'delete');

    const taskQuery = tenantScopedTable(trx, 'project_tasks', tenant);
    tenantDb(trx, tenant).tenantJoin(taskQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
    const task = await taskQuery
      .where('project_tasks.task_id', existingComment.task_id)
      .select('project_phases.project_id', 'project_tasks.task_name')
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // If the comment still has replies, soft-delete it so the thread structure survives
    const child = await tenantScopedTable(trx, 'project_task_comments', tenant)
      .select('task_comment_id')
      .where({ parent_comment_id: taskCommentId })
      .first();

    if (child) {
      const now = new Date().toISOString();
      await tenantScopedTable(trx, 'project_task_comments', tenant)
        .where({ task_comment_id: taskCommentId })
        .update({
          note: '[deleted]',
          markdown_content: '[deleted]',
          deleted_at: now,
          updated_at: now,
        });

      await publishEvent({
        eventType: 'PROJECT_TASK_COMMENT_DELETED',
        payload: {
          tenantId: tenant,
          taskId: existingComment.task_id,
          projectId: task.project_id,
          userId,
          taskCommentId,
          taskName: task.task_name,
          timestamp: new Date().toISOString(),
        }
      });
      return;
    }

    // Delete reactions before hard-deleting the comment (CitusDB doesn't support ON DELETE CASCADE)
    await tenantScopedTable(trx, 'project_task_comment_reactions', tenant)
      .where({ task_comment_id: taskCommentId })
      .del();

    await tenantScopedTable(trx, 'project_task_comments', tenant)
      .where({ task_comment_id: taskCommentId })
      .del();

    if (existingComment.parent_comment_id) {
      await tenantScopedTable(trx, 'comment_threads', tenant)
        .where({ thread_id: existingComment.thread_id })
        .update({
          reply_count: trx.raw('GREATEST(reply_count - 1, 0)'),
        });
    } else {
      await tenantScopedTable(trx, 'comment_threads', tenant)
        .where({ thread_id: existingComment.thread_id })
        .del();
    }

    await publishEvent({
      eventType: 'PROJECT_TASK_COMMENT_DELETED',
      payload: {
        tenantId: tenant,
        taskId: existingComment.task_id,
        projectId: task.project_id,
        userId,
        taskCommentId,
        taskName: task.task_name,
        timestamp: new Date().toISOString(),
      }
    });
  });
  } catch (error) {
    const expected = projectTaskCommentActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Get comment count for a task
 */
export const getTaskCommentCount = withAuth(async (
  user,
  { tenant },
  taskId: string
): Promise<number | ProjectTaskCommentActionError> => {
  try {
  if (!await hasPermission(user, 'project_task', 'read')) {
    throw new Error('Permission denied: cannot read task comments');
  }

  const { knex: db } = await createTenantKnex();

  const result = await tenantScopedTable(db, 'project_task_comments', tenant)
    .where({ task_id: taskId })
    .count('* as count')
    .first();

  return parseInt(result?.count as string) || 0;
  } catch (error) {
    const expected = projectTaskCommentActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Get comment counts for multiple tasks in a single query
 */
export const getTaskCommentCountsBatch = withAuth(async (
  user,
  { tenant },
  taskIds: string[]
): Promise<Record<string, number> | ProjectTaskCommentActionError> => {
  try {
  if (taskIds.length === 0) return {};

  if (!await hasPermission(user, 'project_task', 'read')) {
    throw new Error('Permission denied: cannot read task comments');
  }

  const { knex: db } = await createTenantKnex();

  const results = await tenantScopedTable(db, 'project_task_comments', tenant)
    .whereIn('task_id', taskIds)
    .groupBy('task_id')
    .select('task_id')
    .count('* as count');

  const counts: Record<string, number> = {};
  for (const row of results) {
    counts[row.task_id as string] = parseInt(row.count as string) || 0;
  }
  return counts;
  } catch (error) {
    const expected = projectTaskCommentActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
