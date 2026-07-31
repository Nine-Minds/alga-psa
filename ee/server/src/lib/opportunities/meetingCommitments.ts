import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  IOpportunityCommitment,
  IOpportunityMeetingReview,
  IOpportunityMeetingSessionDetail,
  OpportunityCommitmentResolutionStatus,
} from '@alga-psa/types';

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function utcDayBounds(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function normalizeReview(row: Record<string, any>): IOpportunityMeetingReview {
  return { ...row, reviewed_at: iso(row.reviewed_at)! } as IOpportunityMeetingReview;
}

async function sessionDetail(
  knex: Knex | Knex.Transaction,
  tenant: string,
  row: Record<string, any>,
): Promise<IOpportunityMeetingSessionDetail> {
  const reviews = await tenantDb(knex, tenant).table('opportunity_meeting_reviews')
    .where({ session_id: row.session_id })
    .orderBy('reviewed_at', 'asc');
  return {
    ...row,
    started_at: iso(row.started_at)!,
    created_at: iso(row.created_at)!,
    reviews: reviews.map(normalizeReview),
  } as IOpportunityMeetingSessionDetail;
}

export async function getActiveMeetingSessionData(
  knex: Knex | Knex.Transaction,
  tenant: string,
  startedBy: string,
  now = new Date(),
): Promise<IOpportunityMeetingSessionDetail | null> {
  const bounds = utcDayBounds(now);
  const row = await tenantDb(knex, tenant).table('opportunity_meeting_sessions')
    .where({ started_by: startedBy })
    .where('started_at', '>=', bounds.start)
    .where('started_at', '<', bounds.end)
    .orderBy('started_at', 'desc')
    .first();
  return row ? sessionDetail(knex, tenant, row) : null;
}

export async function startMeetingSessionData(
  trx: Knex.Transaction,
  tenant: string,
  startedBy: string,
  now = new Date(),
): Promise<IOpportunityMeetingSessionDetail> {
  const day = now.toISOString().slice(0, 10);
  await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [
    `opportunity-meeting:${tenant}:${startedBy}:${day}`,
  ]);
  const existing = await getActiveMeetingSessionData(trx, tenant, startedBy, now);
  if (existing) return existing;
  const [created] = await tenantDb(trx, tenant).table('opportunity_meeting_sessions')
    .insert({ tenant, started_by: startedBy, started_at: now.toISOString(), created_at: now.toISOString() })
    .returning('*');
  return sessionDetail(trx, tenant, created);
}

export async function markDealReviewedData(
  trx: Knex.Transaction,
  tenant: string,
  sessionId: string,
  opportunityId: string,
  note: string | null,
  now = new Date(),
): Promise<IOpportunityMeetingReview> {
  const db = tenantDb(trx, tenant);
  const [session, opportunity] = await Promise.all([
    db.table('opportunity_meeting_sessions').where({ session_id: sessionId }).first('session_id'),
    db.table('opportunities').where({ opportunity_id: opportunityId }).first('opportunity_id'),
  ]);
  if (!session) throw new Error('Meeting session not found');
  if (!opportunity) throw new Error('Opportunity not found');
  const [review] = await db.table('opportunity_meeting_reviews')
    .insert({
      tenant,
      session_id: sessionId,
      opportunity_id: opportunityId,
      reviewed_at: now.toISOString(),
      note,
    })
    .onConflict(['tenant', 'session_id', 'opportunity_id'])
    .merge({ reviewed_at: now.toISOString(), note })
    .returning('*');
  return normalizeReview(review);
}

function normalizeCommitment(row: Record<string, any>): IOpportunityCommitment {
  return {
    ...row,
    made_at: iso(row.made_at)!,
    resolved_at: iso(row.resolved_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  } as IOpportunityCommitment;
}

export async function listCommitmentsData(
  knex: Knex | Knex.Transaction,
  tenant: string,
  opportunityId: string,
): Promise<IOpportunityCommitment[]> {
  const rows = await tenantDb(knex, tenant).table('opportunity_commitments')
    .where({ opportunity_id: opportunityId })
    .orderBy('made_at', 'asc');
  return rows.map(normalizeCommitment);
}

export async function createCommitmentData(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  description: string,
  actorId: string,
  now = new Date(),
): Promise<IOpportunityCommitment> {
  const db = tenantDb(trx, tenant);
  if (!await db.table('opportunities').where({ opportunity_id: opportunityId }).first('opportunity_id')) {
    throw new Error('Opportunity not found');
  }
  const timestamp = now.toISOString();
  const [created] = await db.table('opportunity_commitments').insert({
    tenant,
    opportunity_id: opportunityId,
    description,
    made_by: actorId,
    made_at: timestamp,
    resolution_status: 'open',
    resolution_ref_id: null,
    resolved_by: null,
    resolved_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  }).returning('*');
  return normalizeCommitment(created);
}

export interface UpdateCommitmentInput {
  description?: string;
  resolution_status?: OpportunityCommitmentResolutionStatus;
  resolution_ref_id?: string | null;
}

export async function updateCommitmentData(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  commitmentId: string,
  input: UpdateCommitmentInput,
  actorId: string,
  now = new Date(),
): Promise<IOpportunityCommitment> {
  const db = tenantDb(trx, tenant);
  const current = await db.table('opportunity_commitments')
    .where({ opportunity_id: opportunityId, commitment_id: commitmentId })
    .forUpdate()
    .first();
  if (!current) throw new Error('Commitment not found');

  const patch: Record<string, unknown> = { updated_at: now.toISOString() };
  if (input.description !== undefined) patch.description = input.description;
  if (input.resolution_status !== undefined) {
    patch.resolution_status = input.resolution_status;
    if (input.resolution_status === 'open') {
      patch.resolution_ref_id = null;
      patch.resolved_by = null;
      patch.resolved_at = null;
    } else {
      patch.resolution_ref_id = input.resolution_ref_id ?? null;
      patch.resolved_by = actorId;
      patch.resolved_at = now.toISOString();
    }
  } else if (input.resolution_ref_id !== undefined) {
    if (current.resolution_status === 'open') throw new Error('Open commitments cannot have a resolution reference');
    patch.resolution_ref_id = input.resolution_ref_id;
  }

  const [updated] = await db.table('opportunity_commitments')
    .where({ opportunity_id: opportunityId, commitment_id: commitmentId })
    .update(patch)
    .returning('*');
  return normalizeCommitment(updated);
}

export async function deleteCommitmentData(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  commitmentId: string,
): Promise<void> {
  const deleted = await tenantDb(trx, tenant).table('opportunity_commitments')
    .where({ opportunity_id: opportunityId, commitment_id: commitmentId })
    .delete();
  if (!deleted) throw new Error('Commitment not found');
}
