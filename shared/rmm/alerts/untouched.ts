import type { Knex } from 'knex';

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
    .first('status_id');
  if (!ticket) return false;

  const defaultStatus = await trx('statuses')
    .where({ tenant: tenantId, item_type: 'ticket', is_default: true })
    .first('status_id');
  if (defaultStatus && ticket.status_id !== defaultStatus.status_id) {
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
