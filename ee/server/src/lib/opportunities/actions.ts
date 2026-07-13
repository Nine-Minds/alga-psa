'use server';

import { z } from 'zod';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { TIER_FEATURES } from '@alga-psa/types';
import type {
  IForecastBand,
  IOpportunity,
  IOpportunityCommitment,
  IOpportunityMeetingReview,
  IOpportunityMeetingSessionDetail,
  IOpportunityQbrTriggerPack,
  IOpportunityQbrYieldRow,
  ISellerCalibration,
  ISellerOpportunityRollup,
  OpportunityPeriod,
} from '@alga-psa/types';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { getForecastBandData, getSellerCalibrationData } from './forecast';
import {
  createCommitmentData,
  deleteCommitmentData,
  getActiveMeetingSessionData,
  listCommitmentsData,
  markDealReviewedData,
  startMeetingSessionData,
  updateCommitmentData,
} from './meetingCommitments';
import {
  createOpportunitiesFromQbrTriggersData,
  getQbrTriggerPackData,
  getQbrYieldData,
} from './qbr';
import { getSellerRollupsData } from './rollups';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const opportunityPeriodSchema = z.object({
  start: dateSchema,
  end: dateSchema,
}).refine((period) => period.start <= period.end, {
  message: 'Period start must be on or before period end',
  path: ['end'],
});

export const meetingReviewSchema = z.object({
  session_id: z.string().uuid(),
  opportunity_id: z.string().uuid(),
  note: z.string().trim().max(4000).nullable().optional(),
});

export const createCommitmentSchema = z.object({
  description: z.string().trim().min(1).max(4000),
});

const commitmentResolutionSchema = z.enum([
  'open',
  'quote_line',
  'agreement_line',
  'project_task',
  'declined',
]);

export const updateCommitmentSchema = z.object({
  description: z.string().trim().min(1).max(4000).optional(),
  resolution_status: commitmentResolutionSchema.optional(),
  resolution_ref_id: z.string().uuid().nullable().optional(),
}).superRefine((input, ctx) => {
  if (!Object.values(input).some((value) => value !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one field is required' });
  }
  if (
    input.resolution_status
    && ['quote_line', 'agreement_line', 'project_task'].includes(input.resolution_status)
    && !input.resolution_ref_id
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resolution_ref_id is required for linked resolutions',
      path: ['resolution_ref_id'],
    });
  }
  if ((input.resolution_status === 'open' || input.resolution_status === 'declined') && input.resolution_ref_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resolution_ref_id is not valid for open or declined commitments',
      path: ['resolution_ref_id'],
    });
  }
});

export const createQbrOpportunitiesSchema = z.object({
  trigger_keys: z.array(z.string().trim().min(1)).min(1).max(100),
});

function actorId(user: any): string {
  if (!user?.user_id) throw new Error('User is not logged in');
  return String(user.user_id);
}

async function requireManagementAccess(
  user: unknown,
  action: 'create' | 'read' | 'update' | 'delete',
): Promise<void> {
  await assertTierAccess(TIER_FEATURES.OPPORTUNITY_MANAGEMENT);
  if (!await hasPermission(user as any, 'opportunities', action)) {
    throw new Error(`Permission denied: opportunities ${action} required`);
  }
}

/** Non-throwing probe so pages can decide whether to surface management UI. */
export const getManagementAvailability = withAuth(async (user): Promise<boolean> => {
  try {
    await requireManagementAccess(user, 'read');
    return true;
  } catch {
    return false;
  }
});

export const getForecastBand = withAuth(async (
  user,
  { tenant },
  input: OpportunityPeriod,
): Promise<IForecastBand> => {
  await requireManagementAccess(user, 'read');
  const period = opportunityPeriodSchema.parse(input) as OpportunityPeriod;
  const { knex } = await createTenantKnex(tenant);
  return getForecastBandData(knex, tenant, period);
});

export const getOpportunityCalibration = withAuth(async (
  user,
  { tenant },
): Promise<ISellerCalibration[]> => {
  await requireManagementAccess(user, 'read');
  const { knex } = await createTenantKnex(tenant);
  return getSellerCalibrationData(knex, tenant);
});

