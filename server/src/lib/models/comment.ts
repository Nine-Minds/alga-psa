import { createTenantKnex } from '../db';
import { IComment } from '../../interfaces/comment.interface';
import logger from '@shared/core/logger';

const Comment = {
  getAllbyTicketId: async (ticket_id: string): Promise<IComment[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const comments = await db<IComment>('comments')
        .select('comments.*')
        .where('comments.ticket_id', ticket_id)
        .andWhere('comments.tenant', tenant!)
        .orderBy('comments.created_at', 'asc');
      return comments;
    } catch (error) {
      console.error('Error getting all comments:', error);
      throw error;
    }
  },

  get: async (id: string): Promise<IComment | undefined> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const comment = await db<IComment>('comments')
        .select('comments.*')
        .where('comments.comment_id', id)
        .andWhere('comments.tenant', tenant!)
        .first();
      return comment;
    } catch (error) {
      console.error(`Error getting comment with id ${id}:`, error);
      throw error;
    }
  },

  insert: async (comment: Omit<IComment, 'tenant'>): Promise<string> => {
    try {      
      logger.info('Inserting comment:', comment);
      const {knex: db, tenant} = await createTenantKnex();
      
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
        const user = await db('users')
          .select('user_type')
          .where('user_id', comment.user_id)
          .andWhere('tenant', tenant!)
          .first();

        if (user) {
          // Ensure author_type matches user_type
          comment.author_type = user.user_type === 'internal' ? 'internal' : 'client';
        }
      }

      const result = await db<IComment>('comments')
        .insert({
          ...comment,
          tenant: tenant!,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
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

  update: async (id: string, comment: Partial<IComment>): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();

      // Get existing comment first
      const existingComment = await db<IComment>('comments')
        .select('*')
        .where('comment_id', id)
        .andWhere('tenant', tenant!)
        .first();

      if (!existingComment) {
        throw new Error(`Comment with id ${id} not found`);
      }

      // If user_id is being updated, verify user exists and get their type
      if (comment.user_id) {
        const user = await db('users')
          .select('user_type')
          .where('user_id', comment.user_id)
          .andWhere('tenant', tenant!)
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

      await db<IComment>('comments')
        .where('comment_id', id)
        .andWhere('tenant', tenant!)
        .update({
          ...comment,
          updated_at: new Date().toISOString()
        });
    } catch (error) {
      console.error(`Error updating comment with id ${id}:`, error);
      throw error;
    }
  },

  delete: async (id: string): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      await db<IComment>('comments')
        .where('comment_id', id)
        .andWhere('tenant', tenant!)
        .del();
    } catch (error) {
      console.error(`Error deleting comment with id ${id}:`, error);
      throw error;
    }
  },
};

export default Comment;
