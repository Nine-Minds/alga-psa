import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { toCalendarDateString } from '@alga-psa/core';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { recurrenceRuleSchema } from '@alga-psa/shared/lib/recurrence';
import { loadTenantBusinessDayCalendar } from '@alga-psa/shared/lib/businessHours/loadBusinessDayCalendar';
import type { BusinessDayCalendar } from '@alga-psa/shared/lib/businessHours/businessDayCalendar';
import { listCandidateOccurrences, type Candidate } from './candidateOccurrences';
import { createTicketWithSideEffects } from '../createTicketWithSideEffects';
import {
  recurringTicketOverridesSchema,
  resolveEffectiveFields,
  type RecurringTemplateFields,
  type RecurringTicketOverrides,
} from './effectiveFields';
import { renderTitleTemplate } from './titleTemplate';
import { findRecurringReferenceProblems } from './validateReferences';

const DEFINITIONS = 'recurring_ticket_definitions';
const DEFINITION_CLIENTS = 'recurring_ticket_definition_clients';
const CLIENT_ASSETS = 'recurring_ticket_client_assets';
const OCCURRENCES = 'recurring_ticket_occurrences';
const IDEMPOTENCY_COLUMNS = ['tenant', 'definition_client_id', 'occurrence_date'];

export const RECURRING_TICKET_SOURCE = 'recurring_ticket';

export interface GenerateRecurringTicketsOptions {
  /** IANA timezone of the tenant (`getTenantTimezone`). Create and due times are wall-clock in it. */
  timeZone: string;
  /** Tenant default locale for the `{{due_date}}`/`{{month}}` tokens. Falls back to `en`. */
  locale?: string | null;
  /** Injectable clock for tests. */
  now?: Date;
}

export interface GenerateRecurringTicketsSummary {
  definitions: number;
  definitionClients: number;
  created: number;
  skipped: number;
  missed: number;
  failed: number;
  /** Definition-clients that could not be evaluated at all (corrupt rule, no business day found, ...). */
  evaluationErrors: number;
}

interface DefinitionRow extends RecurringTemplateFields {
  definition_id: string;
  name: string;
  title_template: string;
  description: unknown;
  additional_agent_ids: string[];
  tags: string[];
  checklist_template_id: string | null;
  recurrence: unknown;
  start_date: Date | string;
  create_time: string;
  due_time: string;
  lead_days: number;
  non_business_day_policy: 'keep' | 'previous' | 'next';
  open_previous_policy: 'always_create' | 'skip';
  notify_client_on_create: boolean;
}

interface DefinitionClientRow {
  definition_client_id: string;
  definition_id: string;
  client_id: string;
  overrides: unknown;
  contact_id: string | null;
  location_id: string | null;
  evaluated_through: Date;
}

interface OccurrenceRow {
  occurrence_id: string;
  occurrence_date: Date | string;
  status: 'created' | 'skipped' | 'missed' | 'failed';
  attempts: number;
}

type Outcome = 'created' | 'skipped' | 'missed' | 'failed' | 'unchanged';

function asJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/**
 * Per-tenant sweep behind the `generate-recurring-tickets` job. Idempotent: it can run at any
 * cadence, concurrently, or be re-run after a crash without duplicating or losing tickets.
 *
 * Per-occurrence problems are data, stored as `failed`/`missed`/`skipped` occurrence rows. This
 * function throws only on infrastructure failure (database unreachable, ...).
 */
