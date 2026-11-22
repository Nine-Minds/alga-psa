/**
 * Admin notifications for quarantined inbound email.
 *
 * Mirrors inboundAuthPauseNotificationService: one `system-announcement`
 * internal notification per ACTIVE internal tenant admin (role admin/owner).
 * Members and client/portal users never receive it.
 *
 * Throttle: at most one notification burst per (tenant, mailbox, reason) per
 * QUARANTINE_NOTIFICATION_WINDOW_MINUTES. The window is claimed atomically on
 * the persisted quarantine row (`notified_at`) so every server instance and
 * every runtime sees the same window — no process-local state. All admins are
 * notified together under one claim, so each admin gets at most one per window.
 *
 * Strictly best-effort: the durable row is the source of truth; failures are
 * logged and never rethrown.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions';
import {
  QUARANTINE_NOTIFICATION_WINDOW_MINUTES,
  registerInboundQuarantineNotifier,
  type InboundQuarantineNotificationParams,
  type QuarantineReason,
} from '@alga-psa/shared/services/email/inboundQuarantine';
import { getAdminConnection } from '@alga-psa/db/admin';

export const INBOUND_QUARANTINE_QUEUE_PATH = '/msp/settings/email/quarantine';

const REASON_DESCRIPTIONS: Record<QuarantineReason, string> = {
  unauthorized_thread_header_sender:
    'the sender is not a contact, watcher or recipient on the ticket it replied to',
  reply_outside_sender_audience:
    'the reply answered a notification that was restricted to a narrower audience than the sender belongs to',
  co_managed_token_refused: 'the co-managed reply link it used was refused (expired or no longer valid)',
  co_managed_token_unserved: 'the co-managed reply link it used belongs to a thread this workspace cannot accept replies for',
  co_managed_sender_unauthenticated:
    'the sender could not be verified for the co-managed reply link it used',
};

export function describeQuarantineReason(reason: string): string {
  return REASON_DESCRIPTIONS[reason as QuarantineReason] ?? 'it was refused by inbound email safety checks';
}

export function buildQuarantineAnnouncement(params: InboundQuarantineNotificationParams): string {
  const mailbox = params.mailbox || 'an inbound mailbox';
  const subject = params.subject ? `"${params.subject}"` : '(no subject)';
  const ticket = params.ticketNumber ? ` It was a reply to ticket ${params.ticketNumber}.` : '';
  return (
    `Inbound email quarantined on ${mailbox}: a message from ${params.sender || 'an unknown sender'} ` +
    `with subject ${subject} was not added to your PSA because ${describeQuarantineReason(params.reason)}.${ticket} ` +
    `Review quarantined email in Email Settings.`
  );
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

/**
 * Atomically claim the (tenant, mailbox, reason) notification window for this
 * row. Returns false when another row in the same window already notified.
 */
export async function claimQuarantineNotificationWindow(
  knex: Knex,
  params: Pick<InboundQuarantineNotificationParams, 'tenant' | 'quarantineId' | 'providerId' | 'reason'>
): Promise<boolean> {
  const db = tenantDb(knex, params.tenant);
  const priorInWindow = db.table('inbound_email_quarantine as q2')
    .select(knex.raw('1'))
    .where('q2.provider_id', params.providerId)
    .where('q2.reason', params.reason)
    .whereRaw(`q2.notified_at > now() - (? * interval '1 minute')`, [QUARANTINE_NOTIFICATION_WINDOW_MINUTES]);
  const claimed = await db.table('inbound_email_quarantine')
    .where({ id: params.quarantineId })
    .whereNull('notified_at')
    .whereNotExists(priorInWindow)
    .update({ notified_at: knex.fn.now() })
    .returning('id');
  return Array.isArray(claimed) && claimed.length > 0;
}

async function releaseQuarantineNotificationClaim(knex: Knex, tenant: string, quarantineId: string): Promise<void> {
  await tenantDb(knex, tenant).table('inbound_email_quarantine')
    .where({ id: quarantineId })
    .update({ notified_at: null });
}

export async function notifyInboundQuarantineAdmins(
  params: InboundQuarantineNotificationParams
): Promise<void> {
  const knex = await getAdminConnection();

  if (!(await claimQuarantineNotificationWindow(knex, params))) {
    console.info('[InboundQuarantineNotifications] throttled (window already notified)', {
      tenant: params.tenant,
      providerId: params.providerId,
      reason: params.reason,
    });
    return;
  }

  const adminUserIds = await findAdminUserIds(knex, params.tenant);
  if (adminUserIds.length === 0) {
    console.warn('[InboundQuarantineNotifications] no active admin recipients found', {
      tenant: params.tenant,
      providerId: params.providerId,
      reason: params.reason,
    });
    await releaseQuarantineNotificationClaim(knex, params.tenant, params.quarantineId);
    return;
  }

  const announcementTitle = buildQuarantineAnnouncement(params);
  let delivered = 0;
  for (const userId of adminUserIds) {
    try {
      await knex.transaction(async (trx) => {
        await createNotificationFromTemplateInternal(trx, {
          tenant: params.tenant,
          user_id: userId,
          template_name: 'system-announcement',
          data: { announcementTitle },
          link: INBOUND_QUARANTINE_QUEUE_PATH,
        } as any);
      });
      delivered += 1;
    } catch (error) {
      console.warn('[InboundQuarantineNotifications] per-recipient delivery failed', {
        tenant: params.tenant,
        quarantineId: params.quarantineId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (delivered === 0) {
    // Nobody was told: do not let this row burn the window.
    await releaseQuarantineNotificationClaim(knex, params.tenant, params.quarantineId).catch(() => undefined);
  }
  console.info('[InboundQuarantineNotifications] delivered quarantine notifications', {
    tenant: params.tenant,
    quarantineId: params.quarantineId,
    recipients: adminUserIds.length,
    delivered,
  });
}

export function registerInboundQuarantineNotifications(): void {
  registerInboundQuarantineNotifier(notifyInboundQuarantineAdmins);
}
