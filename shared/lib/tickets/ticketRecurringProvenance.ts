import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * The recurring schedule that generated a ticket. One definition of "where a ticket came from" shared by
 * `tickets.find` (this loader) and the `ticket.due_date` date trigger (which left-joins the same rule).
 * The event payload carries the same facts in camelCase (`ticketRecurrenceSchema`), handed down by the
 * generator because the ticket id is not linked to the occurrence row yet at TICKET_CREATED time.
 *
 * Rule: the `created` occurrence row that points at the ticket is the provenance. Each occurrence creates
 * at most one ticket, so one row per ticket is expected; if a data repair ever produces two, the one with
 * the latest `due_at` wins.
 *
 * Lives in shared (not packages/tickets) because the workflow runtime cannot import @alga-psa/tickets.
 */
export interface TicketRecurringProvenance {
  definitionId: string;
  occurrenceId: string;
  /** Nominal (unadjusted) schedule date, YYYY-MM-DD. */
  occurrenceDate: string;
}

const toDateOnly = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

export async function loadTicketRecurringProvenance(
  db: Knex | Knex.Transaction,
  tenant: string,
  ticketIds: readonly string[]
): Promise<Map<string, TicketRecurringProvenance>> {
  const result = new Map<string, TicketRecurringProvenance>();
  if (ticketIds.length === 0) return result;
  const rows = await tenantDb(db, tenant)
    .table('recurring_ticket_occurrences')
    .whereIn('ticket_id', [...ticketIds])
    .where('status', 'created')
    .orderBy('due_at', 'asc')
    .select('ticket_id', 'definition_id', 'occurrence_id', 'occurrence_date');
  // Ascending by due_at, so a later row for the same ticket overwrites an earlier one.
  for (const row of rows as Array<Record<string, unknown>>) {
    result.set(String(row.ticket_id), {
      definitionId: String(row.definition_id),
      occurrenceId: String(row.occurrence_id),
      occurrenceDate: toDateOnly(row.occurrence_date),
    });
  }
  return result;
}
