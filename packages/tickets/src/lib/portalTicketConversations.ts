import type { Knex } from 'knex';
import { conversationUuid, ensureDefaultTicketConversation, listStoredTicketConversations, readStoredTicketConversation, TicketConversationError } from '@alga-psa/shared/lib/tickets/namedConversations';

/** Internal projection after the caller's current portal ticket admission.
 * Customer ownership is fixed by authentication; no home/private store selector
 * or organizational conversation metadata enters the portal response. */
export async function readPortalTicketConversations(trx: Knex.Transaction, tenant: string, ticketId: string, selectedId?: string, lock: 'read' | 'update' = 'read') {
  if (!trx.isTransaction || ![tenant, ticketId].every(conversationUuid) || (selectedId !== undefined && !conversationUuid(selectedId)))
    throw new TicketConversationError('CONVERSATION_INVALID');
  const scope = { trx, storeTenant: tenant, ticket: { tenant, ticketId } };
  const requester = await ensureDefaultTicketConversation(scope, 'requester');
  const rows = await listStoredTicketConversations(scope, ['requester']);
  const selected = rows.find(row => row.conversationId === (selectedId?.toLowerCase() ?? requester.conversationId));
  if (!selected) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  // Hold the destination audience through the caller's read/publication transaction.
  const current = await readStoredTicketConversation(scope, selected.conversationId, lock);
  if (current.audience !== 'requester') throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  return { selectedConversationId: selected.conversationId, requesterConversations: rows.map(row => ({
    conversationId: row.conversationId, name: row.name, isDefault: row.defaultSlot === 'requester', status: row.status,
  })).sort((a, b) => Number(b.isDefault) - Number(a.isDefault)) };
}
