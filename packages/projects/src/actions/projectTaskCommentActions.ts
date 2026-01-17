'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import { convertBlockNoteToMarkdown } from 'server/src/lib/utils/blocknoteUtils';
import { publishEvent } from 'server/src/lib/eventBus/publishers';
import type { IProjectTaskComment, IProjectTaskCommentWithUser } from '@alga-psa/types';
import { getEntityImageUrlsBatch } from 'server/src/lib/utils/avatarUtils';
import { Knex } from 'knex';

/**
 * Create a new task comment
 */
export async function createTaskComment(
  comment: Omit<IProjectTaskComment, 'taskCommentId' | 'tenant' | 'createdAt' | 'authorType' | 'markdownContent' | 'userId'>
): Promise<string> {
  const { knex: db, tenant } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const userId = currentUser.user_id;

    // Verify user is internal
    const user = await trx('users')
      .where({ user_id: userId, tenant })
      .first();

    if (!user || user.user_type !== 'internal') {
      throw new Error('Only internal users can comment on tasks');
    }

    // Convert BlockNote to markdown
    const markdownContent = convertBlockNoteToMarkdown(comment.note);

    // Insert comment (convert camelCase to snake_case for DB)
    const [newComment] = await trx('project_task_comments')
      .insert({
        task_id: comment.taskId,
        user_id: userId,
        tenant,
        author_type: 'internal',
        note: comment.note,
        markdown_content: markdownContent,
        created_at: new Date().toISOString()
      })
      .returning('*');

    // Get project context for notifications
    const task = await trx('project_tasks')
      .join('project_phases', function() {
        this.on('project_tasks.phase_id', 'project_phases.phase_id')
          .andOn('project_tasks.tenant', 'project_phases.tenant');
      })
      .where('project_tasks.task_id', comment.taskId)
      .where('project_tasks.tenant', tenant)
      .select('project_phases.project_id', 'project_tasks.task_name')
      .first();

    if (!task) {
      throw new Error('Task not found');
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
        taskName: task.task_name,
        commentContent: comment.note,  // BlockNote JSON with embedded mentions
        isUpdate: false  // Flag to indicate this is a new comment, not an update
      }
    });

    return newComment.task_comment_id;
  });
}

/**
 * Get all comments for a task
 */
export async function getTaskComments(
  taskId: string
): Promise<IProjectTaskCommentWithUser[]> {
  const { knex: db, tenant } = await createTenantKnex();

  const comments = await db('project_task_comments')
    .where({ 'project_task_comments.task_id': taskId, 'project_task_comments.tenant': tenant })
    .leftJoin('users', function() {
      this.on('project_task_comments.user_id', 'users.user_id')
        .andOn('project_task_comments.tenant', 'users.tenant');
    })
    .select(
      'project_task_comments.*',
      'users.first_name',
      'users.last_name',
      'users.email'
    )
    .orderBy('project_task_comments.created_at', 'asc');

  // Get avatar URLs for all users
  const userIds = [...new Set(comments.map((c: any) => c.user_id).filter(Boolean))];
  const avatarUrls = tenant ? await getEntityImageUrlsBatch('user', userIds, tenant) : new Map<string, string | null>();

  // Map snake_case to camelCase
  return comments.map((comment: any) => ({
    taskCommentId: comment.task_comment_id,
    taskId: comment.task_id,
    userId: comment.user_id,
    authorType: comment.author_type,
    note: comment.note,
    markdownContent: comment.markdown_content,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    editedAt: comment.edited_at,
    tenant: comment.tenant,
    firstName: comment.first_name,
    lastName: comment.last_name,
    email: comment.email,
    avatarUrl: avatarUrls.get(comment.user_id) || null,
  }));
}

/**
 * Update a task comment
 */
export async function updateTaskComment(
  taskCommentId: string,
  updates: Partial<Pick<IProjectTaskComment, 'note'>>
): Promise<void> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('User not authenticated');
  }

  const userId = currentUser.user_id;

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const existingComment = await trx('project_task_comments')
      .where({ task_comment_id: taskCommentId, tenant })
      .first();

    if (!existingComment) {
      throw new Error('Comment not found');
    }

    // Permission check: own comment OR internal user
    if (existingComment.user_id !== userId) {
      const user = await trx('users')
        .where({ user_id: userId, tenant })
        .first();

      if (!user || user.user_type !== 'internal') {
        throw new Error('You can only edit your own comments');
      }
    }

    // Convert updated note to markdown
    const markdownContent = convertBlockNoteToMarkdown(updates.note);

    await trx('project_task_comments')
      .where({ task_comment_id: taskCommentId, tenant })
      .update({
        note: updates.note,
        markdown_content: markdownContent,
        edited_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    // Get task and project context for notifications
    const task = await trx('project_tasks')
      .join('project_phases', function() {
        this.on('project_tasks.phase_id', 'project_phases.phase_id')
          .andOn('project_tasks.tenant', 'project_phases.tenant');
      })
      .where('project_tasks.task_id', existingComment.task_id)
      .where('project_tasks.tenant', tenant)
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
  });
}

/**
 * Delete a task comment
 */
export async function deleteTaskComment(
  taskCommentId: string
): Promise<void> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('User not authenticated');
  }

  const userId = currentUser.user_id;

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const existingComment = await trx('project_task_comments')
      .where({ task_comment_id: taskCommentId, tenant })
      .first();

    if (!existingComment) {
      throw new Error('Comment not found');
    }

    // Permission check: own comment OR internal user
    if (existingComment.user_id !== userId) {
      const user = await trx('users')
        .where({ user_id: userId, tenant })
        .first();

      if (!user || user.user_type !== 'internal') {
        throw new Error('You can only delete your own comments');
      }
    }

    // Hard delete
    await trx('project_task_comments')
      .where({ task_comment_id: taskCommentId, tenant })
      .del();
  });
}

/**
 * Get comment count for a task
 */
export async function getTaskCommentCount(taskId: string): Promise<number> {
  const { knex: db, tenant } = await createTenantKnex();

  const result = await db('project_task_comments')
    .where({ task_id: taskId, tenant })
    .count('* as count')
    .first();

  return parseInt(result?.count as string) || 0;
}
