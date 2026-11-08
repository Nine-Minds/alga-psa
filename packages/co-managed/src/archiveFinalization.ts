import { tenantDb } from '@alga-psa/db';
import type { CoManagedClosureContext } from './relationshipClosure';
import type { CoManagedSharedResource } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { retainCoManagedHistoricalWorkEvidence } from './historicalWorkEvidence';
import { retainCoManagedSharedConversationBeforeReduction } from './conversationParticipationEvidence';
import { classifyArchiveCandidate, registerCoManagedArchiveFileSource } from './archiveManifest';
import { CoManagedArchiveRetentionError, retainFile, retainedCoManagedArchiveFileSource } from './archiveFiles';
import { coManagedAttachmentParent } from './attachmentParent';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { hasEffectiveSharedGrant } from './effectiveSharedGrant';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedConversationAttachmentSources, coManagedConversationBodySources } from './conversationPolicy';

// This is the L7a production connection from retained participation evidence to durable bytes.
registerCoManagedArchiveFileSource(retainedCoManagedArchiveFileSource);

/**
 * Evidence sources that contribute to a closing archive beyond the built-in ticket/task history
 * (time entries, private MSP history, ...). A source runs inside the closure transaction, under
 * the relationship lock, before the manifest is sealed. Each source is responsible for its own
 * eligibility and disclosure; the seal's allowlist is the second, independent gate.
 */
export type CoManagedClosureEvidenceSource = (context: CoManagedClosureContext) => Promise<void>;
const sources = new Map<string, CoManagedClosureEvidenceSource>();
/** Idempotent per name; returns an unregister function. */
export function registerCoManagedClosureEvidenceSource(name: string, source: CoManagedClosureEvidenceSource): () => void {
  sources.set(name, source);
  return () => { if (sources.get(name) === source) sources.delete(name); };
}

/** Production composition for the archive: discover shared work from actual participation, retain
 * its history and run registered sources. Closure seals afterwards and owns the exclusive relationship lock. */
