import type { Knex } from 'knex';
import { TicketModel } from '../../models/ticketModel';

/**
 * A ticket is "untouched" when no human has worked it: no human-authored
 * comments, no time entries, and no manual status change. Status changes are
 * detected by comparing against the tenant's default ticket status — alert
 * tickets are always created in the default status, so any other status means
 * a person (or another automation) moved it. Rule-driven auto-assignment does
 * not count as touched.
 */
export async function isTicketUntouched(
  trx: Knex | Knex.Transaction,
  tenantId: string,
  ticketId: string
): Promise<boolean> {
  const ticket = await trx('tickets')
    .where({ tenant: tenantId, ticket_id: ticketId })
    .first('status_id', 'board_id');
  if (!ticket) return false;

  // Statuses are board-scoped; compare against the same default the ticket
  // was created with (see ticketCreator.ts).
  const defaultStatusId = await TicketModel.getDefaultStatusId(
    tenantId,
    trx as Knex.Transaction,
    ticket.board_id
  );
  if (defaultStatusId && ticket.status_id !== defaultStatusId) {
    return false;
  }

  const humanComment = await trx('comments')
    .where({ tenant: tenantId, ticket_id: ticketId })
    .andWhere((qb) => qb.where('is_system_generated', false).orWhereNull('is_system_generated'))
    .first('comment_id');
  if (humanComment) return false;

  const timeEntry = await trx('time_entries')
    .where({ tenant: tenantId, work_item_id: ticketId, work_item_type: 'ticket' })
    .first('entry_id');
  if (timeEntry) return false;

  return true;
}
