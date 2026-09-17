import { reconcileCommentAttachments, withdrawCommentAttachments } from '@shared/lib/ticketCommentAttachments';
import type { Knex } from 'knex';
import type { IComment } from '@alga-psa/types';
import { tenantDb, withTransaction } from '@alga-psa/db';
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

  /** Owns a transaction when given a plain connection: attachment claims take row locks with the insert. */
  insert: (knexOrTrx: Knex | Knex.Transaction, tenant: string, comment: Omit<IComment, 'tenant'>): Promise<string> => withTransaction(knexOrTrx, async (trx) => {
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
        const user = await tenantScopedTable(trx, 'users', tenant)
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
        const parent = await tenantDb(trx, tenant)
          .tenantJoin(
            tenantScopedTable(trx, 'comments as parent', tenant),
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

        const idsResult = await trx.raw('SELECT gen_random_uuid() AS comment_id');
        commentId = commentId || idsResult.rows?.[0]?.comment_id;
        threadId = parent.thread_id;
      } else {
        const idsResult = await trx.raw('SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id');
        const generatedIds = idsResult.rows?.[0];
        commentId = commentId || generatedIds?.comment_id;
        threadId = threadId || generatedIds?.thread_id;

        await tenantScopedTable(trx, 'comment_threads', tenant).insert({
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
      const result = await tenantScopedTable<IComment>(trx, 'comments', tenant)
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
        await tenantScopedTable(trx, 'comment_threads', tenant)
          .where({ thread_id: threadId })
          .update({
            reply_count: trx.raw('reply_count + 1'),
            last_activity_at: now,
          });
      }

      await reconcileCommentAttachments(trx, tenant, inserted.comment_id, comment.user_id!);
      return inserted.comment_id as string;
    } catch (error) {
      logger.error('Error inserting comment:', error);
      throw error;
    }
  }),

  update: (knexOrTrx: Knex | Knex.Transaction, tenant: string, id: string, comment: Partial<IComment>, actorId?: string): Promise<void> => withTransaction(knexOrTrx, async (trx) => {
    try {
      // Get existing comment first
      const existingComment = await tenantScopedTable<IComment>(trx, 'comments', tenant)
        .select('*')
        .where('comment_id', id)
        .first();

      if (!existingComment) {
        throw new Error(`Comment with id ${id} not found`);
      }

      // If user_id is being updated, verify user exists and get their type
      if (comment.user_id) {
        const user = await tenantScopedTable(trx, 'users', tenant)
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

      await tenantScopedTable<IComment>(trx, 'comments', tenant)
        .where('comment_id', id)
        .update(updateData);
      if (comment.note !== undefined) await reconcileCommentAttachments(trx, tenant, id, actorId || existingComment.user_id!);
    } catch (error) {
      console.error(`Error updating comment with id ${id}:`, error);
      throw error;
    }
  }),

  delete: (knexOrTrx: Knex | Knex.Transaction, tenant: string, id: string): Promise<void> => withTransaction(knexOrTrx, async (trx) => {
    try {
      const existingComment = await tenantScopedTable<IComment>(trx, 'comments', tenant)
        .select('comment_id', 'parent_comment_id', 'thread_id')
        .where('comment_id', id)
        .first();

      if (!existingComment) {
        return;
      }

      await withdrawCommentAttachments(trx, tenant, id);

      const child = await tenantScopedTable<IComment>(trx, 'comments', tenant)
        .select('comment_id')
        .where('parent_comment_id', id)
        .first();

      if (child) {
        const now = new Date().toISOString();
        await tenantScopedTable<IComment>(trx, 'comments', tenant)
          .where('comment_id', id)
          .update({
            note: '[deleted]',
            markdown_content: '[deleted]',
            deleted_at: now,
            updated_at: now,
          });
        return;
      }

      await tenantScopedTable<IComment>(trx, 'comments', tenant)
        .where('comment_id', id)
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
    } catch (error) {
      console.error(`Error deleting comment with id ${id}:`, error);
      throw error;
    }
  }),
};

export default Comment;
