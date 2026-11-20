'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { RequestLocalAuthorizationCache } from '@alga-psa/authorization/kernel';
import { resolveTimeEntryMode } from '../lib/timeEntryMode';
import { resolveTimeEntryReadScope } from '../lib/timeEntryAuthorizationSql';
import { timeSheetActionErrorFrom, type TimeSheetActionError } from './timeSheetActionErrors';

/**
 * One of the signed-in seat technician's own operational entries, as the list shows it. Display fields only;
 * `entry_id` is the key the edit and delete actions take, never a column.
 */
export interface OwnOperationalTimeEntry {
  entry_id: string;
  work_item_type: string;
  work_item_id: string;
  ticket_number: string | null;
  ticket_title: string | null;
  start_time: string;
  end_time: string;
  /** Actual minutes, from the start/end instants: operational rows store no billable minutes. */
  minutes: number;
  notes: string | null;
}

/**
 * Lists the signed-in seat technician's OWN operational entries (S28 / F070), newest first, optionally for one ticket
 * or a window. Edit and delete go through `saveTimeEntry` and `deleteTimeEntry`, which hold the same principal rule.
 *
 * The principal decides: for anyone who is not a seat technician this is refused (their time is the timesheet's,
 * not this list's). The user id is always the caller's, never a parameter, so no entry of another user can be listed.
 */
export const fetchOwnOperationalTimeEntries = withAuth(async (
  user,
  { tenant },
  filters: { ticketId?: string; from?: string; to?: string } = {},
): Promise<OwnOperationalTimeEntry[] | TimeSheetActionError> => {
  try {
    const { knex: db } = await createTenantKnex();
    if (!await hasPermission(user, 'time_entry', 'read', db)) {
      throw new Error('Permission denied: Cannot read time entries');
    }
    if (await resolveTimeEntryMode(db, tenant, user.user_id, new RequestLocalAuthorizationCache()) !== 'operational') {
      throw new Error('Permission denied: Operational time is only listed for seat technicians.');
    }

    const scoped = tenantDb(db, tenant);
    const query = scoped.table('time_entries as te');
    scoped.tenantJoin(query, 'tickets as t', 'te.work_item_id', 't.ticket_id', { type: 'left' });
    // Own entries, and of those only what the technician's read scope allows (the same rule the timesheet read holds).
    (await resolveTimeEntryReadScope(db, tenant, user, 'te')).apply(query);
    query.where({ 'te.user_id': user.user_id, 'te.billing_mode': 'operational' });
    if (filters.ticketId) query.where({ 'te.work_item_type': 'ticket', 'te.work_item_id': filters.ticketId });
    if (filters.from) query.where('te.start_time', '>=', filters.from);
    if (filters.to) query.where('te.start_time', '<', filters.to);
    const rows = await query
      .orderBy('te.start_time', 'desc')
      .select('te.entry_id', 'te.work_item_type', 'te.work_item_id', 'te.start_time', 'te.end_time', 'te.notes',
        't.ticket_number', 't.title as ticket_title');

    return rows.map((row: any): OwnOperationalTimeEntry => ({
      entry_id: row.entry_id,
      work_item_type: row.work_item_type,
      work_item_id: row.work_item_id,
      ticket_number: row.ticket_number ?? null,
      ticket_title: row.ticket_title ?? null,
      start_time: new Date(row.start_time).toISOString(),
      end_time: new Date(row.end_time).toISOString(),
      minutes: Math.max(Math.round((new Date(row.end_time).getTime() - new Date(row.start_time).getTime()) / 60000), 0),
      notes: row.notes ?? null,
    }));
  } catch (error) {
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
