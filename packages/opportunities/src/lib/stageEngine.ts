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
) {
  return {
    correctionEvidenceIds: evidenceIdsAboveStage(evidence, stage),
    // The declaration's note and sources are written by writeDeclaration; the
    // plan only says which checkpoint is declared.
    evidence: stage === 'identified'
      ? null
      : { checkpoint: stage, source: 'user_declared' as const },
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
 * What a declaration says: a written note and the sources behind it. Patch
 * semantics, so a caller that has nothing to say about one half loses nothing:
 * `undefined` keeps the live declaration's value; `null` / `''` (note) and `[]`
 * (citations) clear it.
 */
export interface DeclarationContent {
  note?: string | null;
  citations?: DeclarationRef[];
}

/**
 * Turns a caller's wire shape into engine content. `refType` / `refId` are the
 * single-citation shorthand (the schemas refuse them beside `citations`).
 * Unsupported types are passed through on purpose: the engine's guard refuses them.
 */
export function declarationContentFromInput(input: {
  detail?: string | null;
  citations?: Array<{ type: string; id: string }>;
  refType?: string | null;
  refId?: string | null;
}): DeclarationContent {
  const citations = input.citations
    ?? (input.refType != null && input.refId != null ? [{ type: input.refType, id: input.refId }] : undefined);
  return { note: input.detail, citations: citations as DeclarationRef[] | undefined };
}

/** A declaration holds at most this many sources. */
export const MAX_DECLARATION_CITATIONS = 25;

export type OpportunityDeclarationErrorCode = 'checkpoint_not_reached' | 'checkpoint_not_amendable' | 'too_many_citations';

/** Typed refusal from the declaration engine; callers map `code` to their own surface. */
export class OpportunityDeclarationError extends Error {
  constructor(public readonly code: OpportunityDeclarationErrorCode, message: string) {
    super(message);
    this.name = 'OpportunityDeclarationError';
  }
}

export type AmendableCheckpoint = Exclude<OpportunityCheckpoint, 'won'>;

interface ResolvedDeclaration {
  note: string | null;
  citations: DeclarationRef[];
}

function normalizeNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}

/** First occurrence wins; a (type, id) pair is stored once. */
function dedupeCitations(citations: DeclarationRef[]): DeclarationRef[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.type}:${citation.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameDeclaration(a: ResolvedDeclaration, b: ResolvedDeclaration): boolean {
  return a.note === b.note
    && a.citations.length === b.citations.length
    && a.citations.every((citation, index) => citation.type === b.citations[index].type && citation.id === b.citations[index].id);
}

/**
 * The only code that inserts or supersedes a `user_declared` row for a
 * checkpoint. Resolves `content` against the live declaration (patch
 * semantics), guards every citation the edit introduces, and writes nothing when the
 * result equals what is already there. A change supersedes the live row with
 * a correction and inserts its replacement with the citation rows; the
 * replacement inherits `recorded_at` / `recorded_by`, because that is when the
 * stage was evidenced. Who edited, and when, is the superseded row's
 * `corrected_by` / `corrected_at`.
 *
 * `ensureRow` is for declaring a stage, which needs a declaration row even
 * when it has nothing to say; an amendment with no live declaration and nothing
 * to say writes nothing.
 */
async function writeDeclaration(
  db: TenantDb,
  tenant: string,
  opportunityId: string,
  checkpoint: OpportunityCheckpoint,
  recordedBy: string,
  content: DeclarationContent | undefined,
  options: { ensureRow: boolean },
): Promise<{ written: boolean }> {
  const liveRows = await db.table('opportunity_evidence')
    .where({ opportunity_id: opportunityId, checkpoint, source: 'user_declared' })
    .whereNull('corrected_at')
    .orderBy('recorded_at', 'asc') as IOpportunityEvidence[];

  const liveCitationRows = liveRows.length === 0
    ? []
    : await db.table('opportunity_evidence_citations')
      .whereIn('evidence_id', liveRows.map((row) => row.evidence_id))
      .orderBy('position', 'asc') as Array<{ evidence_id: string; ref_type: DeclarationRef['type']; ref_id: string }>;
  // A legacy checkpoint with several live declarations reads as the newest one.
  const live = liveRows.length > 0 ? liveRows[liveRows.length - 1] : null;
  const current: ResolvedDeclaration = {
    note: normalizeNote(live?.detail),
    citations: live
      ? liveCitationRows.filter((row) => row.evidence_id === live.evidence_id).map((row) => ({ type: row.ref_type, id: row.ref_id }))
      : [],
  };

  const supplied = content?.citations === undefined ? null : dedupeCitations(content.citations);
  if (supplied && supplied.length > MAX_DECLARATION_CITATIONS) {
    throw new OpportunityDeclarationError('too_many_citations', `A declaration can cite at most ${MAX_DECLARATION_CITATIONS} sources`);
  }
  // Only a citation this edit introduces is guarded. One already on the live declaration
  // is carried forward as-is, even if its source has since been detached ("Source removed"):
  // it was validated when recorded. One bad new citation refuses the whole write, before
  // anything is changed.
  const alreadyCited = new Set(current.citations.map((citation) => `${citation.type}:${citation.id}`));
  for (const citation of supplied ?? []) {
    if (alreadyCited.has(`${citation.type}:${citation.id}`)) continue;
    await assertRefBelongsToOpportunity(db, tenant, opportunityId, citation);
  }
  const next: ResolvedDeclaration = {
    note: content?.note === undefined ? current.note : normalizeNote(content.note),
    citations: supplied ?? current.citations,
  };

  if (live ? sameDeclaration(current, next) : !options.ensureRow && sameDeclaration(current, next)) {
    return { written: false };
  }

  const correctedAt = new Date().toISOString();
  if (liveRows.length > 0) {
    await db.table('opportunity_evidence')
      .whereIn('evidence_id', liveRows.map((row) => row.evidence_id))
      .update({ correction_note: 'Superseded by a new declaration', corrected_by: recordedBy, corrected_at: correctedAt });
  }
  const [created] = await db.table('opportunity_evidence').insert({
    tenant,
    opportunity_id: opportunityId,
    checkpoint,
    source: 'user_declared',
    ref_type: null,
    ref_id: null,
    detail: next.note,
    // The stage was reached when its first declaration was recorded, not when it was last edited.
    recorded_by: liveRows.length > 0 ? liveRows[0].recorded_by ?? null : recordedBy,
    recorded_at: liveRows.length > 0 ? liveRows[0].recorded_at : correctedAt,
  }).returning('*') as IOpportunityEvidence[];
  if (next.citations.length > 0) {
    await db.table('opportunity_evidence_citations').insert(next.citations.map((citation, position) => ({
      tenant,
      evidence_id: created.evidence_id,
      ref_type: citation.type,
      ref_id: citation.id,
      position,
    })));
  }
  return { written: true };
}

/**
 * Records a user's explicit stage declaration. Moving backward corrects every
 * active checkpoint above the requested stage before the new stage is derived.
 * `content` follows patch semantics: a declaration of a stage that already has
 * one, made with no content, leaves that declaration as it is.
 */
export async function declareStage(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  stage: ManuallyDeclaredOpportunityStage,
  recordedBy: string,
  content?: DeclarationContent,
): Promise<IOpportunity> {
  const db = tenantDb(trx, tenant);
  const opportunity = await db.table('opportunities')
    .where({ opportunity_id: opportunityId })
    .forUpdate()
    .first<IOpportunity>();
  if (!opportunity) throw new Error('Opportunity not found');
  if (opportunity.status !== 'open') throw new Error('Only open opportunities can change stage');

  const activeEvidence = await db.table('opportunity_evidence')
    .where({ opportunity_id: opportunityId })
    .whereNull('corrected_at') as IOpportunityEvidence[];
  const correctionAt = new Date().toISOString();
  const plan = buildStageDeclarationPlan(activeEvidence, stage);

  // Validate the declaration before correcting anything, so a refused citation writes nothing.
  if (plan.evidence) {
    await writeDeclaration(db, tenant, opportunityId, plan.evidence.checkpoint, recordedBy, content, { ensureRow: true });
  }
  if (plan.correctionEvidenceIds.length > 0) {
    await db.table('opportunity_evidence')
      .whereIn('evidence_id', plan.correctionEvidenceIds)
      .update({
        correction_note: `Stage manually set to ${stage}`,
        corrected_by: recordedBy,
        corrected_at: correctionAt,
      });
  }

  const afterEvidence = await OpportunityModel.getById(trx, tenant, opportunityId);
  if (!afterEvidence) throw new Error('Opportunity not found after stage declaration');
  await updateDerivedStage(trx, tenant, afterEvidence, `user_declared:${recordedBy}:${correctionAt}`);

  const updated = await OpportunityModel.getById(trx, tenant, opportunityId);
  if (!updated) throw new Error('Opportunity not found after stage declaration');
  return updated;
}

/**
 * Seeds the declaration a completed step attests to. A step never rewrites what
 * a user wrote or cited: when the checkpoint already has a live declaration it
 * is left alone, and only an empty checkpoint gets the step title as its note.
 */
export async function declareStageFromStep(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  stage: ManuallyDeclaredOpportunityStage,
  recordedBy: string,
  stepTitle: string,
): Promise<IOpportunity> {
  const live = stage === 'identified'
    ? null
    : await tenantDb(trx, tenant).table('opportunity_evidence')
      .where({ opportunity_id: opportunityId, checkpoint: stage, source: 'user_declared' })
      .whereNull('corrected_at')
      .first();
  return declareStage(trx, tenant, opportunityId, stage, recordedBy, live ? undefined : { note: stepTitle });
}

/**
 * Edits the note and sources behind a stage the deal has already reached,
 * without moving the deal: no evidence at other checkpoints is corrected, the
 * stage is not re-derived, and no OPPORTUNITY_STAGE_CHANGED is published. Works
 * on closed deals. System evidence is never edited: a checkpoint reached only
 * by system evidence gets a user declaration beside it, which then holds the
 * stage on its own. The `won` checkpoint is not amendable.
 */
export async function amendDeclaration(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  checkpoint: OpportunityCheckpoint,
  recordedBy: string,
  content: DeclarationContent,
): Promise<IOpportunity> {
  if (checkpoint === 'won') {
    throw new OpportunityDeclarationError('checkpoint_not_amendable', 'The won checkpoint cannot be edited');
  }
  const db = tenantDb(trx, tenant);
  const opportunity = await db.table('opportunities')
    .where({ opportunity_id: opportunityId })
    .forUpdate()
    .first<IOpportunity>();
  if (!opportunity) throw new Error('Opportunity not found');
  const reached = await db.table('opportunity_evidence')
    .where({ opportunity_id: opportunityId, checkpoint })
    .whereNull('corrected_at')
    .first();
  if (!reached) {
    throw new OpportunityDeclarationError('checkpoint_not_reached', `The ${checkpoint} stage has not been reached`);
  }
  await writeDeclaration(db, tenant, opportunityId, checkpoint, recordedBy, content, { ensureRow: false });
  const updated = await OpportunityModel.getById(trx, tenant, opportunityId);
  if (!updated) throw new Error('Opportunity not found after amending the declaration');
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
