import type { Knex } from 'knex';
import { tenantDb, type TenantDb } from '@alga-psa/db';
import type { IOpportunity, IOpportunityEvidence, OpportunityCheckpoint, OpportunityEvidenceRefType, OpportunityEvidenceSource, OpportunityStage } from '@alga-psa/types';
import { OpportunityModel } from '../models/opportunityModel';
import { buildOpportunityStageChangedPayload } from './opportunityEventBuilders';
import { publishOpportunityEventAfterCommit } from './opportunityEvents';

const checkpointStage: Record<OpportunityCheckpoint, OpportunityStage> = { qualified: 'qualified', assessment: 'assessment', proposed: 'proposed', verbal: 'verbal', won: 'won' };
const stageRank: Record<OpportunityStage, number> = { identified: 0, qualified: 1, assessment: 2, proposed: 3, verbal: 4, won: 5, lost: 5 };
export type ManuallyDeclaredOpportunityStage = Exclude<OpportunityStage, 'won' | 'lost'>;

export function evidenceIdsAboveStage(
  evidence: Array<Pick<IOpportunityEvidence, 'evidence_id' | 'checkpoint'>>,
  stage: ManuallyDeclaredOpportunityStage,
): string[] {
  const targetRank = stageRank[stage];
  return evidence
    .filter((item) => stageRank[checkpointStage[item.checkpoint]] > targetRank)
    .map((item) => item.evidence_id);
}

export function buildStageDeclarationPlan(
  evidence: Array<Pick<IOpportunityEvidence, 'evidence_id' | 'checkpoint'>>,
  stage: ManuallyDeclaredOpportunityStage,
  detail?: string | null,
) {
  return {
    correctionEvidenceIds: evidenceIdsAboveStage(evidence, stage),
    evidence: stage === 'identified'
      ? null
      : {
          checkpoint: stage,
          source: 'user_declared' as const,
          detail: detail?.trim() || `Stage manually set to ${stage}`,
        },
  };
}

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
  if (input.refType == null) existingQuery.whereNull('ref_type');
  else existingQuery.where('ref_type', input.refType);
  if (input.refId == null) existingQuery.whereNull('ref_id');
  else existingQuery.where('ref_id', input.refId);
  const existing = await existingQuery.first<IOpportunityEvidence>();
  if (existing) return existing;
  const [created] = await db.table('opportunity_evidence').insert({ tenant, opportunity_id: input.opportunityId, checkpoint: input.checkpoint, source: input.source, ref_type: input.refType ?? null, ref_id: input.refId ?? null, detail: input.detail ?? null, recorded_by: input.recordedBy ?? null, recorded_at: new Date().toISOString() }).returning('*') as IOpportunityEvidence[];
  await updateDerivedStage(trx, tenant, opportunity, created.evidence_id);
  return created;
}

/** A citation a user may attach to a stage declaration. */
export interface DeclarationRef {
  type: Extract<OpportunityEvidenceRefType, 'interaction' | 'document'>;
  id: string;
}

export const OPPORTUNITY_REF_REFUSAL = 'That source is not attached to this opportunity';

/** Thrown when a cited source is missing, foreign, cross-tenant or of an unsupported type. */
export class OpportunityEvidenceRefError extends Error {
  constructor(message: string = OPPORTUNITY_REF_REFUSAL) {
    super(message);
    this.name = 'OpportunityEvidenceRefError';
  }
}

/**
 * The single guard for a cited source: it must belong to this opportunity in
 * this tenant. The picker is a convenience; this is the control. Only
 * interactions and documents may be cited by a declaration — quote, contract,
 * project and schedule_entry stay system-only.
 */
