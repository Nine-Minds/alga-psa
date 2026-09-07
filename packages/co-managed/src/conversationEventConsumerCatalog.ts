import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
const TABLE = 'co_management_event_consumers';
export type CoManagedEventConsumer = 'search-index' | 'internal-notifications' | 'co-managed-email' | 'customer-internal-email' | 'requester-email';
export function coManagedConversationEventConsumers(eventType: string): CoManagedEventConsumer[] {
  if (eventType === 'TICKET_COMMENT_ADDED') return ['search-index', 'internal-notifications', 'co-managed-email', 'customer-internal-email', 'requester-email'];
  if (eventType === 'PROJECT_TASK_COMMENT_CREATED') return ['search-index', 'internal-notifications'];
  return ['TICKET_COMMENT_UPDATED', 'TICKET_COMMENT_DELETED', 'PROJECT_TASK_COMMENT_UPDATED', 'PROJECT_TASK_COMMENT_DELETED'].includes(eventType) ? ['search-index'] : [];
}
export function coManagedConsumerAllowedForChannel(channel: string | undefined, consumer: CoManagedEventConsumer): boolean {
  return channel !== 'internal-notifications' || consumer === 'internal-notifications';
}
/** Declared before initial publication, so even a consumer that never receives
 * the first Redis message has a durable recovery obligation. */
export async function enqueueCoManagedEventConsumers(trx: Knex.Transaction, tenant: string, eventId: string, eventType: string,
  options: { channel?: 'internal-notifications' } = {}) {
  const rows = coManagedConversationEventConsumers(eventType).map(consumer => {
    const excluded = !coManagedConsumerAllowedForChannel(options.channel, consumer);
    return { tenant, event_id: eventId, consumer, status: excluded ? 'cancelled' : 'pending',
      completed_at: excluded ? trx.raw('clock_timestamp()') : null, error_code: excluded ? 'publication_channel_excluded' : null };
  });
  if (rows.length) await tenantDb(trx, tenant).table(TABLE).insert(rows).onConflict(['tenant', 'event_id', 'consumer']).ignore();
}
