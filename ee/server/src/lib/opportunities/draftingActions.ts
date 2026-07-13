'use server';

import { z } from 'zod';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { TenantEmailService } from '@alga-psa/email';
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

const sendDraftSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(100000),
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

async function resolveRecipient(knex: any, tenant: string, opportunityId: string) {
  const db = tenantDb(knex, tenant);
  const query = db.table('opportunities as o');
  db.tenantJoin(query, 'contacts as c', 'o.contact_id', 'c.contact_name_id');
  return query
    .where({ 'o.opportunity_id': opportunityId })
    .select('o.opportunity_id', 'o.client_id', 'o.contact_id', 'c.email')
    .first() as Promise<{
      opportunity_id: string;
      client_id: string;
      contact_id: string | null;
      email: string | null;
    } | undefined>;
}

export const getOpportunityFollowUpRecipient = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
): Promise<string | null> => {
  await assertOpportunityDraftingAccess(user, tenant);
  await requireOpportunityPermission(user, 'read');
  const id = z.string().uuid().parse(opportunityId);
  const { knex } = await createTenantKnex(tenant);
  const recipient = await resolveRecipient(knex, tenant, id);
  return recipient?.email?.trim() || null;
});

export const sendOpportunityFollowUp = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  input: unknown,
): Promise<{ recipient: string; messageId: string | null }> => {
  await assertOpportunityDraftingAccess(user, tenant);
  await requireOpportunityPermission(user, 'update');
  if (!await hasPermission(user, 'email', 'process')) {
    throw new Error('Permission denied: email process required');
  }
  const id = z.string().uuid().parse(opportunityId);
  const data = sendDraftSchema.parse(input);
  const actor = userId(user);
  const { knex } = await createTenantKnex(tenant);
  const resolved = await resolveRecipient(knex, tenant, id);
  if (!resolved) throw new Error('Opportunity not found or has no linked contact');
  const recipient = resolved.email?.trim();
  if (!recipient) throw new Error('The linked contact has no primary email address');

  const escapedBody = data.body
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', '<br />');
  const result = await TenantEmailService.getInstance(tenant).sendEmail({
    tenantId: tenant,
    to: [recipient],
    subject: data.subject,
    text: data.body,
    html: `<p>${escapedBody}</p>`,
    entityType: 'opportunity',
    entityId: id,
    contactId: resolved.contact_id ?? undefined,
    userId: actor,
  });
  if (!result.success || result.queued) {
    throw new Error(result.error || (result.queued
      ? 'Follow-up was queued but has not been sent yet'
      : 'Email provider did not accept the follow-up'));
  }

  const messageId = result.rfcMessageId || result.messageId || result.providerMessageId || null;
  await withTransaction(knex, (trx) => logDraftSentData(
    trx,
    tenant,
    id,
    actor,
    {
      subject: data.subject,
      summary: `To: ${recipient}\nMessage-ID: ${messageId ?? 'not provided'}\n\n${data.body}`,
    },
  ));
  return { recipient, messageId };
});
