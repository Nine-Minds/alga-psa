import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { conversationUuid, TicketConversationError } from '@alga-psa/shared/lib/tickets/namedConversations';
import { lockCoManagedActiveHomeIdentity } from './sharedWorkIdentity';
import { authorizeNativeTicketConversation } from './nativeConversationAuthority';
import { authorizedConversation } from './namedTicketConversations';
import { executeNamedConversationEmailDelivery, type NamedConversationEmailTransport } from './conversationEmailOperations';

/** Only committed human Send intent admits a deferred native author. Queue
 * callers supply a qualified operation, never a session or a substitute user.
 * Shared tickets require their own relationship-aware deferred admission. */
export async function deliverNativeNamedConversationEmail(db: Knex, input: { tenant: string; operationId: string },
  transport: NamedConversationEmailTransport) {
  if (db.isTransaction || !input || ![input.tenant, input.operationId].every(conversationUuid) ||
    Object.keys(input).some(key => !['tenant', 'operationId'].includes(key))) throw new TicketConversationError('CONVERSATION_INVALID');
  const tenant = input.tenant.toLowerCase(), operationId = input.operationId.toLowerCase();
  const deny = (): never => { throw new TicketConversationError('CONVERSATION_FORBIDDEN'); };
  return executeNamedConversationEmailDelivery(operationId, transport, work => withTransaction(db, async trx => {
    const home = tenantDb(trx, tenant);
    const locator = await home.table('ticket_conversation_email_operations').where('operation_id', operationId)
      .first('actor_user_id', 'ticket_id', 'ticket_tenant', 'conversation_id');
    if (!locator || locator.ticket_tenant !== tenant) return deny();
    const actor = { tenant, userId: locator.actor_user_id };
    const ticket = { tenant, ticketId: locator.ticket_id };
    const subject = await lockCoManagedActiveHomeIdentity(trx, actor);
    const authority = await authorizeNativeTicketConversation(trx, actor, subject, ticket, 'update');
    const ref = { storeTenant: tenant, conversationId: locator.conversation_id };
    const { conversation } = await authorizedConversation(authority, ref);
    if (conversation.transport !== 'email') return deny();
    // Match browser lock order (identity, ticket, conversation, operation), then
    // prove the locator still describes this retained intent under the row lock.
    const row = await home.table('ticket_conversation_email_operations').where('operation_id', operationId).forUpdate().first();
    if (!row || !['pending', 'sending', 'delivered', 'unknown', 'blocked'].includes(row.status) || row.relationship_id ||
      row.actor_user_id !== actor.userId || row.ticket_id !== ticket.ticketId || row.conversation_id !== ref.conversationId ||
      row.ticket_tenant !== tenant || row.conversation_store_tenant !== tenant || row.mailbox_tenant !== tenant) return deny();
    // A pending flag alone is not proof of confirmation. Publication and route
    // are retained atomically with the reviewed envelope by human Send.
    const publication = await home.table('ticket_conversation_publications').where({ operation_id: operationId,
      ticket_tenant: tenant, ticket_id: ticket.ticketId, conversation_id: ref.conversationId,
      actor_tenant: tenant, actor_user_id: actor.userId, mode: 'send' }).forShare().first();
    const route = await home.table('ticket_conversation_email_routes').where({ operation_id: operationId,
      ticket_tenant: tenant, ticket_id: ticket.ticketId, conversation_store_tenant: tenant,
      conversation_id: ref.conversationId, mailbox_id: row.mailbox_id, operation_tenant: tenant,
      token_hash: row.reply_token_hash, rfc_message_id: row.rfc_message_id }).forShare().first();
    if (!publication || !route) return deny();
    const result = await work({ ...authority, conversation }, row);
    await assertCoManagedOperationalWrite(trx, tenant);
    return result;
  }));
}

/** Bounded recovery rotates failures behind other due work. The lease only
 * spaces scans; delivery's committed attempt marker owns duplicate prevention. */
export async function recoverNativeNamedConversationEmails(db: Knex, tenant: string, transport: NamedConversationEmailTransport, limit = 50) {
  if (db.isTransaction || !conversationUuid(tenant) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new TicketConversationError('CONVERSATION_INVALID');
  tenant = tenant.toLowerCase();
  const due = await withTransaction(db, async trx => {
    const home = tenantDb(trx, tenant);
    if (!await home.table('tenants').where('product_code', 'psa').whereNull('suspended_at').first('tenant')) return [];
    const rows = await home.table('ticket_conversation_email_operations').where({ status: 'pending', ticket_tenant: tenant,
      conversation_store_tenant: tenant, mailbox_tenant: tenant }).whereNull('relationship_id')
      .where('recovery_after', '<=', trx.fn.now()).orderBy('recovery_after').orderBy('operation_id')
      .forUpdate().skipLocked().limit(limit).select('operation_id');
    if (rows.length) await home.table('ticket_conversation_email_operations').whereIn('operation_id', rows.map(row => row.operation_id))
      .update({ recovery_after: trx.raw("clock_timestamp() + interval '5 minutes'") });
    return rows;
  });
  const result = { processed: 0, deferred: 0 };
  for (const row of due) {
    try { await deliverNativeNamedConversationEmail(db, { tenant, operationId: row.operation_id }, transport); result.processed++; }
    catch { result.deferred++; }
  }
  return result;
}
