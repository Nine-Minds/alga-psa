// @ts-nocheck
// TODO: Comment model method signature changes
'use server'

import Comment from '../../models/comment';
import { IComment } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { convertBlockNoteToMarkdown } from '@alga-psa/documents/lib/blocknoteUtils';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { TicketResponseState } from '@alga-psa/types';
import { maybeReopenBundleMasterFromChildReply } from '@alga-psa/tickets/actions/ticketBundleUtils';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import { buildTicketCommunicationWorkflowEvents } from '../../lib/workflowTicketCommunicationEvents';

/**
 * Helper function to determine the new response state based on comment properties
 * and update the ticket's response_state accordingly.
 *
 * Logic:
 * - Internal note (is_internal=true): No change to response state
 * - Client-visible comment from internal user: Set to 'awaiting_client'
 * - Comment from client: Set to 'awaiting_internal'
 */
async function updateTicketResponseState(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  authorType: 'internal' | 'client' | 'unknown',
  isInternal: boolean,
  userId: string | null
): Promise<{ previousState: TicketResponseState; newState: TicketResponseState }> {
  // Get current ticket response state
  const ticket = await trx('tickets')
    .select('response_state')
    .where({ ticket_id: ticketId, tenant })
    .first();

  const previousState = (ticket?.response_state || null) as TicketResponseState;
  let newState: TicketResponseState = previousState;

  // Internal notes don't change response state
  if (isInternal) {
    return { previousState, newState };
  }

  // Determine new state based on author type
  if (authorType === 'internal') {
    // Internal staff posting client-visible comment -> awaiting client response
    newState = 'awaiting_client';
  } else if (authorType === 'client') {
    // Client posting comment -> awaiting internal response
    newState = 'awaiting_internal';
  }

  // Only update if state actually changed
  if (newState !== previousState) {
    await trx('tickets')
      .where({ ticket_id: ticketId, tenant })
      .update({ response_state: newState });

    // Publish response state change event
    try {
      await publishEvent({
        eventType: 'TICKET_RESPONSE_STATE_CHANGED',
        payload: {
          tenantId: tenant,
          ticketId,
          userId,
          previousState,
          newState,
          trigger: 'comment'
        }
      });
      console.log(`[updateTicketResponseState] Published event: ${previousState} -> ${newState}`);
    } catch (eventError) {
      console.error(`[updateTicketResponseState] Failed to publish event:`, eventError);
      // Don't throw - allow comment creation to succeed even if event publishing fails
    }
  }

  return { previousState, newState };
}

export async function findCommentsByTicketId(ticketId: string) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex: db, tenant } = await createTenantKnex(currentUser.tenant);
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const comments = await Comment.getAllbyTicketId(trx, tenant!, ticketId);
      return comments;
    });
  } catch (error) {
    console.error(error);
    throw new Error(`Failed to find comments for ticket id: ${ticketId}`);
  }
}

export async function findCommentById(commentId: string) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex: db, tenant } = await createTenantKnex(currentUser.tenant);
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const comment = await Comment.get(trx, tenant!, commentId);
      return comment;
    });
  } catch (error) {
    console.error(error);
    throw new Error(`Failed to find comment with id: ${commentId}`);
  }
}

