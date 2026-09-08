import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { conversationUuid } from '@alga-psa/shared/lib/tickets/namedConversations';
import { namedConversationNotificationCandidates, withNamedConversationNotification,
  type NamedConversationNotificationSource, type NamedConversationNotification, type NamedNotificationContext } from './namedConversationNotifications';

const EVENTS = 'ticket_conversation_message_events';
/** Each channel independently retains fanout completion. Current admission,
 * recipient discovery, transactional replay and fair retry share one engine. */
export async function recoverNamedConversationAttention(db: Knex, tenant: string, channel: 'in_app' | 'email',
  deliver: (context: NamedNotificationContext, message: NamedConversationNotification, source: NamedConversationNotificationSource) => Promise<void>, limit = 30) {
  if (!['in_app', 'email'].includes(channel)) throw new Error('Invalid conversation notification channel');
  const completedColumn = `${channel}_fanout_at`, retryColumn = `${channel}_retry_at`;
  if (db.isTransaction || !conversationUuid(tenant) || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error('Invalid conversation notification recovery');
  tenant = tenant.toLowerCase();
  const sourceStore = tenantDb(db, tenant);
  const pending = (connection: Knex) => tenantDb(connection, tenant).table(EVENTS).whereNull(completedColumn).where(retryColumn, '<=', connection.fn.now());
  const candidates = await pending(db).orderBy(retryColumn).orderBy('conversation_id').orderBy('sequence').limit(limit).select('conversation_id', 'comment_id');
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
            await withNamedConversationNotification(trx, recipient, source, (context, message) => deliver(context, message, source));
          }
        }
        await tenantDb(trx, tenant).table(EVENTS).where(candidate).update({ [completedColumn]: trx.fn.now() });
        return true;
      });
      if (processed) result.processed++;
    } catch {
      result.failed++;
      // Retain retryability without letting a failing source starve later work.
      await sourceStore.table(EVENTS).where(candidate).whereNull(completedColumn)
        .update({ [retryColumn]: db.raw("clock_timestamp() + interval '1 minute'") });
    }
  }
  return result;
}
