import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { MarketingInteractionTypeName } from '@alga-psa/types';
import { getMarketingInteractionTypeId } from './interactionTypes';

export interface MarketingEngagementInput {
  typeName: MarketingInteractionTypeName;
  title: string;
  notes?: string | null;
  /** Null for audience-level events (e.g. a published post with no single contact). */
  contactId?: string | null;
  clientId?: string | null;
  /** interactions.user_id is NOT NULL — pass the acting user, or the owning
   *  user for system events (enrollment's enrolled_by, form's created_by). */
  userId: string;
  campaignId?: string | null;
  contentId?: string | null;
  postId?: string | null;
  stepId?: string | null;
  occurredAt?: string;
}

/**
 * Records a marketing touchpoint: one row in `interactions` (the log — shows
 * up on contact/opportunity timelines with no UI registration) plus one row in
 * `marketing_engagements` (the join back to the machine). Must be called
 * inside the caller's transaction so the pair commits atomically.
 */
export async function recordMarketingEngagement(
  trx: Knex.Transaction,
  tenant: string,
  input: MarketingEngagementInput,
): Promise<{ interactionId: string; engagementId: string }> {
  const db = tenantDb(trx, tenant);
  const typeId = await getMarketingInteractionTypeId(trx, tenant, input.typeName);
  const occurredAt = input.occurredAt ?? new Date().toISOString();

  const [interaction] = await db.table('interactions')
    .insert({
      tenant,
      type_id: typeId,
      contact_name_id: input.contactId ?? null,
      client_id: input.clientId ?? null,
      user_id: input.userId,
      title: input.title,
      notes: input.notes ?? null,
      interaction_date: occurredAt,
      start_time: occurredAt,
      end_time: occurredAt,
      duration: 0,
      status_id: null,
      visibility: 'internal',
      category: 'marketing',
    })
    .returning('interaction_id');

  const [engagement] = await db.table('marketing_engagements')
    .insert({
      tenant,
      interaction_id: interaction.interaction_id,
      campaign_id: input.campaignId ?? null,
      content_id: input.contentId ?? null,
      post_id: input.postId ?? null,
      step_id: input.stepId ?? null,
    })
    .returning('engagement_id');

  return {
    interactionId: String(interaction.interaction_id),
    engagementId: String(engagement.engagement_id),
  };
}
