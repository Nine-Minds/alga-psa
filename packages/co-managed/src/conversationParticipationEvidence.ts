import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { retainCoManagedWorkSnapshot } from './workSnapshotEvidence';
import type { CoManagedSharedResource } from './sharedWork';
import { hasEffectiveSharedGrant } from './effectiveSharedGrant';
import { appendCommentSnapshotEvidence, appendParticipationEvidence, participationEvidenceTable, type ParticipationEvidenceContent } from './participationEvidenceStore';
import { isCoManagedUuid, CoManagedSharedWorkError } from './sharedWorkIdentity';

// Ticket conversations only. Project-task conversations arrive with L4c, and attachment bytes
// with L4b; this file captures the comment text and attribution that was actually shared.
const ticketEventTypes = ['TICKET_COMMENT_ADDED', 'TICKET_COMMENT_UPDATED', 'TICKET_COMMENT_DELETED'] as const;
export type CoManagedConversationCaptureEvent = typeof ticketEventTypes[number];
const instant = (value: string | Date | null) => value ? new Date(value).toISOString() : null;

/** A writer that removes its source row outright has to capture the evidence
 * while the row is still readable, so the capture necessarily runs before the
 * deletion rather than after it. Such a writer says so with this intent; it is
 * a code-level constant of the deleting command, never derived from a request,
 * and it is honoured only for a `_DELETED` capture. Without it, a `_DELETED`
 * capture of a row that carries no `deleted_at` is still refused. */
export interface CoManagedCaptureIntent { precedesSourceRemoval?: boolean }

export interface CoManagedConversationCapture {
  /** The canonical comment event id (idempotency identity of this capture). */
  eventId: string; eventType: CoManagedConversationCaptureEvent; ticketId: string; commentId: string; threadId: string; occurredAt: string | Date;
}

/** Called for a newly published canonical comment event inside its admitted writer (the L0b comment-event
 * contributor, or the shared adapter). Captures the actual source while sharing is effective, never a
 * publication body or a delayed dispatch projection. MSP policy still applies at archive read time. */
