import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions';
import {
  normalizeEntraNotificationConfig,
  type EntraNotification,
  type EntraNotificationConfig,
} from './entraSyncNotificationRules';

/**
 * Delivery for the notifications entraSyncNotificationRules decided.
 *
 * Kept apart from the rules so the rules stay importable — and testable —
 * without dragging the notification stack (and next-auth behind it) into the
 * module graph.
 */

export async function getEntraNotificationConfig(
  knex: Knex,
  tenantId: string
): Promise<EntraNotificationConfig> {
  const row = await tenantDb(knex, tenantId).table('entra_sync_settings')
    .first(['notification_config']);
  return normalizeEntraNotificationConfig(row?.notification_config);
}

async function findEntraNotificationRecipients(knex: Knex, tenantId: string): Promise<string[]> {
  const db = tenantDb(knex, tenantId);
  const query = db.table('users')
    .where('users.user_type', 'internal')
    .whereRaw('LOWER(roles.role_name) = ?', ['admin'])
    .whereNot('users.is_inactive', true)
    .distinct('users.user_id');
  db.tenantJoin(query, 'user_roles', 'user_roles.user_id', 'users.user_id');
  db.tenantJoin(query, 'roles', 'roles.role_id', 'user_roles.role_id');

  const rows = (await query) as unknown as Array<{ user_id: string }>;
  return rows.map((row) => row.user_id);
}

/**
 * Deliver decided notifications to the tenant's admins. Best effort in both
 * directions: a delivery failure never fails the sync, and a sync that failed
 * still gets its alert out.
 */
export async function deliverEntraNotifications(params: {
  knex: Knex;
  tenantId: string;
  notifications: EntraNotification[];
}): Promise<number> {
  if (params.notifications.length === 0) {
    return 0;
  }

  let recipients: string[] = [];
  try {
    recipients = await findEntraNotificationRecipients(params.knex, params.tenantId);
  } catch (error) {
    logger.warn('[entra] Failed to enumerate notification recipients', {
      tenantId: params.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }

  let delivered = 0;
  for (const userId of recipients) {
    for (const notification of params.notifications) {
      try {
        await createNotificationFromTemplateInternal(params.knex, {
          tenant: params.tenantId,
          user_id: userId,
          template_name: 'system-announcement',
          data: { announcementTitle: `${notification.title} — ${notification.message}` },
          link: notification.link,
        } as never);
        delivered += 1;
      } catch (error) {
        logger.warn('[entra] Failed to deliver sync notification', {
          tenantId: params.tenantId,
          userId,
          kind: notification.kind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return delivered;
}
