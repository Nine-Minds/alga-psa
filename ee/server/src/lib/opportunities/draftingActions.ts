'use server';

import { z } from 'zod';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type {
  IOpportunityFollowUpDraft,
  IOpportunityVoiceProfile,
} from '@alga-psa/types';
import {
  deleteOpportunityVoiceProfileData,
  generateFollowUpDraftData,
  getOpportunityVoiceProfileData,
  logDraftSentData,
  saveOpportunityVoiceProfileData,
} from './drafting';
import { assertOpportunityDraftingAccess } from './draftingAccess';

/** Non-throwing probe so pages can decide whether to surface drafting UI. */
export const getOpportunityDraftingAvailability = withAuth(async (user, { tenant }): Promise<boolean> => {
  try {
    await assertOpportunityDraftingAccess(user, tenant);
    return true;
  } catch {
    return false;
  }
});

const voiceProfileSchema = z.object({
  sample_emails: z.array(z.string().trim().min(1).max(10000)).max(10),
  steering_instructions: z.string().trim().max(5000),
}).superRefine((profile, ctx) => {
  const total = profile.sample_emails.reduce((sum, sample) => sum + sample.length, 0);
  if (total > 30000) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sample_emails'],
      message: 'Voice profile samples must total 30,000 characters or less',
    });
  }
});

const draftSentSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(5000),
});

function userId(user: any): string {
  if (!user?.user_id) throw new Error('User is not logged in');
  return String(user.user_id);
}

async function requireOpportunityPermission(user: any, action: 'read' | 'update'): Promise<void> {
  if (!await hasPermission(user, 'opportunities', action)) {
    throw new Error(`Permission denied: opportunities ${action} required`);
  }
}

export const getOpportunityVoiceProfile = withAuth(async (
  user,
  { tenant },
): Promise<IOpportunityVoiceProfile> => {
  await assertOpportunityDraftingAccess(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getOpportunityVoiceProfileData(knex, tenant, userId(user));
});

export const saveOpportunityVoiceProfile = withAuth(async (
  user,
  { tenant },
  input: unknown,
): Promise<IOpportunityVoiceProfile> => {
  await assertOpportunityDraftingAccess(user, tenant);
  const profile = voiceProfileSchema.parse(input) as IOpportunityVoiceProfile;
  const { knex } = await createTenantKnex(tenant);
  return saveOpportunityVoiceProfileData(knex, tenant, userId(user), profile);
});

export const deleteOpportunityVoiceProfile = withAuth(async (
  user,
  { tenant },
): Promise<void> => {
  await assertOpportunityDraftingAccess(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  await deleteOpportunityVoiceProfileData(knex, tenant, userId(user));
});

export const generateFollowUpDraft = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  toneAdjustment?: string,
): Promise<IOpportunityFollowUpDraft> => {
  await assertOpportunityDraftingAccess(user, tenant);
  await requireOpportunityPermission(user, 'read');
  const id = z.string().uuid().parse(opportunityId);
  const tone = z.string().trim().max(1000).optional().parse(toneAdjustment);
  const { knex } = await createTenantKnex(tenant);
  return generateFollowUpDraftData(knex, tenant, id, userId(user), tone);
});

export const logDraftSent = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  input: unknown,
): Promise<void> => {
  await assertOpportunityDraftingAccess(user, tenant);
  await requireOpportunityPermission(user, 'update');
  const id = z.string().uuid().parse(opportunityId);
  const data = draftSentSchema.parse(input) as { subject: string; summary: string };
  const { knex } = await createTenantKnex(tenant);
  await withTransaction(knex, (trx) => logDraftSentData(
    trx,
    tenant,
    id,
    userId(user),
    data,
  ));
});
