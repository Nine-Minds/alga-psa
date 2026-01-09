import { getCurrentTenantId } from '../db';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { IComment } from '../../interfaces/comment.interface';
import logger from '@alga-psa/shared/core/logger';

const Comment = {
  getAllbyTicketId: async (knexOrTrx: Knex | Knex.Transaction, ticket_id: string): Promise<IComment[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for getting comments by ticket ID');
      }
      const comments = await knexOrTrx<IComment>('comments')
        .select('comments.*')
        .where('comments.ticket_id', ticket_id)
        .andWhere('comments.tenant', tenant)
        .orderBy('comments.created_at', 'asc');
      return comments;
    } catch (error) {
      console.error('Error getting all comments:', error);
      throw error;
    }
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<IComment | undefined> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for getting comment');
      }
      const comment = await knexOrTrx<IComment>('comments')
        .select('comments.*')
        .where('comments.comment_id', id)
        .andWhere('comments.tenant', tenant)
        .first();
      return comment;
    } catch (error) {
      console.error(`Error getting comment with id ${id}:`, error);
      throw error;
    }
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, comment: Omit<IComment, 'tenant'>): Promise<string> => {
    try {      
      logger.info('Inserting comment:', comment);
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for inserting comment');
      }
      
      // Ensure author_type is valid
      if (!['internal', 'client', 'unknown'].includes(comment.author_type)) {
        throw new Error(`Invalid author_type: ${comment.author_type}`);
      }

      // Validate user_id is present for non-unknown authors
      if (comment.author_type !== 'unknown' && !comment.user_id) {
        throw new Error('user_id is required for internal and client authors');
      }

      // First verify user exists and get their type
      if (comment.user_id) {
        const user = await knexOrTrx('users')
          .select('user_type')
          .where('user_id', comment.user_id)
          .andWhere('tenant', tenant)
          .first();

        if (user) {
          // Ensure author_type matches user_type
          comment.author_type = user.user_type === 'internal' ? 'internal' : 'client';
        }
      }

      // Explicitly include markdown_content in the insert operation
      const result = await knexOrTrx<IComment>('comments')
        .insert({
          ...comment,
          tenant: tenant,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_system_generated: Boolean((comment as any).is_system_generated),
          markdown_content: comment.markdown_content || "[No markdown content]" // Explicitly include this field
        })
        .returning('comment_id');

      if (!result[0] || !result[0].comment_id) {
        throw new Error('Failed to get comment_id from inserted record');
      }

      return result[0].comment_id;
    } catch (error) {
      logger.error('Error inserting comment:', error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, id: string, comment: Partial<IComment>): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for updating comment');
      }

      // Get existing comment first
      const existingComment = await knexOrTrx<IComment>('comments')
        .select('*')
        .where('comment_id', id)
        .andWhere('tenant', tenant)
        .first();

      if (!existingComment) {
        throw new Error(`Comment with id ${id} not found`);
      }

      // If user_id is being updated, verify user exists and get their type
      if (comment.user_id) {
        const user = await knexOrTrx('users')
          .select('user_type')
          .where('user_id', comment.user_id)
          .andWhere('tenant', tenant)
          .first();

        if (user) {
          // Ensure author_type matches user_type
          comment.author_type = user.user_type === 'internal' ? 'internal' : 'client';
        } else {
          comment.author_type = 'unknown';
        }
      }

      // If author_type is being updated, validate it
      if (comment.author_type) {
        if (!['internal', 'client', 'unknown'].includes(comment.author_type)) {
          throw new Error(`Invalid author_type: ${comment.author_type}`);
        }

        // Validate user_id is present for non-unknown authors
        if (comment.author_type !== 'unknown' && !comment.user_id && !existingComment.user_id) {
          throw new Error('user_id is required for internal and client authors');
        }
      }

      // Explicitly include markdown_content in the update operation if it exists in the comment object
      const updateData = {
        ...comment,
        updated_at: new Date().toISOString()
      };

      // Log the update data for debugging
      logger.info('Updating comment with data:', {
        ...updateData,
        note: updateData.note ? `${updateData.note.substring(0, 50)}...` : undefined,
        markdown_content_length: updateData.markdown_content ? updateData.markdown_content.length : 0
      });

      await knexOrTrx<IComment>('comments')
        .where('comment_id', id)
        .andWhere('tenant', tenant)
        .update(updateData);
    } catch (error) {
      console.error(`Error updating comment with id ${id}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for deleting comment');
      }
      await knexOrTrx<IComment>('comments')
        .where('comment_id', id)
        .andWhere('tenant', tenant)
        .del();
    } catch (error) {
      console.error(`Error deleting comment with id ${id}:`, error);
      throw error;
    }
  },
};

export default Comment;
