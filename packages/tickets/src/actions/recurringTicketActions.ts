'use server'

import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { toCalendarDateString } from '@alga-psa/core';
import { actionError } from '@alga-psa/ui/lib/errorHandling';
import { loadTenantBusinessDayCalendar } from '@alga-psa/shared/lib/businessHours/loadBusinessDayCalendar';
import type { BusinessDayCalendar } from '@alga-psa/shared/lib/businessHours/businessDayCalendar';
import { parseRecurrenceRule, type RecurrenceRule } from '@alga-psa/shared/lib/recurrence';
import { ticketActionErrorFrom, type TicketActionError } from './ticketActionErrors';
import {
  recurringOccurrenceFiltersSchema,
  recurringSchedulePreviewInputSchema,
  recurringTicketClientUpdateSchema,
  recurringTicketDefinitionInputSchema,
  type ParsedRecurringTicketDefinitionInput,
  type RecurringOccurrenceFilters,
  type RecurringSchedulePreviewInput,
  type RecurringTicketClientUpdate,
  type RecurringTicketDefinitionInput,
} from '../lib/recurring/definitionInput';
import {
  recurringTicketOverridesSchema,
  resolveEffectiveFields,
  type RecurringTemplateFields,
} from '../lib/recurring/effectiveFields';
import { RecurringTicketError } from '../lib/recurring/errors';
import { asJsonColumn } from '../lib/recurring/jsonColumn';
import { loadTenantTimeZone } from '../lib/recurring/tenantTimeZone';
import { listUpcomingOccurrences } from '../lib/recurring/upcomingOccurrences';
import { findRecurringReferenceProblems } from '../lib/recurring/validateReferences';
import type {
  RecurringDefinitionClientRecord,
  RecurringDefinitionDetail,
  RecurringDefinitionListItem,
  RecurringDefinitionRecord,
  RecurringDefinitionStatus,
  RecurringOccurrenceListItem,
  RecurringOccurrencePage,
  RecurringSchedulePreview,
  RecurringTicketForClient,
  RecurringTicketSource,
} from '../lib/recurring/types';

const DEFINITIONS = 'recurring_ticket_definitions';
const DEFINITION_CLIENTS = 'recurring_ticket_definition_clients';
const CLIENT_ASSETS = 'recurring_ticket_client_assets';
const OCCURRENCES = 'recurring_ticket_occurrences';

type Conn = Knex | Knex.Transaction;
type RecurringTicketActionError = TicketActionError;
type DefinitionFilter = 'active' | 'paused' | 'archived' | 'all';

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

const ERROR_KEYS: Record<RecurringTicketError['code'], string> = {
  DEFINITION_NOT_FOUND: 'features/tickets:recurring.errors.definitionNotFound',
  DEFINITION_ARCHIVED: 'features/tickets:recurring.errors.definitionArchived',
  CLIENT_NOT_FOUND: 'features/tickets:recurring.errors.clientNotFound',
  CLIENT_ALREADY_ADDED: 'features/tickets:recurring.errors.clientAlreadyAdded',
  INVALID_REFERENCES: 'features/tickets:recurring.errors.invalidReferences',
};

function recurringActionErrorFrom(error: unknown): RecurringTicketActionError | null {
  if (error instanceof RecurringTicketError) {
    return actionError(error.message, ERROR_KEYS[error.code], error.params);
  }
  return ticketActionErrorFrom(error);
}

