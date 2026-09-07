import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { tenantDb, registerAfterCommit } from '@alga-psa/db';
import { createCoManagedTicketComment, CoManagedSharedWorkError, type CoManagedCommentCreateRequest, type CoManagedSharedResource, type CoManagedSessionActor } from '@alga-psa/co-managed';
import Comment from '@alga-psa/tickets/models/comment';
import { isResponseStateTrackingEnabled } from '@alga-psa/tickets/lib/responseStateSettings';
import { buildTicketCommunicationWorkflowEvents } from '@alga-psa/tickets/lib/workflowTicketCommunicationEvents';
import { writeTicketActivity } from '@alga-psa/shared/lib/ticketActivity';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { EventSchemas, buildWorkflowPayload, type WorkflowEventPublishContext } from '@alga-psa/event-schemas';
import { collaborationActorReferenceSchema } from '@alga-psa/event-schemas/collaboration';

/** Production adapter: admission, native comment, response state, activity and
 * receipt share one transaction. Publication starts only after its owner commits. */
export async function createSharedTicketComment(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, request: CoManagedCommentCreateRequest) {
  return createCoManagedTicketComment(db, actor, resource, request, async (context, comment) => {
    const { trx } = context, owner = tenantDb(trx, context.resource.tenant);
    await Comment.insert(trx, context.resource.tenant, comment, { ticketId: context.resource.id, actorTenant: context.actor.tenant, actorUserId: context.actor.userId,
      actorReferenceId: context.actorReferenceId, audience: context.audience, assertWriteAuthority: context.assertWriteAuthority });
    const saved = await owner.table('comments').where('comment_id', comment.comment_id).first();
    const occurredAt = saved.created_at instanceof Date ? saved.created_at.toISOString() : String(saved.created_at);
    const reference = context.actorReferenceId ? collaborationActorReferenceSchema.parse({ ownerTenantId: context.resource.tenant, referenceId: context.actorReferenceId,
      tenantId: context.actor.tenant, userId: context.actor.userId, displayName: saved.actor_display_name, organizationName: saved.actor_organization_name }) : undefined;
    const localUser = reference ? undefined : await owner.table('users').where('user_id', context.actor.userId).first('first_name', 'last_name', 'email');
    const displayName = reference?.displayName ?? ([localUser?.first_name?.trim(), localUser?.last_name?.trim()].filter(Boolean).join(' ') || localUser?.email || context.actor.userId);
    const workflowContext: WorkflowEventPublishContext = { tenantId: context.resource.tenant, occurredAt, correlationId: comment.comment_id,
      actor: reference ? { actorType: 'COLLABORATOR', actorReference: reference } : { actorType: 'USER', actorUserId: context.actor.userId } };
    const publish = (eventType: 'TICKET_COMMENT_ADDED' | 'TICKET_RESPONSE_STATE_CHANGED', payload: Record<string, unknown>) => {
      const complete = buildWorkflowPayload(payload, workflowContext);
      const eventId = uuidv5(eventType, comment.comment_id);
      EventSchemas[eventType].parse({ id: eventId, timestamp: occurredAt, eventType, payload: complete });
      registerAfterCommit(trx, () => publishEvent({ eventType, payload: complete } as any, { eventId }), `${eventType} comment=${comment.comment_id}`);
    };
    // LEVERAGE: pattern comment-response-state — native comment adapters also
    // update this field; retain the owning ticket lock and effective setting.
    if (context.audience === 'requester' && await isResponseStateTrackingEnabled(context.resource.tenant, trx)) {
      if (!context.canUpdateResponseState) throw new CoManagedSharedWorkError();
      const ticket = await owner.table('tickets').where('ticket_id', context.resource.id).first('response_state');
      if (ticket.response_state !== 'awaiting_client') {
        await context.assertWriteAuthority(trx);
        await owner.table('tickets').where('ticket_id', context.resource.id).update({ response_state: 'awaiting_client' });
        publish('TICKET_RESPONSE_STATE_CHANGED', { ticketId: context.resource.id, ...(reference ? {} : { userId: context.actor.userId }),
          previousState: ticket.response_state ?? null, newState: 'awaiting_client', previousResponseState: ticket.response_state ?? null,
          newResponseState: 'awaiting_client', trigger: 'comment' });
      }
    }
    await writeTicketActivity(trx, { tenant: context.resource.tenant, ticketId: context.resource.id,
      eventType: context.audience === 'requester' ? 'TICKET_MESSAGE_ADDED' : 'TICKET_INTERNAL_NOTE_ADDED', entityType: 'comment', entityId: comment.comment_id,
      actor: { actorType: 'user', ...(reference ? { actorReferenceId: reference.referenceId } : { userId: context.actor.userId, displayName }) },
      source: 'ui', occurredAt, details: { is_internal: comment.is_internal, collaboration_audience: context.audience, thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id } });
    publish('TICKET_COMMENT_ADDED', { ticketId: context.resource.id, ...(reference ? {} : { userId: context.actor.userId }), commentId: comment.comment_id,
      thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id, is_reply: Boolean(comment.parent_comment_id),
      comment: { id: comment.comment_id, content: saved.note, author: displayName, authorType: 'internal', isInternal: comment.is_internal,
        audience: context.audience, thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id, is_reply: Boolean(comment.parent_comment_id) } });
    for (const event of buildTicketCommunicationWorkflowEvents({ ticketId: context.resource.id, messageId: comment.comment_id,
      visibility: comment.is_internal ? 'internal' : 'public', audience: context.audience,
      author: reference ? { authorType: 'collaborator', authorReference: reference } : { authorType: 'user', authorId: context.actor.userId }, channel: 'ui', createdAt: occurredAt })) {
      const eventId = uuidv5(event.eventType, comment.comment_id);
      EventSchemas[event.eventType].parse({ id: eventId, timestamp: occurredAt, eventType: event.eventType, payload: buildWorkflowPayload(event.payload, workflowContext) });
      registerAfterCommit(trx, () => publishWorkflowEvent({ ...event, ctx: workflowContext, idempotencyKey: `co-managed-comment:${context.resource.tenant}:${comment.comment_id}:${event.eventType}` }, { eventId }), `${event.eventType} comment=${comment.comment_id}`);
    }
    await context.assertWriteAuthority(trx);
  });
}
