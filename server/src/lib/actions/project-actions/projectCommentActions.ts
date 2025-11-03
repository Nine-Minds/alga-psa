'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { IComment } from 'server/src/interfaces';
import { PartialBlock } from '@blocknote/core';
import { getCurrentUser } from '../user-actions/userActions';
import { v4 as uuidv4 } from 'uuid';

/**
 * Get comments for a project task
 */
export async function getTaskComments(taskId: string): Promise<IComment[]> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  const comments = await knex('comments')
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
export async function getPhaseComments(phaseId: string): Promise<IComment[]> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  const comments = await knex('comments')
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
  content: PartialBlock[],
  isInternal: boolean = false,
  isResolution: boolean = false
): Promise<IComment> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  // Convert content to markdown
  const markdown = blocksToMarkdown(content);

  const comment: IComment = {
    comment_id: uuidv4(),
    tenant: user.tenant,
    project_task_id: taskId,
    user_id: user.user_id,
    author_type: 'internal',
    note: markdown,
    markdown_content: JSON.stringify(content),
    is_internal: isInternal,
    is_resolution: isResolution,
    is_initial_description: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const [insertedComment] = await knex('comments')
    .insert(comment)
    .returning('*');

  return insertedComment;
}

/**
 * Add a comment to a project phase
 */
export async function addPhaseComment(
  phaseId: string,
  content: PartialBlock[],
  isInternal: boolean = false,
  isResolution: boolean = false
): Promise<IComment> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  // Convert content to markdown
  const markdown = blocksToMarkdown(content);

  const comment: IComment = {
    comment_id: uuidv4(),
    tenant: user.tenant,
    project_phase_id: phaseId,
    user_id: user.user_id,
    author_type: 'internal',
    note: markdown,
    markdown_content: JSON.stringify(content),
    is_internal: isInternal,
    is_resolution: isResolution,
    is_initial_description: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const [insertedComment] = await knex('comments')
    .insert(comment)
    .returning('*');

  return insertedComment;
}

/**
 * Update a comment
 */
export async function updateProjectComment(
  commentId: string,
  updates: Partial<IComment>
): Promise<IComment> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  // If markdown_content is being updated, also update the note field
  if (updates.markdown_content) {
    const content = JSON.parse(updates.markdown_content as string) as PartialBlock[];
    updates.note = blocksToMarkdown(content);
  }

  updates.updated_at = new Date().toISOString();

  const [updatedComment] = await knex('comments')
    .where({
      tenant: user.tenant,
      comment_id: commentId
    })
    .update(updates)
    .returning('*');

  if (!updatedComment) {
    throw new Error('Comment not found');
  }

  return updatedComment;
}

/**
 * Delete a comment
 */
export async function deleteProjectComment(commentId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  const deletedRows = await knex('comments')
    .where({
      tenant: user.tenant,
      comment_id: commentId
    })
    .delete();

  if (deletedRows === 0) {
    throw new Error('Comment not found');
  }
}

/**
 * Helper function to convert block content to markdown
 */
function blocksToMarkdown(blocks: PartialBlock[]): string {
  // Simple conversion - you may want to enhance this based on your needs
  let markdown = '';

  for (const block of blocks) {
    if (block.type === 'paragraph' && block.content) {
      for (const content of block.content as any[]) {
        if (content.type === 'text') {
          markdown += content.text || '';
        }
      }
      markdown += '\n\n';
    } else if (block.type === 'heading' && block.content) {
      const level = (block.props as any)?.level || 1;
      markdown += '#'.repeat(level) + ' ';
      for (const content of block.content as any[]) {
        if (content.type === 'text') {
          markdown += content.text || '';
        }
      }
      markdown += '\n\n';
    } else if (block.type === 'bulletListItem' && block.content) {
      markdown += '- ';
      for (const content of block.content as any[]) {
        if (content.type === 'text') {
          markdown += content.text || '';
        }
      }
      markdown += '\n';
    } else if (block.type === 'numberedListItem' && block.content) {
      markdown += '1. ';
      for (const content of block.content as any[]) {
        if (content.type === 'text') {
          markdown += content.text || '';
        }
      }
      markdown += '\n';
    }
  }

  return markdown.trim();
}

/**
 * Get user map for comments
 */
export async function getCommentUserMap(comments: IComment[]): Promise<Record<string, any>> {
  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('No authenticated user or tenant found');
  }

  const { knex } = await createTenantKnex();

  const userIds = [...new Set(comments.map(c => c.user_id).filter(Boolean))];

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