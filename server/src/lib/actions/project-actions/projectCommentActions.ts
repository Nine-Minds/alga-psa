'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { IProjectTaskComment, IProjectPhaseComment } from 'server/src/interfaces';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { v4 as uuidv4 } from 'uuid';

/**
 * Get comments for a project task
 */
export async function getTaskComments(taskId: string): Promise<IProjectTaskComment[]> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  // Check permission to read project data
  if (!await hasPermission(user, 'project', 'read', knex)) {
    throw new Error('Permission denied: Cannot read project comments');
  }

  const comments = await knex('project_task_comment')
    .where({
      tenant: user.tenant,
      project_task_id: taskId
    })
    .orderBy('created_at', 'desc');

  return comments;
}

/**
 * Get comments for a project phase
 */
export async function getPhaseComments(phaseId: string): Promise<IProjectPhaseComment[]> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  // Check permission to read project data
  if (!await hasPermission(user, 'project', 'read', knex)) {
    throw new Error('Permission denied: Cannot read project comments');
  }

  const comments = await knex('project_phase_comment')
    .where({
      tenant: user.tenant,
      project_phase_id: phaseId
    })
    .orderBy('created_at', 'desc');

  return comments;
}

/**
 * Add a comment to a project task
 */
export async function addTaskComment(
  taskId: string,
  content: string
): Promise<IProjectTaskComment> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  // Check permission to update project data
  if (!await hasPermission(user, 'project', 'update', knex)) {
    throw new Error('Permission denied: Cannot add project comments');
  }

  const comment: IProjectTaskComment = {
    project_task_comment_id: uuidv4(),
    tenant: user.tenant,
    project_task_id: taskId,
    user_id: user.user_id,
    note: content,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const [insertedComment] = await knex('project_task_comment')
    .insert(comment)
    .returning('*');

  return insertedComment;
}

/**
 * Add a comment to a project phase
 */
export async function addPhaseComment(
  phaseId: string,
  content: string
): Promise<IProjectPhaseComment> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  // Check permission to update project data
  if (!await hasPermission(user, 'project', 'update', knex)) {
    throw new Error('Permission denied: Cannot add project comments');
  }

  const comment: IProjectPhaseComment = {
    project_phase_comment_id: uuidv4(),
    tenant: user.tenant,
    project_phase_id: phaseId,
    user_id: user.user_id,
    note: content,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const [insertedComment] = await knex('project_phase_comment')
    .insert(comment)
    .returning('*');

  return insertedComment;
}

/**
 * Update a task comment
 */
export async function updateTaskComment(
  commentId: string,
  content: string
): Promise<IProjectTaskComment> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  // Check permission to update project data
  if (!await hasPermission(user, 'project', 'update', knex)) {
    throw new Error('Permission denied: Cannot update project comments');
  }

  const updates = {
    note: content,
    updated_at: new Date().toISOString()
  };

  const [updatedComment] = await knex('project_task_comment')
    .where({
      tenant: user.tenant,
      project_task_comment_id: commentId
    })
    .update(updates)
    .returning('*');

  if (!updatedComment) {
    throw new Error('Comment not found');
  }

  return updatedComment;
}

/**
 * Update a phase comment
 */
export async function updatePhaseComment(
  commentId: string,
  content: string
): Promise<IProjectPhaseComment> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  // Check permission to update project data
  if (!await hasPermission(user, 'project', 'update', knex)) {
    throw new Error('Permission denied: Cannot update project comments');
  }

  const updates = {
    note: content,
    updated_at: new Date().toISOString()
  };

  const [updatedComment] = await knex('project_phase_comment')
    .where({
      tenant: user.tenant,
      project_phase_comment_id: commentId
    })
    .update(updates)
    .returning('*');

  if (!updatedComment) {
    throw new Error('Comment not found');
  }

  return updatedComment;
}

/**
 * Delete a task comment
 */
export async function deleteTaskComment(commentId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  // Check permission to update project data (deletion requires update permission)
  if (!await hasPermission(user, 'project', 'update', knex)) {
    throw new Error('Permission denied: Cannot delete project comments');
  }

  const deletedRows = await knex('project_task_comment')
    .where({
      tenant: user.tenant,
      project_task_comment_id: commentId
    })
    .delete();

  if (deletedRows === 0) {
    throw new Error('Comment not found');
  }
}

/**
 * Delete a phase comment
 */
export async function deletePhaseComment(commentId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  // Check permission to update project data (deletion requires update permission)
  if (!await hasPermission(user, 'project', 'update', knex)) {
    throw new Error('Permission denied: Cannot delete project comments');
  }

  const deletedRows = await knex('project_phase_comment')
    .where({
      tenant: user.tenant,
      project_phase_comment_id: commentId
    })
    .delete();

  if (deletedRows === 0) {
    throw new Error('Comment not found');
  }
}

/**
 * Get user map for comments
 */
export async function getCommentUserMap(comments: (IProjectTaskComment | IProjectPhaseComment)[]): Promise<Record<string, any>> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  // Check permission to read project data
  if (!await hasPermission(user, 'project', 'read', knex)) {
    throw new Error('Permission denied: Cannot read user data');
  }

  const userIds = [...new Set(comments.map(c => c.user_id).filter(Boolean))] as string[];

  if (userIds.length === 0) {
    return {};
  }

  const users = await knex('users')
    .whereIn('user_id', userIds)
    .where('tenant', user.tenant)
    .select('user_id', 'username', 'first_name', 'last_name', 'email');

  const userMap: Record<string, any> = {};
  for (const u of users) {
    userMap[u.user_id] = {
      user_id: u.user_id,
      first_name: u.first_name || '',
      last_name: u.last_name || '',
      email: u.email,
      user_type: 'internal',
      avatarUrl: null // You can add avatar URL logic here
    };
  }

  return userMap;
}