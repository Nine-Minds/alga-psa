import type { Knex } from 'knex';
import { EventSchemas, type BaseEvent } from '@alga-psa/event-schemas';
import { getConnection, registerAfterCommitWithConnection, tenantDb } from '@alga-psa/db';
import { consumeCoManagedConversationEvent, enqueueCoManagedCustomerEmailDeliveries, processCoManagedCustomerEmailDeliveries, isCoManagedUuid } from '@alga-psa/co-managed';
import { sendCoManagedCustomerCommentEmail } from '@alga-psa/jobs/handlers/coManagedCommentEmailTransport';

/** Targeted customer-technician discovery has no native requester side effects. */
export async function deliverCoManagedCustomerCommentEmailEvent(event: BaseEvent): Promise<void> {
  await handleCoManagedCustomerCommentEmailEvent(event);
}
/** Returns whether retained co-managed intent owns internal email completion.
 * Native events without that intent retain their existing delivery path. */
export async function handleCoManagedCustomerCommentEmailEvent(input: BaseEvent, connection?: Knex): Promise<boolean> {
  if (!isCoManagedUuid(input.id)) return false;
  const event = EventSchemas.TICKET_COMMENT_ADDED.parse(input);
  const db = connection ?? await getConnection(event.payload.tenantId);
  if (!await tenantDb(db, event.payload.tenantId).table('co_management_event_outbox').where('event_id', event.id).first('event_id')) return false;
  const obligation = await tenantDb(db, event.payload.tenantId).table('co_management_event_consumers')
    .where({ event_id: event.id, consumer: 'customer-internal-email' }).first('status', 'error_code');
  if (obligation?.status === 'cancelled' && obligation.error_code === 'legacy_native_delivery') return false;
  return consumeCoManagedConversationEvent(db, event as any, 'customer-internal-email', async (trx, current) => {
    const payload = current.payload as typeof event.payload;
    if (payload.suppressInternalNotifications || !payload.comment) return;
    await enqueueCoManagedCustomerEmailDeliveries(trx, { ownerTenant: payload.tenantId, ticketId: payload.ticketId, commentId: payload.comment.id, eventId: event.id });
    registerAfterCommitWithConnection(trx, root => processCoManagedCustomerEmailDeliveries(root, payload.tenantId, sendCoManagedCustomerCommentEmail).then(() => {}), 'customer technician email delivery');
  });
}
