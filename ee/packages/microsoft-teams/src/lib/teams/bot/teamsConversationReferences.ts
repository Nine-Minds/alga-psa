import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';

export type TeamsConversationReferenceType = 'personal' | 'groupChat' | 'channel';

export interface TeamsConversationReferenceActivity {
  serviceUrl?: string | null;
  channelId?: string | null;
  from?: {
    id?: string | null;
    aadObjectId?: string | null;
  } | null;
  conversation?: {
    id?: string | null;
    conversationType?: string | null;
  } | null;
  channelData?: {
    tenant?: {
      id?: string | null;
    } | null;
  } | null;
}

export interface UpsertTeamsConversationReferenceInput {
  tenantId: string;
  activity: TeamsConversationReferenceActivity;
  activityAt?: string | Date;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeTeamsConversationType(value: unknown): TeamsConversationReferenceType {
  const normalized = normalizeOptionalString(value);
  if (normalized === 'groupChat') {
    return 'groupChat';
  }
  if (normalized === 'channel') {
    return 'channel';
  }
  return 'personal';
}

export async function upsertTeamsConversationReference(
  input: UpsertTeamsConversationReferenceInput
): Promise<boolean> {
  const microsoftUserId =
    normalizeOptionalString(input.activity.from?.aadObjectId) ||
    normalizeOptionalString(input.activity.from?.id);
  const conversationId = normalizeOptionalString(input.activity.conversation?.id);
  const serviceUrl = normalizeOptionalString(input.activity.serviceUrl);

  if (!microsoftUserId || !conversationId || !serviceUrl) {
    return false;
  }

  const now = input.activityAt instanceof Date
    ? input.activityAt.toISOString()
    : normalizeOptionalString(input.activityAt) || new Date().toISOString();

  try {
    const { knex, tenant } = await createTenantKnex(input.tenantId);
    const scopedTenant = tenant || input.tenantId;
    await knex('teams_conversation_references')
      .insert({
        tenant: scopedTenant,
        microsoft_user_id: microsoftUserId,
        conversation_id: conversationId,
        conversation_type: normalizeTeamsConversationType(input.activity.conversation?.conversationType),
        service_url: serviceUrl,
        tenant_id_aad: normalizeOptionalString(input.activity.channelData?.tenant?.id),
        channel_id_bot_framework: normalizeOptionalString(input.activity.channelId) || 'msteams',
        last_activity_at: now,
        updated_at: now,
      })
      .onConflict(['tenant', 'microsoft_user_id', 'conversation_id'])
      .merge({
        conversation_type: normalizeTeamsConversationType(input.activity.conversation?.conversationType),
        service_url: serviceUrl,
        tenant_id_aad: normalizeOptionalString(input.activity.channelData?.tenant?.id),
        channel_id_bot_framework: normalizeOptionalString(input.activity.channelId) || 'msteams',
        last_activity_at: now,
        updated_at: now,
      });

    return true;
  } catch (error) {
    logger.warn('[TeamsConversationReferences] Failed to upsert Teams conversation reference', {
      tenant: input.tenantId,
      microsoftUserId,
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
