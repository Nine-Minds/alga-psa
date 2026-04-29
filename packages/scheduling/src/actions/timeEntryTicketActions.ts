'use server';

import type { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { formatISO } from 'date-fns';
import type { IUser, TimeSheetStatus } from '@alga-psa/types';

export interface TicketTimeEntrySummaryEntry {
  entry_id: string;
  user_id: string;
  user_name: string | null;
  start_time: string;
  end_time: string;
  work_date: string | null;
  billable_duration: number;
  notes: string | null;
  approval_status: TimeSheetStatus;
  service_id: string | null;
  service_name: string | null;
  is_own: boolean;
}

export interface TicketTimeEntriesSummary {
  entries: TicketTimeEntrySummaryEntry[];
  ownTotalMinutes: number;
  othersTotalMinutes: number;
  totalMinutes: number;
  ownEntryCount: number;
  othersEntryCount: number;
  canViewOthers: boolean;
}

interface RawRow {
  entry_id: string;
  user_id: string;
  user_name: string | null;
  start_time: Date;
  end_time: Date;
  work_date: Date | string | null;
  billable_duration: number | string | null;
  notes: string | null;
  approval_status: TimeSheetStatus;
  service_id: string | null;
  service_name: string | null;
}

function normalizeWorkDate(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/**
 * Core logic shared between the session-bound server action and the API controller.
 * Callers must have already authenticated the user and resolved the tenant context.
 */
export async function fetchTimeEntriesForTicketCore(
  user: IUser,
  tenant: string,
  db: Knex,
  ticketId: string,
): Promise<TicketTimeEntriesSummary> {
  if (!ticketId) {
    throw new Error('Ticket ID is required');
  }

  if (!await hasPermission(user, 'timeentry', 'read', db)) {
    throw new Error('Permission denied: Cannot read time entries');
  }

  const canViewOthers = await hasPermission(user, 'timesheet', 'read_all', db);

  const rows: RawRow[] = await db('time_entries')
    .leftJoin('users', function joinUsers() {
      this.on('time_entries.user_id', '=', 'users.user_id')
        .andOn('time_entries.tenant', '=', 'users.tenant');
    })
    .leftJoin('service_catalog', function joinServices() {
      this.on('time_entries.service_id', '=', 'service_catalog.service_id')
        .andOn('time_entries.tenant', '=', 'service_catalog.tenant');
    })
    .where({
      'time_entries.tenant': tenant,
      'time_entries.work_item_type': 'ticket',
      'time_entries.work_item_id': ticketId,
    })
    .orderBy('time_entries.start_time', 'desc')
    .select(
      'time_entries.entry_id',
      'time_entries.user_id',
      'time_entries.start_time',
      'time_entries.end_time',
      'time_entries.work_date',
      'time_entries.billable_duration',
      'time_entries.notes',
      'time_entries.approval_status',
      'time_entries.service_id',
      'service_catalog.service_name',
      db.raw(`TRIM(CONCAT_WS(' ', NULLIF(users.first_name, ''), NULLIF(users.last_name, ''))) AS user_name`),
    );

  const visible: TicketTimeEntrySummaryEntry[] = [];
  let ownTotal = 0;
  let othersTotal = 0;
  let ownCount = 0;
  let othersCount = 0;

  for (const row of rows) {
    const isOwn = row.user_id === user.user_id;
    const minutes = Number(row.billable_duration) || 0;

    if (isOwn) {
      ownTotal += minutes;
      ownCount += 1;
    } else {
      othersTotal += minutes;
      othersCount += 1;
    }

    if (isOwn || canViewOthers) {
      visible.push({
        entry_id: row.entry_id,
        user_id: row.user_id,
        user_name: row.user_name?.trim() || null,
        start_time: formatISO(row.start_time),
        end_time: formatISO(row.end_time),
        work_date: normalizeWorkDate(row.work_date),
        billable_duration: minutes,
        notes: row.notes,
        approval_status: row.approval_status,
        service_id: row.service_id,
        service_name: row.service_name,
        is_own: isOwn,
      });
    }
  }

  return {
    entries: visible,
    ownTotalMinutes: ownTotal,
    othersTotalMinutes: othersTotal,
    totalMinutes: ownTotal + othersTotal,
    ownEntryCount: ownCount,
    othersEntryCount: othersCount,
    canViewOthers,
  };
}

export const fetchTimeEntriesForTicket = withAuth(async (
  user,
  { tenant },
  ticketId: string,
): Promise<TicketTimeEntriesSummary> => {
  const { knex: db } = await createTenantKnex();
  return fetchTimeEntriesForTicketCore(user, tenant, db, ticketId);
});