async function requirePermission(
  user: Parameters<typeof hasPermission>[0],
  action: 'read' | 'create' | 'update' | 'delete',
  conn: Conn
): Promise<void> {
  if (!(await hasPermission(user, 'recurring_ticket', action, conn as Knex.Transaction))) {
    throw new Error(`Permission denied: Cannot ${action} recurring tickets`);
  }
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function calendarDate(value: Date | string, column: string): string {
  const date = toCalendarDateString(value);
  if (!date) throw new Error(`Unreadable ${column} value`);
  return date;
}

function statusOf(row: { is_active: boolean; archived_at: Date | string | null }): RecurringDefinitionStatus {
  if (row.archived_at) return 'archived';
  return row.is_active ? 'active' : 'paused';
}

function toDefinitionRecord(row: Record<string, any>): RecurringDefinitionRecord {
  return {
    definition_id: row.definition_id,
    name: row.name,
    is_active: row.is_active,
    archived_at: toIso(row.archived_at),
    title_template: row.title_template,
    description: row.description == null ? null : asJsonColumn(row.description),
    board_id: row.board_id,
    status_id: row.status_id ?? null,
    priority_id: row.priority_id,
    category_id: row.category_id ?? null,
    subcategory_id: row.subcategory_id ?? null,
    assigned_to: row.assigned_to ?? null,
    assigned_team_id: row.assigned_team_id ?? null,
    additional_agent_ids: asJsonColumn<string[]>(row.additional_agent_ids ?? []),
    tags: asJsonColumn<string[]>(row.tags ?? []),
    checklist_template_id: row.checklist_template_id ?? null,
    recurrence: parseRecurrenceRule(asJsonColumn(row.recurrence)),
    start_date: calendarDate(row.start_date, 'start_date'),
    create_time: row.create_time,
    due_time: row.due_time,
    lead_days: row.lead_days,
    non_business_day_policy: row.non_business_day_policy,
    open_previous_policy: row.open_previous_policy,
    notify_client_on_create: row.notify_client_on_create,
  };
}

function templateFields(input: {
  board_id: string;
  status_id: string | null;
  priority_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
  additional_agent_ids: string[];
}): RecurringTemplateFields {
  return {
    board_id: input.board_id,
    status_id: input.status_id,
    priority_id: input.priority_id,
    category_id: input.category_id,
    subcategory_id: input.subcategory_id,
    assigned_to: input.assigned_to,
    assigned_team_id: input.assigned_team_id,
    additional_agent_ids: input.additional_agent_ids,
  };
}

async function assertDefinitionReferences(
  conn: Conn,
  tenant: string,
  input: ParsedRecurringTicketDefinitionInput
): Promise<void> {
  const problems = await findRecurringReferenceProblems(conn, tenant, { fields: templateFields(input) });
  if (input.checklist_template_id) {
    const template = await tenantDb(conn, tenant)
      .table('checklist_templates')
      .where({ template_id: input.checklist_template_id })
      .first('template_id');
    if (!template) {
      problems.push({ field: 'board_id', message: 'The selected checklist template no longer exists' });
    }
  }
  throwIfProblems(problems);
}

function throwIfProblems(problems: { message: string }[]): void {
  if (problems.length === 0) return;
  const joined = problems.map((problem) => problem.message).join('; ');
  throw new RecurringTicketError(joined, 'INVALID_REFERENCES', { problems: joined });
}

/** The definition, locked for the duration of the transaction. Archived definitions are read-only. */
async function loadWritableDefinition(trx: Knex.Transaction, tenant: string, definitionId: string) {
  const row = await tenantDb(trx, tenant)
    .table(DEFINITIONS)
    .where({ definition_id: definitionId })
    .forUpdate()
    .first();
  if (!row) throw new RecurringTicketError('Recurring ticket not found', 'DEFINITION_NOT_FOUND');
  if (row.archived_at) {
    throw new RecurringTicketError('Archived recurring tickets are read-only', 'DEFINITION_ARCHIVED');
  }
  return row;
}

async function loadClientRow(trx: Knex.Transaction, tenant: string, definitionClientId: string) {
  const row = await tenantDb(trx, tenant)
    .table(DEFINITION_CLIENTS)
    .where({ definition_client_id: definitionClientId })
    .first();
  if (!row) throw new RecurringTicketError('Client not found on this recurring ticket', 'CLIENT_NOT_FOUND');
  return row;
}

async function loadCalendarIfNeeded(
  conn: Conn,
  tenant: string,
  policies: Iterable<string>
): Promise<BusinessDayCalendar | null> {
  for (const policy of policies) {
    if (policy !== 'keep') return loadTenantBusinessDayCalendar(conn, tenant);
  }
  return null;
}

function nextDueAt(
  definition: RecurringDefinitionRecord,
  calendar: BusinessDayCalendar | null,
  timeZone: string,
  now: Date
): string | null {
  const [next] = listUpcomingOccurrences({
    rule: definition.recurrence,
    startDate: definition.start_date,
    createTime: definition.create_time,
    dueTime: definition.due_time,
    leadDays: definition.lead_days,
    policy: definition.non_business_day_policy,
    calendar,
    now,
    timeZone,
    count: 1,
  });
  return next ? next.dueAt.toISOString() : null;
}

// ---------------------------------------------------------------------------------------------
// definitions
// ---------------------------------------------------------------------------------------------

export const listRecurringTicketDefinitions = withAuth(async (
  user,
  { tenant },
  filter: DefinitionFilter = 'all'
): Promise<RecurringDefinitionListItem[] | RecurringTicketActionError> => {
  try {
    const { knex } = await createTenantKnex();
    await requirePermission(user, 'read', knex);
    const db = tenantDb(knex, tenant);

    const query = db.table(DEFINITIONS).orderBy('name', 'asc');
    if (filter === 'active') query.where({ is_active: true }).whereNull('archived_at');
    else if (filter === 'paused') query.where({ is_active: false }).whereNull('archived_at');
    else if (filter === 'archived') query.whereNotNull('archived_at');
    const rows = await query;
    if (rows.length === 0) return [];

    const definitionIds = rows.map((row) => row.definition_id as string);
    const clientCounts = await db
      .table(DEFINITION_CLIENTS)
      .whereIn('definition_id', definitionIds)
      .groupBy('definition_id')
      .select('definition_id')
      .count('* as total')
      .select(knex.raw('count(*) filter (where is_active) as active_total'));
    const counts = new Map(
      clientCounts.map((row) => [row.definition_id as string, { total: Number(row.total), active: Number(row.active_total) }])
    );

    // Latest occurrence per client (by due date); a `failed` one is the "needs attention" warning.
    const latest = await db
      .table(OCCURRENCES)
      .whereIn('definition_id', definitionIds)
      .select('definition_id', 'definition_client_id', 'status')
      .select(
        knex.raw('row_number() over (partition by definition_client_id order by occurrence_date desc) as recency')
      );
    const failing = new Set(
      latest.filter((row) => Number(row.recency) === 1 && row.status === 'failed').map((row) => row.definition_id as string)
    );

    const records = rows.map(toDefinitionRecord);
    const calendar = await loadCalendarIfNeeded(knex, tenant, records.map((record) => record.non_business_day_policy));
    const timeZone = await loadTenantTimeZone(knex, tenant);
    const now = new Date();

    return records.map((record) => {
      const count = counts.get(record.definition_id) ?? { total: 0, active: 0 };
      const status = statusOf(record);
      return {
        definition_id: record.definition_id,
        name: record.name,
        status,
        recurrence: record.recurrence,
        client_count: count.total,
        next_due_at: status === 'active' && count.active > 0 ? nextDueAt(record, calendar, timeZone, now) : null,
        has_failure: failing.has(record.definition_id),
        time_zone: timeZone,
      };
    });
  } catch (error) {
    const expected = recurringActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to list recurring ticket definitions:', error);
    throw error;
  }
});

export const getRecurringTicketDefinition = withAuth(async (
  user,
  { tenant },
  definitionId: string
): Promise<RecurringDefinitionDetail | RecurringTicketActionError> => {
  try {
    const { knex } = await createTenantKnex();
    await requirePermission(user, 'read', knex);
    const db = tenantDb(knex, tenant);

    const row = await db.table(DEFINITIONS).where({ definition_id: definitionId }).first();
    if (!row) throw new RecurringTicketError('Recurring ticket not found', 'DEFINITION_NOT_FOUND');
    const definition = toDefinitionRecord(row);

    const clientQuery = db.table(`${DEFINITION_CLIENTS} as dc`);
    db.tenantJoin(clientQuery, 'clients as c', 'dc.client_id', 'c.client_id', { type: 'left' });
    const clientRows = await clientQuery
      .where('dc.definition_id', definitionId)
      .orderBy('c.client_name', 'asc')
      .select('dc.*', 'c.client_name');

    const assetRows = await db
      .table(CLIENT_ASSETS)
      .whereIn('definition_client_id', clientRows.map((client) => client.definition_client_id as string))
      .select('definition_client_id', 'asset_id');
    const assetsByClient = new Map<string, string[]>();
    for (const asset of assetRows) {
      const list = assetsByClient.get(asset.definition_client_id as string) ?? [];
      list.push(asset.asset_id as string);
      assetsByClient.set(asset.definition_client_id as string, list);
    }

    const clients: RecurringDefinitionClientRecord[] = clientRows.map((client) => ({
      definition_client_id: client.definition_client_id,
      definition_id: client.definition_id,
      client_id: client.client_id,
      client_name: client.client_name ?? '',
      is_active: client.is_active,
      overrides: recurringTicketOverridesSchema.parse(asJsonColumn(client.overrides ?? {})),
      contact_id: client.contact_id ?? null,
      location_id: client.location_id ?? null,
      asset_ids: assetsByClient.get(client.definition_client_id as string) ?? [],
    }));

    const calendar = await loadCalendarIfNeeded(knex, tenant, [definition.non_business_day_policy]);
    const timeZone = await loadTenantTimeZone(knex, tenant);
    return { definition, clients, next_due_at: nextDueAt(definition, calendar, timeZone, new Date()), time_zone: timeZone };
  } catch (error) {
    const expected = recurringActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to load recurring ticket definition:', error);
    throw error;
  }
});

function definitionColumns(input: ParsedRecurringTicketDefinitionInput) {
  return {
    name: input.name,
    is_active: input.is_active,
    title_template: input.title_template,
    description: input.description == null ? null : JSON.stringify(input.description),
    board_id: input.board_id,
    status_id: input.status_id,
    priority_id: input.priority_id,
    category_id: input.category_id,
    subcategory_id: input.subcategory_id,
    assigned_to: input.assigned_to,
    assigned_team_id: input.assigned_team_id,
    additional_agent_ids: JSON.stringify(input.additional_agent_ids),
    tags: JSON.stringify(input.tags),
    checklist_template_id: input.checklist_template_id,
    recurrence: JSON.stringify(input.recurrence),
    start_date: input.start_date,
    create_time: input.create_time,
    due_time: input.due_time,
    lead_days: input.lead_days,
    non_business_day_policy: input.non_business_day_policy,
    open_previous_policy: input.open_previous_policy,
    notify_client_on_create: input.notify_client_on_create,
  };
}

export const createRecurringTicketDefinition = withAuth(async (
  user,
  { tenant },
  rawInput: RecurringTicketDefinitionInput
): Promise<{ definition_id: string } | RecurringTicketActionError> => {
  try {
    const input = recurringTicketDefinitionInputSchema.parse(rawInput);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'create', trx);
      await assertDefinitionReferences(trx, tenant, input);

      const definitionId = uuidv4();
      const now = new Date();
      await tenantDb(trx, tenant).table(DEFINITIONS).insert({
        tenant,
        definition_id: definitionId,
        ...definitionColumns(input),
        created_by: user.user_id,
        updated_by: user.user_id,
        created_at: now,
        updated_at: now,
      });
      return { definition_id: definitionId };
    });
  } catch (error) {
    const expected = recurringActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to create recurring ticket definition:', error);
    throw error;
  }
});

