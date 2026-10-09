import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Everyone assigned to a ticket: the primary assignee plus additional agents
 * (ticket_resources). Shared by the in-app and email subscribers.
 */
export async function getAllTicketAssignees(
  conn: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string
): Promise<string[]> {
  const db = tenantDb(conn, tenant);
  const ticket = await db.table('tickets').select('assigned_to').where({ ticket_id: ticketId }).first();

  const assignees: string[] = [];
  if (ticket?.assigned_to) {
    assignees.push(ticket.assigned_to);
  }

  const additionalAgents = await db
    .table('ticket_resources')
    .select('additional_user_id')
    .where({ ticket_id: ticketId })
    .whereNotNull('additional_user_id');

  for (const agent of additionalAgents) {
    if (agent.additional_user_id && !assignees.includes(agent.additional_user_id)) {
      assignees.push(agent.additional_user_id);
    }
  }
  return assignees;
}
