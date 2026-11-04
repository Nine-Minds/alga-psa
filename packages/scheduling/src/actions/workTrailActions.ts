'use server';

import type { Knex } from 'knex';
import { createTenantKnex, resolveUserTimeZone, tenantDb } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import { assertCanActOnBehalf } from './timeEntryDelegationAuth';
import { timeSheetActionErrorFrom, type TimeSheetActionError } from './timeSheetActionErrors';
import {
  deriveSuggestions,
  toWorkDateString,
  type TimeEntrySuggestion,
} from '../lib/workTrail/deriveSuggestions';

/**
 * Work trail server actions (plan sections D13-D15, 8). Suggestions are derived on read from the
 * user's own ticket_audit_logs rows; nothing is materialised except the user's dismissals.
 * Only the owner or a delegate allowed by assertCanActOnBehalf may read or dismiss. Expected
 * failures come back as TimeSheetActionError values.
 */

export interface GetTimeEntrySuggestionsInput {
  userId: string;
  /** Inclusive local work dates, YYYY-MM-DD. */
  startDate: string;
  endDate: string;
}

export interface DismissTimeEntrySuggestionInput {
  userId: string;
  ticketId: string;
  workDate: string;
}

export interface DismissAllTimeEntrySuggestionsInput {
  userId: string;
  workDate: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function expectedOrThrow(error: unknown): TimeSheetActionError {
  const expected = timeSheetActionErrorFrom(error);
  if (expected) return expected;
  throw error;
}

function assertDate(value: string, label: string): void {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`Invalid ${label}`);
  }
}

async function loadSuggestions(
  db: Knex | Knex.Transaction,
  tenant: string,
  userId: string,
  startDate: string,
  endDate: string,
): Promise<TimeEntrySuggestion[]> {
  const scoped = tenantDb(db, tenant);
  const timeZone = await resolveUserTimeZone(db, tenant, userId);

  // Local dates map to UTC instants within +/-14h of the date boundary; over-fetch by a day on each
  // side and let deriveSuggestions assign the authoritative local date, then trim to the range.
  const fromInstant = new Date(Date.parse(`${startDate}T00:00:00Z`) - DAY_MS);
  const toInstant = new Date(Date.parse(`${endDate}T00:00:00Z`) + 2 * DAY_MS);

  const auditQuery = scoped.table('ticket_audit_logs');
  scoped.tenantJoin(auditQuery, 'tickets', 'ticket_audit_logs.ticket_id', 'tickets.ticket_id');
  scoped.tenantJoin(auditQuery, 'clients', 'tickets.client_id', 'clients.client_id', { type: 'left' });
  const touches = await auditQuery
    .where('ticket_audit_logs.actor_type', 'user')
    .where('ticket_audit_logs.actor_user_id', userId)
    .where('ticket_audit_logs.occurred_at', '>=', fromInstant)
    .where('ticket_audit_logs.occurred_at', '<', toInstant)
    .orderBy('ticket_audit_logs.occurred_at', 'asc')
    .select(
      'ticket_audit_logs.ticket_id',
      'ticket_audit_logs.occurred_at',
      'ticket_audit_logs.event_type',
      'tickets.ticket_number',
      'tickets.title',
      'clients.client_name',
    );
  if (touches.length === 0) return [];

  const [loggedRows, openRows, dismissalRows] = await Promise.all([
    scoped.table('time_entries')
      .where({ user_id: userId, work_item_type: 'ticket' })
      .whereBetween('work_date', [startDate, endDate])
      .select('work_item_id as ticket_id', 'work_date'),
    scoped.table('time_tracking_sessions')
      .where({ user_id: userId, work_item_type: 'ticket' })
      .whereIn('status', ['running', 'paused'])
      .select('work_item_id'),
    scoped.table('time_entry_suggestion_dismissals')
      .where({ user_id: userId, work_item_type: 'ticket' })
      .whereBetween('work_date', [startDate, endDate])
      .select('work_item_id as ticket_id', 'work_date'),
  ]);

  return deriveSuggestions({
    touches,
    timeZone,
    loggedPairs: loggedRows.map((r: any) => ({ ticket_id: r.ticket_id, work_date: toWorkDateString(r.work_date) })),
    openSessionTicketIds: openRows.map((r: any) => r.work_item_id).filter(Boolean),
    dismissals: dismissalRows.map((r: any) => ({ ticket_id: r.ticket_id, work_date: toWorkDateString(r.work_date) })),
  }).filter((s) => s.work_date >= startDate && s.work_date <= endDate);
}