export const updateRecurringTicketDefinition = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  rawInput: RecurringTicketDefinitionInput
): Promise<{ definition_id: string } | RecurringTicketActionError> => {
  try {
    const input = recurringTicketDefinitionInputSchema.parse(rawInput);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'update', trx);
      const existing = await loadWritableDefinition(trx, tenant, definitionId);
      await assertDefinitionReferences(trx, tenant, input);

      const db = tenantDb(trx, tenant);
      const now = new Date();
      await db.table(DEFINITIONS).where({ definition_id: definitionId }).update({
        ...definitionColumns(input),
        updated_by: user.user_id,
        updated_at: now,
      });

      // Turning a paused definition back on through the edit form is a resume: no backfill.
      if (!existing.is_active && input.is_active) {
        await db
          .table(DEFINITION_CLIENTS)
          .where({ definition_id: definitionId, is_active: true })
          .update({ evaluated_through: now });
      }
      return { definition_id: definitionId };
    });
  } catch (error) {
    const expected = recurringActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to update recurring ticket definition:', error);
    throw error;
  }
});

export const setRecurringTicketDefinitionActive = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  active: boolean
): Promise<{ definition_id: string; is_active: boolean } | RecurringTicketActionError> => {
  try {
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'update', trx);
      const existing = await loadWritableDefinition(trx, tenant, definitionId);
      const db = tenantDb(trx, tenant);
      const now = new Date();
      await db.table(DEFINITIONS).where({ definition_id: definitionId }).update({
        is_active: active,
        updated_by: user.user_id,
        updated_at: now,
      });
      // Resuming restarts every active client's no-backfill window: nothing that came due while the
      // definition was paused is created afterwards.
      if (active && !existing.is_active) {
        await db
          .table(DEFINITION_CLIENTS)
          .where({ definition_id: definitionId, is_active: true })
          .update({ evaluated_through: now });
      }
      return { definition_id: definitionId, is_active: active };
    });
  } catch (error) {
    const expected = recurringActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to change recurring ticket status:', error);
    throw error;
  }
});

