import type { Knex } from 'knex';
import { registerAfterCommit, tenantDb } from '@alga-psa/db';
import { publishCommentEvent } from '@alga-psa/db/commentEventRegistry';
import { createCoManagedTicketComment, CoManagedSharedWorkError, type CoManagedCommentCreateRequest, type CoManagedSharedResource, type CoManagedSessionActor } from '@alga-psa/co-managed';
import Comment from '@alga-psa/tickets/models/comment';
import { buildTicketCommunicationWorkflowEvents, publishTicketCommunicationWorkflowEvent } from '@alga-psa/tickets/lib/workflowTicketCommunicationEvents';
import { publishTicketUpdate } from '@alga-psa/tickets/lib/liveUpdates';
import { writeTicketActivity } from '@alga-psa/shared/lib/ticketActivity';
import { persistCommentPublication } from '@alga-psa/shared/lib/ticketCommentAttachments';
import { applyCommentResponseState, isResponseStateTrackingEnabled } from '@alga-psa/shared/lib/tickets/responseState';
import { buildTicketCommentAddedPayload } from '@alga-psa/shared/lib/tickets/ticketWorkflowEventPayloads';
import { publishStoredWorkflowEvent } from '@alga-psa/event-bus/publishers';
import type { WorkflowEventPublishContext } from '@alga-psa/event-schemas';
import { collaborationActorReferenceSchema } from '@alga-psa/event-schemas/collaboration';

/** Production adapter: admission, native comment, response state, activity,
 * publication intent and receipt share one transaction. Publication through the
 * L0b comment-event registry / durable comment publication intent starts only
 * after the owner commits. */
export async function createSharedTicketComment(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, request: CoManagedCommentCreateRequest) {
  return createCoManagedTicketComment(db, actor, resource, request, async (context, comment) => {
    const { trx } = context, tenant = context.resource.tenant, owner = tenantDb(trx, tenant);
    // The audience is named on the root; replies inherit the thread's audience.
    await Comment.insert(trx, tenant, { ...comment, ...(comment.parent_comment_id ? {} : { collaboration_audience: context.audience }) } as any, {
      ticketId: context.resource.id, actorTenant: context.actor.tenant, actorUserId: context.actor.userId,
      actorReferenceId: context.actorReferenceId, assertWriteAuthority: context.assertWriteAuthority });
    const saved = await owner.table('comments').where('comment_id', comment.comment_id).first();
    const occurredAt = saved.created_at instanceof Date ? saved.created_at.toISOString() : String(saved.created_at);
    const reference = context.actorReferenceId ? collaborationActorReferenceSchema.parse({ ownerTenantId: tenant, referenceId: context.actorReferenceId,
      tenantId: context.actor.tenant, userId: context.actor.userId, displayName: saved.actor_display_name, organizationName: saved.actor_organization_name }) : undefined;
    const localUser = reference ? undefined : await owner.table('users').where('user_id', context.actor.userId).first('first_name', 'last_name', 'email');
    const displayName = reference?.displayName ?? ([localUser?.first_name?.trim(), localUser?.last_name?.trim()].filter(Boolean).join(' ') || localUser?.email || context.actor.userId);
    const workflowActor: WorkflowEventPublishContext['actor'] = reference ? { actorType: 'COLLABORATOR', actorReference: reference } : { actorType: 'USER', actorUserId: context.actor.userId };
    // LEVERAGE: pattern comment-response-state — native comment adapters also
    // update this field; retain the owning ticket lock and effective setting.
    if (context.audience === 'requester' && await isResponseStateTrackingEnabled(tenant, trx)) {
      if (!context.canUpdateResponseState) throw new CoManagedSharedWorkError();
      await context.assertWriteAuthority(trx);
      await applyCommentResponseState(trx, { tenant, ticketId: context.resource.id, authorType: 'internal', isInternal: false, userId: reference ? null : context.actor.userId });
    }
    await writeTicketActivity(trx, { tenant, ticketId: context.resource.id,
      eventType: context.audience === 'requester' ? 'TICKET_MESSAGE_ADDED' : 'TICKET_INTERNAL_NOTE_ADDED', entityType: 'comment', entityId: comment.comment_id,
      actor: { actorType: 'user', ...(reference ? { actorReferenceId: reference.referenceId } : { userId: context.actor.userId, displayName }) },
      source: 'ui', occurredAt, details: { is_internal: comment.is_internal, collaboration_audience: context.audience, thread_id: saved.thread_id, parent_comment_id: comment.parent_comment_id } });
    // Durable publication intent (carries collaboration_audience so a replay can never widen it).
    await publishCommentEvent(trx, 'ticket', { tenantId: tenant, ticketId: context.resource.id, commentId: comment.comment_id,
      ...(reference ? {} : { userId: context.actor.userId }), eventType: 'TICKET_COMMENT_ADDED' }, async () => {
      await persistCommentPublication(trx, { eventType: 'TICKET_COMMENT_ADDED', payload: {
        ...buildTicketCommentAddedPayload({ tenantId: tenant, occurredAt, ticketId: context.resource.id, commentId: comment.comment_id,
          ...(reference ? { actor: workflowActor } : { userId: context.actor.userId }),
          thread_id: saved.thread_id, parent_comment_id: comment.parent_comment_id, is_reply: Boolean(comment.parent_comment_id),
          comment: { content: saved.note, author: displayName, authorType: 'internal', isInternal: context.audience !== 'requester',
            thread_id: saved.thread_id, parent_comment_id: comment.parent_comment_id, is_reply: Boolean(comment.parent_comment_id) },
          collaboration_audience: context.audience }),
        commentId: comment.comment_id } }, publishStoredWorkflowEvent);
    });
    const events = buildTicketCommunicationWorkflowEvents({ ticketId: context.resource.id, messageId: comment.comment_id,
      visibility: comment.is_internal ? 'internal' : 'public', audience: context.audience,
      author: reference ? { authorType: 'collaborator', authorReference: reference } : { authorType: 'user', authorId: context.actor.userId }, channel: 'ui', createdAt: occurredAt } as any);
    const workflowContext: WorkflowEventPublishContext = { tenantId: tenant, occurredAt, correlationId: comment.comment_id, actor: workflowActor };
    registerAfterCommit(trx, async () => {
      for (const event of events) {
        try { await publishTicketCommunicationWorkflowEvent(event, workflowContext); }
        catch (error) { console.error('[co-managed comment] communication event failed', error); }
      }
    }, `co-managed comment events ${tenant}:${comment.comment_id}`);
    await context.assertWriteAuthority(trx);
    // Only customer-owned comments reach this adapter. MSP-private comments
    // stay in their own store and never signal the customer's live room.
    registerAfterCommit(trx, () => publishTicketUpdate({ tenantId: tenant, ticketId: context.resource.id, updatedFields: ['comments'],
      updatedBy: reference ? { userId: null, displayName, actorReference: reference } : { userId: context.actor.userId, displayName },
      updatedAt: occurredAt }), `co-managed comment refresh ${tenant}:${comment.comment_id}`);
  });
}
