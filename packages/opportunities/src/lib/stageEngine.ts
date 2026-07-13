import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IOpportunity, IOpportunityEvidence, OpportunityCheckpoint, OpportunityEvidenceRefType, OpportunityEvidenceSource, OpportunityStage } from '@alga-psa/types';
import { OpportunityModel } from '../models/opportunityModel';
import { buildOpportunityStageChangedPayload } from './opportunityEventBuilders';
import { publishOpportunityEventAfterCommit } from './opportunityEvents';

const checkpointStage: Record<OpportunityCheckpoint, OpportunityStage> = { qualified: 'qualified', assessment: 'assessment', proposed: 'proposed', verbal: 'verbal', won: 'won' };
const stageRank: Record<OpportunityStage, number> = { identified: 0, qualified: 1, assessment: 2, proposed: 3, verbal: 4, won: 5, lost: 5 };

export function deriveOpportunityStage(opportunity: Pick<IOpportunity, 'status'>, evidence: Array<Pick<IOpportunityEvidence, 'checkpoint' | 'corrected_at'>>): OpportunityStage {
  if (opportunity.status === 'won') return 'won';
  if (opportunity.status === 'lost') return 'lost';
  return evidence.reduce<OpportunityStage>((furthest, item) => {
    if (item.corrected_at) return furthest;
    const candidate = checkpointStage[item.checkpoint];
    return stageRank[candidate] > stageRank[furthest] ? candidate : furthest;
  }, 'identified');
}

export interface RecordEvidenceInput {
  opportunityId: string;
  checkpoint: OpportunityCheckpoint;
  source: OpportunityEvidenceSource;
  refType?: OpportunityEvidenceRefType | null;
  refId?: string | null;
  detail?: string | null;
  recordedBy?: string | null;
}

async function updateDerivedStage(trx: Knex.Transaction, tenant: string, opportunity: IOpportunity, cause: string): Promise<void> {
  const active = await tenantDb(trx, tenant).table('opportunity_evidence').where({ opportunity_id: opportunity.opportunity_id }).whereNull('corrected_at') as IOpportunityEvidence[];
  const nextStage = deriveOpportunityStage(opportunity, active);
  if (nextStage === opportunity.stage) return;
  await OpportunityModel.update(trx, tenant, opportunity.opportunity_id, { stage: nextStage });
  const changedAt = new Date().toISOString();
  const payload = buildOpportunityStageChangedPayload({ opportunityId: opportunity.opportunity_id, clientId: opportunity.client_id, previousStage: opportunity.stage, newStage: nextStage, changedAt });
  publishOpportunityEventAfterCommit(trx, tenant, 'OPPORTUNITY_STAGE_CHANGED', payload, `opportunity_stage_changed:${opportunity.opportunity_id}:${nextStage}:${cause}`);
}

export async function recordEvidence(trx: Knex.Transaction, tenant: string, input: RecordEvidenceInput): Promise<IOpportunityEvidence> {
  const db = tenantDb(trx, tenant);
  const opportunity = await db.table('opportunities').where({ opportunity_id: input.opportunityId }).forUpdate().first<IOpportunity>();
  if (!opportunity) throw new Error('Opportunity not found');
  const existingQuery = db.table('opportunity_evidence').where({ opportunity_id: input.opportunityId, checkpoint: input.checkpoint }).whereNull('corrected_at');
  input.refType == null ? existingQuery.whereNull('ref_type') : existingQuery.where('ref_type', input.refType);
  input.refId == null ? existingQuery.whereNull('ref_id') : existingQuery.where('ref_id', input.refId);
  const existing = await existingQuery.first<IOpportunityEvidence>();
  if (existing) return existing;
  const [created] = await db.table('opportunity_evidence').insert({ tenant, opportunity_id: input.opportunityId, checkpoint: input.checkpoint, source: input.source, ref_type: input.refType ?? null, ref_id: input.refId ?? null, detail: input.detail ?? null, recorded_by: input.recordedBy ?? null, recorded_at: new Date().toISOString() }).returning('*') as IOpportunityEvidence[];
  await updateDerivedStage(trx, tenant, opportunity, created.evidence_id);
  return created;
}

export async function correctEvidence(trx: Knex.Transaction, tenant: string, evidenceId: string, correctionNote: string, correctedBy: string): Promise<IOpportunityEvidence> {
  const note = correctionNote.trim();
  if (!note) throw new Error('A correction note is required');
  const db = tenantDb(trx, tenant);
  const current = await db.table('opportunity_evidence').where({ evidence_id: evidenceId }).whereNull('corrected_at').first<IOpportunityEvidence>();
  if (!current) throw new Error('Active opportunity evidence not found');
  const [corrected] = await db.table('opportunity_evidence').where({ evidence_id: evidenceId }).update({ correction_note: note, corrected_by: correctedBy, corrected_at: new Date().toISOString() }).returning('*') as IOpportunityEvidence[];
  const opportunity = await OpportunityModel.getById(trx, tenant, current.opportunity_id);
  if (!opportunity) throw new Error('Opportunity not found');
  await updateDerivedStage(trx, tenant, opportunity, corrected.evidence_id);
  return corrected;
}