export const archiveRecurringTicketDefinition = withAuth(async (
  user,
  { tenant },
  definitionId: string
): Promise<{ definition_id: string } | RecurringTicketActionError> => {
  try {
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'delete', trx);
      await loadWritableDefinition(trx, tenant, definitionId);
      const now = new Date();
      await tenantDb(trx, tenant).table(DEFINITIONS).where({ definition_id: definitionId }).update({
        archived_at: now,
        is_active: false,
        updated_by: user.user_id,
        updated_at: now,
      });
      return { definition_id: definitionId };
    });
  } catch (error) {
    const expected = recurringActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to archive recurring ticket definition:', error);
    throw error;
  }
});

// ---------------------------------------------------------------------------------------------
// clients
// ---------------------------------------------------------------------------------------------

export const addClientsToRecurringTicketDefinition = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  clientIds: string[]
): Promise<{ added: number } | RecurringTicketActionError> => {
  try {
    const ids = [...new Set(clientIds)];
    if (ids.length === 0) return { added: 0 };
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'update', trx);
      const definition = await loadWritableDefinition(trx, tenant, definitionId);
      const db = tenantDb(trx, tenant);

      const found = await db.table('clients').whereIn('client_id', ids).select('client_id');
      if (found.length !== ids.length) {
        throw new RecurringTicketError('One or more selected clients no longer exist', 'CLIENT_NOT_FOUND');
      }

      const now = new Date();
      // A definition that is paused starts each client's window when it is resumed, so the watermark
      // set here only matters for an active definition; both cases are "no backfill".
      const inserted = await db
        .table(DEFINITION_CLIENTS)
        .insert(
          ids.map((clientId) => ({
            tenant,
            definition_client_id: uuidv4(),
            definition_id: definition.definition_id,
            client_id: clientId,
            is_active: true,
            overrides: JSON.stringify({}),
            evaluated_through: now,
          }))
        )
        .onConflict(['tenant', 'definition_id', 'client_id'])
        .ignore()
        .returning('definition_client_id');
      return { added: inserted.length };
    });
  } catch (error) {
    const expected = recurringActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to add clients to recurring ticket:', error);
    throw error;
  }
});

