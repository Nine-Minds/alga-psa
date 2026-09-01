/**
 * Admin notifications for the inbound auth-failure auto-pause.
 *
 * Mirrors the established accounting-sync notification pattern
 * (packages/billing syncNotificationService): enumerate active internal users
 * whose role is admin (or owner, when the tenant model has that role) and
 * create one `system-announcement` internal notification per recipient.
 *
 * Delivery is strictly best-effort: per-recipient failures are logged with
 * tenant/provider/user identifiers plus the safe reason code and never roll
 * back the pause. The persistent settings banner is the durable fallback.
 *
 * Registered into the shared lifecycle service's notifier hook at app startup
 * because `shared/` cannot depend on `@alga-psa/notifications` (package cycle).
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions';
import {
  registerInboundAuthPauseNotifier,
  type InboundAuthPauseNotificationParams,
} from '@alga-psa/shared/services/email/inboundAuthPauseNotifier';
import { getAdminConnection } from '@alga-psa/db/admin';

function describeAuthFailureReason(params: InboundAuthPauseNotificationParams): string {
  switch (params.providerType) {
    case 'microsoft':
      return 'Microsoft rejected the saved sign-in for this mailbox';
    case 'google':
      return 'Google rejected the saved sign-in for this mailbox';
    default:
      return 'The mail server rejected the saved sign-in for this mailbox';
  }
}

async function findAdminUserIds(knex: Knex, tenantId: string): Promise<string[]> {
  const db = tenantDb(knex, tenantId);
  const query = db.table('users')
    .where('users.user_type', 'internal')
    .whereRaw('LOWER(roles.role_name) IN (?, ?)', ['admin', 'owner'])
    .whereNot('users.is_inactive', true)
    .distinct('users.user_id');
  db.tenantJoin(query, 'user_roles', 'user_roles.user_id', 'users.user_id');
  db.tenantJoin(query, 'roles', 'roles.role_id', 'user_roles.role_id');
  const rows = (await query) as unknown as Array<{ user_id: string }>;
  return rows.map((row) => row.user_id);
}

export async function notifyInboundAuthPauseAdmins(
  params: InboundAuthPauseNotificationParams
): Promise<void> {
  const knex = await getAdminConnection();
  const adminUserIds = await findAdminUserIds(knex, params.tenant);
  if (adminUserIds.length === 0) {
    console.warn('[InboundAuthPauseNotifications] no active admin recipients found', {
      tenant: params.tenant,
      providerId: params.providerId,
      authFailureCode: params.authFailureCode,
    });
    return;
  }

  const mailboxLabel = params.providerName || params.mailbox;
  const announcementTitle =
    `Inbound email paused for ${mailboxLabel} (${params.mailbox}) — reconnection required. ` +
    `${describeAuthFailureReason(params)} repeatedly, so ingestion was paused to stop the failure loop. ` +
    `Messages are not lost; they remain in the source mailbox. Reconnect the mailbox in Email Provider Settings to resume.`;

  let delivered = 0;
  for (const userId of adminUserIds) {
    try {
      await knex.transaction(async (trx) => {
        await createNotificationFromTemplateInternal(trx, {
          tenant: params.tenant,
          user_id: userId,
          template_name: 'system-announcement',
          data: { announcementTitle },
          link: '/msp/settings?tab=email',
        } as any);
      });
      delivered += 1;
    } catch (error) {
      console.warn('[InboundAuthPauseNotifications] per-recipient delivery failed', {
        tenant: params.tenant,
        providerId: params.providerId,
        userId,
        authFailureCode: params.authFailureCode,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.info('[InboundAuthPauseNotifications] delivered auth-pause notifications', {
    tenant: params.tenant,
    providerId: params.providerId,
    authFailureCode: params.authFailureCode,
    recipients: adminUserIds.length,
    delivered,
  });
}

export function registerInboundAuthPauseNotifications(): void {
  registerInboundAuthPauseNotifier(notifyInboundAuthPauseAdmins);
}
