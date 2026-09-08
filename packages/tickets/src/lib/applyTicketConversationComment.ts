import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { CoManagedSharedWorkError, type CoManagedSessionActor, type CoManagedCommentInsert } from '@alga-psa/co-managed';
import type { CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import Comment from '../models/comment';
import { isResponseStateTrackingEnabled } from './responseStateSettings';
import { buildTicketCommunicationWorkflowEvents } from './workflowTicketCommunicationEvents';
import { writeTicketActivity } from '@alga-psa/shared/lib/ticketActivity';
import { EventSchemas, buildWorkflowPayload, type WorkflowEventPublishContext } from '@alga-psa/event-schemas';
import { collaborationActorReferenceSchema } from '@alga-psa/event-schemas/collaboration';
import { publishNativeCommentEvent, publishNativeCommentWorkflowEvent, publishQualifiedNamedConversationEvent } from './nativeConversationEvents';

/** Admission and operation receipts belong to the calling command. This writer
 * keeps its canonical comment, response-state and event effects in that same
 * transaction for legacy co-managed and named/native conversation adapters. */
export interface TicketConversationCommentContext {
  trx: Knex.Transaction;
  resource: { tenant: string; id: string };
  actor: Pick<CoManagedSessionActor, 'tenant' | 'userId'>;
  actorReferenceId?: string;
  audience: CommentAudience;
  conversationId?: string;
  canUpdateResponseState: boolean;
  assertWriteAuthority: (trx: Knex.Transaction) => Promise<void>;
  publication: 'native' | 'qualified';
  externalDelivery: 'notifications' | 'reviewed_email';
}
export async function applyTicketConversationComment(context: TicketConversationCommentContext, comment: CoManagedCommentInsert): Promise<void> {
  const { trx } = context, owner = tenantDb(trx, context.resource.tenant);
  await Comment.insert(trx, context.resource.tenant, comment, { ticketId: context.resource.id, actorTenant: context.actor.tenant, actorUserId: context.actor.userId,
    actorReferenceId: context.actorReferenceId, audience: context.audience, conversationId: context.conversationId, assertWriteAuthority: context.assertWriteAuthority });
  const saved = await owner.table('comments').where('comment_id', comment.comment_id).first();
  const occurredAt = saved.created_at instanceof Date ? saved.created_at.toISOString() : String(saved.created_at);
  const reference = context.actorReferenceId ? collaborationActorReferenceSchema.parse({ ownerTenantId: context.resource.tenant, referenceId: context.actorReferenceId,
    tenantId: context.actor.tenant, userId: context.actor.userId, displayName: saved.actor_display_name, organizationName: saved.actor_organization_name }) : undefined;
  const localUser = reference ? undefined : await owner.table('users').where('user_id', context.actor.userId).first('first_name', 'last_name', 'email');
  const displayName = reference?.displayName ?? ([localUser?.first_name?.trim(), localUser?.last_name?.trim()].filter(Boolean).join(' ') || localUser?.email || context.actor.userId);
  const workflowContext: WorkflowEventPublishContext = { tenantId: context.resource.tenant, occurredAt, correlationId: comment.comment_id,
    actor: reference ? { actorType: 'COLLABORATOR', actorReference: reference } : { actorType: 'USER', actorUserId: context.actor.userId } };
  const source = { tenant: context.resource.tenant, ticketId: context.resource.id, commentId: comment.comment_id,
    threadId: comment.thread_id, audience: context.audience };
  const publish = async (eventType: 'TICKET_COMMENT_ADDED' | 'TICKET_RESPONSE_STATE_CHANGED', payload: Record<string, unknown>) => {
    const complete = buildWorkflowPayload(payload, workflowContext);
    const eventId = uuidv5(`${context.resource.tenant}:${eventType}`, comment.comment_id);
    EventSchemas[eventType].parse({ id: eventId, timestamp: occurredAt, eventType, payload: complete });
    if (context.publication === 'qualified') await publishQualifiedNamedConversationEvent(trx, source,
      { kind: 'event', eventType, payload: complete }, eventId);
    else await publishNativeCommentEvent(trx, source, { eventType, payload: complete });
  };
  if (context.audience === 'requester' && await isResponseStateTrackingEnabled(context.resource.tenant, trx)) {
    if (!context.canUpdateResponseState) throw new CoManagedSharedWorkError();
    const ticket = await owner.table('tickets').where('ticket_id', context.resource.id).first('response_state');
    if (ticket.response_state !== 'awaiting_client') {
      await context.assertWriteAuthority(trx);
      await owner.table('tickets').where('ticket_id', context.resource.id).update({ response_state: 'awaiting_client' });
      await publish('TICKET_RESPONSE_STATE_CHANGED', { ticketId: context.resource.id, ...(reference ? {} : { userId: context.actor.userId }),
        previousState: ticket.response_state ?? null, newState: 'awaiting_client', previousResponseState: ticket.response_state ?? null,
        newResponseState: 'awaiting_client', trigger: 'comment' });
    }
  }
  // Named side activity must not become a customer-visible ticket timestamp
  // or activity record. Requester keeps its canonical lifecycle record.
  if (!context.conversationId || context.audience === 'requester') await writeTicketActivity(trx, { tenant: context.resource.tenant, ticketId: context.resource.id,
    eventType: context.audience === 'requester' ? 'TICKET_MESSAGE_ADDED' : 'TICKET_INTERNAL_NOTE_ADDED', entityType: 'comment', entityId: comment.comment_id,
    actor: { actorType: 'user', ...(reference ? { actorReferenceId: reference.referenceId } : { userId: context.actor.userId, displayName }) },
    source: 'ui', occurredAt, details: { is_internal: comment.is_internal, collaboration_audience: context.audience, thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id } });
  await publish('TICKET_COMMENT_ADDED', {
    // Reviewed Send owns its exact external envelope. Reuse the existing
    // suppression contract so generic contact/watch-list email cannot resend it.
    ...(context.externalDelivery === 'reviewed_email' ? { suppressContactNotifications: true } : {}),
    ticketId: context.resource.id, ...(reference ? {} : { userId: context.actor.userId }), commentId: comment.comment_id,
    thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id, is_reply: Boolean(comment.parent_comment_id),
    comment: { id: comment.comment_id, content: saved.note, author: displayName, authorType: 'internal', isInternal: comment.is_internal,
      audience: context.audience, thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id, is_reply: Boolean(comment.parent_comment_id) } });
  for (const event of buildTicketCommunicationWorkflowEvents({ ticketId: context.resource.id, messageId: comment.comment_id,
    visibility: comment.is_internal ? 'internal' : 'public', audience: context.audience,
    author: reference ? { authorType: 'collaborator', authorReference: reference } : { authorType: 'user', authorId: context.actor.userId }, channel: 'ui', createdAt: occurredAt })) {
    const eventId = uuidv5(`${context.resource.tenant}:${event.eventType}`, comment.comment_id);
    EventSchemas[event.eventType].parse({ id: eventId, timestamp: occurredAt, eventType: event.eventType, payload: buildWorkflowPayload(event.payload, workflowContext) });
    if (context.publication === 'qualified') await publishQualifiedNamedConversationEvent(trx, source,
      { kind: 'workflow', eventType: event.eventType, payload: event.payload, workflowContext,
        idempotencyKey: `${context.conversationId ? 'named-comment' : 'co-managed-comment'}:${context.resource.tenant}:${comment.comment_id}:${event.eventType}` }, eventId);
    else await publishNativeCommentWorkflowEvent(trx, source, { eventType: event.eventType, payload: event.payload, ctx: workflowContext });
  }
  await context.assertWriteAuthority(trx);
}
