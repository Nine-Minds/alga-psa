import type { Knex } from 'knex';
import type { IComment } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';

function tenantScopedTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(table);
}

const Comment = {
  getAllbyTicketId: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, ticket_id: string): Promise<IComment[]> => {
    try {
      const comments = await tenantScopedTable<IComment>(knexOrTrx, 'comments', tenant)
        .select('comments.*')
        .where('comments.ticket_id', ticket_id)
        .orderBy('comments.created_at', 'asc');
      return comments;
    } catch (error) {
      console.error('Error getting all comments:', error);
      throw error;
    }
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, id: string): Promise<IComment | undefined> => {
    try {
      const comment = await tenantScopedTable<IComment>(knexOrTrx, 'comments', tenant)
        .select('comments.*')
        .where('comments.comment_id', id)
        .first();
      return comment;
    } catch (error) {
      console.error(`Error getting comment with id ${id}:`, error);
      throw error;
    }
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, comment: Omit<IComment, 'tenant'>): Promise<string> => {
    try {
      logger.info('Inserting comment:', comment);

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
        const user = await tenantScopedTable(knexOrTrx, 'users', tenant)
          .select('user_type')
          .where('user_id', comment.user_id)
          .first();

        if (user) {
          // Ensure author_type matches user_type
          comment.author_type = user.user_type === 'internal' ? 'internal' : 'client';
        }
      }

      if (!comment.ticket_id) {
        throw new Error('ticket_id is required for comments');
      }

      const now = new Date().toISOString();
      const parentCommentId = comment.parent_comment_id || null;
      const isReply = Boolean(parentCommentId);
      let commentId = comment.comment_id;
      let threadId = comment.thread_id;

      if (isReply) {
        const parent = await tenantDb(knexOrTrx, tenant)
          .tenantJoin(
            tenantScopedTable(knexOrTrx, 'comments as parent', tenant),
            'comment_threads as thread',
            'parent.thread_id',
            'thread.thread_id'
          )
          .select(
            'parent.comment_id',
            'parent.ticket_id',
            'parent.thread_id',
            'parent.deleted_at',
            'thread.is_internal as thread_is_internal'
          )
          .where('parent.comment_id', parentCommentId)
          .first();

        if (!parent) {
          throw new Error('Parent comment not found');
        }

        if (parent.ticket_id !== comment.ticket_id) {
          throw new Error('Parent comment must belong to the same ticket');
        }

        if (parent.deleted_at) {
          throw new Error('Cannot reply to a deleted comment');
        }

        const threadIsInternal = Boolean(parent.thread_is_internal);
        if (comment.is_internal == null) {
          comment.is_internal = threadIsInternal;
        } else if (Boolean(comment.is_internal) !== threadIsInternal) {
          throw new Error('Reply visibility must match the thread root visibility');
        }

        const idsResult = await knexOrTrx.raw('SELECT gen_random_uuid() AS comment_id');
        commentId = commentId || idsResult.rows?.[0]?.comment_id;
        threadId = parent.thread_id;
      } else {
        const idsResult = await knexOrTrx.raw('SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id');
        const generatedIds = idsResult.rows?.[0];
        commentId = commentId || generatedIds?.comment_id;
        threadId = threadId || generatedIds?.thread_id;

        await tenantScopedTable(knexOrTrx, 'comment_threads', tenant).insert({
          tenant,
          thread_id: threadId,
          ticket_id: comment.ticket_id,
          project_task_id: null,
          root_comment_id: commentId,
          is_internal: Boolean(comment.is_internal),
          reply_count: 0,
          last_activity_at: now,
          created_at: now,
          created_by: comment.user_id || null,
        });
      }

      if (!commentId || !threadId) {
        throw new Error('Failed to generate comment/thread identifiers');
      }

      // Explicitly include markdown_content in the insert operation
      const result = await tenantScopedTable<IComment>(knexOrTrx, 'comments', tenant)
        .insert({
          ...comment,
          comment_id: commentId,
          thread_id: threadId,
          parent_comment_id: parentCommentId,
          tenant: tenant,
          created_at: now,
          updated_at: now,
          is_system_generated: Boolean((comment as any).is_system_generated),
          markdown_content: comment.markdown_content || '[No markdown content]',
        })
        .returning('comment_id');

      const inserted = result[0] as any;
      if (!inserted || !inserted.comment_id) {
        throw new Error('Failed to get comment_id from inserted record');
      }

      if (isReply) {
        await tenantScopedTable(knexOrTrx, 'comment_threads', tenant)
          .where({ thread_id: threadId })
          .update({
            reply_count: knexOrTrx.raw('reply_count + 1'),
            last_activity_at: now,
          });
      }

      return inserted.comment_id as string;
    } catch (error) {
      logger.error('Error inserting comment:', error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, id: string, comment: Partial<IComment>): Promise<void> => {
    try {
      // Get existing comment first
      const existingComment = await tenantScopedTable<IComment>(knexOrTrx, 'comments', tenant)
        .select('*')
        .where('comment_id', id)
        .first();

      if (!existingComment) {
        throw new Error(`Comment with id ${id} not found`);
      }

      // If user_id is being updated, verify user exists and get their type
      if (comment.user_id) {
        const user = await tenantScopedTable(knexOrTrx, 'users', tenant)
          .select('user_type')
          .where('user_id', comment.user_id)
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
        updated_at: new Date().toISOString(),
      };

      logger.info('Updating comment with data:', {
        ...updateData,
        note: updateData.note ? `${updateData.note.substring(0, 50)}...` : undefined,
        markdown_content_length: updateData.markdown_content ? updateData.markdown_content.length : 0,
      });

      await tenantScopedTable<IComment>(knexOrTrx, 'comments', tenant)
        .where('comment_id', id)
        .update(updateData);
    } catch (error) {
      console.error(`Error updating comment with id ${id}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, id: string): Promise<void> => {
    try {
      const existingComment = await tenantScopedTable<IComment>(knexOrTrx, 'comments', tenant)
        .select('comment_id', 'parent_comment_id', 'thread_id')
        .where('comment_id', id)
        .first();

      if (!existingComment) {
        return;
      }

      const child = await tenantScopedTable<IComment>(knexOrTrx, 'comments', tenant)
        .select('comment_id')
        .where('parent_comment_id', id)
        .first();

      if (child) {
        const now = new Date().toISOString();
        await tenantScopedTable<IComment>(knexOrTrx, 'comments', tenant)
          .where('comment_id', id)
          .update({
            note: '[deleted]',
            markdown_content: '[deleted]',
            deleted_at: now,
            updated_at: now,
          });
        return;
      }

      await tenantScopedTable<IComment>(knexOrTrx, 'comments', tenant)
        .where('comment_id', id)
        .del();

      if (existingComment.parent_comment_id) {
        await tenantScopedTable(knexOrTrx, 'comment_threads', tenant)
          .where({ thread_id: existingComment.thread_id })
          .update({
            reply_count: knexOrTrx.raw('GREATEST(reply_count - 1, 0)'),
          });
      } else {
        await tenantScopedTable(knexOrTrx, 'comment_threads', tenant)
          .where({ thread_id: existingComment.thread_id })
          .del();
      }
    } catch (error) {
      console.error(`Error deleting comment with id ${id}:`, error);
      throw error;
    }
  },
};

export default Comment;
