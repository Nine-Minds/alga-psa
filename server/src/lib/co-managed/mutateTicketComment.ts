import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { tenantDb, registerAfterCommit } from '@alga-psa/db';
import { mutateCoManagedTicketComment, type CoManagedCommentMutationRequest, type CoManagedSharedResource, type CoManagedSessionActor } from '@alga-psa/co-managed';
import Comment from '@alga-psa/tickets/models/comment';
import { writeTicketActivity } from '@alga-psa/shared/lib/ticketActivity';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { EventSchemas } from '@alga-psa/event-schemas';
import { collaborationActorReferenceSchema } from '@alga-psa/event-schemas/collaboration';

/** Native mutation, metadata-only activity and retry receipt commit together.
 * Content-free events invalidate search without replaying removed comment text. */
export async function mutateSharedTicketComment(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, request: CoManagedCommentMutationRequest) {
  return mutateCoManagedTicketComment(db, actor, resource, request, async (context, mutation) => {
    const { trx } = context, owner = tenantDb(trx, context.resource.tenant);
    await Comment.mutateCollaboration(trx, context.resource.tenant, mutation, { ticketId: context.resource.id, actorTenant: context.actor.tenant,
      actorUserId: context.actor.userId, actorReferenceId: context.actorReferenceId, audience: context.audience, threadId: context.threadId,
      commentId: context.commentId, updatedAt: context.updatedAt, assertWriteAuthority: context.assertWriteAuthority });
    const saved = await owner.table('comments').where('comment_id', context.commentId).first();
    const reference = context.actorReferenceId ? collaborationActorReferenceSchema.parse({ ownerTenantId: context.resource.tenant, referenceId: context.actorReferenceId,
      tenantId: context.actor.tenant, userId: context.actor.userId, displayName: saved.actor_display_name, organizationName: saved.actor_organization_name }) : undefined;
    const eventType = mutation.kind === 'edit' ? 'TICKET_COMMENT_UPDATED' : 'TICKET_COMMENT_DELETED';
    await writeTicketActivity(trx, { tenant: context.resource.tenant, ticketId: context.resource.id, eventType, entityType: 'comment', entityId: context.commentId,
      actor: { actorType: 'user', ...(reference ? { actorReferenceId: reference.referenceId } : { userId: context.actor.userId }) },
      source: 'ui', occurredAt: context.updatedAt, details: { is_internal: context.audience !== 'requester', collaboration_audience: context.audience,
        thread_id: context.threadId, ...(mutation.kind === 'edit' ? { edited: true } : { deleted: true }) } });
    const payload = { tenantId: context.resource.tenant, ticketId: context.resource.id, commentId: context.commentId,
      ...(reference ? { actorType: 'COLLABORATOR' as const, actorReference: reference } : { actorType: 'USER' as const, userId: context.actor.userId }),
      isInternal: context.audience !== 'requester', collaborationMutation: { kind: mutation.kind, threadId: context.threadId, audience: context.audience } };
    const eventId = uuidv5(`${context.resource.tenant}:${eventType}`, context.operationId);
    EventSchemas[eventType].parse({ id: eventId, timestamp: context.updatedAt, eventType, payload });
    registerAfterCommit(trx, () => publishEvent({ eventType, payload } as any, { eventId }), `${eventType} comment=${context.commentId}`);
    await context.assertWriteAuthority(trx);
  });
}
