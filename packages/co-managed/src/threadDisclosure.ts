import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { resolveCommentAudience, type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import { type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, isCoManagedUuid, type CoManagedSessionActor } from './sharedWorkIdentity';

import { withAuthority, target, resourceSnapshot, hash, deny, invalid, conflict, CoManagedThreadDisclosureError, type CoManagedThreadReference, type CoManagedThreadDisclosurePreview, type CoManagedThreadDisclosureRequest, type CoManagedThreadDisclosureReceipt } from './threadDisclosureAdmission';
export { CoManagedThreadDisclosureError, type CoManagedThreadReference, type CoManagedThreadDisclosurePreview, type CoManagedThreadDisclosureRequest, type CoManagedThreadDisclosureReceipt } from './threadDisclosureAdmission';
/** Customer-owned threads retain their identity and files when their audience
 * changes. MSP-private storage needs a separate transfer, not a relabeled row. */
async function lockedThread(context: CoManagedSharedWorkContext, reference: CoManagedThreadReference) {
  const { trx, actor, resource } = context;
  if (reference.storeTenant !== resource.tenant) deny();
  const owner = tenantDb(trx, resource.tenant);
  const thread = await owner.table('comment_threads').where({ thread_id: reference.threadId, ticket_id: resource.id }).forUpdate().first();
  if (!thread) deny();
  const audience = resolveCommentAudience(thread);
  if (actor.tenant !== resource.tenant && audience === 'organization_private') deny();
  const comments = await owner.table('comments').where({ thread_id: reference.threadId, ticket_id: resource.id }).orderBy('comment_id').forUpdate();
  const root = comments.find(row => row.comment_id === thread.root_comment_id);
  if (!root || root.deleted_at || root.publish_state !== 'published' || root.author_type !== 'internal' || root.contact_id != null) deny();
  // The root author controls this thread's audience, under current ticket scope.
  if (actor.tenant === resource.tenant) { if (root.actor_reference_id || root.user_id !== actor.userId) deny(); }
  else if (root.user_id != null || !root.actor_reference_id || !await owner.table('collaboration_actor_references').where({ actor_reference_id: root.actor_reference_id,
    actor_tenant: actor.tenant, actor_user_id: actor.userId }).forShare().first()) deny();
  // Do not use a thread-level command to publish drafts or widen a stricter
  // legacy branch that was not part of the displayed audience.
  if (comments.some(row => row.publish_state !== 'published' || row.is_internal !== (audience !== 'requester'))) conflict();
  const drafts = await owner.table('co_management_conversation_drafts').where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
    ticket_id: resource.id, thread_id: reference.threadId }).orderBy('operation_id').forShare();
  const files = await owner.table('co_management_conversation_attachments').where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
    ticket_id: resource.id, thread_id: reference.threadId }).whereNull('discarded_at').orderBy('attachment_id').forUpdate();
  const publishedIds = new Set(drafts.filter(row => row.status === 'published').map(row => row.operation_id));
  const visibleFiles = files.filter(row => comments.some(comment => comment.comment_id === row.comment_id && !comment.deleted_at) &&
    (!row.draft_operation_id || publishedIds.has(row.draft_operation_id)));
  const preview: CoManagedThreadDisclosurePreview = { ...reference, audience,
    snapshot: hash({ resource, thread, comments, files, drafts }), comments: comments.filter(row => !row.deleted_at).length,
    attachments: visibleFiles.filter(row => row.status === 'ready').length, pendingAttachments: visibleFiles.filter(row => row.status === 'pending').length };
  return { preview, root, comments };
}
export async function previewCoManagedThreadDisclosure(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: CoManagedThreadReference): Promise<CoManagedThreadDisclosurePreview> {
  if (!input || Object.keys(input).some(key => !['storeTenant', 'threadId'].includes(key))) invalid();
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource), reference = target(input);
  return withAuthority(db, actor, resource, async context => (await lockedThread(context, reference)).preview);
}
export interface CoManagedThreadDisclosureContext extends CoManagedSharedWorkContext {
  operationId: string; threadId: string; rootCommentId: string; commentIds: string[]; previousAudience: CommentAudience; audience: CommentAudience;
  appliedAt: string; actorReferenceId?: string;
}
/** The confirmed snapshot includes every reply, tombstone, file and draft. A
 * concurrent change forces review; text-edit commands cannot widen visibility.
 * The adapter records metadata-only activity and after-commit invalidation. */
