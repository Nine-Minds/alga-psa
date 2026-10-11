'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IProjectTaskComment, IProjectTaskCommentWithUser } from '@alga-psa/types';
import {
  countTaskCommentsBatchWithDb,
  countTaskCommentsWithDb,
  createTaskCommentWithDb,
  deleteTaskCommentWithDb,
  listTaskCommentsWithDb,
  updateTaskCommentWithDb,
} from '../lib/taskComments/taskCommentService';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

// The queries, event publishing and ownership rules live in
// ../lib/taskComments/taskCommentService so the REST API shares them; these
// actions only add auth and the web's error mapping.

type ProjectTaskCommentActionError = ActionMessageError | ActionPermissionError;

function projectTaskCommentActionErrorFrom(error: unknown): ProjectTaskCommentActionError | null {
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes('Permission denied')) {
      return permissionError(message);
    }
    if (message === 'Only internal users can comment on tasks') {
      return actionError('Only internal users can comment on tasks.', 'projects:errors.comment.internalOnly');
    }
    if (message === 'Task not found') {
      return actionError('Task not found. It may have been deleted. Please refresh and try again.', 'projects:errors.comment.taskNotFound');
    }
    if (message === 'Parent task comment not found') {
      return actionError('The comment you are replying to was not found. Please refresh and try again.', 'projects:errors.comment.parentNotFound');
    }
    if (message === 'Parent task comment must belong to the same task') {
      return actionError('Replies must stay on the same task thread. Please refresh and try again.', 'projects:errors.comment.sameThreadRequired');
    }
    if (message === 'Cannot reply to a deleted task comment') {
      return actionError('You cannot reply to a deleted comment.', 'projects:errors.comment.parentDeleted');
    }
    if (message === 'Comment not found') {
      return actionError('Comment not found. It may have been deleted. Please refresh and try again.', 'projects:errors.comment.notFound');
    }
    if (message.startsWith('You can only edit') || message.startsWith('You can only delete')) {
      return actionError(message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required comment field: ${dbError.column}.`,
          'projects:errors.comment.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required comment field.', 'projects:errors.comment.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('The selected task or comment no longer exists. Please refresh and try again.', 'projects:errors.comment.referenceMissing');
  }

  return null;
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
    return await createTaskCommentWithDb(db, tenant, user, {
      taskId: comment.taskId,
      note: comment.note,
      parentCommentId: comment.parentCommentId || comment.parent_comment_id || null,
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
    return await listTaskCommentsWithDb(db, tenant, taskId);
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
    return await updateTaskCommentWithDb(db, tenant, user, taskCommentId, updates);
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
    return await deleteTaskCommentWithDb(db, tenant, user, taskCommentId);
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
    return await countTaskCommentsWithDb(db, tenant, taskId);
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
    return await countTaskCommentsBatchWithDb(db, tenant, taskIds);
  } catch (error) {
    const expected = projectTaskCommentActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
