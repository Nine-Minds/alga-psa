import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { postNamedTicketConversationDraft, type NamedConversationPostRequest, type CoManagedSessionActor } from '@alga-psa/co-managed';
import type { ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { EventSchemas, buildWorkflowPayload, type WorkflowEventPublishContext } from '@alga-psa/event-schemas';
import { collaborationActorReferenceSchema } from '@alga-psa/event-schemas/collaboration';
import Comment from '../models/comment';
import { publishNativeCommentEvent, publishNativeCommentWorkflowEvent, publishQualifiedNamedConversationEvent } from './nativeConversationEvents';
import { buildTicketCommunicationWorkflowEvents } from './workflowTicketCommunicationEvents';

export function postNamedTicketConversation(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  reference: TicketConversationReference, request: NamedConversationPostRequest) {
  return postNamedTicketConversationDraft(db, actor, ticket, reference, request, async (context, comment) => {
    const { trx, conversation } = context, owner = tenantDb(trx, ticket.tenant);
    await Comment.insert(trx, ticket.tenant, comment, { ticketId: ticket.ticketId,
      actorTenant: context.actor.tenant, actorUserId: context.actor.userId, actorReferenceId: context.actorReferenceId,
      audience: conversation.audience, conversationId: conversation.conversationId, assertWriteAuthority: context.assertWriteAuthority });
    const saved = await owner.table('comments').where('comment_id', comment.comment_id).first();
    const occurredAt = new Date(saved.created_at).toISOString();
    const qualifiedActor = context.actorReferenceId ? collaborationActorReferenceSchema.parse({ ownerTenantId: ticket.tenant,
      referenceId: context.actorReferenceId, tenantId: context.actor.tenant, userId: context.actor.userId,
      displayName: saved.actor_display_name, organizationName: saved.actor_organization_name }) : undefined;
    const user = qualifiedActor ? null : await owner.table('users').where('user_id', context.actor.userId).first('first_name', 'last_name');
    const displayName = qualifiedActor?.displayName ?? [user?.first_name, user?.last_name].filter(Boolean).join(' ');
    const workflowContext: WorkflowEventPublishContext = { tenantId: ticket.tenant, occurredAt, correlationId: comment.comment_id,
      actor: qualifiedActor ? { actorType: 'COLLABORATOR', actorReference: qualifiedActor } : { actorType: 'USER', actorUserId: context.actor.userId } };
    const source = { tenant: ticket.tenant, ticketId: ticket.ticketId, commentId: comment.comment_id,
      threadId: comment.thread_id, audience: conversation.audience };
    const payload = buildWorkflowPayload({ ticketId: ticket.ticketId, ...(qualifiedActor ? {} : { userId: context.actor.userId }),
      commentId: comment.comment_id, thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id,
      is_reply: Boolean(comment.parent_comment_id), comment: { id: comment.comment_id, content: saved.note, author: displayName,
        authorType: 'internal', isInternal: true, audience: conversation.audience, thread_id: comment.thread_id,
        parent_comment_id: comment.parent_comment_id, is_reply: Boolean(comment.parent_comment_id) } }, workflowContext);
    const eventId = uuidv5(`${ticket.tenant}:TICKET_COMMENT_ADDED`, comment.comment_id);
    EventSchemas.TICKET_COMMENT_ADDED.parse({ id: eventId, timestamp: occurredAt, eventType: 'TICKET_COMMENT_ADDED', payload });
    if (context.shared) await publishQualifiedNamedConversationEvent(trx, source, { kind: 'event', eventType: 'TICKET_COMMENT_ADDED', payload }, eventId);
    else await publishNativeCommentEvent(trx, source, { eventType: 'TICKET_COMMENT_ADDED', payload });
    for (const event of buildTicketCommunicationWorkflowEvents({ ticketId: ticket.ticketId, messageId: comment.comment_id,
      visibility: 'internal', audience: conversation.audience, channel: 'ui', createdAt: occurredAt,
      author: qualifiedActor ? { authorType: 'collaborator', authorReference: qualifiedActor } : { authorType: 'user', authorId: context.actor.userId } })) {
      const id = uuidv5(`${ticket.tenant}:${event.eventType}`, comment.comment_id);
      if (context.shared) await publishQualifiedNamedConversationEvent(trx, source, { kind: 'workflow', eventType: event.eventType,
        payload: event.payload, workflowContext, idempotencyKey: `named-comment:${ticket.tenant}:${comment.comment_id}:${event.eventType}` }, id);
      else await publishNativeCommentWorkflowEvent(trx, source, { eventType: event.eventType, payload: event.payload, ctx: workflowContext });
    }
  });
}
