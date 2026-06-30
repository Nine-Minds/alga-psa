import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb } from '@alga-psa/db';

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

export interface GetLatestTeamsConversationReferenceInput {
  tenant: string;
  microsoftUserId: string;
  conversationType?: TeamsConversationReferenceType;
}

export interface TeamsConversationReferenceRecord {
  tenant: string;
  microsoftUserId: string;
  conversationId: string;
  conversationType: TeamsConversationReferenceType;
  serviceUrl: string;
  tenantIdAad: string | null;
  channelIdBotFramework: string | null;
  lastActivityAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
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
    await tenantDb(knex, scopedTenant).table('teams_conversation_references')
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

function normalizeTimestampForResult(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return normalizeOptionalString(value);
}

function mapConversationReferenceRow(row: Record<string, unknown>): TeamsConversationReferenceRecord {
  return {
    tenant: normalizeOptionalString(row.tenant) || '',
    microsoftUserId: normalizeOptionalString(row.microsoft_user_id) || '',
    conversationId: normalizeOptionalString(row.conversation_id) || '',
    conversationType: normalizeTeamsConversationType(row.conversation_type),
    serviceUrl: normalizeOptionalString(row.service_url) || '',
    tenantIdAad: normalizeOptionalString(row.tenant_id_aad),
    channelIdBotFramework: normalizeOptionalString(row.channel_id_bot_framework),
    lastActivityAt: normalizeTimestampForResult(row.last_activity_at),
    createdAt: normalizeTimestampForResult(row.created_at),
    updatedAt: normalizeTimestampForResult(row.updated_at),
  };
}

export async function getLatestTeamsConversationReferenceImpl(
  input: GetLatestTeamsConversationReferenceInput
): Promise<TeamsConversationReferenceRecord | null> {
  const microsoftUserId = normalizeOptionalString(input.microsoftUserId);
  const tenantId = normalizeOptionalString(input.tenant);

  if (!tenantId || !microsoftUserId) {
    return null;
  }

  try {
    const { knex, tenant } = await createTenantKnex(tenantId);
    const scopedTenant = tenant || tenantId;
    const conversationType = input.conversationType ?? 'personal';
    const row = await tenantDb(knex, scopedTenant).table('teams_conversation_references')
      .where({
        microsoft_user_id: microsoftUserId,
        conversation_type: conversationType,
      })
      .orderBy('last_activity_at', 'desc')
      .first([
        'tenant',
        'microsoft_user_id',
        'conversation_id',
        'conversation_type',
        'service_url',
        'tenant_id_aad',
        'channel_id_bot_framework',
        'last_activity_at',
        'created_at',
        'updated_at',
      ]);

    return row ? mapConversationReferenceRow(row) : null;
  } catch (error) {
    logger.warn('[TeamsConversationReferences] Failed to read Teams conversation reference', {
      tenant: input.tenant,
      microsoftUserId,
      conversationType: input.conversationType ?? 'personal',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
