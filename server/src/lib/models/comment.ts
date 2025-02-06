import { createTenantKnex } from '../db';
import { IComment } from '../../interfaces/comment.interface';
import logger from '../../utils/logger';

const Comment = {
  getAllbyTicketId: async (ticket_id: string): Promise<IComment[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const comments = await db<IComment>('comments')
        .select('*')
        .where('ticket_id', ticket_id)
        .andWhere('tenant', tenant!)
        .orderBy('created_at', 'asc'); // Order comments by creation time
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
        .select('*')
        .where('comment_id', id)
        .andWhere('tenant', tenant!)
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
      if (!['user', 'contact', 'unknown'].includes(comment.author_type)) {
        throw new Error(`Invalid author_type: ${comment.author_type}`);
      }

      // Validate author type and ID combination
      if (comment.author_type === 'user' && !comment.user_id) {
        throw new Error('user_id is required when author_type is "user"');
      }
      if (comment.author_type === 'contact' && !comment.contact_id) {
        throw new Error('contact_id is required when author_type is "contact"');
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
      const {knex: db} = await createTenantKnex();

      // If author_type is being updated, validate it
      if (comment.author_type) {
        if (!['user', 'contact', 'unknown'].includes(comment.author_type)) {
          throw new Error(`Invalid author_type: ${comment.author_type}`);
        }

        // Get existing comment to validate ID requirements
        const existingComment = await Comment.get(id);
        if (!existingComment) {
          throw new Error(`Comment with id ${id} not found`);
        }

        // Validate author type and ID combination
        if (comment.author_type === 'user' && !comment.user_id && !existingComment.user_id) {
          throw new Error('user_id is required when author_type is "user"');
        }
        if (comment.author_type === 'contact' && !comment.contact_id && !existingComment.contact_id) {
          throw new Error('contact_id is required when author_type is "contact"');
        }
      }

      const { tenant } = await createTenantKnex();
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
