import { reconcileCommentAttachments, withdrawCommentAttachments } from '@shared/lib/ticketCommentAttachments';
import type { Knex } from 'knex';
import type { IComment } from '@alga-psa/types';
import { tenantDb, withTransaction } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { isInteractiveUserType, isMspPrincipalUserType } from '@alga-psa/types';
import { HumanWorkOwnerRequiredError } from '@alga-psa/shared/lib/humanWork/HumanWorkOwnerRequiredError';

function tenantScopedTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(table);
}

const QUALIFIED_AUTHOR_FIELDS = ['actor_reference_id', 'actor_display_name', 'actor_organization_name'] as const;

/** Native writers never name a foreign author; only an admitted collaboration command may. */
function assertNoQualifiedAuthorFields(comment: object): void {
  if (QUALIFIED_AUTHOR_FIELDS.some(field => (comment as Record<string, unknown>)[field] != null)) {
    throw new Error('Qualified comment authors require a collaboration command');
  }
}

/** Internal command context, never part of a browser-supplied comment DTO. */
export interface CommentCollaborationContext {
  ticketId: string;
  /** Tenant of the acting user: the owner (a local author) or the co-managing MSP (a foreign author). */
  actorTenant: string;
  actorUserId: string;
  /** Required exactly when actorTenant is not the comment's owning tenant. */
  actorReferenceId?: string;
  /** Rechecks session/deadline/policy inside the transaction. */
  assertWriteAuthority: (trx: Knex.Transaction) => Promise<void>;
}

/**
 * The attribution columns for a collaboration comment: none for an owner-local
 * author, the saved reference snapshot for a foreign one. A foreign author never
 * occupies a local user_id, and its identity is read from the owner-local
 * collaboration_actor_references row, not from the command.
 */
async function collaborationAttribution(trx: Knex.Transaction, tenant: string, comment: Omit<IComment, 'tenant'>,
  context: CommentCollaborationContext) {
  if (!trx.isTransaction || comment.ticket_id !== context.ticketId || comment.author_type !== 'internal' || comment.contact_id != null ||
      comment.is_resolution || (comment as any).is_system_generated) throw new Error('Invalid collaboration comment context');
  await context.assertWriteAuthority(trx);
  if (context.actorTenant === tenant) {
    if (context.actorReferenceId || comment.user_id !== context.actorUserId) throw new Error('Invalid local collaboration author');
    const user = await tenantScopedTable(trx, 'users', tenant).where({ user_id: context.actorUserId, user_type: 'internal', is_inactive: false }).forShare().first('user_id');
    if (!user) throw new Error('Invalid local collaboration author');
    return {};
  }
  if (comment.user_id != null || !context.actorReferenceId) throw new Error('Invalid foreign collaboration author');
  const reference = await tenantScopedTable<{ actor_reference_id: string; actor_tenant: string; actor_user_id: string; display_name: string; organization_name: string }>(trx, 'collaboration_actor_references', tenant)
    .where({ actor_reference_id: context.actorReferenceId, actor_tenant: context.actorTenant, actor_user_id: context.actorUserId }).forShare().first();
  if (!reference) throw new Error('Invalid foreign collaboration author');
  return { actor_reference_id: reference.actor_reference_id, actor_display_name: reference.display_name, actor_organization_name: reference.organization_name };
}