export const updateRecurringTicketClient = withAuth(async (
  user,
  { tenant },
  definitionClientId: string,
  rawUpdate: RecurringTicketClientUpdate
): Promise<{ definition_client_id: string } | RecurringTicketActionError> => {
  try {
    const update = recurringTicketClientUpdateSchema.parse(rawUpdate);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'update', trx);
      const clientRow = await loadClientRow(trx, tenant, definitionClientId);
      const definitionRow = await loadWritableDefinition(trx, tenant, clientRow.definition_id);
      const definition = toDefinitionRecord(definitionRow);

      // Validate the effective ticket this client would get, so a board override that does not fit the
      // inherited category (for example) is rejected when saved rather than failing every run.
      const fields = resolveEffectiveFields(templateFields(definition), update.overrides);
      throwIfProblems(
        await findRecurringReferenceProblems(trx, tenant, {
          fields,
          clientId: clientRow.client_id,
          contactId: update.contact_id,
          locationId: update.location_id,
          assetIds: update.asset_ids,
        })
      );

      const db = tenantDb(trx, tenant);
      await db.table(DEFINITION_CLIENTS).where({ definition_client_id: definitionClientId }).update({
        overrides: JSON.stringify(update.overrides),
        contact_id: update.contact_id,
        location_id: update.location_id,
      });
      await db.table(CLIENT_ASSETS).where({ definition_client_id: definitionClientId }).delete();
      const assetIds = [...new Set(update.asset_ids)];
      if (assetIds.length > 0) {
        await db.table(CLIENT_ASSETS).insert(
          assetIds.map((assetId) => ({ tenant, definition_client_id: definitionClientId, asset_id: assetId }))
        );
      }
      return { definition_client_id: definitionClientId };
    });
  } catch (error) {
    const expected = recurringActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to update recurring ticket client:', error);
    throw error;
  }
});

