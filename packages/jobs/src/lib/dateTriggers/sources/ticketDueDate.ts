import type { Knex } from 'knex';
import { toCalendarDateString } from '@alga-psa/core';
import { tenantDb } from '@alga-psa/db';
import { toTenantLocalDate } from '@alga-psa/event-bus/workflow/dateDomainEvents';
import { listScheduledRecurringOccurrences } from '@alga-psa/tickets/lib/recurring/scheduledOccurrences';
import type { DateOccurrence, DateTriggerScanContext, DateTriggerSource } from '../types';

/**
 * The occurrence identity of a recurring schedule's occurrence: the generator's idempotency key
 * (definition client, nominal date). The scheduled occurrence and the ticket it becomes share it, so
 * the launcher's fire key is the same before and after the ticket exists and the reminder fires once.
 */
export const recurringOccurrenceEntityId = (definitionClientId: string, occurrenceDate: string): string =>
  `recurring:${definitionClientId}:${occurrenceDate}`;

// Fires on the due date of each open ticket, and on the due date of each recurring occurrence that the
// generator has not created yet. The occurrence date is the tenant-local calendar date of the due
// instant; the launcher's fire key includes it, so:
//  - a due date moved to another day is a new occurrence (a due date moved by an SLA change re-fires on purpose);
//  - a time-only move, or a move back to a date that already fired, does not fire again.
// Closed is decided by `statuses.is_closed`, the signal ticket.status_age and the recurring generator
// use; `tickets.is_closed` is only written for historical imports and is not authoritative.
// Recurring occurrences are keyed by the schedule occurrence (recurringOccurrenceEntityId), other
// tickets by ticket id. Projecting the schedule means a -60 reminder does not need lead_days >= 60.
export const ticketDueDateSource: DateTriggerSource = {
  id: 'ticket.due_date',
  async findOccurrences(knex: Knex, tenant: string, fromDate: string, toDate: string, context?: DateTriggerScanContext): Promise<DateOccurrence[]> {
    const fromTickets = await findTicketOccurrences(knex, tenant, fromDate, toDate);
    const fromSchedules = await findScheduledOccurrences(knex, tenant, fromDate, toDate, context?.now ?? new Date());
    const seen = new Set(fromTickets.map((occurrence) => occurrence.entityId));
    return [...fromTickets, ...fromSchedules.filter((occurrence) => !seen.has(occurrence.entityId))];
  },
};

