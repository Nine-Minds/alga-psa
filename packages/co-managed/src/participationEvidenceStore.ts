import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export const participationEvidenceTable = 'co_managed_participation_evidence';
export interface ParticipationEvidenceIdentity {
  tenant: string; customer_tenant: string; relationship_id: string; resource_type: 'ticket' | 'project_task'; resource_id: string;
  source_type: 'ticket_handoff' | 'work_audit' | 'work_snapshot'; source_id: string;
}
export interface ParticipationEvidenceContent {
  client_id: string; operation_id: string; event_type: string; actor_tenant: string; actor_user_id: string | null;
  actor_kind?: 'user' | 'contact' | 'system' | 'unknown'; actor_contact_id?: string | null;
  actor_name: string; actor_organization: string; occurred_at: string; payload: Record<string, unknown>;
}

/**
 * Source-specific adapters decide eligibility and disclosure; this lower store
 * only provides qualified append/replay semantics inside their writer.
 *
 * Retained evidence is immutable IN APP CODE (Citus skips triggers): this module
 * exports append only, and a replay of the same identity must carry the same
 * content hash or it is refused. There is deliberately no update or delete here.
 */
export async function appendParticipationEvidence(trx: Knex.Transaction, key: ParticipationEvidenceIdentity, content: ParticipationEvidenceContent) {
  if (!trx.isTransaction) throw new Error('Participation evidence requires a retained transaction');
  const owner = tenantDb(trx, key.tenant), hash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  // write-admission: exempt — co-managed policy/delegation state, written under the relationship lock after lifecycle admission (lockPolicy / getCoManagedOperationalState)
  await owner.table(participationEvidenceTable).insert({ ...key, ...content, evidence_id: randomUUID(), payload_hash: hash, captured_at: trx.raw('clock_timestamp()') })
    .onConflict(Object.keys(key)).ignore();
  const saved = await owner.table(participationEvidenceTable).where(key).first('payload_hash');
  if (saved?.payload_hash !== hash) throw new Error('Retained participation evidence does not match its original event');
}
