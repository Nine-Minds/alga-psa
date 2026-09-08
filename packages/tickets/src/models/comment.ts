import type { Knex } from 'knex';
import type { IComment } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, withCoManagedOperationalTransaction } from '@alga-psa/licensing';
import { assertCommentThreadAudience, type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import logger from '@alga-psa/core/logger';
import { attachNativeRootToConversation, legacyTicketConversationSql } from '@alga-psa/shared/lib/tickets/namedConversations';

function tenantScopedTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(table);
}

/** Internal command context, never part of a browser-supplied comment DTO. */
export interface CommentCollaborationContext {
  /** Authorized named destination, supplied only by the command adapter. */
  conversationId?: string;
  ticketId: string;
  actorTenant: string;
  actorUserId: string;
  actorReferenceId?: string;
  audience: CommentAudience;
  assertWriteAuthority: (trx: Knex.Transaction) => Promise<void>;
}
export interface CommentCollaborationMutationContext extends CommentCollaborationContext {
  commentId: string; threadId: string; updatedAt: string;
}
async function collaborationAttribution(trx: Knex.Transaction, tenant: string, comment: Omit<IComment, 'tenant'>,
  context: CommentCollaborationContext) {
  if (!trx.isTransaction || comment.ticket_id !== context.ticketId || !['requester', 'shared_it', 'organization_private'].includes(context.audience) ||
      comment.author_type !== 'internal' || comment.contact_id != null || Boolean(comment.is_internal) !== (context.audience !== 'requester') ||
      comment.is_resolution || (comment as any).is_system_generated || (comment.publish_state != null && comment.publish_state !== 'published') ||
      comment.scheduled_publish_at || comment.metadata != null) throw new Error('Invalid collaboration comment context');
  await context.assertWriteAuthority(trx);
  if (context.actorTenant === tenant) {
    if (context.actorReferenceId || comment.user_id !== context.actorUserId) throw new Error('Invalid local collaboration author');
    const user = await tenantScopedTable(trx, 'users', tenant).where({ user_id: context.actorUserId, user_type: 'internal', is_inactive: false }).forShare().first('user_id');
    if (!user) throw new Error('Invalid local collaboration author');
    return {};
  }
  if (context.audience === 'organization_private' || comment.user_id != null || !context.actorReferenceId) throw new Error('Invalid foreign collaboration author');
  const reference = await tenantScopedTable<{ actor_reference_id: string; actor_tenant: string; actor_user_id: string; display_name: string; organization_name: string }>(trx, 'collaboration_actor_references', tenant)
    .where({ actor_reference_id: context.actorReferenceId, actor_tenant: context.actorTenant, actor_user_id: context.actorUserId }).forShare().first();
  if (!reference) throw new Error('Invalid foreign collaboration author');
  return { actor_reference_id: reference.actor_reference_id, actor_display_name: reference.display_name, actor_organization_name: reference.organization_name };
}