const Comment = {
  getAllbyTicketId: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, ticket_id: string): Promise<IComment[]> => {
    try {
      // Read-time bundle provenance lives here, in the shared read layer, so
      // every MSP path that lists a ticket's comments — the initial
      // consolidated load and every refresh (remote update, post add/edit/
      // delete) — returns the same shape. A comment is a mirror when
      // ticket_bundle_mirrors points at it; the mirror's source comment
      // carries the master ticket so the chip can name and link it. All joins
      // are tenant-co-located via tenantJoin.
      const commentsQuery = tenantScopedTable<IComment>(knexOrTrx, 'comments', tenant).select(
        'comments.*',
        'bm.source_comment_id as bundle_mirror_source_comment_id',
        'mt.ticket_id as bundle_source_ticket_id',
        'mt.ticket_number as bundle_source_ticket_number'
      );
      const scopedConn = tenantDb(knexOrTrx, tenant);
      scopedConn.tenantJoin(commentsQuery, 'ticket_bundle_mirrors as bm', 'comments.comment_id', 'bm.child_comment_id', { type: 'left' });
      scopedConn.tenantJoin(commentsQuery, 'comments as src', 'bm.source_comment_id', 'src.comment_id', { type: 'left', rootTenantColumn: 'comments.tenant' });
      scopedConn.tenantJoin(commentsQuery, 'tickets as mt', 'src.ticket_id', 'mt.ticket_id', { type: 'left', rootTenantColumn: 'comments.tenant' });

      const comments = await commentsQuery
        .where('comments.ticket_id', ticket_id)
        .orderBy('comments.created_at', 'asc');

      return (comments as Array<Record<string, unknown>>).map((comment) => {
        const sourceCommentId = comment.bundle_mirror_source_comment_id as string | null | undefined;
        const masterTicketId = (comment.bundle_source_ticket_id as string | null) ?? null;
        const masterTicketNumber = (comment.bundle_source_ticket_number as string | null) ?? null;
        delete comment.bundle_mirror_source_comment_id;
        delete comment.bundle_source_ticket_id;
        delete comment.bundle_source_ticket_number;
        comment.bundle_mirror_source = sourceCommentId
          ? {
              source_comment_id: sourceCommentId,
              master_ticket_id: masterTicketId,
              master_ticket_number: masterTicketNumber,
            }
          : null;
        return comment as unknown as IComment;
      });
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
  insert: (knexOrTrx: Knex | Knex.Transaction, tenant: string, comment: Omit<IComment, 'tenant'>, collaboration?: CommentCollaborationContext): Promise<string> => withTransaction(knexOrTrx, async (trx) => {
    try {
      logger.info('Inserting comment:', comment);

      assertNoQualifiedAuthorFields(comment);
      if (collaboration && !knexOrTrx.isTransaction) throw new Error('Collaboration comments require the owning transaction');
      // Resolved only for a collaboration command; a native insert runs no extra query.
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
        const user = await tenantScopedTable<{ user_type: string | null }>(trx, 'users', tenant)
          .select('user_type')
          .where('user_id', comment.user_id)
          .first();

        if (user) {
          // Ensure author_type matches user_type. The comments.author_type enum is
          // internal|client|unknown: a non-interactive (service) user is MSP-side, so it is
          // stored as 'internal' and distinguished at read time via users.user_type.
          comment.author_type = isMspPrincipalUserType(user.user_type) ? 'internal' : 'client';

          // CE rule (R5.9): a non-interactive author can only write internal comments.
          // Unspecified visibility defaults to internal; an explicit public comment is refused
          // before anything is stored (a licensed human via act-as is required for that).
          if (!isInteractiveUserType(user.user_type)) {
            if (comment.is_internal === false) {
              throw new HumanWorkOwnerRequiredError('is_internal');
            }
            if (comment.is_internal == null) {
              comment.is_internal = true;
            }
          }
        }
      }

      if (!comment.ticket_id) {
        throw new Error('ticket_id is required for comments');
      }

      const now = new Date().toISOString();
      let parentCommentId = comment.parent_comment_id || null;
      let isReply = Boolean(parentCommentId);
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
        if (threadIsInternal && comment.author_type === 'client') {
          // D1 (alga-2026-0002798): a client author can never create an internal
          // comment, and a public comment cannot live in an internal thread. Store
          // a top-level public comment in a fresh public thread instead of
          // inheriting (or rejecting on) the internal thread's visibility.
          // LEVERAGE: pattern non-internal-author-visibility-guard — duplicated in shared/models/ticketModel.ts (createComment); extract a shared visibility resolver.
          comment.is_internal = false;
          parentCommentId = null;
          isReply = false;
          threadId = undefined; // never reuse the internal thread id
        } else {
          if (comment.is_internal == null) {
            comment.is_internal = threadIsInternal;
          } else if (Boolean(comment.is_internal) !== threadIsInternal) {
            throw new Error('Reply visibility must match the thread root visibility');
          }
          threadId = parent.thread_id;
        }
      }

      if (isReply) {
        const idsResult = await trx.raw('SELECT gen_random_uuid() AS comment_id');
        commentId = commentId || idsResult.rows?.[0]?.comment_id;
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
          ...attribution,
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

      await reconcileCommentAttachments(trx, tenant, inserted.comment_id, comment.user_id ?? collaboration?.actorUserId!);
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
        .select('comment_id', 'parent_comment_id', 'thread_id', 'user_id')
        .where('comment_id', id)
        .first();

      if (!existingComment) {
        throw new Error(`Comment with id ${id} not found`);
      }

      // No foreign-authored comment exists in L2 (no comments.actor_reference_id column; see L4a), so no author-column read here.
      assertNoQualifiedAuthorFields(comment);

      // If user_id is being updated, verify user exists and get their type
      if (comment.user_id) {
        const user = await tenantScopedTable<{ user_type: string | null }>(trx, 'users', tenant)
          .select('user_type')
          .where('user_id', comment.user_id)
          .first();

        if (user) {
          // Ensure author_type matches user_type
          comment.author_type = isMspPrincipalUserType(user.user_type) ? 'internal' : 'client';
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
      // bundle_mirror_source is read-time provenance from ticket_bundle_mirrors,
      // not a comments column; strip it so a smuggled payload can never be written.
      delete (updateData as { bundle_mirror_source?: unknown }).bundle_mirror_source;

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
        .select('*')
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
