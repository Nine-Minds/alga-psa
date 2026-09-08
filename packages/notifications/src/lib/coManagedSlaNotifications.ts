import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { fanoutCoManagedSlaNotification, isCoManagedUuid } from '@alga-psa/co-managed';
import { createNotificationRowFromTemplate } from '../actions/internal-notification-actions/createNotificationCore';
import { enqueueCoManagedNotificationDeliveries } from './coManagedDeliveryQueue';
import { coManagedSlaPresentation } from './coManagedSlaPresentation';

/** Fanout completion means every currently eligible recipient/channel has a
 * durable receipt. In-app transports and pending email receipts complete separately. */
export async function persistCoManagedSlaNotifications(db: Knex, tenant: string, limit = 100) {
  if (!isCoManagedUuid(tenant) || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid SLA notification scan');
  tenant = tenant.toLowerCase();
  const home = tenantDb(db, tenant);
  const events = await home.table('sla_organization_notification_events').where('status', 'pending')
    .orderBy('occurred_at').orderBy('notification_event_id').limit(limit).select('notification_event_id');
  let completed = 0;
  const failures: unknown[] = [];
  for (const event of events) {
    try {
      await fanoutCoManagedSlaNotification(db, tenant, event.notification_event_id, async (context, message, channel) => {
        const owner = tenantDb(context.trx, tenant);
        const key = { notification_event_id: message.eventId, recipient_user_id: context.actor.userId, channel };
        const inserted = await owner.table('sla_organization_notification_recipients').insert({ tenant, ...key })
          .onConflict(['tenant', 'notification_event_id', 'recipient_user_id', 'channel']).ignore().returning('notification_event_id');
        if (!inserted.length) {
          const prior = await owner.table('sla_organization_notification_recipients').where(key).forUpdate().first();
          if (!prior || (channel === 'in_app' && !['created', 'disabled', 'skipped'].includes(prior.status))) throw new Error('SLA notification receipt is incomplete');
          return;
        }
        if (channel === 'email') return;
        const notification = await createNotificationRowFromTemplate(context.trx, tenant, context.actor.userId, {
          tenant, user_id: context.actor.userId, template_name: `sla-${message.notificationType}`, type: message.notificationType === 'breach' ? 'error' : 'warning',
          category: 'sla', ...coManagedSlaPresentation(message),
        });
        await owner.table('sla_organization_notification_recipients').where(key).update({ status: notification ? 'created' : 'disabled',
          notification_id: notification?.internal_notification_id ?? null, completed_at: context.trx.raw('clock_timestamp()') });
        if (notification) await enqueueCoManagedNotificationDeliveries(context.trx, notification);
      });
      await home.table('sla_organization_notification_events').where({ notification_event_id: event.notification_event_id, status: 'pending' })
        .update({ status: 'completed', completed_at: db.raw('clock_timestamp()') });
      completed++;
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'SLA notification fanout remains pending');
  return { examined: events.length, completed };
}
