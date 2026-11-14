import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { toCalendarDateString } from '@alga-psa/core';
import { tenantDb } from '@alga-psa/db';
import { recurrenceRuleSchema } from '@alga-psa/shared/lib/recurrence';
import { loadTenantBusinessDayCalendar } from '@alga-psa/shared/lib/businessHours/loadBusinessDayCalendar';
import { listOccurrencesDueBetween } from './candidateOccurrences';
import { loadTenantTimeZone } from './tenantTimeZone';

/**
 * A recurring occurrence the generator has not turned into a ticket yet, but will: its due date is
 * still ahead, its schedule, client row and client are active, and it has no occurrence row other than
 * a `failed` one (which the generator retries until the due time).
 */
export interface ScheduledRecurringOccurrence {
  definitionId: string;
  definitionName: string;
  definitionClientId: string;
  clientId: string;
  clientName: string;
  contactId: string | null;
  /** Nominal (unadjusted) schedule date, YYYY-MM-DD: with definitionClientId, the generator's idempotency key. */
  occurrenceDate: string;
  /** Adjusted due date, YYYY-MM-DD, local to the tenant timezone. */
  dueDate: string;
  dueAt: Date;
  /** Present when a `failed` attempt already holds the occurrence row. */
  occurrenceId?: string;
}

const asJson = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

/**
 * The recurring occurrences due on a tenant-local date in `fromDate..toDate` that do not have a ticket
 * yet and will get one. Lets the `ticket.due_date` date trigger fire on a recurring ticket's due date
 * before the generator creates it, so an early reminder never depends on the schedule's `lead_days`.
 *
 * It mirrors the generator's rules rather than predicting its outcome: "skip while the previous
 * ticket is open" is decided at create time and cannot be known here, so such an occurrence is
 * reported and may end as `skipped`.
 */
export async function listScheduledRecurringOccurrences(
  knex: Knex | Knex.Transaction,
  tenant: string,
  window: { fromDate: string; toDate: string; now: Date }
): Promise<ScheduledRecurringOccurrence[]> {
  const db = tenantDb(knex, tenant);
  // LEVERAGE: pattern recurring-active-schedule-load — same active definitions ⋈ active definition-clients ⋈ clients load as generateRecurringTicketsForTenant; a third reader should share one loader.
  const definitions = await db
    .table('recurring_ticket_definitions')
    .where({ is_active: true })
    .whereNull('archived_at')
    .select('definition_id', 'name', 'recurrence', 'start_date', 'create_time', 'due_time', 'lead_days', 'non_business_day_policy');
  if (definitions.length === 0) return [];

  const definitionClients = await db
    .table('recurring_ticket_definition_clients')
    .whereIn('definition_id', definitions.map((definition: any) => definition.definition_id))
    .where({ is_active: true })
    .select('definition_client_id', 'definition_id', 'client_id', 'contact_id', 'evaluated_through');
  if (definitionClients.length === 0) return [];

  const clients = await db
    .table('clients')
    .whereIn('client_id', [...new Set(definitionClients.map((row: any) => row.client_id as string))])
    .select('client_id', 'client_name', 'is_inactive');
  const clientsById = new Map(clients.map((row: any) => [row.client_id as string, row]));

  const timeZone = await loadTenantTimeZone(knex, tenant);
  const calendar = definitions.some((definition: any) => definition.non_business_day_policy !== 'keep')
    ? await loadTenantBusinessDayCalendar(knex, tenant)
    : null;
  const definitionsById = new Map(definitions.map((definition: any) => [definition.definition_id as string, definition]));

  const projected: ScheduledRecurringOccurrence[] = [];
  for (const definitionClient of definitionClients as any[]) {
    const definition = definitionsById.get(definitionClient.definition_id);
    const client = clientsById.get(definitionClient.client_id);
    // The generator skips an inactive client's occurrences, so they never become tickets.
    if (!definition || !client || client.is_inactive) continue;

    // The generator creates nothing due at or before its watermark, and marks anything already due as missed.
    const horizon = Math.max(new Date(definitionClient.evaluated_through).getTime(), window.now.getTime());
    let candidates;
    try {
      candidates = listOccurrencesDueBetween({
        rule: recurrenceRuleSchema.parse(asJson(definition.recurrence)),
        startDate: toCalendarDateString(definition.start_date) ?? '',
        createTime: definition.create_time,
        dueTime: definition.due_time,
        leadDays: definition.lead_days,
        policy: definition.non_business_day_policy,
        calendar,
        timeZone,
        fromDate: window.fromDate,
        toDate: window.toDate,
      }).filter((candidate) => candidate.dueAt.getTime() > horizon);
    } catch (error) {
      // The generator reports an unevaluable schedule; here it only means no projected occurrences.
      logger.warn('[RecurringTickets] Could not project schedule occurrences', {
        tenant, definitionId: definitionClient.definition_id, definitionClientId: definitionClient.definition_client_id,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const candidate of candidates) {
      projected.push({
        definitionId: definitionClient.definition_id,
        definitionName: definition.name,
        definitionClientId: definitionClient.definition_client_id,
        clientId: definitionClient.client_id,
        clientName: client.client_name,
        contactId: definitionClient.contact_id ?? null,
        occurrenceDate: candidate.nominal,
        dueDate: candidate.due,
        dueAt: candidate.dueAt,
      });
    }
  }
  if (projected.length === 0) return [];

  // A created occurrence is a ticket (the ticket path reports it); skipped and missed never become one.
  const rows = await db
    .table('recurring_ticket_occurrences')
    .whereIn('definition_client_id', [...new Set(projected.map((occurrence) => occurrence.definitionClientId))])
    .whereIn('occurrence_date', [...new Set(projected.map((occurrence) => occurrence.occurrenceDate))])
    .select('definition_client_id', 'occurrence_date', 'occurrence_id', 'status');
  const rowsByKey = new Map(
    rows.map((row: any) => [`${row.definition_client_id}:${toCalendarDateString(row.occurrence_date)}`, row])
  );

  return projected.flatMap((occurrence) => {
    const row = rowsByKey.get(`${occurrence.definitionClientId}:${occurrence.occurrenceDate}`);
    if (!row) return [occurrence];
    return row.status === 'failed' ? [{ ...occurrence, occurrenceId: row.occurrence_id as string }] : [];
  });
}
