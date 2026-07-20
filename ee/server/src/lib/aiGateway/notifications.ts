import type { Knex } from 'knex';

import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions';
import { getConnection } from '@/lib/db/db';

import type { AiCreditsError, AiFeature } from './types';

type BackgroundAiFeature = Exclude<AiFeature, 'chat' | 'chat-title'>;

const NOTIFICATION_THROTTLE_MS = 24 * 60 * 60 * 1000;
const lastNotificationAt = new Map<string, number>();

async function findAdminUserIds(knex: Knex, tenantId: string): Promise<string[]> {
  const db = tenantDb(knex, tenantId);
  const query = db.table('users')
    .where('users.user_type', 'internal')
    .whereRaw('LOWER(roles.role_name) = ?', ['admin'])
    .whereNot('users.is_inactive', true)
    .distinct('users.user_id');
  db.tenantJoin(query, 'user_roles', 'user_roles.user_id', 'users.user_id');
  db.tenantJoin(query, 'roles', 'roles.role_id', 'user_roles.role_id');
  const rows = await query as Array<{ user_id: string }>;
  return rows.map((row) => row.user_id);
}

function notificationMessage(feature: BackgroundAiFeature, error: AiCreditsError): string {
  const reason = error.reason === 'no_subscription'
    ? 'the AI add-on does not have an active subscription'
    : error.reason === 'out_of_credits'
      ? 'the workspace has run out of AI credits'
      : 'AI data-sharing consent is required';
  return `The ${feature} AI surface used its non-AI fallback because ${reason}. Review AI Usage in billing settings.`;
}

/** Best-effort tenant-admin notice, throttled to one attempt per tenant and surface per day. */
export async function notifyAiCreditsUnavailable(
  tenantId: string,
  feature: BackgroundAiFeature,
  error: AiCreditsError,
): Promise<void> {
  const throttleKey = `${tenantId}:${feature}`;
  const now = Date.now();
  const lastSentAt = lastNotificationAt.get(throttleKey);
  if (lastSentAt !== undefined && now - lastSentAt < NOTIFICATION_THROTTLE_MS) {
    return;
  }
  lastNotificationAt.set(throttleKey, now);

  try {
    const knex = await getConnection(tenantId);
    const userIds = await findAdminUserIds(knex, tenantId);
    const announcementTitle = notificationMessage(feature, error);

    for (const userId of userIds) {
      await createNotificationFromTemplateInternal(knex, {
        tenant: tenantId,
        user_id: userId,
        template_name: 'system-announcement',
        type: 'warning',
        category: 'system',
        link: '/msp/settings?tab=account',
        data: { announcementTitle },
        metadata: {
          ai_feature: feature,
          ai_credits_reason: error.reason,
        },
      });
    }
  } catch (notificationError) {
    logger.warn('[aiGateway] Failed to deliver AI credits admin notification', {
      tenantId,
      feature,
      reason: error.reason,
      error: notificationError instanceof Error
        ? notificationError.message
        : String(notificationError),
    });
  }
}