export const setRecurringTicketClientActive = withAuth(async (
  user,
  { tenant },
  definitionClientId: string,
  active: boolean
): Promise<{ definition_client_id: string; is_active: boolean } | RecurringTicketActionError> => {
  try {
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'update', trx);
      const clientRow = await loadClientRow(trx, tenant, definitionClientId);
      await loadWritableDefinition(trx, tenant, clientRow.definition_id);
      await tenantDb(trx, tenant)
        .table(DEFINITION_CLIENTS)
        .where({ definition_client_id: definitionClientId })
        .update({
          is_active: active,
          // Resuming a client restarts its no-backfill window.
          ...(active && !clientRow.is_active ? { evaluated_through: new Date() } : {}),
        });
      return { definition_client_id: definitionClientId, is_active: active };
    });
  } catch (error) {
    const expected = recurringActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to change recurring ticket client status:', error);
    throw error;
  }
});

export const removeClientFromRecurringTicketDefinition = withAuth(async (
  user,
  { tenant },
  definitionClientId: string
): Promise<{ definition_client_id: string } | RecurringTicketActionError> => {
  try {
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'update', trx);
      const clientRow = await loadClientRow(trx, tenant, definitionClientId);
      await loadWritableDefinition(trx, tenant, clientRow.definition_id);
      // Occurrence history deliberately survives: occurrences carry no FK to this row.
      await tenantDb(trx, tenant)
        .table(DEFINITION_CLIENTS)
        .where({ definition_client_id: definitionClientId })
        .delete();
      return { definition_client_id: definitionClientId };
    });
  } catch (error) {
    const expected = recurringActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to remove client from recurring ticket:', error);
    throw error;
  }
});