export async function generateRecurringTicketsForTenant(
  knex: Knex,
  tenant: string,
  options: GenerateRecurringTicketsOptions
): Promise<GenerateRecurringTicketsSummary> {
  const now = options.now ?? new Date();
  const db = tenantDb(knex, tenant);
  const summary: GenerateRecurringTicketsSummary = {
    definitions: 0, definitionClients: 0, created: 0, skipped: 0, missed: 0, failed: 0, evaluationErrors: 0,
  };

  const definitions = (await db
    .table(DEFINITIONS)
    .where({ is_active: true })
    .whereNull('archived_at')
    .select('*')) as DefinitionRow[];
  summary.definitions = definitions.length;
  if (definitions.length === 0) return summary;

  // Only tenants with a non-`keep` policy pay for the calendar load.
  const calendar = definitions.some((definition) => definition.non_business_day_policy !== 'keep')
    ? await loadTenantBusinessDayCalendar(knex, tenant)
    : null;

  const definitionClients = (await db
    .table(DEFINITION_CLIENTS)
    .whereIn('definition_id', definitions.map((definition) => definition.definition_id))
    .where({ is_active: true })
    .select('*')) as DefinitionClientRow[];

  const clientRows = await db
    .table('clients')
    .whereIn('client_id', [...new Set(definitionClients.map((row) => row.client_id))])
    .select('client_id', 'client_name', 'is_inactive');
  const clientsById = new Map<string, { client_name: string; is_inactive: boolean }>(
    clientRows.map((row) => [row.client_id as string, row])
  );

  const definitionsById = new Map(definitions.map((definition) => [definition.definition_id, definition]));

  for (const definitionClient of definitionClients) {
    const definition = definitionsById.get(definitionClient.definition_id);
    if (!definition) continue;
    summary.definitionClients += 1;

    try {
      const counts = await processDefinitionClient({
        knex, tenant, definition, definitionClient, calendar, now, options,
        client: clientsById.get(definitionClient.client_id) ?? null,
      });
      summary.created += counts.created;
      summary.skipped += counts.skipped;
      summary.missed += counts.missed;
      summary.failed += counts.failed;
    } catch (error) {
      if (error instanceof OccurrenceEvaluationError) {
        // The schedule itself cannot be evaluated; there is no occurrence date to attach it to. The
        // watermark stays put so nothing is lost once the definition is fixed.
        summary.evaluationErrors += 1;
        logger.error('[RecurringTickets] Could not evaluate definition for client', {
          tenant, definitionId: definition.definition_id, definitionClientId: definitionClient.definition_client_id,
          message: error.message,
        });
        continue;
      }
      throw error;
    }
  }

  logger.info('[RecurringTickets] Sweep complete', { tenant, ...summary });
  return summary;
}

class OccurrenceEvaluationError extends Error {}

function requireCalendarDate(value: Date | string, column: string): string {
  const date = toCalendarDateString(value);
  if (!date) throw new Error(`Unreadable ${column} value`);
  return date;
}

async function processDefinitionClient(args: {
  knex: Knex;
  tenant: string;
  definition: DefinitionRow;
  definitionClient: DefinitionClientRow;
  client: { client_name: string; is_inactive: boolean } | null;
  calendar: BusinessDayCalendar | null;
  now: Date;
  options: GenerateRecurringTicketsOptions;
}): Promise<Record<'created' | 'skipped' | 'missed' | 'failed', number>> {
  const { knex, tenant, definition, definitionClient, client, calendar, now, options } = args;
  const db = tenantDb(knex, tenant);
  const counts = { created: 0, skipped: 0, missed: 0, failed: 0 };

  let candidates: Candidate[];
  try {
    const rule = recurrenceRuleSchema.parse(asJson(definition.recurrence));
    candidates = listCandidateOccurrences({
      rule,
      startDate: requireCalendarDate(definition.start_date, 'start_date'),
      createTime: definition.create_time,
      dueTime: definition.due_time,
      leadDays: definition.lead_days,
      policy: definition.non_business_day_policy,
      calendar,
      evaluatedThrough: new Date(definitionClient.evaluated_through),
      now,
      timeZone: options.timeZone,
    });
  } catch (error) {
    throw new OccurrenceEvaluationError(error instanceof Error ? error.message : String(error));
  }

  if (candidates.length > 0) {
    const existingRows = (await db
      .table(OCCURRENCES)
      .where({ definition_client_id: definitionClient.definition_client_id })
      .whereIn('occurrence_date', candidates.map((candidate) => candidate.nominal))
      .select('occurrence_id', 'occurrence_date', 'status', 'attempts')) as OccurrenceRow[];
    const existingByDate = new Map(existingRows.map((row) => [requireCalendarDate(row.occurrence_date, 'occurrence_date'), row]));

    for (const candidate of candidates) {
      const outcome = await processCandidate({
        knex, tenant, definition, definitionClient, client, candidate,
        existing: existingByDate.get(candidate.nominal) ?? null, now, options,
      });
      if (outcome !== 'unchanged') counts[outcome] += 1;
    }
  }

  // Set last: a crash before this point leaves the watermark, and the next sweep re-evaluates.
  await db
    .table(DEFINITION_CLIENTS)
    .where({ definition_client_id: definitionClient.definition_client_id })
    .update({ evaluated_through: now, updated_at: knex.fn.now() });

  return counts;
}

