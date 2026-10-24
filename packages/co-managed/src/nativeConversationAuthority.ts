import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AuthorizationSubject } from '@alga-psa/authorization';
import { assertCoManagedOperationalWrite, getCoManagedOperationalState } from '@alga-psa/licensing';
import type { CoManagedHomeActor } from './policy';
import { authorizeCoManagedWorkRecord, CoManagedSharedWorkError } from './sharedWorkIdentity';
import type { ConversationTicketReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { TicketConversationError } from '@alga-psa/shared/lib/tickets/namedConversations';

/** Resource admission shared by verified browser authors and deferred authors.
 * The caller must first lock the actual credential/retained operation and home
 * identity; this function never turns an actor ID into authentication. */
export async function authorizeNativeTicketConversation<Actor extends CoManagedHomeActor>(trx: Knex.Transaction,
  actor: Actor, subject: AuthorizationSubject, ticket: ConversationTicketReference, action: 'read' | 'update') {
  if (!trx.isTransaction || ticket.tenant !== actor.tenant || ticket.relationshipId || subject.tenant !== actor.tenant || subject.userId !== actor.userId)
    throw new CoManagedSharedWorkError();
  const owner = tenantDb(trx, ticket.tenant);
  const workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
  if (!workspace || workspace.product_code !== 'psa' || workspace.suspended_at) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  if (action === 'update') await assertCoManagedOperationalWrite(trx, ticket.tenant);
  else await getCoManagedOperationalState(trx, ticket.tenant);
  const query = owner.table('tickets').where('ticket_id', ticket.ticketId);
  if (action === 'update') query.forUpdate(); else query.forShare();
  const row = await query.first('ticket_id', 'client_id', 'board_id', 'entered_by', 'assigned_to', 'assigned_team_id');
  if (!row) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  const record = { id: row.ticket_id, clientId: row.client_id, boardId: row.board_id, ownerUserId: row.entered_by,
    assignedUserIds: row.assigned_to ? [row.assigned_to] : [], teamIds: row.assigned_team_id ? [row.assigned_team_id] : [] };
  const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', action, record);
  const read = action === 'read' ? decision : await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', 'read', record);
  return { trx, actor, ticket, shared: false as const, hidden: [...decision.redactedFields, ...read.redactedFields] };
}