export async function createComment(comment: Omit<IComment, 'tenant'>): Promise<string> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  try {
    console.log(`[createComment] Starting with comment:`, {
      note_length: comment.note ? comment.note.length : 0,
      is_internal: comment.is_internal,
      is_resolution: comment.is_resolution,
      user_id: comment.user_id
    });

    // Get user's type to set author_type
    if (comment.user_id) {
      const { knex: db, tenant } = await createTenantKnex(currentUser.tenant);
      const user = await withTransaction(db, async (trx: Knex.Transaction) => {
        return await trx('users')
          .select('user_type')
          .where('user_id', comment.user_id)
          .andWhere('tenant', tenant!)
          .first();
      });

      if (user) {
        comment.author_type = user.user_type === 'internal' ? 'internal' : 'client';
      } else {
        comment.author_type = 'unknown';
      }
    } else {
      comment.author_type = 'unknown';
    }

    // Only allow internal comments from MSP (internal) users
    if (comment.is_internal && comment.author_type !== 'internal') {
      throw new Error('Only MSP users can create internal comments');
    }

    // Convert BlockNote JSON to Markdown if note exists
    if (comment.note) {
      console.log(`[createComment] Converting note to markdown for new comment`);
      
      try {
        comment.markdown_content = await convertBlockNoteToMarkdown(comment.note);
        
        if (!comment.markdown_content || comment.markdown_content.trim() === '') {
          console.warn(`[createComment] Markdown conversion returned empty result, using fallback`);
          comment.markdown_content = "[Fallback markdown content]";
        }
        
        console.log(`[createComment] Markdown conversion successful:`, {
          length: comment.markdown_content.length
        });
      } catch (conversionError) {
        console.error(`[createComment] Error during markdown conversion:`, conversionError);
        comment.markdown_content = "[Error during content conversion]";
      }
    } else {
      comment.markdown_content = "[No content]";
    }
    
    // Create a copy of the comment object to ensure markdown_content is included
    const commentToInsert = {
      ...comment,
      markdown_content: comment.markdown_content || "[No markdown content]"
    };
    
    console.log(`[createComment] Final comment object for insertion:`, {
      ...commentToInsert,
      note: commentToInsert.note ? `${commentToInsert.note.substring(0, 50)}...` : undefined,
      markdown_content_length: commentToInsert.markdown_content ? commentToInsert.markdown_content.length : 0
    });

    // Use the Comment model to insert the comment
    const { knex: db, tenant: commentTenant } = await createTenantKnex(currentUser.tenant);
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const commentId = await Comment.insert(trx, commentTenant!, commentToInsert);
      console.log(`[createComment] Comment inserted with ID:`, commentId);

      // Verify the comment was inserted correctly
      const insertedComment = await Comment.get(trx, commentTenant!, commentId);
      if (insertedComment) {
        console.log(`[createComment] Verification - inserted comment:`, {
          comment_id: insertedComment.comment_id,
          has_markdown: !!insertedComment.markdown_content,
          markdown_length: insertedComment.markdown_content ? insertedComment.markdown_content.length : 0
        });
      }

      // Update ticket response state based on comment (F005-F008)
      if (comment.ticket_id && commentTenant) {
        const { previousState, newState } = await updateTicketResponseState(
          trx,
          commentTenant,
          comment.ticket_id,
          comment.author_type as 'internal' | 'client' | 'unknown',
          comment.is_internal || false,
          comment.user_id || null
        );
        console.log(`[createComment] Response state updated: ${previousState} -> ${newState}`);
      }

      // Get user details for event
      if (comment.user_id && commentTenant) {
        const user = await trx('users')
          .select('first_name', 'last_name', 'user_type', 'contact_id')
          .where({ user_id: comment.user_id, tenant: commentTenant })
          .first();

        const authorName = user ? `${user.first_name} ${user.last_name}` : 'Unknown User';

        // Publish TICKET_COMMENT_ADDED event for mention notifications
        // Note: Using try-catch to avoid blocking comment creation if event publishing fails
        try {
          await publishEvent({
            eventType: 'TICKET_COMMENT_ADDED',
            payload: {
              tenantId: commentTenant,
              ticketId: comment.ticket_id!,
              userId: comment.user_id,
              comment: {
                id: commentId,
                content: comment.note!,
                author: authorName,
                isInternal: comment.is_internal || false,
                authorType: comment.author_type // F039: Include author_type in event payload
              }
            }
          });
          console.log(`[createComment] Published TICKET_COMMENT_ADDED event for comment:`, commentId);
        } catch (eventError) {
          console.error(`[createComment] Failed to publish TICKET_COMMENT_ADDED event:`, eventError);
          // Don't throw - allow comment creation to succeed even if event publishing fails
        }

        // Publish workflow v2 domain ticket message events (additive; no impact on legacy comment events).
        try {
          const insertedComment = await Comment.get(trx, commentTenant, commentId);
          const createdAt = insertedComment?.created_at ?? undefined;
          const visibility = comment.is_internal ? 'internal' : 'public';

          const isInternalUser = user?.user_type === 'internal';
          const hasContactId = Boolean(user?.contact_id);
          const author = isInternalUser
            ? { authorType: 'user', authorId: comment.user_id }
            : hasContactId
              ? { authorType: 'contact', authorId: user.contact_id, contactId: user.contact_id }
              : { authorType: 'user', authorId: comment.user_id };

          const workflowCtx = {
            tenantId: commentTenant,
            occurredAt: createdAt ?? new Date().toISOString(),
            actor: isInternalUser
              ? { actorType: 'USER', actorUserId: comment.user_id }
              : hasContactId
                ? { actorType: 'CONTACT', actorContactId: user.contact_id }
                : { actorType: 'USER', actorUserId: comment.user_id },
            correlationId: commentId,
          };

          const channel = isInternalUser ? 'ui' : 'portal';
          const events = buildTicketCommunicationWorkflowEvents({
            ticketId: comment.ticket_id!,
            messageId: commentId,
            visibility,
            author,
            channel,
            createdAt,
          });

          for (const ev of events) {
            await publishWorkflowEvent({
              eventType: ev.eventType,
              payload: ev.payload,
              ctx: workflowCtx,
            });
          }
        } catch (eventError) {
          console.error(`[createComment] Failed to publish workflow ticket message events:`, eventError);
        }
      }

      if (!comment.is_internal && commentTenant) {
        await maybeReopenBundleMasterFromChildReply(trx, commentTenant, comment.ticket_id!, comment.user_id ?? null);
      }

      return commentId;
    });
  } catch (error) {
    console.error(`Failed to create comment:`, error);
    throw new Error(`Failed to create comment`);
  }
}

