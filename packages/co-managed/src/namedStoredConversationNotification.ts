import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { CoManagedSessionActor } from './sharedWorkIdentity';
import type { CoManagedNotificationRecipient } from './sharedWork';
import { withNamedConversationNotification, type NamedNotificationContext } from './namedConversationNotifications';
import type { CoManagedStoredCommentNotification } from './storedCommentNotification';

const TABLE = 'ticket_conversation_notification_receipts';
const IDENTITY = ['tenant', 'delivery_key', 'recipient_user_id', 'source_store_tenant', 'conversation_id', 'ticket_tenant', 'ticket_id',
  'relationship_id', 'comment_id', 'thread_id', 'attention_sequence', 'notification_id', 'outcome'];

/** Receipt-backed inbox projection also serves delayed push/realtime delivery.
 * Cached message text, audience labels and links are never a read fallback. */
export async function withNamedStoredConversationNotification<T>(db: Knex, actor: CoManagedSessionActor | CoManagedNotificationRecipient,
  notificationId: string, lock: 'share' | 'update',
  deliver: (context: NamedNotificationContext, current: CoManagedStoredCommentNotification) => Promise<T>): Promise<T | null> {
  const home = tenantDb(db, actor.tenant);
  const receipt = await home.table(TABLE).where({ notification_id: notificationId, recipient_user_id: actor.userId, outcome: 'created' }).first();
  if (!receipt) return null;
  const source = { ticket: { tenant: receipt.ticket_tenant, ticketId: receipt.ticket_id,
    ...(receipt.relationship_id ? { relationshipId: receipt.relationship_id } : {}) },
    conversation: { storeTenant: receipt.source_store_tenant, conversationId: receipt.conversation_id },
    commentId: receipt.comment_id, threadId: receipt.thread_id, sequence: String(receipt.attention_sequence) };
  return withNamedConversationNotification(db, actor, source, async (context, message) => {
    const lockedHome = tenantDb(context.trx, actor.tenant);
    const current = await lockedHome.table(TABLE).where('delivery_key', receipt.delivery_key).forShare().first();
    if (!current || IDENTITY.some(key => current[key] !== receipt[key])) return null;
    const query = lockedHome.table('internal_notifications').where({ internal_notification_id: notificationId, user_id: actor.userId }).whereNull('deleted_at');
    if (lock === 'update') query.forUpdate(); else query.forShare();
    const notification = await query.first('template_name', 'language_code', 'metadata');
    const metadata = notification?.metadata?.coManaged;
    if (!notification || notification.template_name !== 'ticket-comment-added' || !metadata || metadata.version !== 3 ||
      metadata.resource?.kind !== 'ticket' || metadata.resource?.tenant !== source.ticket.tenant || metadata.resource?.id !== source.ticket.ticketId ||
      (metadata.resource?.relationshipId ?? null) !== (message.resource.relationshipId ?? null) ||
      metadata.conversation?.storeTenant !== source.conversation.storeTenant || metadata.conversation?.conversationId !== source.conversation.conversationId ||
      metadata.commentId !== source.commentId || metadata.threadId !== source.threadId || metadata.sequence !== source.sequence || metadata.deliveryKey !== receipt.delivery_key)
      return null;
    return deliver(context, { notificationId, templateName: notification.template_name, languageCode: notification.language_code,
      deliveryKey: receipt.delivery_key, eventId: source.commentId, message });
  });
}