async function findTicketOccurrences(knex: Knex, tenant: string, fromDate: string, toDate: string): Promise<DateOccurrence[]> {
  const tz = "COALESCE(ts.settings->>'timezone', 'UTC')";
  const rows = await tenantDb(knex, tenant).table('tickets as t')
    .join('statuses as s', function joinStatus() { this.on('s.status_id', '=', 't.status_id').andOn('s.tenant', '=', 't.tenant'); })
    .leftJoin('boards as b', function joinBoard() { this.on('b.board_id', '=', 't.board_id').andOn('b.tenant', '=', 't.tenant'); })
    .leftJoin('clients as c', function joinClient() { this.on('c.client_id', '=', 't.client_id').andOn('c.tenant', '=', 't.tenant'); })
    .leftJoin('tenant_settings as ts', 'ts.tenant', 't.tenant')
    .leftJoin('recurring_ticket_occurrences as o', function joinOccurrence() {
      this.on('o.ticket_id', '=', 't.ticket_id').andOn('o.tenant', '=', 't.tenant').andOn('o.status', '=', knex.raw('?', ['created']));
    })
    .leftJoin('recurring_ticket_definitions as d', function joinDefinition() { this.on('d.definition_id', '=', 'o.definition_id').andOn('d.tenant', '=', 'o.tenant'); })
    .select('t.ticket_id', 't.ticket_number', 't.title', 't.due_date', 't.status_id', 't.board_id', 't.priority_id', 't.client_id', 't.contact_name_id', 't.assigned_to', 't.ticket_origin', 'ts.settings')
    .select({ status_name: 's.name', board_name: 'b.board_name', client_name: 'c.client_name' })
    .select({
      recurrence_definition_id: 'o.definition_id', recurrence_definition_client_id: 'o.definition_client_id', recurrence_definition_name: 'd.name',
      recurrence_occurrence_id: 'o.occurrence_id', recurrence_occurrence_date: 'o.occurrence_date',
    })
    .where('s.is_closed', false)
    .whereNotNull('t.due_date')
    .whereRaw(`t.due_date >= (?::date::timestamp AT TIME ZONE ${tz}) AND t.due_date < ((?::date + 1)::timestamp AT TIME ZONE ${tz})`, [fromDate, toDate])
    .orderBy('t.ticket_id', 'asc')
    // Two created rows for one ticket only happen after a data repair; the latest due_at wins.
    .orderBy('o.due_at', 'asc');

  const byTicket = new Map<string, DateOccurrence>();
  for (const r of rows as any[]) {
    const timezone = typeof r.settings?.timezone === 'string' ? r.settings.timezone : 'UTC';
    const occursOn = toTenantLocalDate(r.due_date, timezone);
    const occurrenceDate = r.recurrence_occurrence_id ? toCalendarDateString(r.recurrence_occurrence_date) : null;
    const recurrence = r.recurrence_occurrence_id && occurrenceDate
      ? {
          definitionId: r.recurrence_definition_id,
          definitionClientId: r.recurrence_definition_client_id,
          ...(r.recurrence_definition_name ? { definitionName: r.recurrence_definition_name } : {}),
          occurrenceId: r.recurrence_occurrence_id,
          occurrenceDate,
        }
      : null;
    byTicket.set(r.ticket_id, {
      entityId: recurrence ? recurringOccurrenceEntityId(recurrence.definitionClientId, occurrenceDate!) : r.ticket_id,
      clientId: r.client_id ?? '',
      occursOn,
      cycleKey: occursOn,
      payload: {
        ticketExists: true,
        ticketId: r.ticket_id,
        ticketNumber: r.ticket_number,
        title: r.title,
        dueDate: occursOn,
        dueAt: new Date(r.due_date).toISOString(),
        statusId: r.status_id,
        statusName: r.status_name,
        boardId: r.board_id,
        boardName: r.board_name ?? '',
        priorityId: r.priority_id ?? undefined,
        clientId: r.client_id ?? undefined,
        clientName: r.client_name ?? undefined,
        contactId: r.contact_name_id ?? undefined,
        assignedUserId: r.assigned_to ?? undefined,
        ticketOrigin: r.ticket_origin ?? 'internal',
        ...(recurrence ? { recurrence } : {}),
      },
    });
  }
  return [...byTicket.values()];
}

async function findScheduledOccurrences(knex: Knex, tenant: string, fromDate: string, toDate: string, now: Date): Promise<DateOccurrence[]> {
  const scheduled = await listScheduledRecurringOccurrences(knex, tenant, { fromDate, toDate, now });
  return scheduled.map((occurrence) => ({
    entityId: recurringOccurrenceEntityId(occurrence.definitionClientId, occurrence.occurrenceDate),
    clientId: occurrence.clientId,
    occursOn: occurrence.dueDate,
    cycleKey: occurrence.dueDate,
    payload: {
      ticketExists: false,
      dueDate: occurrence.dueDate,
      dueAt: occurrence.dueAt.toISOString(),
      clientId: occurrence.clientId,
      clientName: occurrence.clientName,
      ...(occurrence.contactId ? { contactId: occurrence.contactId } : {}),
      ticketOrigin: 'recurring',
      recurrence: {
        definitionId: occurrence.definitionId,
        definitionClientId: occurrence.definitionClientId,
        definitionName: occurrence.definitionName,
        ...(occurrence.occurrenceId ? { occurrenceId: occurrence.occurrenceId } : {}),
        occurrenceDate: occurrence.occurrenceDate,
      },
    },
  }));
}
