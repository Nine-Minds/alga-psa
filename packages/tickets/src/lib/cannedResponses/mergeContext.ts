// Server-only: loads the values merge fields resolve against. The pure resolver (mergeFields.ts) is shared
// with the client; this file touches the database, so it must never be imported from a client component.

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { CannedResponseMergeContext } from '@alga-psa/types';
import { emptyMergeContext, splitFullName } from './mergeFields';

/**
 * Builds the merge context for a ticket as seen by `agentUserId`. A ticket without a contact or client
 * yields empty values for those groups (they resolve to ''), and a ticket that is not found yields an
 * all-empty context rather than an error: callers use this on the comment write path, where an unknown
 * token must never block saving a comment.
 */
export async function loadCannedMergeContext(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string | null | undefined,
  agentUserId: string | null | undefined
): Promise<CannedResponseMergeContext> {
  const context = emptyMergeContext();
  const db = tenantDb(trx, tenant);

  if (agentUserId) {
    const agent = await db.table('users').where({ user_id: agentUserId }).first('first_name', 'last_name');
    const name = [agent?.first_name, agent?.last_name].filter(Boolean).join(' ').trim();
    context.agent.name = name || null;
  }

  if (!ticketId) return context;
  const ticket = await db
    .table('tickets')
    .where({ ticket_id: ticketId })
    .first('ticket_number', 'title', 'client_id', 'contact_name_id');
  if (!ticket) return context;

  context.ticket = { number: ticket.ticket_number ?? null, title: ticket.title ?? null };

  if (ticket.client_id) {
    const client = await db.table('clients').where({ client_id: ticket.client_id }).first('client_name');
    context.client.name = client?.client_name ?? null;
  }
  if (ticket.contact_name_id) {
    const contact = await db.table('contacts').where({ contact_name_id: ticket.contact_name_id }).first('full_name');
    const fullName = contact?.full_name?.trim() || null;
    context.contact = { ...splitFullName(fullName), name: fullName };
  }
  return context;
}
