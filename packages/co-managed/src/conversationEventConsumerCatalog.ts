import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
const TABLE = 'co_management_event_consumers';
export type CoManagedEventConsumer = 'search-index' | 'internal-notifications' | 'co-managed-email' | 'customer-internal-email';
export function coManagedConversationEventConsumers(eventType: string): CoManagedEventConsumer[] {
  if (eventType === 'TICKET_COMMENT_ADDED') return ['search-index', 'internal-notifications', 'co-managed-email', 'customer-internal-email'];
  return ['TICKET_COMMENT_UPDATED', 'TICKET_COMMENT_DELETED'].includes(eventType) ? ['search-index'] : [];
}
/** Declared before initial publication, so even a consumer that never receives
 * the first Redis message has a durable recovery obligation. */
export async function enqueueCoManagedEventConsumers(trx: Knex.Transaction, tenant: string, eventId: string, eventType: string) {
  const rows = coManagedConversationEventConsumers(eventType).map(consumer => ({ tenant, event_id: eventId, consumer }));
  if (rows.length) await tenantDb(trx, tenant).table(TABLE).insert(rows).onConflict(['tenant', 'event_id', 'consumer']).ignore();
}