export async function finalizeCoManagedArchive(context: CoManagedClosureContext): Promise<void> {
  const { trx, sponsorTenant, customerTenant, relationshipId, operationId, cutoffAt } = context;
  if (!trx.isTransaction || sponsorTenant === customerTenant || ![sponsorTenant, customerTenant, relationshipId, operationId].every(isCoManagedUuid) ||
      !(cutoffAt instanceof Date) || !Number.isFinite(cutoffAt.getTime())) throw new CoManagedSharedWorkError();
  const customer = tenantDb(trx, customerTenant), sponsor = tenantDb(trx, sponsorTenant);
  const relationship = await customer.table('co_management_relationships').where({ relationship_id: relationshipId, sponsor_tenant: sponsorTenant, state: 'active' })
    .whereNull('ended_at').forShare().first('sponsor_client_id', 'redacted_fields');
  if (!relationship) throw new CoManagedSharedWorkError();
  // Discover from actual participation, never an oversight list; every customer source still
  // requires its effective grant inside the retainers.
  const candidates = new Map<string, CoManagedSharedResource>();
  const add = (kind: 'ticket' | 'project_task', id: string) => candidates.set(`${kind}:${id}`, { tenant: customerTenant, relationshipId, kind, id });
  for (const row of await sponsor.table('co_managed_participation_evidence').where({ customer_tenant: customerTenant, relationship_id: relationshipId,
    client_id: relationship.sponsor_client_id }).distinct('resource_type', 'resource_id')) add(row.resource_type, row.resource_id);
  for (const kind of ['ticket', 'project_task'] as const) {
    const task = kind === 'project_task', id = task ? 'task_id' : 'ticket_id';
    const commentTable = task ? 'project_task_comments' : 'comments';
    if (!await trx.schema.hasTable(commentTable) || !await trx.schema.hasTable('collaboration_actor_references')) continue;
    // Only `comments` carries actor_reference_id; project task comments have no such column, so they cannot be discovered this way.
    if (!await trx.schema.hasColumn(commentTable, 'actor_reference_id')) continue;
    const comments = customer.table(`${commentTable} as c`);
    customer.tenantJoin(comments, 'collaboration_actor_references as a', 'c.actor_reference_id', 'a.actor_reference_id');
    for (const row of await comments.where('a.actor_tenant', sponsorTenant).distinct(`c.${id}`)) add(kind, row[id]);
  }
  if (await trx.schema.hasTable('co_management_ticket_handoffs')) {
    for (const row of await customer.table('co_management_ticket_handoffs').where({ relationship_id: relationshipId, transition: 'escalated', audience: 'shared_it' })
      .distinct('ticket_id')) add('ticket', row.ticket_id);
  }
  const audits = await customer.table('audit_logs').whereIn('table_name', ['tickets', 'project_tasks'])
    .whereIn('operation', ['co_managed_ticket_assignment', 'co_managed_project_task_update', 'co_managed_project_task_assignment']).select('table_name', 'record_id', 'details');
  for (const audit of audits) {
    const details = typeof audit.details === 'string' ? JSON.parse(audit.details) : audit.details;
    if (details?.relationship_id === relationshipId && details.actor_tenant === sponsorTenant && isCoManagedUuid(audit.record_id)) {
      add(audit.table_name === 'tickets' ? 'ticket' : 'project_task', audit.record_id);
    }
  }
  const historical = { trx, sponsorTenant, customerTenant, relationshipId, cutoffAt };
  for (const resource of [...candidates.values()].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))) {
    await retainCoManagedHistoricalWorkEvidence(historical, resource);
    await retainCoManagedSharedConversationBeforeReduction(trx, resource, operationId, { cutoffAt });
  }

  // Built-in history/snapshots above produce the final participation set. Copy only attachments
  // belonging to archived, visible conversation evidence before the seal can name their bytes.
  const conversationAndFileSources = [...coManagedConversationBodySources, ...coManagedConversationAttachmentSources,
    'comments', 'comment_threads', 'co_management_conversation_drafts'];
  const customerFileSourcesHidden = isCoManagedReadFieldHidden(relationship.redacted_fields ?? [], conversationAndFileSources);
  if (!customerFileSourcesHidden) {
    const evidence = await sponsor.table('co_managed_participation_evidence').where({ customer_tenant: customerTenant,
      relationship_id: relationshipId, source_type: 'conversation' }).orderBy('evidence_id')
      .select('evidence_id', 'resource_type', 'resource_id', 'occurred_at', 'payload');
    for (const row of evidence) {
    // The current attachment surface supports ticket threads. Participation history
    // identifies where to look; it is not authorization for a newly uploaded file.
    if (row.resource_type !== 'ticket' || !isCoManagedUuid(row.resource_id)) continue;
      const candidate = { evidence_id: '', payload_hash: '', source_type: 'conversation', occurred_at: row.occurred_at, payload: row.payload };
      if (!classifyArchiveCandidate(candidate, cutoffAt).include) continue;
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      if (payload?.deleted || !['requester', 'shared_it'].includes(payload?.audience) ||
          !isCoManagedUuid(payload?.commentId) || !isCoManagedUuid(payload?.threadId)) continue;
      const resource = { tenant: customerTenant, relationshipId, kind: 'ticket' as const, id: row.resource_id };
      if (!await hasEffectiveSharedGrant(trx, resource)) continue;

    // Re-check the specific comment and its root at closure time. Old shared
    // participation evidence cannot authorize a comment that is private now.
      const comment = tenantDb(trx, customerTenant).table('comments as c')
        .where({ 'c.ticket_id': row.resource_id, 'c.thread_id': payload.threadId, 'c.comment_id': payload.commentId, 'c.publish_state': 'published' });
      tenantDb(trx, customerTenant).tenantJoin(comment, 'comment_threads as t', 'c.thread_id', 't.thread_id', {
        on: join => join.andOn('t.ticket_id', '=', 'c.ticket_id'),
      });
      tenantDb(trx, customerTenant).tenantJoin(comment, 'comments as root', 't.root_comment_id', 'root.comment_id', {
        on: join => join.andOn('root.ticket_id', '=', 'c.ticket_id').andOn('root.thread_id', '=', 'c.thread_id'),
      });
      const currentComment = await comment.where('root.publish_state', 'published').whereNull('c.deleted_at').whereNull('root.deleted_at')
        .forShare('c', 't', 'root').select({ audience: commentAudienceSql(trx, 't', 'root', 'c') }).first();
      if (!currentComment || !['requester', 'shared_it'].includes(currentComment.audience)) continue;

      const publishedDraft = tenantDb(trx, customerTenant).table('co_management_conversation_drafts as d')
        .where({ 'd.status': 'published', 'd.customer_tenant': customerTenant, 'd.relationship_id': relationshipId,
          'd.ticket_id': row.resource_id, 'd.thread_id': payload.threadId, 'd.operation_id': payload.commentId })
        .whereRaw('d.operation_id = co_management_conversation_attachments.draft_operation_id')
        .whereRaw('d.relationship_id = co_management_conversation_attachments.relationship_id');
      const source = tenantDb(trx, customerTenant).table('co_management_conversation_attachments')
        .where({ customer_tenant: customerTenant, relationship_id: relationshipId, thread_id: payload.threadId,
          comment_id: payload.commentId, status: 'ready', ...coManagedAttachmentParent({ kind: row.resource_type, id: row.resource_id }) })
        .whereNull('discarded_at').whereNull('purged_at')
        .where(query => query.whereNull('draft_operation_id').orWhereExists(publishedDraft)).forShare();
      const files = await source.select('attachment_id', 'content_hash');
      for (const file of files) {
        try {
          await retainFile(trx, { tenant: sponsorTenant, sourceTenant: customerTenant, fileId: file.attachment_id,
            hash: file.content_hash, relationshipId, clientId: relationship.sponsor_client_id, audience: currentComment.audience });
        } catch (error) {
          if (!(error instanceof CoManagedArchiveRetentionError)) throw error;
          context.retentionFailures.push({ evidenceId: String(row.evidence_id), attachmentId: String(file.attachment_id),
            status: 'retention_failed', reason: error.reason });
        }
      }
    }
  }

  // Additional owned evidence producers run after the built-in participation snapshotters and
  // before sealCoManagedArchive, so each source can see their finalized evidence set.
  for (const name of [...sources.keys()].sort()) await sources.get(name)!(context);
}