export const startMeetingSession = withAuth(async (
  user,
  { tenant },
): Promise<IOpportunityMeetingSessionDetail> => {
  await requireManagementAccess(user, 'read');
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, (trx) => startMeetingSessionData(trx, tenant, actorId(user)));
});

export const markDealReviewed = withAuth(async (
  user,
  { tenant },
  input: unknown,
): Promise<IOpportunityMeetingReview> => {
  await requireManagementAccess(user, 'update');
  const data = meetingReviewSchema.parse(input);
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, (trx) => markDealReviewedData(
    trx,
    tenant,
    data.session_id,
    data.opportunity_id,
    data.note ?? null,
  ));
});

export const getActiveMeetingSession = withAuth(async (
  user,
  { tenant },
): Promise<IOpportunityMeetingSessionDetail | null> => {
  await requireManagementAccess(user, 'read');
  const { knex } = await createTenantKnex(tenant);
  return getActiveMeetingSessionData(knex, tenant, actorId(user));
});

export const listOpportunityCommitments = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
): Promise<IOpportunityCommitment[]> => {
  await requireManagementAccess(user, 'read');
  const id = z.string().uuid().parse(opportunityId);
  const { knex } = await createTenantKnex(tenant);
  return listCommitmentsData(knex, tenant, id);
});

export const createOpportunityCommitment = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  input: unknown,
): Promise<IOpportunityCommitment> => {
  await requireManagementAccess(user, 'update');
  const id = z.string().uuid().parse(opportunityId);
  const data = createCommitmentSchema.parse(input);
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, (trx) => createCommitmentData(
    trx,
    tenant,
    id,
    data.description,
    actorId(user),
  ));
});

export const updateOpportunityCommitment = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  commitmentId: string,
  input: unknown,
): Promise<IOpportunityCommitment> => {
  await requireManagementAccess(user, 'update');
  const [opportunity, commitment] = [opportunityId, commitmentId].map((id) => z.string().uuid().parse(id));
  const data = updateCommitmentSchema.parse(input);
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, (trx) => updateCommitmentData(
    trx,
    tenant,
    opportunity,
    commitment,
    data,
    actorId(user),
  ));
});

export const deleteOpportunityCommitment = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  commitmentId: string,
): Promise<void> => {
  await requireManagementAccess(user, 'delete');
  const [opportunity, commitment] = [opportunityId, commitmentId].map((id) => z.string().uuid().parse(id));
  const { knex } = await createTenantKnex(tenant);
  await withTransaction(knex, (trx) => deleteCommitmentData(trx, tenant, opportunity, commitment));
});

export const getQbrTriggerPack = withAuth(async (
  user,
  { tenant },
  clientId: string,
): Promise<IOpportunityQbrTriggerPack> => {
  await requireManagementAccess(user, 'read');
  const id = z.string().uuid().parse(clientId);
  const { knex } = await createTenantKnex(tenant);
  return getQbrTriggerPackData(knex, tenant, id);
});

export const createOpportunitiesFromTriggers = withAuth(async (
  user,
  { tenant },
  clientId: string,
  triggerKeys: string[],
): Promise<IOpportunity[]> => {
  await requireManagementAccess(user, 'create');
  const id = z.string().uuid().parse(clientId);
  const data = createQbrOpportunitiesSchema.parse({ trigger_keys: triggerKeys });
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, (trx) => createOpportunitiesFromQbrTriggersData(
    trx,
    tenant,
    id,
    data.trigger_keys,
    actorId(user),
  ));
});

export const getQbrYield = withAuth(async (
  user,
  { tenant },
): Promise<IOpportunityQbrYieldRow[]> => {
  await requireManagementAccess(user, 'read');
  const { knex } = await createTenantKnex(tenant);
  return getQbrYieldData(knex, tenant);
});

export const getSellerRollups = withAuth(async (
  user,
  { tenant },
  input: OpportunityPeriod,
): Promise<ISellerOpportunityRollup[]> => {
  await requireManagementAccess(user, 'read');
  const period = opportunityPeriodSchema.parse(input) as OpportunityPeriod;
  const { knex } = await createTenantKnex(tenant);
  return getSellerRollupsData(knex, tenant, period);
});

export {
  deleteOpportunityVoiceProfile,
  generateFollowUpDraft,
  getOpportunityVoiceProfile,
  logDraftSent,
  saveOpportunityVoiceProfile,
} from './draftingActions';