export async function assertRefBelongsToOpportunity(
  db: Pick<TenantDb, 'table'>,
  tenant: string,
  opportunityId: string,
  ref: { type: string; id: string },
): Promise<void> {
  if (ref.type === 'interaction') {
    const row = await db.table('interactions')
      .where({ tenant, interaction_id: ref.id, opportunity_id: opportunityId })
      .first();
    if (!row) throw new OpportunityEvidenceRefError();
    return;
  }
  if (ref.type === 'document') {
    // The tenant constraint sits on the association itself, not only the document.
    const row = await db.table('document_associations')
      .where({ tenant, document_id: ref.id, entity_type: 'opportunity', entity_id: opportunityId })
      .first();
    if (!row) throw new OpportunityEvidenceRefError();
    return;
  }
  throw new OpportunityEvidenceRefError('Only an interaction or a document can be cited by a stage declaration');
}

/**
 * Records a user's explicit stage declaration. Moving backward corrects every
 * active checkpoint above the requested stage before the new stage is derived.
 */
export async function declareStage(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  stage: ManuallyDeclaredOpportunityStage,
  recordedBy: string,
  detail?: string | null,
  ref?: DeclarationRef | null,
): Promise<IOpportunity> {
  const db = tenantDb(trx, tenant);
  const opportunity = await db.table('opportunities')
    .where({ opportunity_id: opportunityId })
    .forUpdate()
    .first<IOpportunity>();
  if (!opportunity) throw new Error('Opportunity not found');
  if (opportunity.status !== 'open') throw new Error('Only open opportunities can change stage');
  // A citation on "identified" has no checkpoint to ride on; ignore it rather than store it.
  const citation = stage === 'identified' ? null : ref ?? null;
  if (citation) await assertRefBelongsToOpportunity(db, tenant, opportunityId, citation);

  const activeEvidence = await db.table('opportunity_evidence')
    .where({ opportunity_id: opportunityId })
    .whereNull('corrected_at') as IOpportunityEvidence[];
  const correctionAt = new Date().toISOString();
  const plan = buildStageDeclarationPlan(activeEvidence, stage, detail);

  if (plan.correctionEvidenceIds.length > 0) {
    await db.table('opportunity_evidence')
      .whereIn('evidence_id', plan.correctionEvidenceIds)
      .update({
        correction_note: `Stage manually set to ${stage}`,
        corrected_by: recordedBy,
        corrected_at: correctionAt,
      });
  }

  if (plan.evidence) {
    // One live declaration per checkpoint: a declaration with a different (or
    // no) citation supersedes the old one. The same citation is a no-op via
    // recordEvidence's de-dupe. Rows already corrected above are skipped.
    const alreadyCorrected = new Set(plan.correctionEvidenceIds);
    const superseded = activeEvidence.filter((item) =>
      item.checkpoint === plan.evidence!.checkpoint
      && item.source === 'user_declared'
      && !alreadyCorrected.has(item.evidence_id)
      && ((item.ref_type ?? null) !== (citation?.type ?? null) || (item.ref_id ?? null) !== (citation?.id ?? null)));
    if (superseded.length > 0) {
      await db.table('opportunity_evidence')
        .whereIn('evidence_id', superseded.map((item) => item.evidence_id))
        .update({
          correction_note: 'Superseded by a new declaration',
          corrected_by: recordedBy,
          corrected_at: correctionAt,
        });
    }
  }

  if (!plan.evidence) {
    await updateDerivedStage(trx, tenant, opportunity, `user_declared:${recordedBy}:${correctionAt}`);
  } else {
    await recordEvidence(trx, tenant, {
      opportunityId,
      ...plan.evidence,
      refType: citation?.type ?? null,
      refId: citation?.id ?? null,
      recordedBy,
    });
  }

  const afterEvidence = await OpportunityModel.getById(trx, tenant, opportunityId);
  if (!afterEvidence) throw new Error('Opportunity not found after stage declaration');
  await updateDerivedStage(
    trx,
    tenant,
    afterEvidence,
    `user_declared:${recordedBy}:${correctionAt}`,
  );

  const updated = await OpportunityModel.getById(trx, tenant, opportunityId);
  if (!updated) throw new Error('Opportunity not found after stage declaration');
  return updated;
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