const Comment = {
  getAllbyTicketId: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, ticket_id: string): Promise<IComment[]> => {
    try {
      const comments = await tenantScopedTable<IComment>(knexOrTrx, 'comments', tenant)
        .select('comments.*')
        .where('comments.ticket_id', ticket_id)
        .whereRaw(legacyTicketConversationSql(knexOrTrx, tenant))
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

  insert: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, input: Omit<IComment, 'tenant'>, inputCollaboration?: CommentCollaborationContext): Promise<string> => {
    const collaboration = inputCollaboration ? { ...inputCollaboration } : undefined;
    const comment = collaboration ? { ...input } : input;
    if (collaboration && !knexOrTrx.isTransaction) throw new Error('Collaboration comments require the owning transaction');
    return withCoManagedOperationalTransaction(knexOrTrx, tenant, async trx => {
      try {
        for (const field of ['actor_reference_id', 'actor_display_name', 'actor_organization_name']) {
          if ((comment as any)[field] != null) throw new Error('Qualified comment authors require a collaboration command');
        }

        const attribution = collaboration ? await collaborationAttribution(trx, tenant, comment, collaboration) : {};

        // Ensure author_type is valid
        if (!['internal', 'client', 'unknown'].includes(comment.author_type)) {
          throw new Error(`Invalid author_type: ${comment.author_type}`);
        }

        // Validate user_id is present for non-unknown authors
        if (comment.author_type !== 'unknown' && !comment.user_id && !collaboration) {
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
            ...(collaboration ? { collaboration_audience: collaboration.audience } : {}),
            reply_count: 0,
            last_activity_at: now,
            created_at: now,
            created_by: comment.user_id || null,
          });
        }

        if (!commentId || !threadId) {
          throw new Error('Failed to generate comment/thread identifiers');
        }

        const audience = await assertCommentThreadAudience(trx, tenant, threadId, { ticketId: comment.ticket_id, isInternal: Boolean(comment.is_internal), parentCommentId });
        if (collaboration && audience !== collaboration.audience) throw new Error('Collaboration reply audience changed');
        if (collaboration) await collaboration.assertWriteAuthority(trx);

        await assertCoManagedOperationalWrite(trx, tenant);
        // Explicitly include markdown_content in the insert operation
        const result = await tenantScopedTable<IComment>(trx, 'comments', tenant)
          .insert({
            ...comment,
            ...attribution,
            comment_id: commentId,
            thread_id: threadId,
            parent_comment_id: parentCommentId,
            tenant: tenant,
            created_at: now,
            updated_at: now,
            is_internal: Boolean(comment.is_internal),
            is_resolution: Boolean(comment.is_resolution),
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

        await attachNativeRootToConversation({ trx, ticket: { tenant, ticketId: comment.ticket_id }, storeTenant: tenant },
          threadId, collaboration?.conversationId);
        return inserted.comment_id as string;
      } catch (error) {
        logger.error('Error inserting comment:', error);
        throw error;
      }
    });
  },

  /** Qualified command adapter: immutable author/thread/audience and retained
   * tombstones keep replies and historical attribution resolvable after delete. */
  mutateCollaboration: async (knexOrTrx: Knex | Knex.Transaction, tenant: string,
    input: { kind: 'edit'; note: string; markdown_content: string } | { kind: 'delete' }, inputContext: CommentCollaborationMutationContext): Promise<void> => {
    const context = { ...inputContext }, mutation = { ...input };
    if (!knexOrTrx.isTransaction || !['edit', 'delete'].includes(mutation.kind) ||
        Object.keys(mutation).some(key => !(mutation.kind === 'edit' ? ['kind', 'note', 'markdown_content'] : ['kind']).includes(key)) ||
        !Number.isFinite(Date.parse(context.updatedAt))) throw new Error('Invalid collaboration mutation context');
    return withCoManagedOperationalTransaction(knexOrTrx, tenant, async trx => {
      const audience = await assertCommentThreadAudience(trx, tenant, context.threadId, { ticketId: context.ticketId });
      const existing = await tenantScopedTable<IComment>(trx, 'comments', tenant).where({ comment_id: context.commentId,
        thread_id: context.threadId, ticket_id: context.ticketId }).forUpdate().first();
      if (!existing || existing.deleted_at || existing.publish_state !== 'published' || audience !== context.audience || existing.is_system_generated ||
          (existing.actor_reference_id ?? undefined) !== context.actorReferenceId) throw new Error('Invalid collaboration mutation target');
      await collaborationAttribution(trx, tenant, { ticket_id: existing.ticket_id, user_id: existing.user_id, contact_id: existing.contact_id,
        author_type: existing.author_type, is_internal: existing.is_internal, publish_state: existing.publish_state } as Omit<IComment, 'tenant'>, context);
      if (mutation.kind === 'edit' && (typeof mutation.note !== 'string' || typeof mutation.markdown_content !== 'string')) throw new Error('Invalid collaboration text');
      await context.assertWriteAuthority(trx);
      await tenantScopedTable(trx, 'comments', tenant).where('comment_id', context.commentId).update({ updated_at: context.updatedAt,
        ...(mutation.kind === 'edit' ? { note: mutation.note, markdown_content: mutation.markdown_content }
          : { note: '[deleted]', markdown_content: '[deleted]', deleted_at: context.updatedAt }) });
      await tenantScopedTable(trx, 'comment_threads', tenant).where('thread_id', context.threadId).update({ last_activity_at: context.updatedAt });
      await context.assertWriteAuthority(trx);
    });
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, id: string, comment: Partial<IComment>): Promise<void> => {
    return withCoManagedOperationalTransaction(knexOrTrx, tenant, async trx => {
      try {
        // Get existing comment first
        const existingComment = await tenantScopedTable<IComment>(trx, 'comments', tenant)
          .select('*')
          .where('comment_id', id)
          .first();

        if (!existingComment) {
          throw new Error(`Comment with id ${id} not found`);
        }

        if ((existingComment as any).actor_reference_id || ['actor_reference_id', 'actor_display_name', 'actor_organization_name'].some(field => (comment as any)[field] != null)) {
          throw new Error('Qualified comment authors require a collaboration command');
        }
        if ((comment.tenant !== undefined && comment.tenant !== tenant) || (comment.comment_id !== undefined && comment.comment_id !== id)) throw new Error('Comment ownership cannot be edited');
        if ((comment.thread_id !== undefined && comment.thread_id !== existingComment.thread_id) ||
            (comment.parent_comment_id !== undefined && comment.parent_comment_id !== existingComment.parent_comment_id)) throw new Error('Comment thread ownership cannot be edited');
        await assertCommentThreadAudience(trx, tenant, existingComment.thread_id!, { ticketId: comment.ticket_id ?? existingComment.ticket_id, isInternal: comment.is_internal });

        await tenantScopedTable(trx, 'comments', tenant).where('comment_id', id).forUpdate().first();
        await assertCoManagedOperationalWrite(trx, tenant);

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
      } catch (error) {
        console.error(`Error updating comment with id ${id}:`, error);
        throw error;
      }
    });
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, id: string): Promise<void> => {
    return withCoManagedOperationalTransaction(knexOrTrx, tenant, async trx => {
      try {
        const existingComment = await tenantScopedTable<IComment>(trx, 'comments', tenant)
          .select('comment_id', 'parent_comment_id', 'thread_id', 'actor_reference_id' as any)
          .where('comment_id', id)
          .first();

        if (!existingComment) {
          return;
        }

        if ((existingComment as any).actor_reference_id) throw new Error('Qualified comment authors require a collaboration command');
        await assertCommentThreadAudience(trx, tenant, existingComment.thread_id!, {});

        await tenantScopedTable(trx, 'comments', tenant).where('comment_id', id).forUpdate().first();
        await assertCoManagedOperationalWrite(trx, tenant);

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
    });
  },
};

export default Comment;