async function processCandidate(args: {
  knex: Knex;
  tenant: string;
  definition: DefinitionRow;
  definitionClient: DefinitionClientRow;
  client: { client_name: string; is_inactive: boolean } | null;
  candidate: Candidate;
  existing: OccurrenceRow | null;
  now: Date;
  options: GenerateRecurringTicketsOptions;
}): Promise<Outcome> {
  const { knex, tenant, definition, definitionClient, candidate, existing, now } = args;

  if (existing && existing.status !== 'failed') return 'unchanged';

  const pastDue = candidate.dueAt.getTime() <= now.getTime();
  if (pastDue) {
    // A failed row is final once due. With no row at all the sweep never got to this occurrence.
    if (existing) return 'unchanged';
    const inserted = await tenantDb(knex, tenant)
      .table(OCCURRENCES)
      .insert({
        tenant,
        definition_id: definition.definition_id,
        definition_client_id: definitionClient.definition_client_id,
        client_id: definitionClient.client_id,
        occurrence_date: candidate.nominal,
        due_date: candidate.due,
        create_at: candidate.createAt,
        due_at: candidate.dueAt,
        status: 'missed',
        reason: 'The occurrence came due before a ticket could be created',
        attempts: 0,
      })
      .onConflict(IDEMPOTENCY_COLUMNS)
      .ignore()
      .returning('occurrence_id');
    return inserted.length > 0 ? 'missed' : 'unchanged';
  }

  try {
    return await withTransaction(knex, (trx) => generateOccurrence({ ...args, trx }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn('[RecurringTickets] Occurrence generation failed', {
      tenant, definitionId: definition.definition_id,
      definitionClientId: definitionClient.definition_client_id, occurrenceDate: candidate.nominal, reason,
    });
    await recordFailure({ knex, tenant, definition, definitionClient, candidate, reason, now });
    return 'failed';
  }
}

async function recordFailure(args: {
  knex: Knex;
  tenant: string;
  definition: DefinitionRow;
  definitionClient: DefinitionClientRow;
  candidate: Candidate;
  reason: string;
  now: Date;
}): Promise<void> {
  const { knex, tenant, definition, definitionClient, candidate, reason, now } = args;
  // Insert, or bump a previously failed row. Never touches a row that has since become created/skipped.
  await knex.raw(
    `INSERT INTO ${OCCURRENCES}
       (tenant, definition_id, definition_client_id, client_id, occurrence_date, due_date,
        create_at, due_at, status, reason, attempts, last_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, 1, ?)
     ON CONFLICT (tenant, definition_client_id, occurrence_date) DO UPDATE
       SET reason = EXCLUDED.reason,
           due_date = EXCLUDED.due_date,
           create_at = EXCLUDED.create_at,
           due_at = EXCLUDED.due_at,
           attempts = ${OCCURRENCES}.attempts + 1,
           last_attempt_at = EXCLUDED.last_attempt_at
     WHERE ${OCCURRENCES}.tenant = EXCLUDED.tenant AND ${OCCURRENCES}.status = 'failed'`,
    [
      tenant, definition.definition_id, definitionClient.definition_client_id, definitionClient.client_id,
      candidate.nominal, candidate.due, candidate.createAt, candidate.dueAt, reason.slice(0, 2000), now,
    ]
  );
}

/** Steps 4.1–4.5 of §4.4, all in the caller's transaction so the ticket and its ledger row commit together. */
async function generateOccurrence(args: {
  trx: Knex.Transaction;
  tenant: string;
  definition: DefinitionRow;
  definitionClient: DefinitionClientRow;
  client: { client_name: string; is_inactive: boolean } | null;
  candidate: Candidate;
  existing: OccurrenceRow | null;
  now: Date;
  options: GenerateRecurringTicketsOptions;
}): Promise<Outcome> {
  const { trx, tenant, definition, definitionClient, client, candidate, existing, now, options } = args;
  const db = tenantDb(trx, tenant);

  // 1. Claim the occurrence. Losing the race (another sweep inserted or resolved it first) is a no-op.
  let occurrenceId: string;
  if (existing) {
    const claimed = await db
      .table(OCCURRENCES)
      .where({ occurrence_id: existing.occurrence_id, status: 'failed' })
      .update({ attempts: trx.raw('attempts + 1'), last_attempt_at: now })
      .returning('occurrence_id');
    if (claimed.length === 0) return 'unchanged';
    occurrenceId = claimed[0].occurrence_id;
  } else {
    // Inserted as `failed` and flipped below: the row only survives the transaction if it ends as
    // `created` or `skipped`; any error rolls it back and `recordFailure` writes the real failed row.
    const inserted = await db
      .table(OCCURRENCES)
      .insert({
        tenant,
        definition_id: definition.definition_id,
        definition_client_id: definitionClient.definition_client_id,
        client_id: definitionClient.client_id,
        occurrence_date: candidate.nominal,
        due_date: candidate.due,
        create_at: candidate.createAt,
        due_at: candidate.dueAt,
        status: 'failed',
        attempts: 1,
        last_attempt_at: now,
      })
      .onConflict(IDEMPOTENCY_COLUMNS)
      .ignore()
      .returning('occurrence_id');
    if (inserted.length === 0) return 'unchanged';
    occurrenceId = inserted[0].occurrence_id;
  }

  const finish = async (values: Record<string, unknown>) => {
    await db.table(OCCURRENCES).where({ occurrence_id: occurrenceId }).update({ reason: null, ...values });
  };

  if (!client) throw new Error('The client no longer exists');
  if (client.is_inactive) {
    await finish({ status: 'skipped', reason: 'client_inactive' });
    return 'skipped';
  }

  // 2. "Skip while the previous ticket is still open".
  if (definition.open_previous_policy === 'skip') {
    const previous = await db
      .tenantJoin(
        db.table(`${OCCURRENCES} as o`),
        'tickets as t',
        'o.ticket_id',
        't.ticket_id'
      )
      .where({ 'o.definition_client_id': definitionClient.definition_client_id, 'o.status': 'created' })
      .whereNot('o.occurrence_id', occurrenceId)
      .orderBy('o.due_at', 'desc')
      .first('t.ticket_number', 't.status_id');
    if (previous) {
      const status = await db.table('statuses').where({ status_id: previous.status_id }).first('is_closed');
      if (!status?.is_closed) {
        await finish({ status: 'skipped', reason: `previous_open:${previous.ticket_number}` });
        return 'skipped';
      }
    }
  }

  // 3. Effective fields, re-validated now (their referents can change after the definition is saved).
  const overrides = recurringTicketOverridesSchema.parse(asJson(definitionClient.overrides ?? {})) as RecurringTicketOverrides;
  const fields = resolveEffectiveFields(
    {
      board_id: definition.board_id,
      status_id: definition.status_id,
      priority_id: definition.priority_id,
      category_id: definition.category_id,
      subcategory_id: definition.subcategory_id,
      assigned_to: definition.assigned_to,
      assigned_team_id: definition.assigned_team_id,
      additional_agent_ids: asJson<string[]>(definition.additional_agent_ids ?? []),
    },
    overrides
  );
  const assetRows = await db
    .table(CLIENT_ASSETS)
    .where({ definition_client_id: definitionClient.definition_client_id })
    .select('asset_id');
  const assetIds = assetRows.map((row) => row.asset_id as string);

  const problems = await findRecurringReferenceProblems(trx, tenant, {
    fields,
    clientId: definitionClient.client_id,
    contactId: definitionClient.contact_id,
    locationId: definitionClient.location_id,
    assetIds,
  });
  if (problems.length > 0) throw new Error(problems.map((problem) => problem.message).join('; '));

  const title = renderTitleTemplate(definition.title_template, {
    clientName: client.client_name,
    dueDate: candidate.due,
    locale: options.locale,
  });

  // 4. The ticket, with the same side effects as one created in the UI.
  const { ticketId } = await createTicketWithSideEffects(trx, tenant, {
    actor: { type: 'system' },
    ticket: {
      title,
      description: definition.description == null ? undefined : JSON.stringify(definition.description),
      client_id: definitionClient.client_id,
      contact_id: definitionClient.contact_id ?? undefined,
      location_id: definitionClient.location_id ?? undefined,
      board_id: fields.board_id,
      status_id: fields.status_id ?? undefined,
      priority_id: fields.priority_id,
      category_id: fields.category_id ?? undefined,
      subcategory_id: fields.subcategory_id ?? undefined,
      assigned_to: fields.assigned_to ?? undefined,
      due_date: candidate.dueAt.toISOString(),
      ticket_origin: 'recurring',
      source: RECURRING_TICKET_SOURCE,
    },
    teamId: fields.assigned_team_id,
    additionalAgentIds: fields.additional_agent_ids,
    tags: asJson<string[]>(definition.tags ?? []),
    assetIds,
    checklistTemplateId: definition.checklist_template_id,
    notificationSuppression: { suppressContactNotifications: !definition.notify_client_on_create },
  });

  // 5. Close the ledger row in the same transaction as the ticket.
  await finish({ status: 'created', ticket_id: ticketId });
  return 'created';
}
