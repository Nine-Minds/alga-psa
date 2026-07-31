'use server'

import { Knex } from 'knex';
import { formatISO } from 'date-fns';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { validateArray } from '@alga-psa/validation';
import { ITimeEntryChangeRequest } from '@alga-psa/types';
import { assertCanActOnBehalf } from './timeEntryDelegationAuth';
import { timeEntryChangeRequestSchema } from '../schemas/timeSheet.schemas';
import { groupTimeEntryChangeRequestsByEntryId } from '../lib/timeEntryChangeRequests';
import {
  timeSheetActionErrorFrom,
  type TimeSheetActionError,
} from './timeSheetActionErrors';

interface DbTimeEntryChangeRequestRow {
  change_request_id: string;
  time_entry_id: string;
  time_sheet_id: string;
  comment: string;
  created_at: string | Date;
  created_by: string;
  created_by_name?: string;
  handled_at?: string | Date | null;
  handled_by?: string | null;
  tenant: string;
}

function toIso(value?: string | Date | null): string | undefined {
  if (!value) {
    return undefined;
  }

  return formatISO(new Date(value));
}

function mapDbTimeEntryChangeRequest(
  row: DbTimeEntryChangeRequestRow,
): ITimeEntryChangeRequest {
  return {
    change_request_id: row.change_request_id,
    time_entry_id: row.time_entry_id,
    time_sheet_id: row.time_sheet_id,
    comment: row.comment,
    created_at: formatISO(new Date(row.created_at)),
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    handled_at: toIso(row.handled_at),
    handled_by: row.handled_by ?? undefined,
    tenant: row.tenant,
  };
}

export async function fetchTimeEntryChangeRequestsForEntryIdsFromDb(
  db: Knex | Knex.Transaction,
  tenant: string,
  entryIds: string[],
): Promise<Map<string, ITimeEntryChangeRequest[]>> {
  if (entryIds.length === 0) {
    return new Map();
  }

  const scopedDb = tenantDb(db, tenant);
  const query = scopedDb.table('time_entry_change_requests as change_requests');
  scopedDb.tenantJoin(query, 'users as authors', 'change_requests.created_by', 'authors.user_id', { type: 'left' });

  const rows = await query
    .whereIn('change_requests.time_entry_id', entryIds)
    .select(
      'change_requests.change_request_id as change_request_id',
      'change_requests.time_entry_id as time_entry_id',
      'change_requests.time_sheet_id as time_sheet_id',
      'change_requests.comment as comment',
      'change_requests.created_at as created_at',
      'change_requests.created_by as created_by',
      'change_requests.handled_at as handled_at',
      'change_requests.handled_by as handled_by',
      'change_requests.tenant as tenant',
      db.raw("TRIM(CONCAT(COALESCE(authors.first_name, ''), ' ', COALESCE(authors.last_name, ''))) as created_by_name"),
    )
    .orderBy('change_requests.created_at', 'desc');

  return groupTimeEntryChangeRequestsByEntryId(
    validateArray(
      timeEntryChangeRequestSchema,
      rows.map((row) => mapDbTimeEntryChangeRequest(row as unknown as DbTimeEntryChangeRequestRow)),
    ) as ITimeEntryChangeRequest[],
  );
}

export async function createTimeEntryChangeRequestRecord(
  db: Knex | Knex.Transaction,
  params: {
    tenant: string;
    timeEntryId: string;
    timeSheetId: string;
    comment: string;
    createdBy: string;
  },
): Promise<void> {
  await tenantDb(db, params.tenant).table('time_entry_change_requests').insert({
    change_request_id: db.raw('gen_random_uuid()'),
    time_entry_id: params.timeEntryId,
    time_sheet_id: params.timeSheetId,
    comment: params.comment,
    created_by: params.createdBy,
    created_at: db.fn.now(),
    tenant: params.tenant,
  });
}

export async function markTimeEntryChangeRequestsHandled(
  db: Knex | Knex.Transaction,
  params: {
    tenant: string;
    timeEntryId: string;
    handledBy: string;
  },
): Promise<void> {
  await tenantDb(db, params.tenant).table('time_entry_change_requests')
    .where({
      time_entry_id: params.timeEntryId,
    })
    .whereNull('handled_at')
    .update({
      handled_at: db.fn.now(),
      handled_by: params.handledBy,
    });
}

export const fetchTimeEntryChangeRequestsForTimeSheet = withAuth(async (
  user,
  { tenant },
  timeSheetId: string,
): Promise<ITimeEntryChangeRequest[] | TimeSheetActionError> => {
  try {
    const { knex: db } = await createTenantKnex();

    if (!await hasPermission(user, 'timeentry', 'read', db)) {
      throw new Error('Permission denied: Cannot read time entry change requests');
    }

    const timeSheet = await tenantDb(db, tenant).table('time_sheets')
      .where({ id: timeSheetId })
      .select('user_id')
      .first();

    if (!timeSheet) {
      throw new Error('Time sheet not found');
    }

    await assertCanActOnBehalf(user, tenant, timeSheet.user_id, db);

    const scopedDb = tenantDb(db, tenant);
    const query = scopedDb.table('time_entry_change_requests as change_requests');
    scopedDb.tenantJoin(query, 'users as authors', 'change_requests.created_by', 'authors.user_id', { type: 'left' });

    const rows = await query
      .where({ 'change_requests.time_sheet_id': timeSheetId })
      .select(
        'change_requests.change_request_id as change_request_id',
        'change_requests.time_entry_id as time_entry_id',
        'change_requests.time_sheet_id as time_sheet_id',
        'change_requests.comment as comment',
        'change_requests.created_at as created_at',
        'change_requests.created_by as created_by',
        'change_requests.handled_at as handled_at',
        'change_requests.handled_by as handled_by',
        'change_requests.tenant as tenant',
        db.raw("TRIM(CONCAT(COALESCE(authors.first_name, ''), ' ', COALESCE(authors.last_name, ''))) as created_by_name"),
      )
      .orderBy('change_requests.created_at', 'desc');

    return validateArray(
      timeEntryChangeRequestSchema,
      rows.map((row) => mapDbTimeEntryChangeRequest(row as unknown as DbTimeEntryChangeRequestRow)),
    ) as ITimeEntryChangeRequest[];
  } catch (error) {
    console.error('Error fetching time entry change requests:', error);
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
