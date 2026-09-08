import { stageCoManagedConversationFiles } from './archiveFiles';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { projectTaskAudienceSql } from './projectTaskAudience';
import { hasEffectiveSharedGrant } from './effectiveSharedGrant';
import { appendParticipationEvidence, participationEvidenceTable, type ParticipationEvidenceContent } from './participationEvidenceStore';
import { isCoManagedUuid, CoManagedSharedWorkError } from './sharedWorkIdentity';

const eventTypes = ['TICKET_COMMENT_ADDED', 'TICKET_COMMENT_UPDATED', 'TICKET_COMMENT_DELETED',
  'PROJECT_TASK_COMMENT_CREATED', 'PROJECT_TASK_COMMENT_UPDATED', 'PROJECT_TASK_COMMENT_DELETED'];
const instant = (value: string | Date | null) => value ? new Date(value).toISOString() : null;

/** Only called for a newly retained canonical event inside its admitted writer.
 * Capture the actual source while sharing is effective, never a publication body
 * or a delayed dispatch projection. MSP policy still applies at archive read time.
 * This captures conversation text/identity; referenced files need their own archive. */
export async function retainCoManagedConversationParticipation(trx: Knex.Transaction, tenant: string, eventId: string): Promise<void> {
  if (!trx.isTransaction || ![tenant, eventId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const owner = tenantDb(trx, tenant);
  const event = await owner.table('co_management_event_outbox').where('event_id', eventId).forShare().first();
  if (!event) throw new CoManagedSharedWorkError();
  if (!eventTypes.includes(event.event_type) || event.publication.kind !== 'event') return;
  const task = event.resource_type === 'project_task';
  if ((!task && event.resource_type !== 'ticket') || task !== event.event_type.startsWith('PROJECT_TASK_')) throw new CoManagedSharedWorkError();
  const relationship = await owner.table('co_management_relationships').where('state', 'active').whereNull('ended_at').forShare()
    .first('relationship_id', 'sponsor_tenant', 'sponsor_client_id');
  // Native customer comments remain usable after termination/independent upgrade.
  if (!relationship) return;
  const resource = { tenant, relationshipId: relationship.relationship_id, kind: task ? 'project_task' as const : 'ticket' as const, id: event.resource_id };
  if (!await hasEffectiveSharedGrant(trx, resource)) return;
  const idColumn = task ? 'task_comment_id' : 'comment_id', workColumn = task ? 'task_id' : 'ticket_id';
  const table = task ? 'project_task_comments' : 'comments';
  const query = owner.table(`${table} as c`).where({ [`c.${idColumn}`]: event.comment_id, [`c.${workColumn}`]: resource.id, 'c.thread_id': event.thread_id });
  owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => {
    join.andOn(`t.${task ? 'project_task_id' : 'ticket_id'}`, '=', `c.${workColumn}`);
    if (task) join.andOnNull('t.ticket_id');
  } });
  owner.tenantJoin(query, `${table} as root`, 't.root_comment_id', `root.${idColumn}`, { on: join =>
    join.andOn(`root.${workColumn}`, '=', `c.${workColumn}`).andOn('root.thread_id', '=', 'c.thread_id') });
  owner.tenantJoin(query, `${table} as parent`, 'c.parent_comment_id', `parent.${idColumn}`, { type: 'left', on: join =>
    join.andOn(`parent.${workColumn}`, '=', `c.${workColumn}`).andOn('parent.thread_id', '=', 'c.thread_id') });
  if (!task) query.where('c.publish_state', 'published').where('root.publish_state', 'published');
  const comment = await query.forShare('c', 't', 'root').select('c.actor_reference_id', 'c.user_id', 'c.actor_display_name', 'c.actor_organization_name',
    'c.deleted_at', 'c.created_at', 'c.updated_at', 'c.note', 'c.markdown_content',
    ...(task ? ['c.collaboration_revision'] : ['c.contact_id', 'c.is_system_generated']), { root_deleted_at: 'root.deleted_at',
    parent_comment_id: task ? 'parent.task_comment_id' : trx.raw("CASE WHEN parent.publish_state = 'published' AND ? IN ('requester', 'shared_it') THEN parent.comment_id ELSE NULL END", [commentAudienceSql(trx, 't', 'root', 'parent')]),
    audience: task ? projectTaskAudienceSql(trx, 't') : commentAudienceSql(trx, 't', 'root', 'c') }).first();
  if (!comment || !['requester', 'shared_it'].includes(comment.audience)) return;
  const deleted = Boolean(comment.deleted_at);
  if (event.event_type.endsWith('_DELETED') && !deleted) throw new CoManagedSharedWorkError();
  // Disclosure invalidates existing tombstones as updates; retain their empty
  // identity without treating them as newly created content.
  if (deleted && (event.event_type.endsWith('_ADDED') || event.event_type.endsWith('_CREATED'))) return;
  // A deleted root cannot authorize a fresh body capture from a surviving reply.
  if (!deleted && comment.root_deleted_at) return;
  const attribution = comment.actor_reference_id ? await owner.table('collaboration_actor_references')
    .where('actor_reference_id', comment.actor_reference_id).forShare().first('actor_tenant', 'actor_user_id') : null;
  if (comment.actor_reference_id && (!attribution || ![tenant, relationship.sponsor_tenant].includes(attribution.actor_tenant))) throw new CoManagedSharedWorkError();
  const sponsor = tenantDb(trx, relationship.sponsor_tenant);
  const workKey = { customer_tenant: tenant, relationship_id: relationship.relationship_id, resource_type: resource.kind, resource_id: resource.id };
  if (attribution?.actor_tenant !== relationship.sponsor_tenant) {
    const reference = await sponsor.table(task ? 'co_managed_project_task_references' : 'co_managed_ticket_references')
      .where({ customer_tenant: tenant, relationship_id: resource.relationshipId, [task ? 'task_id' : 'ticket_id']: resource.id,
        client_id: relationship.sponsor_client_id }).forShare().first('reference_id');
    if (!reference && !await sponsor.table(participationEvidenceTable).where(workKey).first('evidence_id')) return;
  }
  const actorTenant = attribution?.actor_tenant ?? tenant;
  const userId = attribution?.actor_user_id ?? comment.user_id ?? null;
  const contactId = !userId && !task ? comment.contact_id ?? null : null;
  const actorKind = userId ? 'user' : contactId ? 'contact' : comment.is_system_generated ? 'system' : 'unknown';
  // Snapshot foreign attribution from the comment, not today's mutable directory.
  const user = !attribution && userId ? await owner.table('users').where('user_id', userId).first('first_name', 'last_name', 'email') : null;
  const contact = contactId ? await owner.table('contacts').where('contact_name_id', contactId).first('full_name') : null;
  const organization = !attribution ? await owner.table('tenants').first('client_name') : null;
  const name = comment.actor_display_name ?? ([user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || contact?.full_name || '');
  const organizationName = comment.actor_organization_name ?? organization?.client_name ?? '';
  const source = await owner.table(task ? 'project_tasks' : 'tickets').where(task ? 'task_id' : 'ticket_id', resource.id)
    .first(task ? 'task_name' : 'title', ...(task ? [] : ['ticket_number']));
  const content: ParticipationEvidenceContent = {
    client_id: relationship.sponsor_client_id, operation_id: eventId, event_type: event.event_type,
    actor_tenant: actorTenant, actor_user_id: userId, actor_kind: actorKind, actor_contact_id: contactId,
    actor_name: name, actor_organization: organizationName, occurred_at: instant(event.created_at)!,
    payload: { resourceTitle: source?.title ?? source?.task_name ?? null, ticketNumber: source?.ticket_number ?? null, commentId: event.comment_id, threadId: event.thread_id, parentCommentId: comment.parent_comment_id, audience: comment.audience,
      revision: task ? comment.collaboration_revision : null, createdAt: instant(comment.created_at),
      updatedAt: instant(comment.updated_at), deletedAt: instant(comment.deleted_at), deleted,
      ...(deleted ? {} : { note: comment.note, markdown: comment.markdown_content }) },
  };
  await appendParticipationEvidence(trx, { tenant: relationship.sponsor_tenant, ...workKey, source_type: 'conversation', source_id: eventId }, content);
  if (!task && !deleted) await stageCoManagedConversationFiles(trx, tenant, resource.id, event.comment_id);
}
