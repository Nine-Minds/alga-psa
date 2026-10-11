import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { InternalNotification } from '@alga-psa/notifications';
import { deliverCoManagedTaskCommentToAssignees } from '@alga-psa/co-managed';
import { createNotificationRowFromTemplate } from '@alga-psa/notifications/actions/internal-notification-actions/createNotificationCore';
import { coManagedCommentPresentation } from '@alga-psa/notifications/lib/coManagedCommentPresentation';
import { enqueueCoManagedNotificationDeliveries } from '@alga-psa/notifications/lib/coManagedDeliveryQueue';

/** Called only by the retained event consumer, using its reconstructed intent. */
export async function persistCoManagedTaskCommentNotifications(db: Knex, input: { eventId: string; ownerTenant: string; taskId: string; commentId: string },
  onCreated?: (trx: Knex.Transaction, notification: InternalNotification) => void) {
  input = { ...input, eventId: typeof input.eventId === 'string' ? input.eventId.toLowerCase() : input.eventId };
  await deliverCoManagedTaskCommentToAssignees(db, { ...input, channel: 'in_app' }, async (context, message, deliveryKey) => {
    const home = tenantDb(context.trx, context.actor.tenant);
    const receipt = { tenant: context.actor.tenant, delivery_key: deliveryKey, event_id: input.eventId, recipient_user_id: context.actor.userId,
      customer_tenant: message.resource.tenant, relationship_id: message.resource.relationshipId, resource_type: 'project_task', resource_id: message.resource.id,
      ticket_id: null, comment_id: message.commentId };
    const inserted = await home.table('co_management_in_app_receipts').insert(receipt).onConflict(['tenant', 'delivery_key']).ignore().returning('delivery_key');
    const current = await home.table('co_management_in_app_receipts').where('delivery_key', deliveryKey).forUpdate().first();
    if (!current || Object.entries(receipt).some(([key, value]) => current[key] !== value)) throw new Error('Task notification receipt identity conflict');
    if (!inserted.length) { if (!['created', 'disabled'].includes(current.outcome)) throw new Error('Task notification receipt incomplete'); return; }
    const notification = await createNotificationRowFromTemplate(context.trx, context.actor.tenant, context.actor.userId, {
      tenant: context.actor.tenant, user_id: context.actor.userId, template_name: 'task-comment-added', type: 'info', category: 'projects',
      ...coManagedCommentPresentation(message, input.eventId, deliveryKey),
    });
    await home.table('co_management_in_app_receipts').where('delivery_key', deliveryKey).update({ outcome: notification ? 'created' : 'disabled', notification_id: notification?.internal_notification_id ?? null });
    if (notification) { await enqueueCoManagedNotificationDeliveries(context.trx, notification); onCreated?.(context.trx, notification); }
  });
}