// ---------------------------------------------------------------------------------------------
// history, preview, and cross-feature reads
// ---------------------------------------------------------------------------------------------

export const listRecurringTicketOccurrences = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  rawFilters: RecurringOccurrenceFilters = {}
): Promise<RecurringOccurrencePage | RecurringTicketActionError> => {
  try {
    const filters = recurringOccurrenceFiltersSchema.parse(rawFilters);
    const { knex } = await createTenantKnex();
    await requirePermission(user, 'read', knex);
    const db = tenantDb(knex, tenant);

    const applyFilters = (query: Knex.QueryBuilder) => {
      query.where('o.definition_id', definitionId);
      if (filters.status) query.where('o.status', filters.status);
      if (filters.clientId) query.where('o.client_id', filters.clientId);
      return query;
    };

    const countQuery = applyFilters(db.table(`${OCCURRENCES} as o`));
    const totalRow = await countQuery.count('* as total').first();

    const rowsQuery = applyFilters(db.table(`${OCCURRENCES} as o`));
    db.tenantJoin(rowsQuery, 'clients as c', 'o.client_id', 'c.client_id', { type: 'left' });
    db.tenantJoin(rowsQuery, 'tickets as t', 'o.ticket_id', 't.ticket_id', { type: 'left' });
    const rows = await rowsQuery
      .orderBy('o.due_at', 'desc')
      .orderBy('o.occurrence_id', 'asc')
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize)
      .select('o.*', 'c.client_name', 't.ticket_number');

    const items: RecurringOccurrenceListItem[] = rows.map((row: Record<string, any>) => ({
      occurrence_id: row.occurrence_id,
      definition_id: row.definition_id,
      definition_client_id: row.definition_client_id,
      client_id: row.client_id,
      client_name: row.client_name ?? null,
      occurrence_date: calendarDate(row.occurrence_date, 'occurrence_date'),
      due_date: calendarDate(row.due_date, 'due_date'),
      create_at: toIso(row.create_at),
      due_at: toIso(row.due_at),
      status: row.status,
      ticket_id: row.ticket_id ?? null,
      ticket_number: row.ticket_number ?? null,
      reason: row.reason ?? null,
      attempts: row.attempts,
    }));
    return { items, total: Number(totalRow?.total ?? 0), page: filters.page, pageSize: filters.pageSize };
  } catch (error) {
    const expected = recurringActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to list recurring ticket occurrences:', error);
    throw error;
  }
});

/** The next 5 `{ due_at, create_at }` from now for an unsaved draft schedule, in the tenant timezone. */
export const previewRecurringTicketOccurrences = withAuth(async (
  user,
  { tenant },
  rawDraft: RecurringSchedulePreviewInput
): Promise<RecurringSchedulePreview | RecurringTicketActionError> => {
  try {
    const draft = recurringSchedulePreviewInputSchema.parse(rawDraft);
    const { knex } = await createTenantKnex();
    await requirePermission(user, 'read', knex);

    const timeZone = await loadTenantTimeZone(knex, tenant);
    const calendar = await loadCalendarIfNeeded(knex, tenant, [draft.non_business_day_policy]);
    const upcoming = listUpcomingOccurrences({
      rule: draft.recurrence as RecurrenceRule,
      startDate: draft.start_date,
      createTime: draft.create_time,
      dueTime: draft.due_time,
      leadDays: draft.lead_days,
      policy: draft.non_business_day_policy,
      calendar,
      now: new Date(),
      timeZone,
      count: 5,
    });
    return {
      occurrences: upcoming.map((candidate) => ({
        nominal: candidate.nominal,
        due: candidate.due,
        create_at: candidate.createAt.toISOString(),
        due_at: candidate.dueAt.toISOString(),
      })),
      time_zone: timeZone,
      calendar: calendar ? { source: calendar.source, schedule_name: calendar.scheduleName } : null,
    };
  } catch (error) {
    const expected = recurringActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to preview recurring ticket occurrences:', error);
    throw error;
  }
});

