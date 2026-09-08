import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { CoManagedClosureEvidenceContext } from './relationshipClosure';
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
  await capturePrivateComment(trx, { tenant: actor.tenant, customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
    resource_type: resource.kind as 'ticket' | 'project_task', resource_id: resource.id, client_id: relationship.sponsor_client_id,
    operation_id: operationId, source_id: operationId, event_type: `private_comment_${receipt.command_type}`, occurred_at: receipt.applied_at,
    resourceTitle: work?.title ?? work?.task_name ?? null, ticketNumber: work?.ticket_number ?? null }, comment);
}

/** Closure retains the MSP's own published private history, even after source
 * unsharing or explicit disclosure. All attribution/text comes from its own
 * immutable source identity; historical captions come only from prior captures.
 * No customer work row, current title or private customer content is reopened. */
export async function retainCoManagedPrivateHistoryAtClosure(context: CoManagedClosureEvidenceContext): Promise<void> {
  const { trx, sponsorTenant, customerTenant, relationshipId, operationId, cutoffAt } = context;
  if (!trx.isTransaction || sponsorTenant === customerTenant || ![sponsorTenant, customerTenant, relationshipId, operationId].every(isCoManagedUuid) ||
      !(cutoffAt instanceof Date) || !Number.isFinite(cutoffAt.getTime())) throw new CoManagedSharedWorkError();
  const relationship = await tenantDb(trx, customerTenant).table('co_management_relationships')
    .where({ relationship_id: relationshipId, sponsor_tenant: sponsorTenant, state: 'active' }).whereNull('ended_at').forShare().first('sponsor_client_id');
  if (!relationship) throw new CoManagedSharedWorkError();
  const home = tenantDb(trx, sponsorTenant), query = home.table('co_management_private_comments as c');
  home.tenantJoin(query, 'co_management_private_threads as t', 'c.thread_id', 't.thread_id');
  home.tenantJoin(query, 'co_management_private_comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 'c.thread_id') });
  home.tenantJoin(query, 'co_management_private_comments as parent', 'c.parent_comment_id', 'parent.comment_id', { type: 'left', on: join => join.andOn('parent.thread_id', '=', 'c.thread_id') });
  const comments = await query.where({ 't.customer_tenant': customerTenant, 't.relationship_id': relationshipId })
    .whereIn('t.resource_type', ['ticket', 'project_task']).orderBy('c.comment_id').forShare('c', 't', 'root')
    .select('c.*', 't.resource_type', 't.resource_id', { retained_parent_id: 'parent.comment_id' });
  for (const comment of comments) {
    const key = { customer_tenant: customerTenant, relationship_id: relationshipId, resource_type: comment.resource_type, resource_id: comment.resource_id };
    const prior = await home.table('co_managed_participation_evidence').where(key).where('client_id', relationship.sponsor_client_id)
      .whereRaw("COALESCE(payload->>'resourceTitle', CASE WHEN source_type = 'time_entry' THEN payload->>'title' END) IS NOT NULL")
      .orderBy('captured_at', 'desc').first('payload');
    await capturePrivateComment(trx, { tenant: sponsorTenant, ...key, client_id: relationship.sponsor_client_id, operation_id: operationId,
      source_id: randomUUID(), event_type: 'private_comment_archived', occurred_at: new Date(cutoffAt),
      resourceTitle: prior?.payload.resourceTitle ?? prior?.payload.title ?? null, ticketNumber: prior?.payload.ticketNumber ?? null },
    { ...comment, parent_comment_id: comment.retained_parent_id });
  }
}

async function capturePrivateComment(trx: Knex.Transaction, source: {
  tenant: string; customer_tenant: string; relationship_id: string; resource_type: 'ticket' | 'project_task'; resource_id: string;
  client_id: string; operation_id: string; source_id: string; event_type: string; occurred_at: Date | string; resourceTitle: string | null; ticketNumber: string | null;
}, comment: any): Promise<void> {
  const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
  await appendParticipationEvidence(trx, { tenant: source.tenant, customer_tenant: source.customer_tenant, relationship_id: source.relationship_id,
    resource_type: source.resource_type, resource_id: source.resource_id, source_type: 'private_conversation', source_id: source.source_id },
  { client_id: source.client_id, operation_id: source.operation_id, event_type: source.event_type,
    actor_tenant: source.tenant, actor_user_id: comment.actor_user_id, actor_kind: 'user', actor_name: comment.actor_display_name, actor_organization: comment.actor_organization_name,
    occurred_at: iso(source.occurred_at)!, payload: { resourceTitle: source.resourceTitle, ticketNumber: source.ticketNumber,
      commentId: comment.comment_id, threadId: comment.thread_id, parentCommentId: comment.parent_comment_id, revision: comment.revision, audience: 'organization_private',
      createdAt: iso(comment.created_at), updatedAt: iso(comment.updated_at), deletedAt: iso(comment.deleted_at), deleted: Boolean(comment.deleted_at),
      ...(comment.deleted_at ? {} : { note: comment.note, markdown: comment.markdown_content }) } });
  if (['ticket', 'project_task'].includes(source.resource_type) && !comment.deleted_at) await stageCoManagedPrivateConversationFiles(trx, source.tenant,
    { tenant: source.customer_tenant, relationshipId: source.relationship_id, kind: source.resource_type, id: source.resource_id }, comment.comment_id);
}
