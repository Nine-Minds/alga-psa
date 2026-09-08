import { stageCoManagedPrivateConversationFiles } from './archiveFiles';
import { tenantDb } from '@alga-psa/db';
import type { CoManagedSharedWorkContext } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { appendParticipationEvidence } from './participationEvidenceStore';

/** The actual MSP-private command receipt and comment establish owned work.
 * No private content is published to a customer event stream or copied into
 * customer storage. This hook runs before the writer's final credential check. */
export async function retainCoManagedPrivateParticipation(context: CoManagedSharedWorkContext, operationId: string) {
  const { trx, actor, resource } = context;
  if (!trx.isTransaction || context.action !== 'update' || actor.tenant === resource.tenant || !isCoManagedUuid(operationId) || !['ticket', 'project_task'].includes(resource.kind)) throw new CoManagedSharedWorkError();
  const home = tenantDb(trx, actor.tenant), customer = tenantDb(trx, resource.tenant);
  const relationship = await customer.table('co_management_relationships').where({ relationship_id: resource.relationshipId, sponsor_tenant: actor.tenant, state: 'active' })
    .whereNull('ended_at').forShare().first('sponsor_client_id');
  const receipt = await home.table('co_management_private_command_receipts').where({ operation_id: operationId, customer_tenant: resource.tenant,
    relationship_id: resource.relationshipId, resource_type: resource.kind, resource_id: resource.id, actor_user_id: actor.userId }).forShare().first();
  if (!relationship || !receipt || !['create', 'edit', 'delete'].includes(receipt.command_type)) throw new CoManagedSharedWorkError();
  const query = home.table('co_management_private_comments as c').where({ 'c.comment_id': receipt.comment_id, 'c.thread_id': receipt.thread_id, 'c.revision': receipt.revision,
    'c.actor_user_id': actor.userId });
  home.tenantJoin(query, 'co_management_private_threads as t', 'c.thread_id', 't.thread_id');
  const comment = await query.where({ 't.customer_tenant': resource.tenant, 't.relationship_id': resource.relationshipId, 't.resource_type': resource.kind, 't.resource_id': resource.id })
    .whereNull('t.disclosure_operation_id').forShare('c', 't').select('c.*').first();
  if (!comment || Boolean(comment.deleted_at) !== (receipt.command_type === 'delete')) throw new CoManagedSharedWorkError();
  const work = await customer.table(resource.kind === 'ticket' ? 'tickets' : 'project_tasks').where(resource.kind === 'ticket' ? 'ticket_id' : 'task_id', resource.id)
    .first(resource.kind === 'ticket' ? 'title' : 'task_name', ...(resource.kind === 'ticket' ? ['ticket_number'] : []));
  const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
  await appendParticipationEvidence(trx, { tenant: actor.tenant, customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
    resource_type: resource.kind as 'ticket' | 'project_task', resource_id: resource.id, source_type: 'private_conversation', source_id: operationId },
  { client_id: relationship.sponsor_client_id, operation_id: operationId, event_type: `private_comment_${receipt.command_type}`,
    actor_tenant: actor.tenant, actor_user_id: comment.actor_user_id, actor_kind: 'user', actor_name: comment.actor_display_name, actor_organization: comment.actor_organization_name,
    occurred_at: iso(receipt.applied_at)!, payload: { resourceTitle: work?.title ?? work?.task_name ?? null, ticketNumber: work?.ticket_number ?? null,
      commentId: comment.comment_id, threadId: comment.thread_id, parentCommentId: comment.parent_comment_id, revision: comment.revision, audience: 'organization_private',
      createdAt: iso(comment.created_at), updatedAt: iso(comment.updated_at), deletedAt: iso(comment.deleted_at), deleted: Boolean(comment.deleted_at),
      ...(comment.deleted_at ? {} : { note: comment.note, markdown: comment.markdown_content }) } });
  if (resource.kind === 'ticket' && !comment.deleted_at) await stageCoManagedPrivateConversationFiles(trx, actor.tenant, resource, comment.comment_id);
}
