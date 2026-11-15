import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { mutateCoManagedTicketComment, CoManagedSharedWorkError, type CoManagedCommentMutationRequest, type CoManagedSharedResource, type CoManagedSessionActor } from '@alga-psa/co-managed';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { writeTicketActivity } from '@alga-psa/shared/lib/ticketActivity';
import { collaborationActorReferenceSchema } from '@alga-psa/event-schemas/collaboration';

/** Tombstone body: a deleted or edited root keeps its row, replies and thread audience. */
export const COMMENT_TOMBSTONE = '[deleted]';

/** Native mutation, metadata-only activity and retry receipt commit together.
 * Delete redacts the body and sets deleted_at; the thread's audience columns are
 * never written, so a tombstoned root can neither widen nor narrow its replies. */
export async function mutateSharedTicketComment(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, request: CoManagedCommentMutationRequest) {
  return mutateCoManagedTicketComment(db, actor, resource, request, async (context, mutation) => {
    const { trx } = context, tenant = context.resource.tenant, owner = tenantDb(trx, tenant);
    await context.assertWriteAuthority(trx);
    // Re-check the target and its effective audience under the row lock.
    const query = owner.table('comments as c').where({ 'c.comment_id': context.commentId, 'c.thread_id': context.threadId, 'c.ticket_id': context.resource.id });
    owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id');
    owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 't.ticket_id') });
    const target = await query.where('c.publish_state', 'published').whereNull('c.deleted_at').forUpdate('c')
      .select({ audience: commentAudienceSql(trx, 't', 'root', 'c'), actor_reference_id: 'c.actor_reference_id', is_system_generated: 'c.is_system_generated' }).first();
    if (!target || target.audience !== context.audience || target.is_system_generated || (target.actor_reference_id ?? undefined) !== context.actorReferenceId) throw new CoManagedSharedWorkError();
    if (mutation.kind === 'edit' && (typeof mutation.note !== 'string' || typeof mutation.markdown_content !== 'string')) throw new CoManagedSharedWorkError();
    await owner.table('comments').where('comment_id', context.commentId).update({ updated_at: context.updatedAt,
      ...(mutation.kind === 'edit' ? { note: mutation.note, markdown_content: mutation.markdown_content }
        : { note: COMMENT_TOMBSTONE, markdown_content: COMMENT_TOMBSTONE, deleted_at: context.updatedAt }) });
    await owner.table('comment_threads').where('thread_id', context.threadId).update({ last_activity_at: context.updatedAt });
    const saved = await owner.table('comments').where('comment_id', context.commentId).first('actor_display_name', 'actor_organization_name');
    const reference = context.actorReferenceId ? collaborationActorReferenceSchema.parse({ ownerTenantId: tenant, referenceId: context.actorReferenceId,
      tenantId: context.actor.tenant, userId: context.actor.userId, displayName: saved.actor_display_name, organizationName: saved.actor_organization_name }) : undefined;
    await writeTicketActivity(trx, { tenant, ticketId: context.resource.id,
      // No distinct delete activity type exists; details.deleted distinguishes the tombstone.
      eventType: 'TICKET_COMMENT_UPDATED', entityType: 'comment', entityId: context.commentId,
      actor: { actorType: 'user', ...(reference ? { actorReferenceId: reference.referenceId } : { userId: context.actor.userId }) },
      source: 'ui', occurredAt: context.updatedAt, details: { is_internal: context.audience !== 'requester', collaboration_audience: context.audience,
        thread_id: context.threadId, ...(mutation.kind === 'edit' ? { edited: true } : { deleted: true }) } });
    await context.assertWriteAuthority(trx);
  });
}
