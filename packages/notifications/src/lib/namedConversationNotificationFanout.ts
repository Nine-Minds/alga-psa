import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { namedConversationNotificationCandidates, namedConversationNotificationKey, withNamedConversationNotification,
  type NamedConversationNotificationSource } from '@alga-psa/co-managed';
import { conversationUuid } from '@alga-psa/shared/lib/tickets/namedConversations';
import { createNotificationRowFromTemplate } from '../actions/internal-notification-actions/createNotificationCore';
import { enqueueCoManagedNotificationDeliveries } from './coManagedDeliveryQueue';
import { coManagedCommentPresentation } from './coManagedCommentPresentation';

const EVENTS = 'ticket_conversation_message_events', RECEIPTS = 'ticket_conversation_notification_receipts';

/** Existing template/preferences, inbox rows and delivery queue; only the source
 * receipt is conversation-specific. Source, recipient receipts, channel intents
 * and fanout completion share one transaction and replay cannot duplicate them. */
export async function recoverNamedConversationNotifications(db: Knex, tenant: string, limit = 30) {
  if (db.isTransaction || !conversationUuid(tenant) || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error('Invalid conversation notification recovery');
  tenant = tenant.toLowerCase();
  const sourceStore = tenantDb(db, tenant);
  const pending = (connection: Knex) => tenantDb(connection, tenant).table(EVENTS).whereNull('in_app_fanout_at').where('in_app_retry_at', '<=', connection.fn.now());
  const candidates = await pending(db).orderBy('in_app_retry_at').orderBy('conversation_id').orderBy('sequence').limit(limit).select('conversation_id', 'comment_id');
  const result = { processed: 0, failed: 0 };
  for (const candidate of candidates) {
    try {
      const processed = await withTransaction(db, async trx => {
        const event = await pending(trx).where(candidate).forUpdate().skipLocked().first();
        if (!event) return false;
        const conversation = await tenantDb(trx, tenant).table('ticket_conversations').where({ conversation_id: event.conversation_id,
          ticket_tenant: event.ticket_tenant, ticket_id: event.ticket_id }).first('audience', 'relationship_id');
        // Requester continues through the existing ticket notification matrix.
        // Its contact/watch-list semantics are independent of side following.
        if (conversation && conversation.audience !== 'requester') {
          const source: NamedConversationNotificationSource = { ticket: { tenant: event.ticket_tenant, ticketId: event.ticket_id,
            ...(conversation.relationship_id ? { relationshipId: conversation.relationship_id } : {}) },
            conversation: { storeTenant: tenant, conversationId: event.conversation_id },
            commentId: event.comment_id, threadId: event.thread_id, sequence: String(event.sequence) };
          for (const recipient of await namedConversationNotificationCandidates(trx, source)) {
            await withNamedConversationNotification(trx, recipient, source, async (context, message) => {
              const home = tenantDb(context.trx, recipient.tenant), key = namedConversationNotificationKey(source, recipient);
              const receipt = { tenant: recipient.tenant, delivery_key: key, recipient_user_id: recipient.userId,
                source_store_tenant: tenant, conversation_id: event.conversation_id, ticket_tenant: event.ticket_tenant, ticket_id: event.ticket_id,
                relationship_id: message.resource.relationshipId ?? null, comment_id: event.comment_id, thread_id: event.thread_id, attention_sequence: String(event.sequence) };
              const inserted = await home.table(RECEIPTS).insert(receipt).onConflict(['tenant', 'delivery_key']).ignore().returning('delivery_key');
              const retained = await home.table(RECEIPTS).where('delivery_key', key).forUpdate().first();
              if (!retained || Object.entries(receipt).some(([field, value]) => retained[field] !== value)) throw new Error('Conversation notification receipt identity conflict');
              if (!inserted.length) {
                if (!['created', 'disabled'].includes(retained.outcome)) throw new Error('Incomplete conversation notification receipt');
                return;
              }
              const notification = await createNotificationRowFromTemplate(context.trx, recipient.tenant, recipient.userId, {
                tenant: recipient.tenant, user_id: recipient.userId, template_name: 'ticket-comment-added', type: 'info', category: 'tickets',
                ...coManagedCommentPresentation(message, event.comment_id, key),
              });
              await home.table(RECEIPTS).where('delivery_key', key).update({ outcome: notification ? 'created' : 'disabled', notification_id: notification?.internal_notification_id ?? null });
              if (notification) await enqueueCoManagedNotificationDeliveries(context.trx, notification);
            });
          }
        }
        await tenantDb(trx, tenant).table(EVENTS).where(candidate).update({ in_app_fanout_at: trx.fn.now() });
        return true;
      });
      if (processed) result.processed++;
    } catch {
      result.failed++;
      // Retain retryability without letting a failing source starve later work.
      await sourceStore.table(EVENTS).where(candidate).whereNull('in_app_fanout_at')
        .update({ in_app_retry_at: db.raw("clock_timestamp() + interval '1 minute'") });
    }
  }
  return result;
}
