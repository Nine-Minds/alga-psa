'use server'

import Comment from 'server/src/lib/models/comment';
import { IComment } from 'server/src/interfaces/comment.interface';
import { findUserById } from 'server/src/lib/actions/user-actions/userActions';
import { createTenantKnex } from 'server/src/lib/db';

export async function findCommentsByTicketId(ticketId: string) {
  try {
    const comments = await Comment.getAllbyTicketId(ticketId);
    return comments;
  } catch (error) {
    console.error(error);
    throw new Error(`Failed to find comments for ticket id: ${ticketId}`);
  }
}

export async function findCommentById(ticketId: string) {
  try {
    const comments = await Comment.get(ticketId);
    return comments;
  } catch (error) {
    console.error(error);
    throw new Error(`Failed to find comments for ticket id: ${ticketId}`);
  }
}

export async function createComment(comment: Omit<IComment, 'tenant'>): Promise<string> {
  try {
    // First, check if there are any existing comments for this ticket
    const existingComments = await Comment.getAllbyTicketId(comment.ticket_id || '');

    // If this is the first comment, set is_initial_description to true
    if (existingComments.length === 0) {
      comment.is_initial_description = true;
    }

    // Get user's type to set author_type
    if (comment.user_id) {
      const { knex: db, tenant } = await createTenantKnex();
      const user = await db('users')
        .select('user_type')
        .where('user_id', comment.user_id)
        .andWhere('tenant', tenant!)
        .first();

      if (user) {
        comment.author_type = user.user_type === 'internal' ? 'internal' : 'client';
      } else {
        comment.author_type = 'unknown';
      }
    } else {
      comment.author_type = 'unknown';
    }

    // Only allow internal comments from internal users
    if (comment.is_internal && comment.author_type !== 'internal') {
      throw new Error('Only internal users can create internal comments');
    }

    // Now insert the comment
    const commentId = await Comment.insert(comment);
    return commentId;
  } catch (error) {
    console.error(`Failed to create comment:`, error);
    throw new Error(`Failed to create comment`);
  }
}

export async function updateComment(id: string, comment: Partial<IComment>) {
  console.log(`[updateComment] Starting update for comment ID: ${id}`, { commentData: comment });
  try {
    console.log(`[updateComment] Fetching existing comment with ID: ${id}`);
    const existingComment = await Comment.get(id);
    if (!existingComment) {
      console.error(`[updateComment] Comment with ID ${id} not found`);
      throw new Error(`Comment with id ${id} not found`);
    }
    console.log(`[updateComment] Found existing comment:`, existingComment);

    // If user_id is being updated, get user's type
    if (comment.user_id) {
      const { knex: db, tenant } = await createTenantKnex();
      const user = await db('users')
        .select('user_type')
        .where('user_id', comment.user_id)
        .andWhere('tenant', tenant!)
        .first();

      if (user) {
        comment.author_type = user.user_type === 'internal' ? 'internal' : 'client';
      } else {
        comment.author_type = 'unknown';
      }
    }

    // Validate internal comment permissions
    if (comment.is_internal !== undefined) {
      // Only allow internal comments from internal users
      if (comment.is_internal && comment.author_type !== 'internal' && existingComment.author_type !== 'internal') {
        throw new Error('Only internal users can set comments as internal');
      }
      // If a client user is updating a comment, ensure they can't make it internal
      if (existingComment.author_type === 'client') {
        comment.is_internal = existingComment.is_internal; // Preserve internal status
      }
    }

    console.log(`[updateComment] Proceeding with update`, { finalUpdateData: comment });
    await Comment.update(id, comment);
    console.log(`[updateComment] Successfully updated comment with ID: ${id}`);
  } catch (error) {
    console.error(`[updateComment] Failed to update comment with ID ${id}:`, error);
    console.error(`[updateComment] Stack trace:`, error instanceof Error ? error.stack : 'No stack trace available');
    throw new Error(`Failed to update comment with id ${id}`);
  }
}

export async function deleteComment(id: string) {
  try {
    await Comment.delete(id);
  } catch (error) {
    console.error(`Failed to delete comment with id ${id}:`, error);
    throw new Error(`Failed to delete comment with id ${id}`);
  }
}
