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
  publicationOptions?: import('@alga-psa/shared/lib/tickets/requesterPublicationOptions').RequesterPublicationOptions | null;
  canUpdateResponseState: boolean;
  assertWriteAuthority: (trx: Knex.Transaction) => Promise<void>;
  publication: 'native' | 'qualified';
  externalDelivery: 'notifications' | 'reviewed_email';
}
export async function applyTicketConversationComment(context: TicketConversationCommentContext, comment: CoManagedCommentInsert): Promise<void> {
  const { trx } = context;
  if (context.publicationOptions && (context.publication !== 'native' || context.audience !== 'requester' || context.actor.tenant !== context.resource.tenant || context.actorReferenceId)) throw new CoManagedSharedWorkError();
  await Comment.insert(trx, context.resource.tenant, { ...comment, is_resolution: Boolean(context.publicationOptions?.isResolution), ...(context.publicationOptions?.schedule ? { publish_state: 'scheduled' as const, scheduled_publish_at: context.publicationOptions.schedule.at, scheduled_publish_tz: context.publicationOptions.schedule.timeZone } : {}) }, { ticketId: context.resource.id, actorTenant: context.actor.tenant, actorUserId: context.actor.userId,
    requesterPublicationOptions: context.publicationOptions, actorReferenceId: context.actorReferenceId, audience: context.audience, conversationId: context.conversationId, assertWriteAuthority: context.assertWriteAuthority });
  if (context.publicationOptions?.schedule) { await context.assertWriteAuthority(trx); return; }
  await publishTicketConversationCommentEffects(context, comment);
}

/** Publish effects for a canonical row already made visible in this transaction.
 * Immediate Send and the scheduled publisher use identical reviewed-email
 * suppression, response-state and communication event classification. */
export async function publishTicketConversationCommentEffects(context: TicketConversationCommentContext, comment: CoManagedCommentInsert): Promise<void> {
  const { trx } = context, owner = tenantDb(trx, context.resource.tenant);
  const saved = await owner.table('comments').where('comment_id', comment.comment_id).first();
  if (!saved || saved.publish_state !== 'published' || saved.deleted_at || saved.ticket_id !== context.resource.id) throw new CoManagedSharedWorkError();
  const scheduled = saved.scheduled_publish_at != null;
  const retained = context.publication === 'qualified' || scheduled;
  const publishedAt = saved.published_at ?? saved.created_at;
  const occurredAt = publishedAt instanceof Date ? publishedAt.toISOString() : String(publishedAt);
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
    if (retained) await publishQualifiedNamedConversationEvent(trx, source,
      { kind: 'event', eventType, payload: complete }, eventId);
    else await publishNativeCommentEvent(trx, source, { eventType, payload: complete });
  };
  if (context.audience === 'requester' && await isResponseStateTrackingEnabled(context.resource.tenant, trx)) {
    const ticket = await owner.table('tickets').where('ticket_id', context.resource.id).first('response_state');
    if (!context.canUpdateResponseState && (!scheduled || ticket.response_state !== 'awaiting_client')) throw new CoManagedSharedWorkError();
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
    eventType: scheduled ? 'TICKET_COMMENT_PUBLISHED' : context.audience === 'requester' ? 'TICKET_MESSAGE_ADDED' : 'TICKET_INTERNAL_NOTE_ADDED', entityType: 'comment', entityId: comment.comment_id,
    actor: scheduled ? { actorType: 'system' } : { actorType: 'user', ...(reference ? { actorReferenceId: reference.referenceId } : { userId: context.actor.userId, displayName }) },
    source: scheduled ? 'system' : 'ui', occurredAt, details: { ...(scheduled ? { scheduled_publish: true, published_at: occurredAt } : {}), is_internal: comment.is_internal, ...(saved.is_resolution ? { is_resolution: true } : {}), collaboration_audience: context.audience, thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id } });
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
    if (retained) await publishQualifiedNamedConversationEvent(trx, source,
      { kind: 'workflow', eventType: event.eventType, payload: event.payload, workflowContext,
        idempotencyKey: `${context.conversationId ? 'named-comment' : 'co-managed-comment'}:${context.resource.tenant}:${comment.comment_id}:${event.eventType}` }, eventId);
    else await publishNativeCommentWorkflowEvent(trx, source, { eventType: event.eventType, payload: event.payload, ctx: workflowContext });
  }
  await context.assertWriteAuthority(trx);
}
