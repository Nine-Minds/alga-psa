import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type { InternalNotification } from '../types/internalNotification';
import type { NotificationDeliveryChannel, NotificationDeliveryResult } from './notificationTransportTypes';
import { withNotificationDelivery } from './notificationDelivery';

const TABLE = 'co_management_notification_deliveries';
const CHANNELS: NotificationDeliveryChannel[] = ['in_app', 'teams', 'push'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 10;
type Delivery = { tenant: string; notification_id: string; recipient_user_id: string; channel: NotificationDeliveryChannel; attempt_count: number };

/** Called inside the same transaction as the MSP receipt and notification. No
 * body, title, URL or customer identifiers are copied into the delivery queue. */
export async function enqueueCoManagedNotificationDeliveries(trx: Knex.Transaction, notification: InternalNotification): Promise<void> {
  if (!trx.isTransaction) throw new Error('Notification delivery enqueue requires the owning transaction');
  await tenantDb(trx, notification.tenant).table(TABLE).insert(CHANNELS.map(channel => ({ tenant: notification.tenant,
    notification_id: notification.internal_notification_id, recipient_user_id: notification.user_id, channel })))
    .onConflict(['tenant', 'notification_id', 'channel']).ignore();
}

function due(db: Knex, item: Delivery) {
  return tenantDb(db, item.tenant).table(TABLE).where({ notification_id: item.notification_id, channel: item.channel,
    recipient_user_id: item.recipient_user_id, status: 'pending' }).where('next_attempt_at', '<=', db.raw('clock_timestamp()'));
}

async function finish(trx: Knex.Transaction, item: Delivery, result: NotificationDeliveryResult): Promise<void> {
  const attempt = item.attempt_count + 1;
  const retry = result.status === 'failed' && result.retryable && attempt < MAX_ATTEMPTS;
  const rawCode = result.status === 'failed' ? result.errorCode : result.status === 'skipped' ? result.reason : null;
  const code = rawCode && /^[a-z0-9_]{1,100}$/.test(rawCode) ? rawCode : rawCode ? 'delivery_failed' : null;
  await tenantDb(trx, item.tenant).table(TABLE).where({ notification_id: item.notification_id, channel: item.channel }).update({
    status: retry ? 'pending' : result.status, attempt_count: attempt, last_error_code: code,
    next_attempt_at: retry ? trx.raw("now() + (? * interval '1 millisecond')", [Math.min(300000, 1000 * 2 ** (attempt - 1))]) : null,
    completed_at: retry ? null : trx.raw('now()'),
  });
}

/** Each channel completes independently. Source authority is acquired before
 * the delivery row lock; concurrent workers skip locked work and never deliver
 * an already completed channel. A crash rolls back the attempt, making it due
 * again. External transports are at-least-once: a provider acceptance followed
 * by process loss before commit can repeat that channel's stable notification ID. */
export async function processCoManagedNotificationDeliveries(db: Knex, tenant: string,
  perform: (channel: NotificationDeliveryChannel, notification: InternalNotification) => Promise<NotificationDeliveryResult>,
  options: { limit?: number; notificationId?: string } = {}): Promise<{ examined: number; processed: number }> {
  if (!UUID.test(tenant) || (options.notificationId !== undefined && !UUID.test(options.notificationId))) throw new Error('Invalid notification delivery scope');
  tenant = tenant.toLowerCase();
  const limit = options.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error('Invalid notification delivery batch size');
  const query = tenantDb(db, tenant).table(TABLE).where('status', 'pending').where('next_attempt_at', '<=', db.raw('clock_timestamp()'))
    .orderBy('next_attempt_at').orderBy('notification_id').orderBy('channel').limit(limit);
  if (options.notificationId) query.where('notification_id', options.notificationId);
  const items: Delivery[] = await query;
  let processed = 0;
  for (const item of items) {
    try {
      const done = await withTransaction(db, async trx => {
        // This queue only accepts co-managed receipts. Force shared
        // classification even if both the receipt and row marker are damaged.
        const locator = { tenant, user_id: item.recipient_user_id, internal_notification_id: item.notification_id,
          metadata: { coManaged: true } };
        const delivered = await withNotificationDelivery(trx, locator, async current => {
          const locked = await due(trx, item).forUpdate().skipLocked().first();
          if (!locked) return false;
          let result: NotificationDeliveryResult;
          try { result = await perform(item.channel, current); }
          catch { result = { status: 'failed', errorCode: 'transport_exception', retryable: true }; }
          if (!result || !['delivered', 'skipped', 'failed'].includes(result.status)) result = { status: 'failed', errorCode: 'invalid_transport_result', retryable: true };
          await finish(trx, locked, result);
          return true;
        });
        if (delivered !== null) return delivered;
        const locked = await due(trx, item).forUpdate().skipLocked().first();
        if (!locked) return false;
        await finish(trx, locked, { status: 'skipped', reason: 'notification_not_visible' });
        return true;
      });
      if (done) processed++;
    } catch {
      // Database/authorization loading failures are not evidence of revocation.
      // Retain retryability and never deliver cached content as a fallback.
      await withTransaction(db, async trx => {
        const locked = await due(trx, item).forUpdate().skipLocked().first();
        if (!locked) return;
        await finish(trx, locked, { status: 'failed', errorCode: 'delivery_processing_failed', retryable: true });
      });
    }
  }
  return { examined: items.length, processed };
}
