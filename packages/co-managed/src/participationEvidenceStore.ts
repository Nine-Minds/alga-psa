import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export const participationEvidenceTable = 'co_managed_participation_evidence';
export interface ParticipationEvidenceIdentity {
  tenant: string; customer_tenant: string; relationship_id: string; resource_type: 'ticket' | 'project_task'; resource_id: string;
  source_type: 'ticket_handoff' | 'work_audit' | 'time_entry' | 'conversation' | 'private_conversation' | 'work_snapshot'; source_id: string;
}
export interface ParticipationEvidenceContent {
  client_id: string; operation_id: string; event_type: string; actor_tenant: string; actor_user_id: string | null;
  actor_kind?: 'user' | 'contact' | 'system' | 'unknown'; actor_contact_id?: string | null;
  actor_name: string; actor_organization: string; occurred_at: string; payload: Record<string, unknown>;
}

/** Source-specific adapters decide eligibility and disclosure. This lower
 * store only provides qualified append/replay semantics inside their writer. */
export async function appendParticipationEvidence(trx: Knex.Transaction, key: ParticipationEvidenceIdentity, content: ParticipationEvidenceContent) {
  if (!trx.isTransaction) throw new Error('Participation evidence requires a retained transaction');
  const owner = tenantDb(trx, key.tenant), hash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  await owner.table(participationEvidenceTable).insert({ ...key, ...content, evidence_id: randomUUID(), payload_hash: hash, captured_at: trx.raw('clock_timestamp()') })
    .onConflict(Object.keys(key)).ignore();
  const saved = await owner.table(participationEvidenceTable).where(key).first('payload_hash');
  if (saved?.payload_hash !== hash) throw new Error('Retained participation evidence does not match its original event');
}

/** What a retained comment says, as opposed to when or why it was captured: the operation, event, capture time and
 * work captions (resourceTitle/ticketNumber) belong to the capture, not to the comment. */
const commentStateFields = ['commentId', 'threadId', 'parentCommentId', 'audience', 'revision', 'createdAt', 'updatedAt', 'deletedAt', 'deleted', 'note', 'markdown'] as const;
const commentState = (content: Pick<ParticipationEvidenceContent, 'actor_tenant' | 'actor_user_id' | 'actor_name' | 'actor_organization' | 'payload'>) =>
  JSON.stringify([content.actor_tenant, content.actor_user_id ?? null, content.actor_name, content.actor_organization,
    ...commentStateFields.map(field => content.payload[field] ?? null)]);

/** Snapshots (a sharing reduction or closure re-reading current comments) are not events. A snapshot is appended
 * only when it records comment state the archive does not already hold; otherwise the comment's latest retained
 * capture already is that history, and appending it again would list the same message twice. */
export async function appendCommentSnapshotEvidence(trx: Knex.Transaction, key: ParticipationEvidenceIdentity, content: ParticipationEvidenceContent) {
  if (!trx.isTransaction) throw new Error('Participation evidence requires a retained transaction');
  const { source_id: _snapshotId, ...subject } = key;
  const latest = await tenantDb(trx, key.tenant).table(participationEvidenceTable).where(subject)
    .whereRaw("payload->>'commentId' = ?", [String(content.payload.commentId)]).orderBy('captured_at', 'desc')
    .first('actor_tenant', 'actor_user_id', 'actor_name', 'actor_organization', 'payload');
  if (latest && commentState(latest) === commentState(content)) return;
  await appendParticipationEvidence(trx, key, content);
}
