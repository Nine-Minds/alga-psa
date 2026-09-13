import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { namedConversationNotificationKey, recoverNamedConversationAttention } from '@alga-psa/co-managed';
import { createNotificationRowFromTemplate } from '../actions/internal-notification-actions/createNotificationCore';
import { enqueueCoManagedNotificationDeliveries } from './coManagedDeliveryQueue';
import { coManagedCommentPresentation } from './coManagedCommentPresentation';

const RECEIPTS = 'ticket_conversation_notification_receipts';
/** Existing preferences, inbox rows and channel queue share fanout's transaction. */
export async function recoverNamedConversationNotifications(db: Knex, tenant: string, limit = 30) {
  return recoverNamedConversationAttention(db, tenant, 'in_app', async (context, message, source) => {
    const home = tenantDb(context.trx, context.actor.tenant), key = namedConversationNotificationKey(source, context.actor);
    const receipt = { tenant: context.actor.tenant, delivery_key: key, recipient_user_id: context.actor.userId,
      source_store_tenant: source.conversation.storeTenant, conversation_id: source.conversation.conversationId, ticket_tenant: source.ticket.tenant, ticket_id: source.ticket.ticketId,
      relationship_id: message.resource.relationshipId ?? null, comment_id: source.commentId, thread_id: source.threadId, attention_sequence: source.sequence };
    const inserted = await home.table(RECEIPTS).insert(receipt).onConflict(['tenant', 'delivery_key']).ignore().returning('delivery_key');
    const retained = await home.table(RECEIPTS).where('delivery_key', key).forUpdate().first();
    if (!retained || Object.entries(receipt).some(([field, value]) => retained[field] !== value)) throw new Error('Conversation notification receipt identity conflict');
    if (!inserted.length) {
      if (!['created', 'disabled'].includes(retained.outcome)) throw new Error('Incomplete conversation notification receipt');
      return;
    }
    const notification = await createNotificationRowFromTemplate(context.trx, context.actor.tenant, context.actor.userId, {
      tenant: context.actor.tenant, user_id: context.actor.userId, template_name: 'ticket-comment-added', type: 'info', category: 'tickets',
      ...coManagedCommentPresentation(message, source.commentId, key),
    });
    await home.table(RECEIPTS).where('delivery_key', key).update({ outcome: notification ? 'created' : 'disabled', notification_id: notification?.internal_notification_id ?? null });
    if (notification) await enqueueCoManagedNotificationDeliveries(context.trx, notification);
  }, limit);
}
