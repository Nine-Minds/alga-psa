import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { enqueueCoManagedSlaDeliveries, isCoManagedUuid } from '@alga-psa/co-managed';

/** Capture each retained crossing's recipients as pending rows in L5's delivery ledger, then complete the event.
 * Completion means every currently eligible recipient/channel is owed a ledger row; sending (and its retries) is the
 * ledger's job, run by the delivery step. */
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
      await enqueueCoManagedSlaDeliveries(db, tenant, event.notification_event_id);
      await home.table('sla_organization_notification_events').where({ notification_event_id: event.notification_event_id, status: 'pending' })
        .update({ status: 'completed', completed_at: db.raw('now()') });
      completed++;
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'SLA notification fanout remains pending');
  return { examined: events.length, completed };
}
