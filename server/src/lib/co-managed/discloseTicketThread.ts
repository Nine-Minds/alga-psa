import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { uploadConversationAttachmentObject } from './conversationAttachments';
import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { discloseCoManagedThread, discloseCoManagedPrivateThread, retainCoManagedTaskCommentEvent, CoManagedSharedWorkError, CoManagedAttachmentError, CoManagedThreadDisclosureError, type CoManagedThreadDisclosureContext, type CoManagedThreadDisclosureRequest, type CoManagedSharedResource, type CoManagedSessionActor } from '@alga-psa/co-managed';
import { writeTicketActivity } from '@alga-psa/shared/lib/ticketActivity';
import { queueCoManagedConversationEvent } from './conversationEvents';
import { EventSchemas } from '@alga-psa/event-schemas';
import { collaborationActorReferenceSchema } from '@alga-psa/event-schemas/collaboration';

/** Persist the audience audit with the entire thread change, then invalidate
 * each comment's search representation without emitting its old or new body. */
export async function discloseSharedThread(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, request: CoManagedThreadDisclosureRequest) {
  const afterChange = async (context: CoManagedThreadDisclosureContext) => {
    const { trx, actor, resource } = context, owner = tenantDb(trx, resource.tenant);
    if (resource.kind === 'project_task') {
      await owner.table('audit_logs').insert({ tenant: resource.tenant, audit_id: context.operationId,
        user_id: actor.tenant === resource.tenant ? actor.userId : null, operation: 'co_managed_task_thread_audience', table_name: 'project_task_comments', record_id: context.rootCommentId,
        changed_data: {}, details: { actor_tenant: actor.tenant, actor_user_id: actor.userId, relationship_id: resource.relationshipId,
          task_id: resource.id, thread_id: context.threadId, previous_audience: context.previousAudience, audience: context.audience,
          comment_count: context.commentIds.length }, timestamp: context.appliedAt });
      for (const commentId of context.commentIds) await retainCoManagedTaskCommentEvent(trx, { tenant: resource.tenant,
        eventId: uuidv5(`${resource.tenant}:task-thread-audience:${commentId}`, context.operationId), taskId: resource.id, commentId, kind: 'audience' });
      return;
    }
    const saved = context.actorReferenceId ? await owner.table('collaboration_actor_references').where('actor_reference_id', context.actorReferenceId).first() : null;
    const reference = saved ? collaborationActorReferenceSchema.parse({ ownerTenantId: resource.tenant, referenceId: context.actorReferenceId,
      tenantId: actor.tenant, userId: actor.userId, displayName: saved.display_name, organizationName: saved.organization_name }) : undefined;
    await writeTicketActivity(trx, { tenant: resource.tenant, ticketId: resource.id, eventType: 'TICKET_COMMENT_UPDATED', entityType: 'comment', entityId: context.rootCommentId,
      actor: { actorType: 'user', ...(reference ? { actorReferenceId: reference.referenceId } : { userId: actor.userId }) }, source: 'ui', occurredAt: context.appliedAt,
      details: { is_internal: context.audience !== 'requester', collaboration_audience: context.audience, previous_audience: context.previousAudience,
        thread_id: context.threadId, audience_changed: true, comment_count: context.commentIds.length } });
    for (const commentId of context.commentIds) {
      const payload = { tenantId: resource.tenant, ticketId: resource.id, commentId,
        ...(reference ? { actorType: 'COLLABORATOR' as const, actorReference: reference } : { actorType: 'USER' as const, userId: actor.userId }),
        isInternal: context.audience !== 'requester', collaborationMutation: { kind: 'audience' as const, threadId: context.threadId, audience: context.audience } };
      const eventId = uuidv5(`${resource.tenant}:thread-audience:${commentId}`, context.operationId);
      EventSchemas.TICKET_COMMENT_UPDATED.parse({ id: eventId, timestamp: context.appliedAt, eventType: 'TICKET_COMMENT_UPDATED', payload });
      await queueCoManagedConversationEvent(trx, { tenant: resource.tenant, eventId, ticketId: resource.id, commentId, threadId: context.threadId, audience: context.audience,
        publication: { kind: 'event', eventType: 'TICKET_COMMENT_UPDATED', payload } });
    }
  };
  const customer = resource.tenant.toLowerCase();
  return request.storeTenant.toLowerCase() === customer
    ? discloseCoManagedThread(db, actor, resource, request, afterChange)
    : discloseCoManagedPrivateThread(db, actor, resource, request, {
      download: async path => (await StorageProviderFactory.createProvider()).download(path),
      upload: async (path, bytes, mime) => {
        try { await uploadConversationAttachmentObject(customer, path, bytes, mime); }
        catch (error) { if (error instanceof CoManagedAttachmentError) throw new CoManagedThreadDisclosureError('INVALID_THREAD_DISCLOSURE'); throw error; }
      },
    }, afterChange);
}

/** Legacy ticket callers retain their ticket-only contract. */
export async function discloseSharedTicketThread(...args: Parameters<typeof discloseSharedThread>) {
  if (args[2]?.kind !== 'ticket') throw new CoManagedSharedWorkError();
  return discloseSharedThread(...args);
}
