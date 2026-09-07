import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { EventSchemas } from '@alga-psa/event-schemas';
import { deliverCoManagedTicketCommentToAssignees } from '@alga-psa/co-managed';
import { createNotificationRowFromTemplate } from '@alga-psa/notifications/actions/internal-notification-actions/createNotificationCore';
import { extractTicketRichTextPlainText } from '@alga-psa/tickets/lib/ticketRichText';

/** Transactional in-app storage adapter. Caller/worker transport must separately
 * enforce qualified inbox and broadcast access before connecting this adapter
 * to the event subscriber. No realtime, email, Teams, or push effects run here. */
export async function persistCoManagedCommentNotifications(db: Knex, inputEvent: unknown): Promise<void> {
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
    const authorName = message.author?.displayName
      ? [message.author.displayName, message.author.organizationName ? `(${message.author.organizationName})` : ''].filter(Boolean).join(' ')
      : '—';
    const commentPreview = Array.from(extractTicketRichTextPlainText(message.note)).slice(0, 200).join('');
    const notification = await createNotificationRowFromTemplate(context.trx, context.actor.tenant, context.actor.userId, {
      tenant: context.actor.tenant, user_id: context.actor.userId, template_name: 'ticket-comment-added', type: 'info', category: 'tickets',
      link: `/msp/co-management/tickets/${message.resource.tenant}/${message.resource.relationshipId}/${message.resource.id}`,
      data: { authorName, ticketId: message.ticketNumber ?? '—', commentPreview },
      // Never flatten foreign source/author IDs into native ticketId/userId keys.
      metadata: { coManaged: { version: 1, resource: message.resource, commentId: message.commentId, threadId: message.threadId,
        audience: message.audience, deliveryKey, eventId: event.id.toLowerCase(), ...(message.author ? { author: message.author } : {}) } },
    });
    await home.table('co_management_in_app_receipts').where('delivery_key', deliveryKey).update({
      outcome: notification ? 'created' : 'disabled', notification_id: notification?.internal_notification_id ?? null,
    });
  });
}