/** The definitions that include `clientId`, with that client's overrides, for the client-page section. */
export const listRecurringTicketsForClient = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<RecurringTicketForClient[] | RecurringTicketActionError> => {
  try {
    const { knex } = await createTenantKnex();
    await requirePermission(user, 'read', knex);
    const db = tenantDb(knex, tenant);

    const query = db.table(`${DEFINITION_CLIENTS} as dc`);
    db.tenantJoin(query, `${DEFINITIONS} as d`, 'dc.definition_id', 'd.definition_id');
    const rows = await query
      .where('dc.client_id', clientId)
      .whereNull('d.archived_at')
      .orderBy('d.name', 'asc')
      .select(
        'dc.definition_client_id',
        'dc.is_active as client_is_active',
        'dc.overrides',
        'dc.contact_id',
        'dc.location_id',
        'd.*'
      );
    if (rows.length === 0) return [];

    const assetRows = await db
      .table(CLIENT_ASSETS)
      .whereIn('definition_client_id', rows.map((row) => row.definition_client_id as string))
      .select('definition_client_id', 'asset_id');
    const assetsByClient = new Map<string, string[]>();
    for (const asset of assetRows) {
      const list = assetsByClient.get(asset.definition_client_id as string) ?? [];
      list.push(asset.asset_id as string);
      assetsByClient.set(asset.definition_client_id as string, list);
    }

    const records = rows.map((row) => toDefinitionRecord(row));
    const calendar = await loadCalendarIfNeeded(knex, tenant, records.map((record) => record.non_business_day_policy));
    const timeZone = await loadTenantTimeZone(knex, tenant);
    const now = new Date();

    return rows.map((row, index) => {
      const record = records[index];
      const status = statusOf({ is_active: record.is_active, archived_at: record.archived_at });
      return {
        definition_client_id: row.definition_client_id,
        definition_id: record.definition_id,
        name: record.name,
        status,
        is_client_active: row.client_is_active,
        recurrence: record.recurrence,
        next_due_at: status === 'active' && row.client_is_active ? nextDueAt(record, calendar, timeZone, now) : null,
        time_zone: timeZone,
        overrides: recurringTicketOverridesSchema.parse(asJsonColumn(row.overrides ?? {})),
        contact_id: row.contact_id ?? null,
        location_id: row.location_id ?? null,
        asset_ids: assetsByClient.get(row.definition_client_id as string) ?? [],
      };
    });
  } catch (error) {
    const expected = recurringActionErrorFrom(error);
    if (expected) return expected;
    console.error('Failed to list recurring tickets for client:', error);
    throw error;
  }
});

/**
 * The definition that generated `ticketId`, for the ticket-detail badge, or null. A viewer without
 * `recurring_ticket:read` gets null rather than an error: the ticket page must keep working and the
 * badge just shows the plain "Recurring" origin without a link.
 */
export const getRecurringSourceForTicket = withAuth(async (
  user,
  { tenant },
  ticketId: string
): Promise<RecurringTicketSource | null> => {
  const { knex } = await createTenantKnex();
  if (!(await hasPermission(user, 'recurring_ticket', 'read', knex as Knex.Transaction))) return null;

  const db = tenantDb(knex, tenant);
  const query = db.table(`${OCCURRENCES} as o`);
  db.tenantJoin(query, `${DEFINITIONS} as d`, 'o.definition_id', 'd.definition_id');
  const row = await query.where('o.ticket_id', ticketId).first('d.definition_id', 'd.name');
  return row ? { definition_id: row.definition_id, name: row.name } : null;
});
