import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getActiveWatchListEmails } from '@alga-psa/shared/lib/tickets/watchList';
import type { CoManagedCustomerNotificationContext, CoManagedCustomerCommentNotification } from './customerCommentNotification';

export const nativeRecipientEmailHash = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
const watcherAddresses = (attributes: unknown) => [...new Set(getActiveWatchListEmails(attributes).map(email => email.trim().toLowerCase()))];

/** A watcher address is candidate discovery, never ticket read authority. */
export async function nativeTicketEmailWatcherCandidates(db: Knex, tenant: string, ticketId: string): Promise<string[]> {
  const owner = tenantDb(db, tenant), ticket = await owner.table('tickets').where('ticket_id', ticketId).first('attributes');
  const emails = watcherAddresses(ticket?.attributes);
  if (!emails.length) return [];
  const users = await owner.table('users').where({ user_type: 'internal', is_inactive: false })
    .whereRaw('lower(trim(email)) = ANY(?::text[])', [emails]).select('user_id');
  return users.map(user => user.user_id);
}

/** Preserve ticket watcher delivery for human requester updates. Additional
 * requester exchanges use their own followers; vendors/private/AI never turn
 * a ticket watch-list entry into a recipient. */
export async function isNativeTicketEmailWatcher(context: CoManagedCustomerNotificationContext, message: CoManagedCustomerCommentNotification): Promise<boolean> {
  if (message.audience !== 'requester' || isCoManagedReadFieldHidden(context.redactedFields, ['attributes', 'tickets.attributes', 'watch_list'])) return false;
  const owner = tenantDb(context.trx, context.actor.tenant);
  if (message.conversationTarget) {
    const conversation = await owner.table('ticket_conversations').where({ conversation_id: message.conversationTarget.conversationId,
      ticket_tenant: context.resource.tenant, ticket_id: context.resource.id }).forShare().first('default_slot');
    if (conversation?.default_slot !== 'requester') return false;
  }
  const comment = await owner.table('comments').where({ comment_id: message.commentId, ticket_id: context.resource.id }).first('user_id', 'actor_reference_id', 'is_system_generated');
  if (!comment?.user_id || comment.actor_reference_id || comment.is_system_generated) return false;
  const author = await owner.table('users').where('user_id', comment.user_id).forShare().first('user_type');
  if (author?.user_type !== 'internal') return false;
  const ticket = await owner.table('tickets').where('ticket_id', context.resource.id).forShare().first('attributes');
  const user = await owner.table('users').where('user_id', context.actor.userId).forShare().first('email');
  return Boolean(user?.email && watcherAddresses(ticket?.attributes).includes(user.email.trim().toLowerCase()));
}

/** Native mail previously deduplicated recipients by address in its subscriber.
 * Serialize current address delivery and use committed token/queue receipts to
 * preserve that behavior across jobs and two internal users sharing an address.
 * The caller retains recipient/source locks and its queue row through send. */
export async function hasDeliveredNativeTicketEmail(context: CoManagedCustomerNotificationContext, row: { ticket_id: string; comment_id: string }, email: string): Promise<boolean> {
  const hash = nativeRecipientEmailHash(email), { trx } = context, owner = tenantDb(trx, context.actor.tenant);
  await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`native-ticket-email:${context.actor.tenant}:${row.ticket_id}:${row.comment_id}:${hash}`]);
  const query = owner.table('co_management_customer_email_deliveries as d').where({ 'd.ticket_id': row.ticket_id, 'd.comment_id': row.comment_id,
    'd.native_delivery': true, 'd.status': 'delivered' });
  owner.tenantJoin(query, 'co_management_customer_reply_tokens as r', 'd.delivery_key', 'r.delivery_key', { on: join => join
    .andOn('r.recipient_user_id', '=', 'd.recipient_user_id').andOn('r.ticket_id', '=', 'd.ticket_id').andOn('r.comment_id', '=', 'd.comment_id') });
  return Boolean(await query.where('r.recipient_email', email.trim().toLowerCase()).first('d.delivery_key'));
}