export async function discloseCoManagedTicketThread(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: CoManagedThreadDisclosureRequest, afterChange: (context: CoManagedThreadDisclosureContext) => Promise<void>): Promise<CoManagedThreadDisclosureReceipt> {
  if (!input || Object.keys(input).some(key => !['storeTenant', 'threadId', 'operationId', 'expectedSnapshot', 'audience', 'confirmed'].includes(key)) ||
    !isCoManagedUuid(input.operationId) || typeof input.expectedSnapshot !== 'string' || !/^[0-9a-f]{64}$/.test(input.expectedSnapshot) ||
    input.confirmed !== true || !['requester', 'shared_it', 'organization_private'].includes(input.audience)) invalid();
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource);
  const request = { ...target(input), operationId: input.operationId.toLowerCase(), expectedSnapshot: input.expectedSnapshot, audience: input.audience, confirmed: true };
  if (request.storeTenant !== resource.tenant || (actor.tenant !== resource.tenant && request.audience === 'organization_private')) deny();
  const requestHash = hash({ resource, actor: { tenant: actor.tenant, userId: actor.userId }, command: 'ticket_thread_audience', request });
  try {
    return await withAuthority(db, actor, resource, async context => {
      const { trx } = context, owner = tenantDb(trx, resource.tenant);
      const result = (appliedAt: Date): CoManagedThreadDisclosureReceipt => ({ storeTenant: request.storeTenant, threadId: request.threadId,
        operationId: request.operationId, audience: request.audience, appliedAt: appliedAt.toISOString() });
      // LEVERAGE: pattern co-managed-command-receipt — audience and content edits share qualified, atomic operation replay.
      const previous = await owner.table('co_management_command_receipts').where('operation_id', request.operationId).forShare().first();
      if (previous) {
        if (previous.request_hash !== requestHash) throw new CoManagedThreadDisclosureError('THREAD_DISCLOSURE_OPERATION_CONFLICT');
        return result(previous.applied_at);
      }
      const { preview, root, comments } = await lockedThread(context, request);
      if (preview.snapshot !== request.expectedSnapshot || preview.pendingAttachments > 0) conflict();
      if (preview.audience === request.audience) invalid();
      await assertCoManagedSessionUnexpired(trx, actor); await assertCoManagedOperationalWrite(trx, resource.tenant);
      const clock = await trx.raw('SELECT clock_timestamp() AS value'), appliedAt: Date = clock.rows[0].value;
      await owner.table('comment_threads').where('thread_id', request.threadId).update({ collaboration_audience: request.audience,
        is_internal: request.audience !== 'requester', last_activity_at: appliedAt });
      await owner.table('comments').where({ thread_id: request.threadId, ticket_id: resource.id }).update({ is_internal: request.audience !== 'requester',
        updated_at: trx.raw("GREATEST(clock_timestamp(), COALESCE(updated_at, '-infinity'::timestamptz) + interval '1 microsecond')") });
      await afterChange({ ...context, operationId: request.operationId, threadId: request.threadId, rootCommentId: root.comment_id, commentIds: comments.map(row => row.comment_id),
        previousAudience: preview.audience, audience: request.audience, appliedAt: appliedAt.toISOString(), actorReferenceId: root.actor_reference_id ?? undefined });
      await owner.table('co_management_command_receipts').insert({ tenant: resource.tenant, operation_id: request.operationId, relationship_id: resource.relationshipId,
        resource_type: 'ticket', resource_id: resource.id, actor_tenant: actor.tenant, actor_user_id: actor.userId,
        command_type: 'ticket_thread_audience', request_hash: requestHash, applied_at: appliedAt });
      return result(appliedAt);
    });
  } catch (error) {
    if ((error as { code?: string })?.code === '23505' && (error as { constraint?: string }).constraint === 'co_management_command_receipts_pkey') {
      throw new CoManagedThreadDisclosureError('THREAD_DISCLOSURE_OPERATION_CONFLICT');
    }
    throw error;
  }

}