export async function retainCoManagedConversationParticipation(trx: Knex.Transaction, tenant: string, event: CoManagedConversationCapture,
  intent: CoManagedCaptureIntent = {}): Promise<void> {
  if (!trx.isTransaction || ![tenant, event.eventId, event.ticketId, event.commentId, event.threadId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  if (!(ticketEventTypes as readonly string[]).includes(event.eventType)) return;
  if (intent.precedesSourceRemoval !== undefined && typeof intent.precedesSourceRemoval !== 'boolean') throw new CoManagedSharedWorkError();
  if (intent.precedesSourceRemoval && !event.eventType.endsWith('_DELETED')) throw new CoManagedSharedWorkError();
  await captureSharedConversation(trx, { tenant, kind: 'ticket', id: event.ticketId }, event.commentId, event.threadId,
    { sourceId: event.eventId, operationId: event.eventId, eventType: event.eventType, occurredAt: event.occurredAt,
      precedesSourceRemoval: intent.precedesSourceRemoval === true });
}

/** Called only inside a sharing reduction that already retains the relationship
 * lock. This snapshots current permitted source rows, without publishing fake
 * comment events or inventing an MSP user. Replay belongs to that command's
 * receipt; a failed reduction rolls its snapshots back with the grant change. */
export async function retainCoManagedSharedConversationBeforeReduction(trx: Knex.Transaction, resource: CoManagedSharedResource, operationId: string,
  scope: { threadId?: string; cutoffAt?: Date } = {}): Promise<void> {
  if (!trx.isTransaction || ![resource.tenant, resource.relationshipId, resource.id, operationId].every(isCoManagedUuid) ||
      !['ticket', 'project_task'].includes(resource.kind) || (scope.threadId !== undefined && !isCoManagedUuid(scope.threadId)) ||
      (scope.cutoffAt !== undefined && (!(scope.cutoffAt instanceof Date) || !Number.isFinite(scope.cutoffAt.getTime())))) throw new CoManagedSharedWorkError();
  const owner = tenantDb(trx, resource.tenant);
  const occurredAt = scope.cutoffAt ? new Date(scope.cutoffAt) : (await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at;
  // L4c adds the task conversation store; until then a task has no shared conversation to retain.
  if (resource.kind === 'ticket') {
    const comments = await owner.table('comments').where('ticket_id', resource.id)
      .modify(q => { if (scope.threadId) q.where('thread_id', scope.threadId); }).orderBy('comment_id').select('comment_id', 'thread_id');
    for (const comment of comments) {
      if (!comment.thread_id) continue;
      await captureSharedConversation(trx, { tenant: resource.tenant, relationshipId: resource.relationshipId, kind: 'ticket', id: resource.id }, comment.comment_id, comment.thread_id, { sourceId: randomUUID(), operationId,
        eventType: 'TICKET_COMMENT_ARCHIVED', occurredAt, snapshot: true });
    }
  }
  if (!scope.threadId) await retainCoManagedWorkSnapshot(trx, resource, operationId, new Date(occurredAt));
}

async function captureSharedConversation(trx: Knex.Transaction,
  input: { tenant: string; kind: 'ticket' | 'project_task'; id: string; relationshipId?: string }, commentId: string, threadId: string,
  capture: { sourceId: string; operationId: string; eventType: string; occurredAt: string | Date; precedesSourceRemoval?: boolean; snapshot?: boolean }): Promise<void> {
  if (input.kind !== 'ticket') return;
  const { tenant } = input, owner = tenantDb(trx, tenant);
  const relationship = await owner.table('co_management_relationships').where('state', 'active').whereNull('ended_at')
    .modify(q => { if (input.relationshipId) q.where('relationship_id', input.relationshipId); }).forShare()
    .first('relationship_id', 'sponsor_tenant', 'sponsor_client_id');
  // Native customer comments remain usable after termination/independent upgrade.
  if (!relationship) return;
  const resource = { tenant, relationshipId: relationship.relationship_id, kind: 'ticket' as const, id: input.id };
  if (!await hasEffectiveSharedGrant(trx, resource)) return;
  const query = owner.table('comments as c').where({ 'c.comment_id': commentId, 'c.ticket_id': resource.id, 'c.thread_id': threadId });
  owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.ticket_id', '=', 'c.ticket_id') });
  owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join =>
    join.andOn('root.ticket_id', '=', 'c.ticket_id').andOn('root.thread_id', '=', 'c.thread_id') });
  owner.tenantJoin(query, 'comments as parent', 'c.parent_comment_id', 'parent.comment_id', { type: 'left', on: join =>
    join.andOn('parent.ticket_id', '=', 'c.ticket_id').andOn('parent.thread_id', '=', 'c.thread_id') });
  query.where('c.publish_state', 'published').where('root.publish_state', 'published');
  const comment = await query.forShare('c', 't', 'root').select('c.actor_reference_id', 'c.user_id', 'c.actor_display_name', 'c.actor_organization_name',
    'c.deleted_at', 'c.created_at', 'c.updated_at', 'c.note', 'c.markdown_content', 'c.contact_id', 'c.is_system_generated',
    { parent_comment_id: trx.raw("CASE WHEN parent.publish_state = 'published' AND ? IN ('requester', 'shared_it') THEN parent.comment_id ELSE NULL END", [commentAudienceSql(trx, 't', 'root', 'parent')]),
      audience: commentAudienceSql(trx, 't', 'root', 'c') }).first();
  // Only audiences the MSP could read are ever retained; organisation-private customer notes never are.
  if (!comment || !['requester', 'shared_it'].includes(comment.audience)) return;
  // A removal that takes the row with it leaves nothing to read afterwards, so
  // its writer captures first and declares that here. Anything else claiming a
  // deletion must carry the tombstone the source already wrote.
  const removing = capture.precedesSourceRemoval === true && capture.eventType.endsWith('_DELETED');
  const deleted = Boolean(comment.deleted_at) || removing;
  if (capture.eventType.endsWith('_DELETED') && !deleted) throw new CoManagedSharedWorkError();
  // A tombstone keeps its empty identity but is not newly created content.
  if (deleted && capture.eventType.endsWith('_ADDED')) return;
  const attribution = comment.actor_reference_id ? await owner.table('collaboration_actor_references')
    .where('actor_reference_id', comment.actor_reference_id).forShare().first('actor_tenant', 'actor_user_id') : null;
  if (comment.actor_reference_id && (!attribution || ![tenant, relationship.sponsor_tenant].includes(attribution.actor_tenant))) throw new CoManagedSharedWorkError();
  const sponsor = tenantDb(trx, relationship.sponsor_tenant);
  const workKey = { customer_tenant: tenant, relationship_id: relationship.relationship_id, resource_type: resource.kind, resource_id: resource.id };
  if (attribution?.actor_tenant !== relationship.sponsor_tenant) {
    // L3: the sponsor-side reference table lands later; before it, only prior evidence proves participation.
    const reference = await trx.schema.hasTable('co_managed_ticket_references') ? await sponsor.table('co_managed_ticket_references')
      .where({ customer_tenant: tenant, relationship_id: resource.relationshipId, ticket_id: resource.id, client_id: relationship.sponsor_client_id })
      .forShare().first('reference_id') : null;
    if (!reference && !await sponsor.table(participationEvidenceTable).where(workKey).first('evidence_id')) return;
  }
  const actorTenant = attribution?.actor_tenant ?? tenant;
  const userId = attribution?.actor_user_id ?? comment.user_id ?? null;
  const contactId = !userId ? comment.contact_id ?? null : null;
  const actorKind = userId ? 'user' : contactId ? 'contact' : comment.is_system_generated ? 'system' : 'unknown';
  // Snapshot foreign attribution from the comment, not today's mutable directory.
  const user = !attribution && userId ? await owner.table('users').where('user_id', userId).first('first_name', 'last_name', 'email') : null;
  const contact = contactId ? await owner.table('contacts').where('contact_name_id', contactId).first('full_name') : null;
  const organization = !attribution ? await owner.table('tenants').first('client_name') : null;
  const name = comment.actor_display_name ?? ([user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || contact?.full_name || '');
  const organizationName = comment.actor_organization_name ?? organization?.client_name ?? '';
  const source = await owner.table('tickets').where('ticket_id', resource.id).first('title', 'ticket_number');
  const content: ParticipationEvidenceContent = {
    client_id: relationship.sponsor_client_id, operation_id: capture.operationId, event_type: capture.eventType,
    actor_tenant: actorTenant, actor_user_id: userId, actor_kind: actorKind, actor_contact_id: contactId,
    actor_name: name, actor_organization: organizationName, occurred_at: instant(capture.occurredAt)!,
    payload: { resourceTitle: source?.title ?? null, ticketNumber: source?.ticket_number ?? null, commentId, threadId, parentCommentId: comment.parent_comment_id,
      audience: comment.audience, revision: null, createdAt: instant(comment.created_at), updatedAt: instant(comment.updated_at),
      deletedAt: instant(comment.deleted_at) ?? (removing ? instant(capture.occurredAt) : null), deleted,
      ...(deleted ? {} : { note: comment.note, markdown: comment.markdown_content }) },
  };
  await (capture.snapshot ? appendCommentSnapshotEvidence : appendParticipationEvidence)(trx,
    { tenant: relationship.sponsor_tenant, ...workKey, source_type: 'conversation', source_id: capture.sourceId }, content);
}
