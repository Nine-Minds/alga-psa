import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { CO_MANAGED_ROUTING_RECIPIENTS, isCoManagedUuid, withCoManagedTicketRoutingNotification } from '@alga-psa/co-managed';
import { createNotificationRowFromTemplate } from '../actions/internal-notification-actions/createNotificationCore';
import { enqueueCoManagedNotificationDeliveries } from './coManagedDeliveryQueue';
import { coManagedRoutingPresentation } from './coManagedRoutingPresentation';

/** Canonical commands have already retained recipient/channel obligations. A
 * failed stage remains pending; retries cannot duplicate or resurrect a notice. */
export async function persistCoManagedRoutingNotifications(db: Knex, tenant: string, limit = 100) {
  if (!isCoManagedUuid(tenant) || !Number.isSafeInteger(limit) || limit < 1 || limit > 300) throw new Error('Invalid routing notification scan');
  const home = tenantDb(db, tenant), rows = await home.table(CO_MANAGED_ROUTING_RECIPIENTS).where({ channel: 'in_app', status: 'pending' })
    .orderBy('event_id').orderBy('recipient_user_id').limit(limit);
  let processed = 0; const failures: unknown[] = [];
  for (const candidate of rows) try {
    const key = { event_id: candidate.event_id, recipient_user_id: candidate.recipient_user_id, channel: 'in_app', status: 'pending' };
    await withTransaction(db, async trx => {
      const delivered = await withCoManagedTicketRoutingNotification(trx, { kind: 'notification_recipient', tenant, userId: candidate.recipient_user_id },
        candidate.event_id, 'in_app', async (context, message) => {
          const local = tenantDb(context.trx, tenant);
          if (!await local.table(CO_MANAGED_ROUTING_RECIPIENTS).where(key).forUpdate().skipLocked().first()) return false;
          const notification = await createNotificationRowFromTemplate(context.trx, tenant, context.actor.userId, {
            tenant, user_id: context.actor.userId, template_name: `co-managed-ticket-${message.transition}`, type: 'info', category: 'tickets',
            ...coManagedRoutingPresentation(message),
          });
          await local.table(CO_MANAGED_ROUTING_RECIPIENTS).where(key).update({ status: notification ? 'created' : 'disabled',
            notification_id: notification?.internal_notification_id ?? null, completed_at: trx.raw('now()') });
          if (notification) await enqueueCoManagedNotificationDeliveries(context.trx, notification);
          return true;
        });
      if (delivered !== null) return;
      const local = tenantDb(trx, tenant);
      if (await local.table(CO_MANAGED_ROUTING_RECIPIENTS).where(key).forUpdate().skipLocked().first())
        await local.table(CO_MANAGED_ROUTING_RECIPIENTS).where(key).update({ status: 'skipped', completed_at: trx.raw('now()') });
    });
    processed++;
  } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, 'Routing notification creation remains pending');
  return { examined: rows.length, processed };
}
