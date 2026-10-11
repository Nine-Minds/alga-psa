import { enqueueCoManagedNotificationDeliveries } from '@alga-psa/notifications/lib/coManagedDeliveryQueue';
import type { Knex } from 'knex';
import type { InternalNotification } from '@alga-psa/notifications';
import { tenantDb } from '@alga-psa/db';
import { EventSchemas } from '@alga-psa/event-schemas';
import { deliverCoManagedTicketCommentToAssignees } from '@alga-psa/co-managed';
import { createNotificationRowFromTemplate } from '@alga-psa/notifications/actions/internal-notification-actions/createNotificationCore';
import { coManagedCommentPresentation } from '@alga-psa/notifications/lib/coManagedCommentPresentation';

/** Transactional in-app storage adapter. The optional server-side callback
 * registers effects on the owning transaction only for newly created rows.
 * Completed receipts do not recreate rows or replay creation effects. */
export async function persistCoManagedCommentNotifications(db: Knex, inputEvent: unknown,
  onCreated?: (trx: Knex.Transaction, notification: InternalNotification) => void): Promise<void> {
  const event = EventSchemas.TICKET_COMMENT_ADDED.parse(inputEvent);
  if (event.payload.suppressInternalNotifications === true) return;
  await deliverCoManagedTicketCommentToAssignees(db, { ownerTenant: event.payload.tenantId, ticketId: event.payload.ticketId,
    commentId: event.payload.comment.id, eventId: event.id, channel: 'in_app' }, async (context, message, deliveryKey) => {
    const home = tenantDb(context.trx, context.actor.tenant);
    const receipt = { tenant: context.actor.tenant, delivery_key: deliveryKey, event_id: event.id.toLowerCase(),
      recipient_user_id: context.actor.userId, customer_tenant: message.resource.tenant, relationship_id: message.resource.relationshipId,
      ticket_id: message.resource.id, comment_id: message.commentId };
    const inserted = await home.table('co_management_in_app_receipts').insert(receipt)
      .onConflict(['tenant', 'delivery_key']).ignore().returning('delivery_key');
    const prior = await home.table('co_management_in_app_receipts').where('delivery_key', deliveryKey).forUpdate().first();
    if (!prior || Object.entries(receipt).some(([key, value]) => prior[key] !== value)) throw new Error('Co-managed notification receipt identity conflict');
    if (!inserted.length) {
      if (!['created', 'disabled'].includes(prior.outcome)) throw new Error('Co-managed notification receipt is incomplete');
      return;
    }
    const notification = await createNotificationRowFromTemplate(context.trx, context.actor.tenant, context.actor.userId, {
      tenant: context.actor.tenant, user_id: context.actor.userId, template_name: 'ticket-comment-added', type: 'info', category: 'tickets',
      ...coManagedCommentPresentation(message, event.id, deliveryKey),
    });
    await home.table('co_management_in_app_receipts').where('delivery_key', deliveryKey).update({
      outcome: notification ? 'created' : 'disabled', notification_id: notification?.internal_notification_id ?? null,
    });
    if (notification) {
      await enqueueCoManagedNotificationDeliveries(context.trx, notification);
      onCreated?.(context.trx, notification);
    }
  });
}