async function insertDismissals(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  pairs: Array<{ ticketId: string; workDate: string }>,
): Promise<void> {
  if (pairs.length === 0) return;
  // Column-target ON CONFLICT (not the constraint name): Citus suffixes constraint names per shard.
  await tenantDb(trx, tenant)
    .table('time_entry_suggestion_dismissals')
    .insert(pairs.map((p) => ({
      tenant,
      user_id: userId,
      work_item_type: 'ticket',
      work_item_id: p.ticketId,
      work_date: p.workDate,
    })))
    .onConflict(['tenant', 'user_id', 'work_item_type', 'work_item_id', 'work_date'])
    .ignore();
}

async function authorize(
  user: Parameters<typeof assertCanActOnBehalf>[0],
  tenant: string,
  subjectUserId: string,
  db: Knex,
): Promise<TimeSheetActionError | null> {
  if (!await hasPermission(user, 'time_entry', 'read', db)) {
    return permissionError('Permission denied: Cannot read time entries');
  }
  await assertCanActOnBehalf(user, tenant, subjectUserId, db);
  return null;
}

export const getTimeEntrySuggestions = withAuth(async (
  user,
  { tenant },
  input: GetTimeEntrySuggestionsInput,
): Promise<TimeEntrySuggestion[] | TimeSheetActionError> => {
  const { knex } = await createTenantKnex();
  try {
    assertDate(input.startDate, 'start date');
    assertDate(input.endDate, 'end date');
    const denied = await authorize(user, tenant, input.userId, knex);
    if (denied) return denied;
    return await loadSuggestions(knex, tenant, input.userId, input.startDate, input.endDate);
  } catch (error) {
    return expectedOrThrow(error);
  }
});

export const dismissTimeEntrySuggestion = withAuth(async (
  user,
  { tenant },
  input: DismissTimeEntrySuggestionInput,
): Promise<{ dismissed: number } | TimeSheetActionError> => {
  const { knex } = await createTenantKnex();
  try {
    assertDate(input.workDate, 'work date');
    const denied = await authorize(user, tenant, input.userId, knex);
    if (denied) return denied;
    await knex.transaction((trx) =>
      insertDismissals(trx, tenant, input.userId, [{ ticketId: input.ticketId, workDate: input.workDate }]));
    return { dismissed: 1 };
  } catch (error) {
    return expectedOrThrow(error);
  }
});

/** Dismiss every ticket currently suggested for the user on one local work date. */
export const dismissAllTimeEntrySuggestionsForDay = withAuth(async (
  user,
  { tenant },
  input: DismissAllTimeEntrySuggestionsInput,
): Promise<{ dismissed: number } | TimeSheetActionError> => {
  const { knex } = await createTenantKnex();
  try {
    assertDate(input.workDate, 'work date');
    const denied = await authorize(user, tenant, input.userId, knex);
    if (denied) return denied;
    return await knex.transaction(async (trx) => {
      const suggestions = await loadSuggestions(trx, tenant, input.userId, input.workDate, input.workDate);
      await insertDismissals(
        trx,
        tenant,
        input.userId,
        suggestions.map((s) => ({ ticketId: s.ticket_id, workDate: s.work_date })),
      );
      return { dismissed: suggestions.length };
    });
  } catch (error) {
    return expectedOrThrow(error);
  }
});