export async function updateComment(id: string, comment: Partial<IComment>) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  console.log(`[updateComment] Starting update for comment ID: ${id}`, {
    commentData: {
      ...comment,
      note: comment.note ? `${comment.note.substring(0, 50)}...` : undefined
    }
  });

  const { knex: db, tenant: commentTenant } = await createTenantKnex(currentUser.tenant);
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Fetch existing comment to verify it exists
      const existingComment = await Comment.get(trx, id);
      if (!existingComment) {
        console.error(`[updateComment] Comment with ID ${id} not found`);
        throw new Error(`Comment with id ${id} not found`);
      }
      if (existingComment.is_system_generated) {
        throw new Error('This comment is system-generated and cannot be edited.');
      }
      console.log(`[updateComment] Found existing comment:`, existingComment);

      // Store old comment data for event publishing
      const oldCommentData = {
        id: existingComment.comment_id!,
        content: existingComment.note!,
        isInternal: existingComment.is_internal || false
      };

      // Get the original author name for old comment
      const oldAuthor = await trx('users')
        .select('first_name', 'last_name')
        .where({ user_id: existingComment.user_id, tenant: commentTenant! })
        .first();
      const oldAuthorName = oldAuthor ? `${oldAuthor.first_name} ${oldAuthor.last_name}` : 'Unknown User';

      // Verify user permissions - only allow users to edit their own comments
      // or  MSP (internal) users to edit any comment
      if (comment.user_id && comment.user_id !== existingComment.user_id) {
        const user = await trx('users')
          .select('user_type')
          .where('user_id', comment.user_id)
          .andWhere('tenant', commentTenant!)
          .first();

      // Only MSP (internal) users can edit other users' comments
      if (!user || user.user_type !== 'internal') {
        throw new Error('You can only edit your own comments');
      }

      // Set author_type based on user type
      if (user) {
        comment.author_type = user.user_type === 'internal' ? 'internal' : 'client';
      } else {
        comment.author_type = 'unknown';
      }
    }

    // Validate internal comment permissions
    if (comment.is_internal !== undefined) {
      // Only allow internal comments from  MSP (internal) users
      if (comment.is_internal && comment.author_type !== 'internal' && existingComment.author_type !== 'internal') {
        throw new Error('Only MSP users can set comments as internal');
      }
      // If a client user is updating a comment, ensure they can't make it internal
      if (existingComment.author_type === 'client') {
        comment.is_internal = existingComment.is_internal; // Preserve internal status
      }
    }

    // Convert BlockNote JSON to Markdown if note is being updated
    if (comment.note !== undefined) {
      console.log(`[updateComment] Converting note to markdown for comment update`);

      try {
        comment.markdown_content = await convertBlockNoteToMarkdown(comment.note);

        if (!comment.markdown_content || comment.markdown_content.trim() === '') {
          console.warn(`[updateComment] Markdown conversion returned empty result, using fallback`);
          comment.markdown_content = "[Fallback markdown content]";
        }

        console.log(`[updateComment] Markdown conversion successful:`, {
          length: comment.markdown_content.length
        });
      } catch (conversionError) {
        console.error(`[updateComment] Error during markdown conversion:`, conversionError);
        comment.markdown_content = "[Error during content conversion]";
      }
    }

    // Create a copy of the comment object to ensure markdown_content is included
    const commentToUpdate = {
      ...comment,
      markdown_content: comment.note !== undefined ?
        (comment.markdown_content || "[No markdown content]") :
        comment.markdown_content
    };

    console.log(`[updateComment] Proceeding with update`, {
      finalUpdateData: {
        ...commentToUpdate,
        note: commentToUpdate.note ? `${commentToUpdate.note.substring(0, 50)}...` : undefined
      },
      hasMarkdownContent: commentToUpdate.markdown_content !== undefined,
      markdownContentLength: commentToUpdate.markdown_content ? commentToUpdate.markdown_content.length : 0
    });

      // Use the Comment model to update the comment
      await Comment.update(trx, id, commentToUpdate);
      console.log(`[updateComment] Successfully updated comment with ID: ${id}`);

      // Verify the comment was updated correctly
      const updatedComment = await Comment.get(trx, id);
      if (updatedComment) {
        console.log(`[updateComment] Verification - updated comment:`, {
          comment_id: updatedComment.comment_id,
          has_markdown: !!updatedComment.markdown_content,
          markdown_length: updatedComment.markdown_content ? updatedComment.markdown_content.length : 0
        });
      }

      // Publish TICKET_COMMENT_UPDATED event if the comment was updated and we have user info
      if (updatedComment && comment.user_id && commentTenant) {
        const newAuthor = await trx('users')
          .select('first_name', 'last_name')
          .where({ user_id: comment.user_id, tenant: commentTenant })
          .first();
        const newAuthorName = newAuthor ? `${newAuthor.first_name} ${newAuthor.last_name}` : 'Unknown User';

        try {
          await publishEvent({
            eventType: 'TICKET_COMMENT_UPDATED',
            payload: {
              tenantId: commentTenant,
              ticketId: updatedComment.ticket_id!,
              userId: comment.user_id,
              oldComment: {
                id: oldCommentData.id,
                content: oldCommentData.content,
                author: oldAuthorName,
                isInternal: oldCommentData.isInternal
              },
              newComment: {
                id: updatedComment.comment_id!,
                content: updatedComment.note!,
                author: newAuthorName,
                isInternal: updatedComment.is_internal || false
              }
            }
          });
          console.log(`[updateComment] Published TICKET_COMMENT_UPDATED event for comment:`, id);
        } catch (eventError) {
          console.error(`[updateComment] Failed to publish TICKET_COMMENT_UPDATED event:`, eventError);
          // Don't throw - allow comment update to succeed even if event publishing fails
        }
      }
    });
  } catch (error) {
    console.error(`[updateComment] Failed to update comment with ID ${id}:`, error);
    console.error(`[updateComment] Stack trace:`, error instanceof Error ? error.stack : 'No stack trace available');
    throw new Error(`Failed to update comment with id ${id}`);
  }
}

export async function deleteComment(id: string) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex: db, tenant } = await createTenantKnex(currentUser.tenant);
  try {
    await withTransaction(db, async (trx: Knex.Transaction) => {
      const existingComment = await Comment.get(trx, id);
      if (existingComment?.is_system_generated) {
        throw new Error('This comment is system-generated and cannot be deleted.');
      }
      await Comment.delete(trx, id);
    });
  } catch (error) {
    console.error(`Failed to delete comment with id ${id}:`, error);
    throw new Error(`Failed to delete comment with id ${id}`);
  }
}
